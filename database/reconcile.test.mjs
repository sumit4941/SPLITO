import { createHash } from 'node:crypto';
import { Decimal128 } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  bilateralDifferences,
  balanceDifferences,
  findInvalidBatches,
  findInvalidExpenseRevisions,
  findInvalidSettlements,
  loadActualBalances,
  loadExpectedBalances,
  loadExpectedBilaterals,
} from './scripts/reconcile.mjs';

const participantA = '10000000-0000-0000-0000-000000000001';
const participantB = '20000000-0000-0000-0000-000000000002';
const contextId = '30000000-0000-0000-0000-000000000003';
const createReceiptId = 'a0000000-0000-4000-8000-000000000001';
const updateReceiptId = 'a0000000-0000-4000-8000-000000000002';
const settlementReceiptId = 'a0000000-0000-4000-8000-000000000003';

const amount = (value) => Decimal128.fromString(String(value));

function expenseRevision() {
  return {
    _id: '40000000-0000-0000-0000-000000000004',
    expenseId: '60000000-0000-0000-0000-000000000006',
    revisionNumber: 1,
    totalMinor: amount(100),
    payers: [
      { id: 'payer-a', participantId: participantA, paidMinor: amount(100), allocationOrder: 0 },
    ],
    shares: [
      { id: 'share-a', participantId: participantA, owedMinor: amount(40), allocationOrder: 0 },
      { id: 'share-b', participantId: participantB, owedMinor: amount(60), allocationOrder: 1 },
    ],
    obligations: [
      {
        id: 'obligation-b-a',
        debtorParticipantId: participantB,
        creditorParticipantId: participantA,
        amountMinor: amount(60),
        matchOrder: 0,
      },
    ],
  };
}

function expenseBatch() {
  return {
    _id: '50000000-0000-0000-0000-000000000005',
    contextId,
    currencyCode: 'INR',
    batchType: 'EXPENSE',
    sourceType: 'EXPENSE',
    sourceId: '60000000-0000-0000-0000-000000000006',
    sourceRevisionId: expenseRevision()._id,
    idempotencyId: createReceiptId,
    actorParticipantId: participantA,
    postings: [
      { id: 'posting-a', participantId: participantA, amountMinor: amount(60), postingOrder: 0 },
      {
        id: 'posting-b',
        participantId: participantB,
        amountMinor: amount(-60),
        postingOrder: 1,
      },
    ],
  };
}

function reversalBatch() {
  const original = expenseBatch();
  return {
    ...original,
    _id: '70000000-0000-0000-0000-000000000007',
    batchType: 'REVERSAL',
    reversesBatchId: original._id,
    idempotencyId: updateReceiptId,
    postings: [
      {
        id: 'reversal-a',
        participantId: participantA,
        amountMinor: amount(-60),
        postingOrder: 0,
      },
      {
        id: 'reversal-b',
        participantId: participantB,
        amountMinor: amount(60),
        postingOrder: 1,
      },
    ],
  };
}

function receiptForBatch(batch, expenseRevisionById) {
  const operationKey =
    batch.batchType === 'REVERSAL'
      ? 'expense.update'
      : batch.batchType === 'SETTLEMENT'
        ? 'settlement.create'
        : expenseRevisionById.get(batch.sourceRevisionId)?.revisionNumber === 1
          ? 'expense.create'
          : 'expense.update';
  const httpStatus = operationKey === 'expense.update' ? 200 : 201;
  const keyHash = createHash('sha256').update(`key:${batch.idempotencyId}`).digest('hex');
  const scopeId = createHash('sha256')
    .update(`${batch.actorParticipantId}\u0000${operationKey}\u0000${keyHash}`)
    .digest('hex');
  return {
    _id: batch.idempotencyId,
    scopeId,
    actorParticipantId: batch.actorParticipantId,
    operationKey,
    keyHash,
    httpStatus,
    resourceId: batch.sourceId,
  };
}

function history(overrides = {}) {
  const revision = expenseRevision();
  const initial = expenseBatch();
  const reversal = reversalBatch();
  const batches = overrides.batches ?? [initial, reversal];
  const expenseRevisions = overrides.expenseRevisions ?? [revision];
  const settlements = overrides.settlements ?? [];
  const settlementRevisions = overrides.settlementRevisions ?? [];
  const expenseRevisionById = new Map(expenseRevisions.map((item) => [item._id, item]));
  const idempotencyReceipts = overrides.idempotencyReceipts ?? [
    ...new Map(
      batches.map((batch) => {
        const receipt = receiptForBatch(batch, expenseRevisionById);
        return [receipt._id, receipt];
      }),
    ).values(),
  ];
  return {
    batches,
    batchById: new Map(batches.map((batch) => [batch._id, batch])),
    expenseRevisions,
    expenseRevisionById,
    settlements,
    settlementById: new Map(settlements.map((item) => [item._id, item])),
    settlementRevisionById: new Map(settlementRevisions.map((item) => [item._id, item])),
    idempotencyReceipts,
    idempotencyReceiptById: new Map(idempotencyReceipts.map((item) => [item._id, item])),
  };
}

describe('MongoDB financial reconciliation invariants', () => {
  it('accepts an exact reversal and preserves a zero bilateral slot', () => {
    const financialHistory = history();
    expect(findInvalidExpenseRevisions(financialHistory)).toEqual([]);
    expect(findInvalidBatches(financialHistory)).toEqual([]);

    const expected = loadExpectedBilaterals(financialHistory);
    expect([...expected.values()]).toEqual([
      expect.objectContaining({ lowOwesHighMinor: 0n, version: 2 }),
    ]);
    expect(bilateralDifferences(expected, new Map())).toEqual([
      expect.objectContaining({ expectedMinor: '0', expectedVersion: 2, actualVersion: 0 }),
    ]);
    expect(bilateralDifferences(expected, expected)).toEqual([]);
  });

  it('rejects a balanced reversal that does not exactly negate its source', () => {
    const malformed = reversalBatch();
    malformed.postings[0].amountMinor = amount(-59);
    malformed.postings[1].amountMinor = amount(59);
    const financialHistory = history({ batches: [expenseBatch(), malformed] });

    expect(findInvalidBatches(financialHistory)).toEqual([
      expect.objectContaining({ batchId: malformed._id, validReversal: false }),
    ]);
  });

  it('rejects a journal batch whose permanent idempotency receipt is missing', () => {
    const financialHistory = history({ idempotencyReceipts: [] });
    expect(findInvalidBatches(financialHistory)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchId: expenseBatch()._id, validReceipt: false }),
        expect.objectContaining({ batchId: reversalBatch()._id, validReceipt: false }),
      ]),
    );
  });

  it('rejects payer/share totals that diverge from the immutable revision total', () => {
    const revision = expenseRevision();
    revision.shares[1].owedMinor = amount(59);
    const financialHistory = history({ expenseRevisions: [revision] });

    expect(findInvalidExpenseRevisions(financialHistory)).toEqual([
      expect.objectContaining({ revisionId: revision._id, totalMinor: '100', shareSum: '99' }),
    ]);
  });

  it('rejects obligations whose net flow differs from paid minus owed', () => {
    const revision = expenseRevision();
    revision.obligations[0].amountMinor = amount(59);
    const financialHistory = history({ expenseRevisions: [revision] });

    expect(findInvalidExpenseRevisions(financialHistory)).toEqual([
      expect.objectContaining({ revisionId: revision._id, validObligationFlow: false }),
    ]);
  });

  it('rejects duplicate non-reversal expense batches for one source revision', () => {
    const first = expenseBatch();
    const duplicate = {
      ...expenseBatch(),
      _id: 'aaaaaaaa-0000-0000-0000-000000000010',
      postings: expenseBatch().postings.map((posting, index) => ({
        ...posting,
        id: `duplicate-${index}`,
      })),
    };
    const invalid = findInvalidBatches(history({ batches: [first, duplicate] }));

    expect(invalid).toHaveLength(2);
    expect(invalid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchId: first._id, uniqueSourceBatch: false }),
        expect.objectContaining({ batchId: duplicate._id, uniqueSourceBatch: false }),
      ]),
    );
  });

  it('rejects duplicate non-reversal settlement batches for one source revision', () => {
    const settlement = {
      _id: 'bbbbbbbb-0000-0000-0000-000000000011',
      currentRevisionId: 'cccccccc-0000-0000-0000-000000000012',
      senderParticipantId: participantA,
      recipientParticipantId: participantB,
      method: 'CASH',
      amountMinor: amount(50),
    };
    const revision = {
      _id: settlement.currentRevisionId,
      settlementId: settlement._id,
      method: settlement.method,
      amountMinor: settlement.amountMinor,
    };
    const first = {
      _id: 'dddddddd-0000-0000-0000-000000000013',
      contextId,
      currencyCode: 'INR',
      batchType: 'SETTLEMENT',
      sourceType: 'SETTLEMENT',
      sourceId: settlement._id,
      sourceRevisionId: revision._id,
      idempotencyId: settlementReceiptId,
      actorParticipantId: participantA,
      postings: [
        {
          id: 'settlement-a',
          participantId: participantA,
          amountMinor: amount(50),
          postingOrder: 0,
        },
        {
          id: 'settlement-b',
          participantId: participantB,
          amountMinor: amount(-50),
          postingOrder: 1,
        },
      ],
    };
    const duplicate = {
      ...first,
      _id: 'eeeeeeee-0000-0000-0000-000000000014',
      postings: first.postings.map((posting, index) => ({
        ...posting,
        id: `duplicate-settlement-${index}`,
      })),
    };
    const financialHistory = history({
      batches: [first, duplicate],
      expenseRevisions: [],
      settlements: [settlement],
      settlementRevisions: [revision],
    });

    expect(findInvalidBatches(financialHistory)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchId: first._id, uniqueSourceBatch: false }),
        expect.objectContaining({ batchId: duplicate._id, uniqueSourceBatch: false }),
      ]),
    );
  });

  it('preserves zero balance rows and their journal-derived versions', async () => {
    const aggregateRows = [
      {
        _id: { contextId, participantId: participantA, currencyCode: 'INR' },
        netMinor: amount(0),
        batches: ['batch-1', 'batch-2'],
      },
    ];
    const storedRows = [
      {
        _id: 'balance-a',
        contextId,
        participantId: participantA,
        currencyCode: 'INR',
        netMinor: amount(0),
        version: 2,
      },
    ];
    const database = {
      collection: (name) => ({
        aggregate: () => ({ toArray: async () => aggregateRows }),
        find: () => ({ toArray: async () => (name === 'balanceProjections' ? storedRows : []) }),
      }),
    };

    const expected = await loadExpectedBalances(database, undefined);
    const actual = await loadActualBalances(database, undefined);
    expect(expected.size).toBe(1);
    expect(actual.size).toBe(1);
    expect(balanceDifferences(expected, actual)).toEqual([]);
  });

  it('rejects a settlement whose two parties are identical', () => {
    const settlement = {
      _id: '80000000-0000-0000-0000-000000000008',
      currentRevisionId: '90000000-0000-0000-0000-000000000009',
      senderParticipantId: participantA,
      recipientParticipantId: participantA,
      method: 'UPI',
      amountMinor: amount(50),
    };
    const revision = {
      _id: settlement.currentRevisionId,
      settlementId: settlement._id,
      method: 'UPI',
      amountMinor: amount(50),
    };
    const financialHistory = history({
      settlements: [settlement],
      settlementRevisions: [revision],
    });

    expect(findInvalidSettlements(financialHistory)).toEqual([
      expect.objectContaining({ settlementId: settlement._id, distinctParticipants: false }),
    ]);
  });
});
