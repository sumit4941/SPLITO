import { Decimal128 } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import type { MongoUnitOfWork } from '../database/mongo.service.js';
import { ExpensesRepository, type LockedExpenseForUpdate } from './expenses.repository.js';
import type { PreparedExpense } from './expenses.types.js';

const expenseId = '11111111-1111-4111-8111-111111111111';
const callerId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const revisionId = '44444444-4444-4444-8444-444444444444';
const contextId = '55555555-5555-4555-8555-555555555555';
const memberId = '66666666-6666-4666-8666-666666666666';
const previousBatchId = '77777777-7777-4777-8777-777777777777';
const nextRevisionId = '88888888-8888-4888-8888-888888888888';
const reversalBatchId = '99999999-9999-4999-8999-999999999999';
const replacementBatchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idempotencyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function cursor(rows: unknown[]) {
  const value = {
    sort: vi.fn(),
    limit: vi.fn(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
  value.sort.mockReturnValue(value);
  value.limit.mockReturnValue(value);
  return value;
}

function detailWork(expensePresent = true): MongoUnitOfWork {
  const expense = {
    _id: expenseId,
    contextId,
    description: 'Dinner',
    currencyCode: 'INR',
    expenseDate: '2026-09-12',
    businessTimezone: 'Asia/Kolkata',
    categoryCode: 'food',
    status: 'POSTED',
    createdByParticipantId: callerId,
    currentRevisionId: revisionId,
    version: '3',
    createdAt: new Date('2026-09-12T12:00:00.000Z'),
    updatedAt: new Date('2026-09-12T12:00:00.000Z'),
  };
  const revision = {
    _id: revisionId,
    expenseId,
    revisionNumber: 2,
    totalMinor: Decimal128.fromString('10000'),
    splitMethod: 'EQUAL',
    algorithmVersion: 'splito-largest-remainder-v1',
    originalInputs: {},
    notes: 'Shared meal',
    createdByParticipantId: callerId,
    payers: [
      {
        id: 'payer',
        participantId: callerId,
        paidMinor: Decimal128.fromString('10000'),
        allocationOrder: 0,
      },
    ],
    shares: [
      {
        id: 'share-1',
        participantId: callerId,
        owedMinor: Decimal128.fromString('5000'),
        allocationOrder: 0,
      },
      {
        id: 'share-2',
        participantId: memberId,
        owedMinor: Decimal128.fromString('5000'),
        allocationOrder: 1,
      },
    ],
    obligations: [],
    createdAt: new Date(),
  };
  const participants = [
    { _id: callerId, displayName: 'Alex' },
    { _id: memberId, displayName: 'Sam' },
  ];
  const collections: Record<string, unknown> = {
    expenses: { findOne: vi.fn().mockResolvedValue(expensePresent ? expense : null) },
    expenseRevisions: { findOne: vi.fn().mockResolvedValue(revision) },
    contextMembers: {
      findOne: vi.fn().mockResolvedValue({ contextId, participantId: callerId, status: 'ACTIVE' }),
    },
    groups: { findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId, name: 'Goa trip' }) },
    contexts: { findOne: vi.fn().mockResolvedValue({ _id: contextId, status: 'ACTIVE' }) },
    participants: {
      findOne: vi.fn().mockResolvedValue(participants[0]),
      find: vi.fn(() => cursor(participants)),
    },
  };
  return {
    db: { collection: vi.fn((name: string) => collections[name]) },
  } as unknown as MongoUnitOfWork;
}

describe('MongoDB expense detail mapping and authorization', () => {
  it('maps the embedded current revision with exact Decimal128 minor units', async () => {
    const repository = new ExpensesRepository();
    const detail = await repository.detail(detailWork(), expenseId, callerId);
    expect(detail).toMatchObject({
      id: expenseId,
      amount: { amountMinor: '10000', currency: 'INR' },
      status: 'posted',
      version: '3',
      revisionNumber: 2,
      splitMethod: 'equal',
      createdBy: { id: callerId, displayName: 'Alex' },
      canEdit: true,
      payers: [{ id: callerId, paidAmountMinor: '10000' }],
      allocations: [
        { id: callerId, owedAmountMinor: '5000', netAmountMinor: '5000' },
        { id: memberId, owedAmountMinor: '5000', netAmountMinor: '-5000' },
      ],
    });
  });

  it('returns no data when the expense does not exist', async () => {
    await expect(
      new ExpensesRepository().detail(detailWork(false), expenseId, callerId),
    ).resolves.toBeUndefined();
  });
});

describe('MongoDB expense ledger behavior', () => {
  it('loads only the unreversed current batch and validates balanced posting order', async () => {
    const batch = {
      _id: previousBatchId,
      contextId,
      currencyCode: 'INR',
      batchType: 'EXPENSE',
      sourceType: 'EXPENSE',
      sourceId: expenseId,
      sourceRevisionId: revisionId,
      idempotencyId,
      actorParticipantId: callerId,
      postedAt: new Date(),
      postings: [
        {
          id: '2',
          participantId: memberId,
          amountMinor: Decimal128.fromString('-5000'),
          postingOrder: 1,
        },
        {
          id: '1',
          participantId: callerId,
          amountMinor: Decimal128.fromString('5000'),
          postingOrder: 0,
        },
      ],
    };
    const revision = {
      _id: revisionId,
      expenseId,
      obligations: [
        {
          id: 'obligation',
          debtorParticipantId: memberId,
          creditorParticipantId: callerId,
          amountMinor: Decimal128.fromString('5000'),
          matchOrder: 0,
          algorithmVersion: 'v1',
        },
      ],
    };
    const ledgerFindOne = vi.fn().mockResolvedValue(null);
    const work = {
      db: {
        collection: vi.fn((name: string) =>
          name === 'ledgerBatches'
            ? { find: vi.fn(() => cursor([batch])), findOne: ledgerFindOne }
            : { findOne: vi.fn().mockResolvedValue(revision) },
        ),
      },
    } as unknown as MongoUnitOfWork;

    await expect(
      new ExpensesRepository().currentFinancialEffect(work, expenseId, revisionId),
    ).resolves.toEqual({
      batchId: previousBatchId,
      batchContextId: contextId,
      batchCurrency: 'INR',
      postings: [
        { participantId: callerId, amountMinor: 5000n, postingOrder: 0 },
        { participantId: memberId, amountMinor: -5000n, postingOrder: 1 },
      ],
      obligations: [
        {
          debtorParticipantId: memberId,
          creditorParticipantId: callerId,
          amountMinor: 5000n,
          matchOrder: 0,
        },
      ],
    });
    expect(ledgerFindOne).toHaveBeenCalledWith({ reversesBatchId: previousBatchId }, undefined);
  });

  it('writes immutable revision, reversal, replacement, outbox, audit, and projection deltas', async () => {
    const inserted: Record<string, Record<string, unknown>[]> = {};
    const expenseUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const work = {
      db: {
        collection: vi.fn((name: string) => ({
          insertOne: vi.fn(async (document: Record<string, unknown>) => {
            (inserted[name] ??= []).push(document);
            return { acknowledged: true };
          }),
          updateOne:
            name === 'expenses' ? expenseUpdate : vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        })),
      },
    } as unknown as MongoUnitOfWork;
    const repository = new ExpensesRepository();
    const balance = vi.spyOn(repository, 'applyBalanceDelta').mockResolvedValue(undefined);
    const bilateral = vi.spyOn(repository, 'applyBilateralDelta').mockResolvedValue(undefined);
    const current: LockedExpenseForUpdate = {
      expenseId,
      contextId,
      groupId,
      groupName: 'Goa trip',
      contextStatus: 'ACTIVE',
      status: 'POSTED',
      currency: 'INR',
      version: '3',
      revisionId,
      revisionNumber: 2,
      createdByParticipantId: callerId,
      createdByDisplayName: 'Alex',
    };
    const prepared: PreparedExpense = {
      input: {
        groupId,
        description: 'Updated dinner',
        amountMinor: '6000',
        currency: 'USD',
        expenseDate: '2026-09-13',
        category: 'food',
        notes: 'Corrected',
        splitMethod: 'equal',
        payers: [{ participantId: callerId, paidAmountMinor: '6000' }],
        beneficiaries: [{ participantId: callerId }, { participantId: memberId }],
      },
      contextId,
      groupName: 'Goa trip',
      participants: [
        { id: callerId, displayName: 'Alex', allocationOrder: 0 },
        { id: memberId, displayName: 'Sam', allocationOrder: 1 },
      ],
      allocations: [
        { participantId: callerId, amountMinor: 3000n, allocationOrder: 0 },
        { participantId: memberId, amountMinor: 3000n, allocationOrder: 1 },
      ],
      postings: [
        { participantId: callerId, amountMinor: 3000n },
        { participantId: memberId, amountMinor: -3000n },
      ],
      obligations: [
        { debtorParticipantId: memberId, creditorParticipantId: callerId, amountMinor: 3000n },
      ],
      algorithmVersion: 'splito-largest-remainder-v1',
      bilateralAlgorithmVersion: 'splito-bilateral-greedy-v1',
      splitMethod: 'equal',
    };

    await repository.replacePostedExpense(work, {
      current,
      previousEffect: {
        batchId: previousBatchId,
        batchContextId: contextId,
        batchCurrency: 'INR',
        postings: [
          { participantId: callerId, amountMinor: 5000n, postingOrder: 0 },
          { participantId: memberId, amountMinor: -5000n, postingOrder: 1 },
        ],
        obligations: [
          {
            debtorParticipantId: memberId,
            creditorParticipantId: callerId,
            amountMinor: 5000n,
            matchOrder: 0,
          },
        ],
      },
      prepared,
      ids: { revisionId: nextRevisionId, reversalBatchId, replacementBatchId },
      expectedVersion: '3',
      nextVersion: '4',
      nextRevisionNumber: 3,
      actorParticipantId: callerId,
      actorUserId,
      idempotencyId,
      requestId: 'request-update',
      businessTimezone: 'Asia/Kolkata',
    });

    expect(inserted.expenseRevisions?.[0]).toMatchObject({
      _id: nextRevisionId,
      previousRevisionId: revisionId,
      revisionNumber: 3,
    });
    expect(expenseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expenseId, version: '3', currentRevisionId: revisionId }),
      expect.objectContaining({
        $set: expect.objectContaining({ version: '4', currentRevisionId: nextRevisionId }),
      }),
      undefined,
    );
    expect(inserted.ledgerBatches).toHaveLength(2);
    expect(inserted.ledgerBatches?.[0]).toMatchObject({
      _id: reversalBatchId,
      batchType: 'REVERSAL',
      reversesBatchId: previousBatchId,
      currencyCode: 'INR',
    });
    expect(inserted.ledgerBatches?.[1]).toMatchObject({
      _id: replacementBatchId,
      batchType: 'EXPENSE',
      currencyCode: 'USD',
    });
    expect(balance).toHaveBeenCalledTimes(4);
    expect(bilateral).toHaveBeenCalledTimes(2);
    expect(inserted.outbox?.[0]).toMatchObject({ eventType: 'expense.updated', status: 'PENDING' });
    expect(inserted.auditEvents?.[0]).toMatchObject({ actionKey: 'expense.update' });
  });
});
