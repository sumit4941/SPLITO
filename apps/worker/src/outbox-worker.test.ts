import { loadWorkerEnvironment, type Environment } from '@splito/config';
import type { Db, MongoClient } from 'mongodb';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDevelopmentHandler,
  type ClaimedOutboxEvent,
  OutboxWorker,
} from './outbox-worker.js';

function environment(overrides: NodeJS.ProcessEnv = {}): Environment {
  return loadWorkerEnvironment(overrides);
}

function productionEnvironment(): Environment {
  return environment({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://worker:placeholder@example.mongodb.net/',
  });
}

function loggerMock(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function outboxDocument(attempts = 1): object {
  return {
    _id: '11111111-1111-4111-8111-111111111111',
    eventType: 'EXAMPLE_CREATED',
    aggregateType: 'EXAMPLE',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    payload: { kind: 'example' },
    status: 'LEASED',
    attempts,
    availableAt: new Date(0),
    leasedUntil: new Date(Date.now() + 60_000),
    leaseOwner: 'worker',
    createdAt: new Date(0),
  };
}

function mongoMock(claims: unknown[] = [], updates: unknown[] = []) {
  const findOneAndUpdate = vi.fn();
  for (const claim of claims) findOneAndUpdate.mockResolvedValueOnce(claim);
  findOneAndUpdate.mockResolvedValue(undefined);
  const updateOne = vi.fn();
  for (const update of updates) updateOne.mockResolvedValueOnce(update);
  updateOne.mockResolvedValue({ modifiedCount: 1 });
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
  const collection = { findOneAndUpdate, updateMany, updateOne };
  const database = { collection: vi.fn(() => collection) } as unknown as Db;
  const close = vi.fn().mockResolvedValue(undefined);
  const client = { close } as unknown as MongoClient;
  return { client, database, collection, findOneAndUpdate, updateMany, updateOne, close };
}

describe('OutboxWorker', () => {
  afterEach(() => vi.useRealTimers());

  it('refuses to construct the development acknowledgement sink in production', () => {
    expect(() => createDevelopmentHandler(productionEnvironment(), loggerMock())).toThrow(
      /No production outbox delivery handlers are configured/u,
    );
  });

  it('requires a handler before its polling loop can start', () => {
    const mongo = mongoMock();
    const worker = new OutboxWorker(mongo.client, mongo.database, environment(), loggerMock());
    expect(() => worker.start()).toThrow(/At least one outbox handler/u);
  });

  it('atomically reclaims an eligible event and records completion', async () => {
    const mongo = mongoMock([outboxDocument(2)], [{ modifiedCount: 1 }]);
    const worker = new OutboxWorker(mongo.client, mongo.database, environment(), loggerMock());
    let observed: ClaimedOutboxEvent | undefined;
    worker.register('EXAMPLE_CREATED', (event) => {
      observed = event;
      return Promise.resolve();
    });

    await expect(worker.runOnce(1)).resolves.toBe(1);
    expect(observed?.attempts).toBe(2);
    expect(observed?.payload).toEqual({ kind: 'example' });
    expect(mongo.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: { $lt: expect.any(Number) },
        $or: expect.any(Array),
      }),
      expect.objectContaining({ $inc: { attempts: 1 } }),
      expect.objectContaining({ returnDocument: 'after' }),
    );
    expect(mongo.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LEASED' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  it('dead-letters an expired lease at the attempt limit without dispatching it again', async () => {
    const mongo = mongoMock();
    const worker = new OutboxWorker(
      mongo.client,
      mongo.database,
      environment({ OUTBOX_MAX_ATTEMPTS: '3' }),
      loggerMock(),
    );
    const handler = vi.fn().mockResolvedValue(undefined);
    worker.register('EXAMPLE_CREATED', handler);

    await expect(worker.runOnce(1)).resolves.toBe(0);
    expect(mongo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: { $gte: 3 },
        $or: expect.arrayContaining([
          expect.objectContaining({ status: 'LEASED', leasedUntil: { $lt: expect.any(Date) } }),
        ]),
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'DEAD' }) }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('fails closed on an invalid persisted attempt count', async () => {
    const mongo = mongoMock([outboxDocument(Number.NaN)]);
    const worker = new OutboxWorker(mongo.client, mongo.database, environment(), loggerMock());
    const handler = vi.fn().mockResolvedValue(undefined);
    worker.register('EXAMPLE_CREATED', handler);

    await expect(worker.runOnce(1)).rejects.toThrow(/invalid outbox attempt count/u);
    expect(handler).not.toHaveBeenCalled();
  });

  it('records a retry even when a handler rejects without an error object', async () => {
    const mongo = mongoMock([outboxDocument()], [{ modifiedCount: 1 }]);
    const worker = new OutboxWorker(mongo.client, mongo.database, environment(), loggerMock());
    worker.register('EXAMPLE_CREATED', () => Promise.reject(undefined));

    await expect(worker.runOnce(1)).resolves.toBe(1);
    expect(mongo.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LEASED' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'RETRY' }) }),
    );
  });

  it('waits for an in-flight dispatch before closing the MongoDB client', async () => {
    const mongo = mongoMock([outboxDocument()], [{ modifiedCount: 1 }]);
    const worker = new OutboxWorker(mongo.client, mongo.database, environment(), loggerMock());
    let releaseHandler: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolveStarted) => {
      worker.register(
        'EXAMPLE_CREATED',
        () =>
          new Promise<void>((resolveHandler) => {
            releaseHandler = resolveHandler;
            resolveStarted();
          }),
      );
    });

    worker.start();
    await handlerStarted;
    const stopping = worker.stop();
    expect(mongo.close).not.toHaveBeenCalled();
    releaseHandler?.();
    await stopping;
    expect(mongo.close).toHaveBeenCalledOnce();
  });

  it('renews the lease while a long-running handler is in flight', async () => {
    vi.useFakeTimers();
    const mongo = mongoMock([outboxDocument()], [{ modifiedCount: 1 }, { modifiedCount: 1 }]);
    const worker = new OutboxWorker(
      mongo.client,
      mongo.database,
      environment({ OUTBOX_LEASE_SECONDS: '5' }),
      loggerMock(),
    );
    let releaseHandler: (() => void) | undefined;
    let notifyStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    worker.register(
      'EXAMPLE_CREATED',
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve;
          notifyStarted?.();
        }),
    );

    const running = worker.runOnce(1);
    await handlerStarted;
    await vi.advanceTimersByTimeAsync(2_500);
    expect(mongo.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ leasedUntil: expect.objectContaining({ $gte: expect.any(Date) }) }),
      expect.objectContaining({ $set: { leasedUntil: expect.any(Date) } }),
    );
    releaseHandler?.();
    await running;
    expect(mongo.updateOne).toHaveBeenCalledTimes(2);
  });
});
