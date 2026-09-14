import argon2 from 'argon2';
import { Decimal128 } from 'mongodb';

import { connectMongo } from '../lib/mongodb-env.mjs';
import { COLLECTIONS } from '../schema.mjs';

if (
  process.env.NODE_ENV !== 'development' ||
  process.env.SPLITO_ALLOW_DEVELOPMENT_SEED !== 'true'
) {
  throw new Error(
    'Refusing to seed unless NODE_ENV=development and SPLITO_ALLOW_DEVELOPMENT_SEED=true',
  );
}

const demoPassword = process.env.SPLITO_DEMO_PASSWORD ?? 'SplitoDemo!2026'; // gitleaks:allow
if (demoPassword.length < 12) {
  throw new Error('SPLITO_DEMO_PASSWORD must contain at least 12 characters');
}

const IDs = Object.freeze({
  aliceUser: '10000000-0000-0000-0000-000000000001',
  bobUser: '10000000-0000-0000-0000-000000000002',
  caseyUser: '10000000-0000-0000-0000-000000000003',
  aliceParticipant: '20000000-0000-0000-0000-000000000001',
  bobParticipant: '20000000-0000-0000-0000-000000000002',
  caseyParticipant: '20000000-0000-0000-0000-000000000003',
  context: '30000000-0000-0000-0000-000000000001',
  group: '40000000-0000-0000-0000-000000000001',
  expense: '60000000-0000-0000-0000-000000000001',
  revision: '61000000-0000-0000-0000-000000000001',
  batch: '64000000-0000-0000-0000-000000000001',
  idempotency: '69000000-0000-0000-0000-000000000001',
  idempotencyScope: 'a'.repeat(64),
});

const userFixtures = [
  {
    _id: IDs.aliceUser,
    participantId: IDs.aliceParticipant,
    emailNormalized: 'alice@splito.example',
    mobileE164: '+12025550101',
    displayName: 'Alice Rao',
  },
  {
    _id: IDs.bobUser,
    participantId: IDs.bobParticipant,
    emailNormalized: 'bob@splito.example',
    mobileE164: '+12025550102',
    displayName: 'Bob Singh',
  },
  {
    _id: IDs.caseyUser,
    participantId: IDs.caseyParticipant,
    emailNormalized: 'casey@splito.example',
    mobileE164: '+12025550103',
    displayName: 'Casey Shah',
  },
];

const passwordHashes = await Promise.all(
  userFixtures.map(() =>
    argon2.hash(demoPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    }),
  ),
);

const { client, database } = await connectMongo();
const session = client.startSession();

try {
  await session.withTransaction(
    async () => {
      const users = database.collection(COLLECTIONS.users);
      const existingFixtureCount = await users.countDocuments(
        { _id: { $in: userFixtures.map(({ _id }) => _id) } },
        { session },
      );
      if (existingFixtureCount !== 0 && existingFixtureCount !== userFixtures.length) {
        throw new Error('Partial demo identity data exists; inspect it before retrying the seed');
      }

      const conflictingIdentity = await users.findOne(
        {
          $or: userFixtures.flatMap((fixture) => [
            { emailNormalized: fixture.emailNormalized, _id: { $ne: fixture._id } },
            { mobileE164: fixture.mobileE164, _id: { $ne: fixture._id } },
          ]),
        },
        { session, projection: { _id: 1 } },
      );
      if (conflictingIdentity) {
        throw new Error('Reserved fictional demo identities conflict with existing users');
      }

      const now = new Date();
      const resetPasswords = process.env.SPLITO_RESET_DEMO_PASSWORDS === 'true';
      for (const [index, fixture] of userFixtures.entries()) {
        const existingUser = await users.findOne(
          { _id: fixture._id },
          { session, projection: { passwordHash: 1, authFence: 1 } },
        );
        const userSet = {
          emailNormalized: fixture.emailNormalized,
          emailVerifiedAt: now,
          mobileE164: fixture.mobileE164,
          mobileVerifiedAt: now,
          displayName: fixture.displayName,
          defaultCurrencyCode: 'INR',
          localeCode: 'en-IN',
          timezoneName: 'Asia/Kolkata',
          theme: 'SYSTEM',
          reducedMotion: false,
          status: 'ACTIVE',
          updatedAt: now,
        };
        if (!existingUser?.passwordHash || resetPasswords) {
          userSet.passwordHash = passwordHashes[index];
        }
        if (typeof existingUser?.authFence !== 'number') {
          userSet.authFence = 1;
        }
        await users.updateOne(
          { _id: fixture._id },
          {
            $set: userSet,
            $setOnInsert: { createdAt: now },
            ...(existingUser && resetPasswords && typeof existingUser.authFence === 'number'
              ? { $inc: { authFence: 1 } }
              : {}),
          },
          { upsert: true, session },
        );
        await database.collection(COLLECTIONS.participants).updateOne(
          { _id: fixture.participantId },
          {
            $set: {
              userId: fixture._id,
              kind: 'USER',
              displayName: fixture.displayName,
              status: 'ACTIVE',
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          { upsert: true, session },
        );
        await database.collection(COLLECTIONS.userPreferences).updateOne(
          { _id: fixture._id },
          {
            $set: { userId: fixture._id, updatedAt: now },
            $setOnInsert: {
              createdAt: now,
            },
          },
          { upsert: true, session },
        );
      }

      await database.collection(COLLECTIONS.contexts).updateOne(
        { _id: IDs.context },
        {
          $setOnInsert: {
            type: 'GROUP',
            defaultCurrencyCode: 'INR',
            simplificationEnabled: true,
            status: 'ACTIVE',
            createdByParticipantId: IDs.aliceParticipant,
            createdAt: now,
            updatedAt: now,
            mutationVersion: 1,
          },
        },
        { upsert: true, session },
      );
      await database.collection(COLLECTIONS.groups).updateOne(
        { _id: IDs.group },
        {
          $setOnInsert: {
            contextId: IDs.context,
            name: 'Jaipur Weekend',
            description: 'Synthetic group for local development',
            type: 'TRIP',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      );

      for (const [index, fixture] of userFixtures.entries()) {
        await database.collection(COLLECTIONS.contextMembers).updateOne(
          { _id: `50000000-0000-0000-0000-00000000000${index + 1}` },
          {
            $setOnInsert: {
              contextId: IDs.context,
              participantId: fixture.participantId,
              role: index === 0 ? 'OWNER' : 'MEMBER',
              status: 'ACTIVE',
              allocationOrder: index,
              joinedAt: now,
              addedByParticipantId: IDs.aliceParticipant,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true, session },
        );
      }

      await database.collection(COLLECTIONS.expenses).updateOne(
        { _id: IDs.expense },
        {
          $setOnInsert: {
            contextId: IDs.context,
            description: 'Museum tickets',
            currencyCode: 'INR',
            expenseDate: '2026-09-12',
            businessTimezone: 'Asia/Kolkata',
            categoryCode: 'ENTERTAINMENT',
            status: 'POSTED',
            currentRevisionId: IDs.revision,
            version: '1',
            createdByParticipantId: IDs.aliceParticipant,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true, session },
      );
      await database.collection(COLLECTIONS.expenseRevisions).updateOne(
        { _id: IDs.revision },
        {
          $setOnInsert: {
            expenseId: IDs.expense,
            revisionNumber: 1,
            totalMinor: Decimal128.fromString('10000'),
            splitMethod: 'EQUAL',
            algorithmVersion: 'splito-largest-remainder-v1',
            originalInputs: {
              beneficiaries: userFixtures.map(({ participantId }) => participantId),
            },
            payers: [
              {
                id: '62000000-0000-0000-0000-000000000001',
                participantId: IDs.aliceParticipant,
                paidMinor: Decimal128.fromString('10000'),
                allocationOrder: 0,
              },
            ],
            shares: userFixtures.map((fixture, index) => ({
              id: `63000000-0000-0000-0000-00000000000${index + 1}`,
              participantId: fixture.participantId,
              owedMinor: Decimal128.fromString(index === 0 ? '3334' : '3333'),
              allocationOrder: index,
            })),
            obligations: userFixtures.slice(1).map((fixture, index) => ({
              id: `66000000-0000-0000-0000-00000000000${index + 1}`,
              debtorParticipantId: fixture.participantId,
              creditorParticipantId: IDs.aliceParticipant,
              amountMinor: Decimal128.fromString('3333'),
              matchOrder: index,
              algorithmVersion: 'splito-bilateral-order-v1',
            })),
            createdByParticipantId: IDs.aliceParticipant,
            createdAt: now,
          },
        },
        { upsert: true, session },
      );
      await database.collection(COLLECTIONS.idempotencyReceipts).updateOne(
        { _id: IDs.idempotency },
        {
          $setOnInsert: {
            scopeId: IDs.idempotencyScope,
            actorParticipantId: IDs.aliceParticipant,
            operationKey: 'expense.create',
            keyHash: 'b'.repeat(64),
            requestHash: 'c'.repeat(64),
            httpStatus: 201,
            resourceId: IDs.expense,
            createdAt: now,
            completedAt: now,
          },
        },
        { upsert: true, session },
      );
      await database.collection(COLLECTIONS.ledgerBatches).updateOne(
        { _id: IDs.batch },
        {
          $setOnInsert: {
            contextId: IDs.context,
            currencyCode: 'INR',
            batchType: 'EXPENSE',
            sourceType: 'EXPENSE',
            sourceId: IDs.expense,
            sourceRevisionId: IDs.revision,
            idempotencyId: IDs.idempotency,
            actorParticipantId: IDs.aliceParticipant,
            postings: [
              {
                id: '65000000-0000-0000-0000-000000000001',
                participantId: IDs.aliceParticipant,
                amountMinor: Decimal128.fromString('6666'),
                postingOrder: 0,
              },
              {
                id: '65000000-0000-0000-0000-000000000002',
                participantId: IDs.bobParticipant,
                amountMinor: Decimal128.fromString('-3333'),
                postingOrder: 1,
              },
              {
                id: '65000000-0000-0000-0000-000000000003',
                participantId: IDs.caseyParticipant,
                amountMinor: Decimal128.fromString('-3333'),
                postingOrder: 2,
              },
            ],
            postedAt: now,
          },
        },
        { upsert: true, session },
      );

      for (const [index, fixture] of userFixtures.entries()) {
        await database.collection(COLLECTIONS.balanceProjections).updateOne(
          { contextId: IDs.context, participantId: fixture.participantId, currencyCode: 'INR' },
          {
            $setOnInsert: {
              _id: `67000000-0000-0000-0000-00000000000${index + 1}`,
              contextId: IDs.context,
              participantId: fixture.participantId,
              currencyCode: 'INR',
              netMinor: Decimal128.fromString(index === 0 ? '6666' : '-3333'),
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true, session },
        );
      }

      for (const [index, highParticipantId] of [
        IDs.bobParticipant,
        IDs.caseyParticipant,
      ].entries()) {
        await database.collection(COLLECTIONS.bilateralProjections).updateOne(
          {
            contextId: IDs.context,
            participantLowId: IDs.aliceParticipant,
            participantHighId: highParticipantId,
            currencyCode: 'INR',
          },
          {
            $setOnInsert: {
              _id: `68000000-0000-0000-0000-00000000000${index + 1}`,
              contextId: IDs.context,
              participantLowId: IDs.aliceParticipant,
              participantHighId: highParticipantId,
              currencyCode: 'INR',
              lowOwesHighMinor: Decimal128.fromString('-3333'),
              version: 1,
              updatedAt: now,
            },
          },
          { upsert: true, session },
        );
      }

      for (const fixture of userFixtures) {
        const seededUser = await users.findOne({ _id: fixture._id }, { session });
        const seededParticipant = await database
          .collection(COLLECTIONS.participants)
          .findOne({ _id: fixture.participantId }, { session });
        const seededPreferences = await database
          .collection(COLLECTIONS.userPreferences)
          .findOne({ _id: fixture._id }, { session });
        if (
          !seededUser ||
          typeof seededUser.passwordHash !== 'string' ||
          seededUser.localeCode !== 'en-IN' ||
          seededUser.timezoneName !== 'Asia/Kolkata' ||
          typeof seededUser.authFence !== 'number' ||
          seededUser.status !== 'ACTIVE' ||
          !seededParticipant ||
          seededParticipant.userId !== fixture._id ||
          seededParticipant.status !== 'ACTIVE' ||
          !(seededParticipant.createdAt instanceof Date) ||
          !(seededParticipant.updatedAt instanceof Date) ||
          !seededPreferences ||
          seededPreferences.userId !== fixture._id ||
          !(seededPreferences.createdAt instanceof Date) ||
          !(seededPreferences.updatedAt instanceof Date)
        ) {
          throw new Error(
            'Seeded authentication fixture does not match the runtime document model',
          );
        }
      }
    },
    {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    },
  );

  process.stdout.write(
    'Development seed ready: alice@splito.example, bob@splito.example, and ' +
      'casey@splito.example use the configured SPLITO_DEMO_PASSWORD; their fictional mobiles ' +
      'are +12025550101, +12025550102, and +12025550103.\n',
  );
} finally {
  await session.endSession();
  await client.close();
}
