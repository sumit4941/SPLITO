import { describe, expect, it, vi } from 'vitest';
import {
  COLLECTIONS,
  COLLECTION_VALIDATORS,
  MONGO_INDEXES,
  SCHEMA_MIGRATIONS_COLLECTION,
} from './schema.mjs';
import { assertMongoRuntimeReady, MONGO_SCHEMA_DEFINITION_CHECKSUM } from './runtime-readiness.mjs';

function readyMigration() {
  return {
    _id: 1,
    name: 'mongodb-application-baseline',
    checksum: MONGO_SCHEMA_DEFINITION_CHECKSUM,
    appliedAt: new Date(),
  };
}

function createWorkerDatabase(collectionRows, indexes = []) {
  const listCollections = vi.fn(() => ({
    toArray: vi.fn().mockResolvedValue(collectionRows),
  }));
  const collection = vi.fn((name) => {
    if (name === SCHEMA_MIGRATIONS_COLLECTION) {
      return { findOne: vi.fn().mockResolvedValue(readyMigration()) };
    }
    if (name === COLLECTIONS.outbox) {
      return {
        listIndexes: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(indexes) })),
      };
    }
    throw new Error(`Unexpected collection lookup: ${name}`);
  });

  return {
    database: {
      admin: vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) })),
      collection,
      listCollections,
    },
    listCollections,
  };
}

describe('MongoDB runtime readiness', () => {
  it('uses an Atlas-compatible empty collection filter and ignores unrelated collections', async () => {
    const { database, listCollections } = createWorkerDatabase([
      { name: COLLECTIONS.outbox },
      { name: 'unrelatedCollection' },
    ]);

    await expect(assertMongoRuntimeReady(database, 'worker')).resolves.toBeUndefined();
    expect(listCollections).toHaveBeenCalledWith(
      {},
      { nameOnly: true, authorizedCollections: true },
    );
  });

  it('still fails closed when a required collection is missing', async () => {
    const { database } = createWorkerDatabase([{ name: 'unrelatedCollection' }]);

    await expect(assertMongoRuntimeReady(database, 'worker')).rejects.toThrow(
      'required collections are missing for worker',
    );
  });

  it('requests full definitions only when managed schema validation is enabled', async () => {
    const outboxIndexes = MONGO_INDEXES.find(
      ({ collection }) => collection === COLLECTIONS.outbox,
    ).indexes;
    const { database, listCollections } = createWorkerDatabase(
      [
        {
          name: COLLECTIONS.outbox,
          options: {
            validator: COLLECTION_VALIDATORS[COLLECTIONS.outbox],
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      ],
      outboxIndexes,
    );

    await expect(
      assertMongoRuntimeReady(database, 'worker', { verifyManagedSchema: true }),
    ).resolves.toBeUndefined();
    expect(listCollections).toHaveBeenCalledWith({}, { nameOnly: false });
  });
});
