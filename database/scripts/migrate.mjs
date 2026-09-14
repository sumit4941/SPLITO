import { connectMongo } from '../lib/mongodb-env.mjs';
import { MONGO_SCHEMA_DEFINITION_CHECKSUM } from '../runtime-readiness.mjs';
import {
  COLLECTIONS,
  ensureMongoSchema,
  REFERENCE_CURRENCIES,
  SCHEMA_MIGRATIONS_COLLECTION,
  SCHEMA_VERSION,
} from '../schema.mjs';

const { client, database } = await connectMongo();

try {
  const migrations = database.collection(SCHEMA_MIGRATIONS_COLLECTION);
  const existing = await migrations.findOne({ _id: SCHEMA_VERSION });
  if (existing && existing.checksum !== MONGO_SCHEMA_DEFINITION_CHECKSUM) {
    throw new Error(
      `MongoDB schema version ${SCHEMA_VERSION} has a different checksum; add a new forward migration instead of changing an applied definition`,
    );
  }

  await ensureMongoSchema(database);

  const currencies = database.collection(COLLECTIONS.currencies);
  for (const currency of REFERENCE_CURRENCIES) {
    await currencies.updateOne({ _id: currency._id }, { $setOnInsert: currency }, { upsert: true });
  }

  await migrations.updateOne(
    { _id: SCHEMA_VERSION },
    {
      $setOnInsert: {
        name: 'mongodb-application-baseline',
        checksum: MONGO_SCHEMA_DEFINITION_CHECKSUM,
        appliedAt: new Date(),
      },
    },
    { upsert: true },
  );

  process.stdout.write(
    `MongoDB schema version ${SCHEMA_VERSION} is ready in database ${database.databaseName}.\n`,
  );
} finally {
  await client.close();
}
