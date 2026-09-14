import { randomUUID } from 'node:crypto';
import { loadEnvironment, type Environment } from '@splito/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  MongoService,
  type MongoTransactionalUnitOfWork,
} from '../database/mongo.service.js';
import { IdempotencyService } from './idempotency.service.js';

const integrationUri = process.env.MONGODB_INTEGRATION_URI;

describe.skipIf(!integrationUri)('MongoDB idempotency transaction integration', () => {
  let config: Environment;
  let mongo: MongoService;
  let idempotency: IdempotencyService;
  const actors: string[] = [];

  beforeAll(async () => {
    if (!integrationUri) throw new Error('MONGODB_INTEGRATION_URI is required');
    config = loadEnvironment({
      NODE_ENV: 'test',
      MONGODB_URI: integrationUri,
      MONGODB_DATABASE: process.env.MONGODB_INTEGRATION_DATABASE ?? 'splito_ci',
    });
    mongo = new MongoService(config);
    await mongo.onModuleInit();
    idempotency = new IdempotencyService(mongo);
  });

  afterAll(async () => {
    if (!mongo) return;
    if (actors.length > 0) {
      await mongo.withConnection(async (work) => {
        await work.db.collection(COLLECTIONS.idempotencyKeys).deleteMany({
          actorParticipantId: { $in: actors },
        });
        await work.db.collection(COLLECTIONS.idempotencyReceipts).deleteMany({
          actorParticipantId: { $in: actors },
        });
      });
    }
    await mongo.onApplicationShutdown();
  });

  async function mutate(
    actorParticipantId: string,
    key: string,
    requestBody: unknown,
  ): Promise<{ id: string; replayed: boolean }> {
    return mongo.withTransaction(async (work: MongoTransactionalUnitOfWork) => {
      const claim = await idempotency.claim<{ id: string }>(work, {
        actorParticipantId,
        operation: 'integration.idempotency',
        key,
        requestBody,
      });
      if (claim.replay) return { id: claim.id, replayed: true };
      await idempotency.complete(work, {
        id: claim.id,
        httpStatus: 201,
        responseBody: { id: claim.id },
        resourceId: claim.id,
      });
      return { id: claim.id, replayed: false };
    });
  }

  it('serializes concurrent first claims without leaking a duplicate-key failure', async () => {
    const actor = randomUUID();
    actors.push(actor);
    const key = `concurrent-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => mutate(actor, key, { amountMinor: '100', currency: 'INR' })),
    );

    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    await mongo.withConnection(async (work) => {
      await expect(
        work.db.collection(COLLECTIONS.idempotencyReceipts).countDocuments({
          actorParticipantId: actor,
          operationKey: 'integration.idempotency',
        }),
      ).resolves.toBe(1);
    });
  });

  it('reuses an expired replay key with a new immutable receipt id', async () => {
    const actor = randomUUID();
    actors.push(actor);
    const key = `expired-${randomUUID()}`;
    const first = await mutate(actor, key, { amountMinor: '100' });
    await mongo.withConnection(async (work) => {
      const result = await work.db
        .collection(COLLECTIONS.idempotencyKeys)
        .updateOne(
          { actorParticipantId: actor, operationKey: 'integration.idempotency' },
          { $set: { expiresAt: new Date(0) } },
        );
      expect(result.modifiedCount).toBe(1);
    });

    const second = await mutate(actor, key, { amountMinor: '101' });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(second.id).not.toBe(first.id);
    await mongo.withConnection(async (work) => {
      await expect(
        work.db.collection(COLLECTIONS.idempotencyReceipts).countDocuments({
          actorParticipantId: actor,
          operationKey: 'integration.idempotency',
        }),
      ).resolves.toBe(2);
    });
  });
});
