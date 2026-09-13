import { domainAssert } from './errors.js';
import { assertCurrencyCode, assertMinorAmount } from './money.js';

export const SIMPLIFICATION_ALGORITHM_VERSION = 'splito-greedy-largest-v1';

export interface BalancePosition {
  readonly participantId: string;
  /** Positive means this participant is owed money; negative means they owe money. */
  readonly netMinor: bigint;
}

export interface SettlementSuggestion {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly amountMinor: bigint;
}

export interface SimplificationInput {
  readonly contextId: string;
  readonly currency: string;
  /** Opaque projection version that callers must recheck before committing a suggestion. */
  readonly balanceVersion: string;
  readonly balances: readonly BalancePosition[];
}

export interface SimplificationPlan {
  readonly contextId: string;
  readonly currency: string;
  readonly balanceVersion: string;
  readonly algorithmVersion: typeof SIMPLIFICATION_ALGORITHM_VERSION;
  readonly suggestions: readonly SettlementSuggestion[];
}

interface RemainingPosition {
  readonly participantId: string;
  remaining: bigint;
}

function descendingAmountThenId(left: RemainingPosition, right: RemainingPosition): number {
  return left.remaining === right.remaining
    ? left.participantId.localeCompare(right.participantId)
    : left.remaining > right.remaining
      ? -1
      : 1;
}

/** Greedy settlement planning. It preserves every net, but does not claim transfer-count optimality. */
export function simplifyBalances(input: SimplificationInput): SimplificationPlan {
  assertCurrencyCode(input.currency);
  domainAssert(input.contextId.length > 0, 'INVALID_CONTEXT_ID', 'Context ID is required.');
  domainAssert(
    input.balanceVersion.length > 0,
    'INVALID_BALANCE_VERSION',
    'A balance projection version is required for stale-plan detection.',
  );

  const ids = new Set<string>();
  for (const balance of input.balances) {
    domainAssert(
      balance.participantId.length > 0 && !ids.has(balance.participantId),
      'DUPLICATE_PARTICIPANT',
      'Each participant can appear only once in a simplification input.',
      { participantId: balance.participantId },
    );
    ids.add(balance.participantId);
    assertMinorAmount(balance.netMinor, { allowNegative: true });
  }

  const total = input.balances.reduce((sum, balance) => sum + balance.netMinor, 0n);
  domainAssert(
    total === 0n,
    'UNBALANCED_SIMPLIFICATION_INPUT',
    'Balances must sum to zero before simplification.',
    { netTotalMinor: total.toString() },
  );

  const creditors: RemainingPosition[] = input.balances
    .filter((balance) => balance.netMinor > 0n)
    .map((balance) => ({ participantId: balance.participantId, remaining: balance.netMinor }));
  const debtors: RemainingPosition[] = input.balances
    .filter((balance) => balance.netMinor < 0n)
    .map((balance) => ({ participantId: balance.participantId, remaining: -balance.netMinor }));
  const suggestions: SettlementSuggestion[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(descendingAmountThenId);
    debtors.sort(descendingAmountThenId);
    const creditor = creditors[0];
    const debtor = debtors[0];
    domainAssert(
      creditor !== undefined && debtor !== undefined,
      'MATCH_STATE_ERROR',
      'Invalid match state.',
    );

    const amountMinor =
      creditor.remaining < debtor.remaining ? creditor.remaining : debtor.remaining;
    suggestions.push({
      fromParticipantId: debtor.participantId,
      toParticipantId: creditor.participantId,
      amountMinor,
    });
    creditor.remaining -= amountMinor;
    debtor.remaining -= amountMinor;
    if (creditor.remaining === 0n) creditors.shift();
    if (debtor.remaining === 0n) debtors.shift();
  }

  domainAssert(
    creditors.length === 0 && debtors.length === 0,
    'INCOMPLETE_SIMPLIFICATION',
    'Could not settle every balance.',
  );

  return {
    contextId: input.contextId,
    currency: input.currency,
    balanceVersion: input.balanceVersion,
    algorithmVersion: SIMPLIFICATION_ALGORITHM_VERSION,
    suggestions,
  };
}
