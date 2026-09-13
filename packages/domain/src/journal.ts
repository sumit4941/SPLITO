import { domainAssert } from './errors.js';
import { assertCurrencyCode, assertMinorAmount } from './money.js';

export interface JournalPosting {
  readonly participantId: string;
  /** Positive means owed to the participant; negative means owed by the participant. */
  readonly amountMinor: bigint;
}

export interface JournalBatch {
  readonly batchId: string;
  readonly contextId: string;
  readonly currency: string;
  readonly sourceType: 'expense' | 'settlement' | 'refund' | 'conversion' | 'correction';
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly reversalOfBatchId?: string;
  readonly postings: readonly JournalPosting[];
}

export function assertBalancedJournalBatch(batch: JournalBatch): JournalBatch {
  domainAssert(batch.batchId.length > 0, 'INVALID_BATCH_ID', 'Journal batch ID is required.');
  domainAssert(batch.contextId.length > 0, 'INVALID_CONTEXT_ID', 'Journal context ID is required.');
  assertCurrencyCode(batch.currency);
  domainAssert(batch.sourceId.length > 0, 'INVALID_SOURCE_ID', 'Journal source ID is required.');
  domainAssert(batch.actorId.length > 0, 'INVALID_ACTOR_ID', 'Journal actor ID is required.');
  domainAssert(
    Number.isSafeInteger(batch.sourceRevision) && batch.sourceRevision > 0,
    'INVALID_SOURCE_REVISION',
    'Journal source revision must be a positive safe integer.',
  );
  domainAssert(
    !Number.isNaN(Date.parse(batch.occurredAt)),
    'INVALID_OCCURRED_AT',
    'Journal occurrence timestamp must be an ISO-compatible timestamp.',
  );
  domainAssert(batch.postings.length > 0, 'EMPTY_JOURNAL_BATCH', 'A journal batch needs postings.');

  const participants = new Set<string>();
  let sum = 0n;
  for (const posting of batch.postings) {
    domainAssert(
      posting.participantId.length > 0 && !participants.has(posting.participantId),
      'DUPLICATE_JOURNAL_PARTICIPANT',
      'A participant can have only one posting per batch.',
      { participantId: posting.participantId },
    );
    participants.add(posting.participantId);
    assertMinorAmount(posting.amountMinor, { allowNegative: true });
    sum += posting.amountMinor;
  }
  domainAssert(sum === 0n, 'UNBALANCED_JOURNAL_BATCH', 'Journal postings must sum to zero.', {
    batchId: batch.batchId,
    sumMinor: sum.toString(),
  });
  return batch;
}

export interface ReverseBatchMetadata {
  readonly batchId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly actorId: string;
  readonly occurredAt: string;
}

export function reverseJournalBatch(
  original: JournalBatch,
  metadata: ReverseBatchMetadata,
): JournalBatch {
  assertBalancedJournalBatch(original);
  const reversal: JournalBatch = {
    ...original,
    ...metadata,
    reversalOfBatchId: original.batchId,
    postings: original.postings.map((posting) => ({
      participantId: posting.participantId,
      amountMinor: -posting.amountMinor,
    })),
  };
  return assertBalancedJournalBatch(reversal);
}

export function assertExactReversal(original: JournalBatch, reversal: JournalBatch): void {
  assertBalancedJournalBatch(original);
  assertBalancedJournalBatch(reversal);
  domainAssert(
    reversal.reversalOfBatchId === original.batchId &&
      reversal.contextId === original.contextId &&
      reversal.currency === original.currency,
    'INVALID_REVERSAL_LINK',
    'A reversal must identify its original batch in the same context and currency.',
  );
  const reversalByParticipant = new Map(
    reversal.postings.map((posting) => [posting.participantId, posting.amountMinor]),
  );
  domainAssert(
    reversalByParticipant.size === original.postings.length &&
      original.postings.every(
        (posting) => reversalByParticipant.get(posting.participantId) === -posting.amountMinor,
      ),
    'INEXACT_REVERSAL',
    'A reversal must exactly negate every original participant posting.',
  );
}

export interface ExpenseContribution {
  readonly participantId: string;
  readonly paidMinor: bigint;
  readonly owedMinor: bigint;
}

export function expenseNetPostings(
  totalMinor: bigint,
  contributions: readonly ExpenseContribution[],
): JournalPosting[] {
  assertMinorAmount(totalMinor);
  domainAssert(contributions.length > 0, 'EMPTY_EXPENSE', 'An expense needs participants.');
  const ids = new Set<string>();
  let paidTotal = 0n;
  let owedTotal = 0n;
  const postings = contributions.map((contribution) => {
    domainAssert(
      contribution.participantId.length > 0 && !ids.has(contribution.participantId),
      'DUPLICATE_PARTICIPANT',
      'Each expense participant can appear only once.',
      { participantId: contribution.participantId },
    );
    ids.add(contribution.participantId);
    assertMinorAmount(contribution.paidMinor);
    assertMinorAmount(contribution.owedMinor);
    paidTotal += contribution.paidMinor;
    owedTotal += contribution.owedMinor;
    return {
      participantId: contribution.participantId,
      amountMinor: contribution.paidMinor - contribution.owedMinor,
    };
  });
  domainAssert(
    paidTotal === totalMinor,
    'PAYER_TOTAL_MISMATCH',
    'Payer amounts must sum exactly to the expense total.',
    { expectedMinor: totalMinor.toString(), actualMinor: paidTotal.toString() },
  );
  domainAssert(
    owedTotal === totalMinor,
    'OWED_TOTAL_MISMATCH',
    'Beneficiary amounts must sum exactly to the expense total.',
    { expectedMinor: totalMinor.toString(), actualMinor: owedTotal.toString() },
  );
  domainAssert(
    postings.reduce((sum, posting) => sum + posting.amountMinor, 0n) === 0n,
    'UNBALANCED_EXPENSE_NETS',
    'Expense participant nets must sum to zero.',
  );
  return postings;
}

export interface BalanceProjectionEntry {
  readonly contextId: string;
  readonly currency: string;
  readonly participantId: string;
  readonly amountMinor: bigint;
}

function projectionKey(entry: Omit<BalanceProjectionEntry, 'amountMinor'>): string {
  return JSON.stringify([entry.contextId, entry.currency, entry.participantId]);
}

function sortProjection(left: BalanceProjectionEntry, right: BalanceProjectionEntry): number {
  return (
    left.contextId.localeCompare(right.contextId) ||
    left.currency.localeCompare(right.currency) ||
    left.participantId.localeCompare(right.participantId)
  );
}

export function applyJournalBatch(
  current: readonly BalanceProjectionEntry[],
  batch: JournalBatch,
): BalanceProjectionEntry[] {
  assertBalancedJournalBatch(batch);
  const projection = new Map<string, BalanceProjectionEntry>();
  for (const entry of current) {
    projection.set(projectionKey(entry), { ...entry });
  }
  for (const posting of batch.postings) {
    const identity = {
      contextId: batch.contextId,
      currency: batch.currency,
      participantId: posting.participantId,
    };
    const key = projectionKey(identity);
    const previous = projection.get(key)?.amountMinor ?? 0n;
    projection.set(key, { ...identity, amountMinor: previous + posting.amountMinor });
  }
  return [...projection.values()].sort(sortProjection);
}

export function rebuildBalanceProjection(
  batches: readonly JournalBatch[],
): BalanceProjectionEntry[] {
  return batches.reduce<BalanceProjectionEntry[]>(applyJournalBatch, []);
}
