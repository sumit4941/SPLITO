import { describe, expect, it } from 'vitest';

import {
  applyJournalBatch,
  assertBalancedJournalBatch,
  assertExactReversal,
  createBilateralObligations,
  expenseNetPostings,
  rebuildBalanceProjection,
  reverseJournalBatch,
  simplifyBalances,
  type JournalBatch,
} from '../src/index.js';

function batch(
  batchId: string,
  sourceType: JournalBatch['sourceType'],
  postings: JournalBatch['postings'],
): JournalBatch {
  return {
    batchId,
    contextId: 'group-1',
    currency: 'INR',
    sourceType,
    sourceId: batchId,
    sourceRevision: 1,
    actorId: 'actor-1',
    occurredAt: '2026-09-12T00:00:00.000Z',
    postings,
  };
}

describe('expense nets and bilateral attribution', () => {
  it('calculates the required multiple-payer example', () => {
    const postings = expenseNetPostings(100_000n, [
      { participantId: 'A', paidMinor: 60_000n, owedMinor: 25_000n },
      { participantId: 'B', paidMinor: 40_000n, owedMinor: 25_000n },
      { participantId: 'C', paidMinor: 0n, owedMinor: 25_000n },
      { participantId: 'D', paidMinor: 0n, owedMinor: 25_000n },
    ]);
    expect(postings.map(({ amountMinor }) => amountMinor)).toEqual([
      35_000n,
      15_000n,
      -25_000n,
      -25_000n,
    ]);

    const obligations = createBilateralObligations(
      'INR',
      postings.map((posting, allocationOrder) => ({
        participantId: posting.participantId,
        allocationOrder,
        netMinor: posting.amountMinor,
      })),
    );
    expect(obligations.obligations).toEqual([
      { debtorParticipantId: 'C', creditorParticipantId: 'A', amountMinor: 25_000n },
      { debtorParticipantId: 'D', creditorParticipantId: 'A', amountMinor: 10_000n },
      { debtorParticipantId: 'D', creditorParticipantId: 'B', amountMinor: 15_000n },
    ]);
  });
});

describe('simplification', () => {
  it('suggests A pay C when A owes B and B owes C the same amount', () => {
    const plan = simplifyBalances({
      contextId: 'group-1',
      currency: 'INR',
      balanceVersion: '42',
      balances: [
        { participantId: 'A', netMinor: -10_000n },
        { participantId: 'B', netMinor: 0n },
        { participantId: 'C', netMinor: 10_000n },
      ],
    });
    expect(plan.suggestions).toEqual([
      { fromParticipantId: 'A', toParticipantId: 'C', amountMinor: 10_000n },
    ]);
    expect(plan.balanceVersion).toBe('42');
  });

  it('does not invent suggestions for a zero-net obligation cycle', () => {
    const plan = simplifyBalances({
      contextId: 'group-1',
      currency: 'INR',
      balanceVersion: '43',
      balances: [
        { participantId: 'A', netMinor: 0n },
        { participantId: 'B', netMinor: 0n },
        { participantId: 'C', netMinor: 0n },
      ],
    });
    expect(plan.suggestions).toEqual([]);
  });
});

describe('append-only journal invariants', () => {
  it('rejects an unbalanced batch', () => {
    expect(() =>
      assertBalancedJournalBatch(
        batch('bad', 'expense', [
          { participantId: 'A', amountMinor: 100n },
          { participantId: 'B', amountMinor: -99n },
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNBALANCED_JOURNAL_BATCH' }));
  });

  it('creates an exact linked reversal and leaves history intact', () => {
    const original = batch('expense-1-r1', 'expense', [
      { participantId: 'A', amountMinor: 5_000n },
      { participantId: 'B', amountMinor: -5_000n },
    ]);
    const reversal = reverseJournalBatch(original, {
      batchId: 'expense-1-reversal-r2',
      sourceId: 'expense-1',
      sourceRevision: 2,
      actorId: 'actor-2',
      occurredAt: '2026-09-13T00:00:00.000Z',
    });
    expect(() => assertExactReversal(original, reversal)).not.toThrow();
    expect(rebuildBalanceProjection([original, reversal])).toMatchObject([
      { participantId: 'A', amountMinor: 0n },
      { participantId: 'B', amountMinor: 0n },
    ]);
  });

  it('preserves settlement history when a later expense edit is posted', () => {
    const expense = batch('expense-r1', 'expense', [
      { participantId: 'A', amountMinor: -50_000n },
      { participantId: 'B', amountMinor: 50_000n },
    ]);
    const settlement = batch('settlement-r1', 'settlement', [
      { participantId: 'A', amountMinor: 20_000n },
      { participantId: 'B', amountMinor: -20_000n },
    ]);
    const reversal = reverseJournalBatch(expense, {
      batchId: 'expense-r1-reversal',
      sourceId: 'expense-1',
      sourceRevision: 2,
      actorId: 'actor-1',
      occurredAt: '2026-09-14T00:00:00.000Z',
    });
    const replacement = batch('expense-r2', 'expense', [
      { participantId: 'A', amountMinor: -40_000n },
      { participantId: 'B', amountMinor: 40_000n },
    ]);
    const projection = rebuildBalanceProjection([expense, settlement, reversal, replacement]);
    expect(projection).toMatchObject([
      { participantId: 'A', amountMinor: -20_000n },
      { participantId: 'B', amountMinor: 20_000n },
    ]);
  });

  it('keeps currency projections independent', () => {
    const inr = batch('inr', 'expense', [
      { participantId: 'A', amountMinor: -100n },
      { participantId: 'B', amountMinor: 100n },
    ]);
    const usd = { ...batch('usd', 'expense', inr.postings), currency: 'USD' };
    const projection = rebuildBalanceProjection([inr, usd]);
    expect(projection).toHaveLength(4);
    expect(new Set(projection.map(({ currency }) => currency))).toEqual(new Set(['INR', 'USD']));
  });

  it('incremental projection equals a complete rebuild', () => {
    const first = batch('one', 'expense', [
      { participantId: 'A', amountMinor: 100n },
      { participantId: 'B', amountMinor: -100n },
    ]);
    const second = batch('two', 'settlement', [
      { participantId: 'A', amountMinor: -40n },
      { participantId: 'B', amountMinor: 40n },
    ]);
    expect(applyJournalBatch(applyJournalBatch([], first), second)).toEqual(
      rebuildBalanceProjection([first, second]),
    );
  });
});
