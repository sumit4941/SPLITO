import { randomUUID } from 'node:crypto';
import { loadWorkerEnvironment, type Environment } from '@splito/config';
import { MongoClient, type Db } from 'mongodb';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ClaimedOutboxEvent, OutboxWorker } from './outbox-worker.js';

const integrationUri = process.env.MONGODB_INTEGRATION_URI;

interface IntegrationOutboxDocument {
  _id: string;
  [key: string]: unknown;
}

describe.skipIf(!integrationUri)('MongoDB outbox lease integration', () => {
  let config: Environment;
  let client: MongoClient;
  let database: Db;
  const insertedIds: string[] = [];

  beforeAll(async () => {
    if (!integrationUri) throw new Error('MONGODB_INTEGRATION_URI is required');
    config = loadWorkerEnvironment({
      MONGODB_URI: integrationUri,
      MONGODB_DATABASE: process.env.MONGODB_INTEGRATION_DATABASE ?? 'splito_worker_test',
    });
    client = new MongoClient(config.MONGODB_URI);
    await client.connect();
    database = client.db(config.MONGODB_DATABASE);
  });

  afterAll(async () => {
    if (!client) return;
    if (insertedIds.length) {
      await database
        .collection<IntegrationOutboxDocument>('outbox')
        .deleteMany({ _id: { $in: insertedIds } });
    }
    await client.close();
  });

  it('reclaims an expired lease and conditionally records completion', async () => {
    const id = randomUUID();
    insertedIds.push(id);
    const eventType = `WORKER_TEST_${randomUUID()}`;
    await database.collection<IntegrationOutboxDocument>('outbox').insertOne({
      _id: id,
      eventType,
      aggregateType: 'WORKER_TEST',
      aggregateId: randomUUID(),
      payload: { integration: true },
      status: 'LEASED',
      availableAt: new Date(0),
      leasedUntil: new Date(0),
      leaseOwner: 'crashed-worker',
      attempts: 1,
      createdAt: new Date(0),
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const worker = new OutboxWorker(client, database, config, logger);
    let observed: ClaimedOutboxEvent | undefined;
    worker.register(eventType, (event) => {
      observed = event;
      return Promise.resolve();
    });

    await expect(worker.runOnce(1)).resolves.toBe(1);
    expect(observed?.attempts).toBe(2);
    expect(observed?.payload).toEqual({ integration: true });
    await expect(
      database.collection<IntegrationOutboxDocument>('outbox').findOne({ _id: id }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'PROCESSED', attempts: 2, processedAt: expect.any(Date) }),
    );
  });

  it('does not redeliver an expired lease that already reached the attempt limit', async () => {
    const id = randomUUID();
    insertedIds.push(id);
    const eventType = `WORKER_TEST_${randomUUID()}`;
    await database.collection<IntegrationOutboxDocument>('outbox').insertOne({
      _id: id,
      eventType,
      aggregateType: 'WORKER_TEST',
      aggregateId: randomUUID(),
      payload: { integration: true },
      status: 'LEASED',
      availableAt: new Date(0),
      leasedUntil: new Date(0),
      leaseOwner: 'crashed-worker',
      attempts: config.OUTBOX_MAX_ATTEMPTS,
      createdAt: new Date(0),
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const worker = new OutboxWorker(client, database, config, logger);
    const handler = vi.fn().mockResolvedValue(undefined);
    worker.register(eventType, handler);

    await expect(worker.runOnce(1)).resolves.toBe(0);
    expect(handler).not.toHaveBeenCalled();
    await expect(
      database.collection<IntegrationOutboxDocument>('outbox').findOne({ _id: id }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'DEAD', attempts: config.OUTBOX_MAX_ATTEMPTS }),
    );
  });
});
