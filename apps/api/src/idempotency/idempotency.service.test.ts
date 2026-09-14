import { MongoServerError, type ClientSession } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJsonHash } from '../common/canonical-json.js';
import type {
  MongoService,
  MongoTransactionalUnitOfWork,
  RetryableMongoTransactionError,
} from '../database/mongo.service.js';
import { IdempotencyService } from './idempotency.service.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';
const storedId = '33333333-3333-4333-8333-333333333333';

function slot(values: Record<string, unknown> = {}) {
  return {
    _id: 'deterministic-key',
    id: storedId,
    actorParticipantId: actorId,
    operationKey: 'expense.create',
    keyHash: 'key-hash',
    requestHash: canonicalJsonHash({ amountMinor: '100', currency: 'INR' }).toString('hex'),
    status: 'COMPLETED',
    httpStatus: 201,
    responseBody: { id: resourceId, amountMinor: '100' },
    resourceId,
    createdAt: new Date('2026-09-13T10:00:00.000Z'),
    completedAt: new Date('2026-09-13T10:00:01.000Z'),
    expiresAt: new Date(Date.now() + 60_000),
    ...values,
  };
}

function harness() {
  const findOneAndUpdate = vi.fn();
  const updateOne = vi.fn();
  const insertOne = vi.fn();
  const slots = { findOneAndUpdate, updateOne };
  const receipts = { insertOne };
  const collection = vi.fn((name: string) => (name === 'idempotencyKeys' ? slots : receipts));
  const session = {} as ClientSession;
  const work = { db: { collection }, session } as unknown as MongoTransactionalUnitOfWork;
  const service = new IdempotencyService({} as MongoService);
  return { collection, findOneAndUpdate, insertOne, service, updateOne, work };
}

describe('MongoDB-backed idempotency outcomes', () => {
  it('fails closed when a caller attempts idempotency work outside a transaction', async () => {
    const { service, work } = harness();
    const nonTransactionalWork = { db: work.db } as unknown as MongoTransactionalUnitOfWork;

    await expect(
      service.claim(nonTransactionalWork, {
        actorParticipantId: actorId,
        operation: 'expense.create',
        key: 'retry-key-123',
        requestBody: { amountMinor: '100' },
      }),
    ).rejects.toThrow('Idempotency claims require a MongoDB transaction');
    await expect(
      service.complete(nonTransactionalWork, {
        id: storedId,
        httpStatus: 201,
        responseBody: { id: resourceId },
        resourceId,
      }),
    ).rejects.toThrow('Idempotency completion requires a MongoDB transaction');
  });

  it("atomically claims a fresh scoped key inside the caller's transaction", async () => {
    const { findOneAndUpdate, service, work } = harness();
    findOneAndUpdate.mockImplementationOnce(
      async (_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) => ({
        _id: 'deterministic-key',
        ...update.$setOnInsert,
      }),
    );

    const claim = await service.claim(work, {
      actorParticipantId: actorId,
      operation: 'expense.create',
      key: 'retry-key-123',
      requestBody: { amountMinor: '100' },
    });

    expect(claim.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(claim.replay).toBeUndefined();
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: expect.stringMatching(/^[0-9a-f]{64}$/u) },
      {
        $setOnInsert: expect.objectContaining({
          actorParticipantId: actorId,
          operationKey: 'expense.create',
        }),
      },
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
  });

  it('replays the atomically stored native response for the same payload', async () => {
    const requestBody = { amountMinor: '100', currency: 'INR' };
    const { findOneAndUpdate, service, work } = harness();
    findOneAndUpdate.mockResolvedValueOnce(slot());

    await expect(
      service.claim<{ id: string; amountMinor: string }>(work, {
        actorParticipantId: actorId,
        operation: 'expense.create',
        key: 'retry-key-123',
        requestBody,
      }),
    ).resolves.toEqual({
      id: storedId,
      replay: {
        status: 201,
        body: { id: resourceId, amountMinor: '100' },
        resourceId,
      },
    });
  });

  it('rejects reuse of a live scoped key with a different payload', async () => {
    const { findOneAndUpdate, service, work } = harness();
    findOneAndUpdate.mockResolvedValueOnce(
      slot({ requestHash: canonicalJsonHash({ amountMinor: '100' }).toString('hex') }),
    );

    await expect(
      service.claim(work, {
        actorParticipantId: actorId,
        operation: 'expense.create',
        key: 'retry-key-123',
        requestBody: { amountMinor: '101' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  });

  it('rotates the receipt id when an expired replay slot is reused', async () => {
    const { findOneAndUpdate, service, updateOne, work } = harness();
    findOneAndUpdate.mockResolvedValueOnce(slot({ expiresAt: new Date(0) }));
    updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

    const claim = await service.claim(work, {
      actorParticipantId: actorId,
      operation: 'expense.create',
      key: 'retry-key-123',
      requestBody: { amountMinor: '101' },
    });

    expect(claim.id).not.toBe(storedId);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: expect.stringMatching(/^[0-9a-f]{64}$/u),
        id: storedId,
        expiresAt: { $lte: expect.any(Date) },
      },
      expect.objectContaining({
        $set: expect.objectContaining({ id: claim.id, status: 'IN_PROGRESS' }),
      }),
      expect.objectContaining({ session: expect.anything() }),
    );
  });

  it('requests a whole-transaction retry for a concurrent first claim', async () => {
    const { findOneAndUpdate, service, work } = harness();
    const duplicate = new MongoServerError({ message: 'duplicate', ok: 0, code: 11_000 });
    findOneAndUpdate.mockRejectedValueOnce(duplicate);

    await expect(
      service.claim(work, {
        actorParticipantId: actorId,
        operation: 'expense.create',
        key: 'retry-key-123',
        requestBody: { amountMinor: '100' },
      }),
    ).rejects.toMatchObject({
      name: 'RetryableMongoTransactionError',
      originalError: duplicate,
    } satisfies Partial<RetryableMongoTransactionError>);
  });

  it('stores the replay outcome and inserts an immutable provenance receipt', async () => {
    const { findOneAndUpdate, insertOne, service, work } = harness();
    findOneAndUpdate.mockResolvedValueOnce(slot({ status: 'COMPLETED' }));
    insertOne.mockResolvedValueOnce({ acknowledged: true, insertedId: storedId });

    await service.complete(work, {
      id: storedId,
      httpStatus: 201,
      responseBody: { id: resourceId, amountMinor: '100' },
      resourceId,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { id: storedId, status: 'IN_PROGRESS' },
      { $set: expect.objectContaining({ status: 'COMPLETED', httpStatus: 201, resourceId }) },
      expect.objectContaining({ returnDocument: 'after' }),
    );
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: storedId,
        scopeId: 'deterministic-key',
        actorParticipantId: actorId,
        operationKey: 'expense.create',
        httpStatus: 201,
        resourceId,
      }),
      expect.objectContaining({ session: expect.anything() }),
    );
    expect(insertOne.mock.calls[0]?.[0]).not.toHaveProperty('responseBody');
  });
});
