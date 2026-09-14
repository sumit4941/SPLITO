import { randomUUID } from 'node:crypto';
import { loadEnvironment, type Environment } from '@splito/config';
import type { Collection, Decimal128, Document } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  COLLECTIONS,
  MongoService,
  minorToDecimal,
  type MongoCollectionName,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { SettlementsRepository } from '../settlements/settlements.repository.js';
import { SettlementsService } from '../settlements/settlements.service.js';
import type { ExpenseMutationInput } from './expenses.schemas.js';
import { ExpensesRepository } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';

const integrationUri = process.env.MONGODB_INTEGRATION_URI;

interface StringIdDocument extends Document {
  _id: string;
}

function mongoCollection(
  work: MongoUnitOfWork,
  name: MongoCollectionName,
): Collection<StringIdDocument> {
  return work.db.collection<StringIdDocument>(name);
}

describe.skipIf(!integrationUri)('MongoDB financial transaction integration', () => {
  let config: Environment;
  let mongo: MongoService;
  let expensesRepository: ExpensesRepository;
  let expenses: ExpensesService;
  let settlements: SettlementsService;

  const contextId = randomUUID();
  const groupId = randomUUID();
  const creatorId = randomUUID();
  const memberId = randomUUID();
  const creatorUserId = randomUUID();
  const memberUserId = randomUUID();
  const overflowProjectionId = randomUUID();
  const overflowContextId = randomUUID();
  const overflowParticipantId = randomUUID();
  const actorIds = [creatorId, memberId];

  const creatorAuth: AuthContext = {
    sessionId: randomUUID(),
    csrfHash: Buffer.alloc(32, 1),
    user: {
      id: creatorId,
      userId: creatorUserId,
      participantId: creatorId,
      displayName: 'Mongo Creator',
      mobileNumber: '+12025550101',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      defaultCurrency: 'INR',
      theme: 'system',
      reducedMotion: false,
      version: '1',
    },
  };
  const memberAuth: AuthContext = {
    ...creatorAuth,
    sessionId: randomUUID(),
    user: {
      ...creatorAuth.user,
      id: memberId,
      userId: memberUserId,
      participantId: memberId,
      displayName: 'Mongo Member',
      mobileNumber: '+12025550102',
    },
  };

  beforeAll(async () => {
    if (!integrationUri) throw new Error('MONGODB_INTEGRATION_URI is required');
    config = loadEnvironment({
      NODE_ENV: 'test',
      MONGODB_URI: integrationUri,
      MONGODB_DATABASE: process.env.MONGODB_INTEGRATION_DATABASE ?? 'splito_ci',
    });
    mongo = new MongoService(config);
    await mongo.onModuleInit();
    const access = new ContextAccessRepository(mongo);
    const idempotency = new IdempotencyService(mongo);
    expensesRepository = new ExpensesRepository();
    expenses = new ExpensesService(mongo, access, expensesRepository, idempotency);
    settlements = new SettlementsService(
      mongo,
      access,
      expensesRepository,
      new SettlementsRepository(),
      idempotency,
    );

    const now = new Date();
    await mongo.withTransaction(async (work) => {
      for (const participant of [
        { _id: creatorId, userId: creatorUserId, displayName: 'Mongo Creator' },
        { _id: memberId, userId: memberUserId, displayName: 'Mongo Member' },
      ]) {
        await mongoCollection(work, COLLECTIONS.participants).insertOne(
          {
            ...participant,
            kind: 'USER',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          },
          { session: work.session },
        );
      }
      await mongoCollection(work, COLLECTIONS.contexts).insertOne(
        {
          _id: contextId,
          type: 'GROUP',
          defaultCurrencyCode: 'INR',
          simplificationEnabled: false,
          status: 'ACTIVE',
          mutationVersion: 1,
          createdByParticipantId: creatorId,
          createdAt: now,
          updatedAt: now,
        },
        { session: work.session },
      );
      await mongoCollection(work, COLLECTIONS.groups).insertOne(
        {
          _id: groupId,
          contextId,
          name: 'Mongo transaction test',
          type: 'TRIP',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
        { session: work.session },
      );
      for (const [allocationOrder, participantId] of [creatorId, memberId].entries()) {
        await mongoCollection(work, COLLECTIONS.contextMembers).insertOne(
          {
            _id: randomUUID(),
            contextId,
            participantId,
            role: allocationOrder === 0 ? 'OWNER' : 'MEMBER',
            status: 'ACTIVE',
            allocationOrder,
            addedByParticipantId: creatorId,
            joinedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          { session: work.session },
        );
      }
    });
  });

  afterAll(async () => {
    if (!mongo) return;
    await mongo.withConnection(async (work) => {
      const expenseIds = await mongoCollection(work, COLLECTIONS.expenses).distinct('_id', {
        contextId,
      });
      const settlementIds = await mongoCollection(work, COLLECTIONS.settlements).distinct('_id', {
        contextId,
      });
      await mongoCollection(work, COLLECTIONS.expenseRevisions).deleteMany({
        expenseId: { $in: expenseIds },
      });
      await mongoCollection(work, COLLECTIONS.settlementRevisions).deleteMany({
        settlementId: { $in: settlementIds },
      });
      for (const collectionName of [
        COLLECTIONS.ledgerBatches,
        COLLECTIONS.balanceProjections,
        COLLECTIONS.bilateralProjections,
        COLLECTIONS.expenses,
        COLLECTIONS.settlements,
        COLLECTIONS.auditEvents,
      ]) {
        await mongoCollection(work, collectionName).deleteMany({ contextId });
      }
      await mongoCollection(work, COLLECTIONS.outbox).deleteMany({
        'payload.contextId': contextId,
      });
      await mongoCollection(work, COLLECTIONS.idempotencyKeys).deleteMany({
        actorParticipantId: { $in: actorIds },
      });
      await mongoCollection(work, COLLECTIONS.idempotencyReceipts).deleteMany({
        actorParticipantId: { $in: actorIds },
      });
      await mongoCollection(work, COLLECTIONS.contextMembers).deleteMany({ contextId });
      await mongoCollection(work, COLLECTIONS.groups).deleteMany({ _id: groupId });
      await mongoCollection(work, COLLECTIONS.contexts).deleteMany({ _id: contextId });
      await mongoCollection(work, COLLECTIONS.participants).deleteMany({
        _id: { $in: [creatorId, memberId] },
      });
      await mongoCollection(work, COLLECTIONS.balanceProjections).deleteMany({
        _id: overflowProjectionId,
      });
    });
    await mongo.onApplicationShutdown();
  });

  it('atomically creates, concurrently edits, and settles an expense under strict validators', async () => {
    const initial: ExpenseMutationInput = {
      groupId,
      description: 'Integration dinner',
      amountMinor: '1000',
      currency: 'INR',
      expenseDate: '2026-09-14',
      category: 'food',
      splitMethod: 'equal',
      payers: [{ participantId: creatorId, paidAmountMinor: '1000' }],
      beneficiaries: [{ participantId: creatorId }, { participantId: memberId }],
    };
    const created = await expenses.create(initial, creatorAuth, {
      idempotencyKey: `create-${randomUUID()}`,
      requestId: randomUUID(),
    });
    expect(created.data).toMatchObject({ version: '1', amount: { amountMinor: '1000' } });

    const edited: ExpenseMutationInput = {
      ...initial,
      description: 'Integration dinner corrected',
      amountMinor: '1200',
      payers: [{ participantId: creatorId, paidAmountMinor: '1200' }],
    };
    const editAttempts = await Promise.allSettled(
      [0, 1].map((attempt) =>
        expenses.update(created.data.id, edited, creatorAuth, {
          idempotencyKey: `edit-${attempt}-${randomUUID()}`,
          expectedVersion: '1',
          requestId: randomUUID(),
        }),
      ),
    );
    const successfulEdits = editAttempts.filter((result) => result.status === 'fulfilled');
    const rejectedEdits = editAttempts.filter((result) => result.status === 'rejected');
    expect(successfulEdits).toHaveLength(1);
    expect(rejectedEdits).toHaveLength(1);
    expect(rejectedEdits[0]).toMatchObject({
      reason: expect.objectContaining({ code: 'RESOURCE_VERSION_MISMATCH', status: 412 }),
    });

    const previewInput = {
      context: { id: groupId, type: 'group' as const },
      senderId: memberId,
      recipientId: creatorId,
      currency: 'INR',
      amountMinor: '600',
      settlementDate: '2026-09-14',
      method: 'upi' as const,
    };
    const preview = await settlements.preview(previewInput, memberAuth);
    expect(preview).toMatchObject({ outstandingAmountMinor: '600', overpayment: false });
    const settled = await settlements.create(
      { ...previewInput, previewVersion: preview.previewVersion, overpaymentConfirmed: false },
      memberAuth,
      { idempotencyKey: `settle-${randomUUID()}`, requestId: randomUUID() },
    );
    expect(settled.data).toMatchObject({ status: 'posted', version: '1' });

    await mongo.withConnection(async (work) => {
      const balances = await mongoCollection(work, COLLECTIONS.balanceProjections)
        .find({ contextId })
        .toArray();
      expect(balances).toHaveLength(2);
      expect(balances.every((row) => (row.netMinor as Decimal128).toString() === '0')).toBe(true);
      await expect(
        mongoCollection(work, COLLECTIONS.ledgerBatches).countDocuments({ contextId }),
      ).resolves.toBe(4);
      await expect(
        mongoCollection(work, COLLECTIONS.idempotencyReceipts).countDocuments({
          actorParticipantId: { $in: actorIds },
        }),
      ).resolves.toBe(3);
    });
  });

  it('rolls back a projection increment that crosses the signed 19-digit bound', async () => {
    const maximum = '9999999999999999999';
    const now = new Date();
    await mongo.withConnection(async (work) => {
      await mongoCollection(work, COLLECTIONS.balanceProjections).insertOne({
        _id: overflowProjectionId,
        contextId: overflowContextId,
        participantId: overflowParticipantId,
        currencyCode: 'INR',
        netMinor: minorToDecimal(maximum),
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      mongo.withTransaction((work) =>
        expensesRepository.applyBalanceDelta(work, {
          contextId: overflowContextId,
          participantId: overflowParticipantId,
          currency: 'INR',
          deltaMinor: 1n,
        }),
      ),
    ).rejects.toThrow(/19-digit/u);
    await mongo.withConnection(async (work) => {
      const projection = await mongoCollection(work, COLLECTIONS.balanceProjections).findOne({
        _id: overflowProjectionId,
      });
      expect((projection?.netMinor as Decimal128 | undefined)?.toString()).toBe(maximum);
      expect(projection?.version).toBe(1);
    });
  });
});
