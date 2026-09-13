import { domainAssert } from './errors.js';
import { assertCurrencyCode, assertMinorAmount } from './money.js';
import { normalizeOrderedParticipants, type OrderedParticipant } from './participants.js';

export const BILATERAL_ALGORITHM_VERSION = 'splito-bilateral-order-v1';

export interface ParticipantNet extends OrderedParticipant {
  /** Positive means this participant is owed money; negative means they owe money. */
  readonly netMinor: bigint;
}

export interface BilateralObligation {
  readonly debtorParticipantId: string;
  readonly creditorParticipantId: string;
  readonly amountMinor: bigint;
}

export interface BilateralAllocationResult {
  readonly currency: string;
  readonly algorithmVersion: typeof BILATERAL_ALGORITHM_VERSION;
  readonly obligations: readonly BilateralObligation[];
}

/**
 * Matches expense-level debtors and creditors in persisted allocation order.
 * This preserves a deterministic attribution even when an expense has many payers.
 */
export function createBilateralObligations(
  currency: string,
  positions: readonly ParticipantNet[],
): BilateralAllocationResult {
  assertCurrencyCode(currency);
  const ordered = normalizeOrderedParticipants(positions);
  for (const position of ordered) {
    assertMinorAmount(position.netMinor, { allowNegative: true });
  }

  const netTotal = ordered.reduce((sum, position) => sum + position.netMinor, 0n);
  domainAssert(
    netTotal === 0n,
    'UNBALANCED_PARTICIPANT_NETS',
    'Expense-level participant net amounts must sum to zero.',
    { netTotalMinor: netTotal.toString() },
  );

  const creditors = ordered
    .filter((position) => position.netMinor > 0n)
    .map((position) => ({ participantId: position.participantId, remaining: position.netMinor }));
  const debtors = ordered
    .filter((position) => position.netMinor < 0n)
    .map((position) => ({ participantId: position.participantId, remaining: -position.netMinor }));

  const obligations: BilateralObligation[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    domainAssert(
      creditor !== undefined && debtor !== undefined,
      'MATCH_STATE_ERROR',
      'Invalid match state.',
    );

    const amountMinor =
      creditor.remaining < debtor.remaining ? creditor.remaining : debtor.remaining;
    obligations.push({
      debtorParticipantId: debtor.participantId,
      creditorParticipantId: creditor.participantId,
      amountMinor,
    });
    creditor.remaining -= amountMinor;
    debtor.remaining -= amountMinor;
    if (creditor.remaining === 0n) creditorIndex += 1;
    if (debtor.remaining === 0n) debtorIndex += 1;
  }

  domainAssert(
    creditors.every((creditor) => creditor.remaining === 0n) &&
      debtors.every((debtor) => debtor.remaining === 0n),
    'INCOMPLETE_BILATERAL_MATCH',
    'Could not fully match participant debts and credits.',
  );

  return { currency, algorithmVersion: BILATERAL_ALGORITHM_VERSION, obligations };
}
