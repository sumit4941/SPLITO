import { Decimal128 } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { MongoUnitOfWork } from '../database/mongo.service.js';
import { SettlementsRepository } from './settlements.repository.js';

const lowId = '11111111-1111-4111-8111-111111111111';
const highId = '22222222-2222-4222-8222-222222222222';
const contextId = '33333333-3333-4333-8333-333333333333';

describe('MongoDB settlement persistence', () => {
  it('interprets the canonical bilateral sign from the sender perspective', async () => {
    const findOne = vi.fn().mockResolvedValue({
      _id: 'projection',
      contextId,
      participantLowId: lowId,
      participantHighId: highId,
      currencyCode: 'INR',
      lowOwesHighMinor: Decimal128.fromString('1250'),
      version: 4,
    });
    const work = {
      db: { collection: vi.fn(() => ({ findOne })) },
    } as unknown as MongoUnitOfWork;
    const repository = new SettlementsRepository();

    await expect(
      repository.currentObligation(work, {
        contextId,
        senderId: lowId,
        recipientId: highId,
        currency: 'INR',
      }),
    ).resolves.toEqual({ outstandingMinor: 1250n, projectionVersion: '4' });
    await expect(
      repository.currentObligation(work, {
        contextId,
        senderId: highId,
        recipientId: lowId,
        currency: 'INR',
      }),
    ).resolves.toEqual({ outstandingMinor: 0n, projectionVersion: '4' });
  });

  it('stores an exact balanced journal batch plus outbox and audit records', async () => {
    const inserted: Record<string, Record<string, unknown>[]> = {};
    const work = {
      db: {
        collection: vi.fn((name: string) => ({
          insertOne: vi.fn(async (document: Record<string, unknown>) => {
            (inserted[name] ??= []).push(document);
            return { acknowledged: true };
          }),
        })),
      },
    } as unknown as MongoUnitOfWork;
    const repository = new SettlementsRepository();

    await repository.insert(work, {
      input: {
        context: { type: 'group', id: '44444444-4444-4444-8444-444444444444' },
        senderId: lowId,
        recipientId: highId,
        amountMinor: '1250',
        currency: 'INR',
        settlementDate: '2026-09-14',
        method: 'upi',
        note: 'Paid',
        previewVersion: 'preview',
        overpaymentConfirmed: false,
      },
      contextId,
      settlementId: '55555555-5555-4555-8555-555555555555',
      revisionId: '66666666-6666-4666-8666-666666666666',
      batchId: '77777777-7777-4777-8777-777777777777',
      actorParticipantId: lowId,
      actorUserId: '88888888-8888-4888-8888-888888888888',
      idempotencyId: '99999999-9999-4999-8999-999999999999',
      businessTimezone: 'Asia/Kolkata',
      requestId: 'request-settlement',
    });

    expect(inserted.settlements?.[0]).toMatchObject({
      currencyCode: 'INR',
      status: 'POSTED',
      assertion: true,
    });
    const postings = inserted.ledgerBatches?.[0]?.postings as Array<{ amountMinor: Decimal128 }>;
    expect(postings.map(({ amountMinor }) => amountMinor.toString())).toEqual(['1250', '-1250']);
    expect(inserted.outbox?.[0]).toMatchObject({
      eventType: 'settlement.posted',
      status: 'PENDING',
    });
    expect(inserted.auditEvents?.[0]).toMatchObject({ actionKey: 'settlement.create' });
  });
});
