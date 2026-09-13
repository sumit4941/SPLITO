import { domainAssert } from './errors.js';
import { assertMinorAmount, parseMinorAmount } from './money.js';
import {
  addRational,
  compareRational,
  divideRational,
  floorNonNegative,
  fractionalPartNonNegative,
  multiplyRational,
  parseDecimal,
  rational,
  sumRationals,
  type Rational,
} from './rational.js';
import {
  compareOrderedParticipants,
  normalizeOrderedParticipants,
  type OrderedParticipant,
} from './participants.js';

export const ALLOCATION_ALGORITHM_VERSION = 'splito-largest-remainder-v1';
export const MAX_SHARE_WEIGHT = 1_000_000_000n;

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustments';

export interface AllocatedAmount extends OrderedParticipant {
  readonly amountMinor: bigint;
}

export interface AllocationResult {
  readonly method: SplitMethod;
  readonly totalMinor: bigint;
  readonly algorithmVersion: typeof ALLOCATION_ALGORITHM_VERSION;
  readonly allocations: readonly AllocatedAmount[];
}

export interface AllocationResultJson {
  readonly method: SplitMethod;
  readonly totalMinor: string;
  readonly algorithmVersion: typeof ALLOCATION_ALGORITHM_VERSION;
  readonly allocations: readonly (OrderedParticipant & { readonly amountMinor: string })[];
}

interface RationalAllocationEntry extends OrderedParticipant {
  readonly exactAmount: Rational;
}

function result(
  method: SplitMethod,
  totalMinor: bigint,
  allocations: readonly AllocatedAmount[],
): AllocationResult {
  const sum = allocations.reduce((current, allocation) => current + allocation.amountMinor, 0n);
  domainAssert(sum === totalMinor, 'UNBALANCED_ALLOCATION', 'Allocation does not sum to total.', {
    expectedMinor: totalMinor.toString(),
    actualMinor: sum.toString(),
  });
  return { method, totalMinor, algorithmVersion: ALLOCATION_ALGORITHM_VERSION, allocations };
}

function roundExactAmounts(
  totalMinor: bigint,
  entries: readonly RationalAllocationEntry[],
): AllocatedAmount[] {
  const exactSum = sumRationals(entries.map((entry) => entry.exactAmount));
  domainAssert(
    compareRational(exactSum, rational(totalMinor)) === 0,
    'UNBALANCED_RATIONAL_ALLOCATION',
    'Exact rational allocations must sum to the requested total.',
  );

  const withRemainders = entries.map((entry) => {
    domainAssert(
      entry.exactAmount.numerator >= 0n,
      'NEGATIVE_ALLOCATION',
      'A beneficiary allocation cannot be negative.',
      { participantId: entry.participantId },
    );
    return {
      ...entry,
      floor: floorNonNegative(entry.exactAmount),
      remainder: fractionalPartNonNegative(entry.exactAmount),
    };
  });

  const floorTotal = withRemainders.reduce((sum, entry) => sum + entry.floor, 0n);
  const unitCount = totalMinor - floorTotal;
  domainAssert(
    unitCount >= 0n && unitCount < BigInt(entries.length),
    'INVALID_ROUNDING_REMAINDER',
    'Largest-remainder rounding produced an invalid remainder count.',
    { unitCount: unitCount.toString() },
  );

  const remainderPriority = [...withRemainders].sort((left, right) => {
    const remainderComparison = compareRational(right.remainder, left.remainder);
    return remainderComparison || compareOrderedParticipants(left, right);
  });
  const roundedUp = new Set(
    remainderPriority.slice(0, Number(unitCount)).map((entry) => entry.participantId),
  );

  return withRemainders
    .map((entry) => ({
      participantId: entry.participantId,
      allocationOrder: entry.allocationOrder,
      amountMinor: entry.floor + (roundedUp.has(entry.participantId) ? 1n : 0n),
    }))
    .sort(compareOrderedParticipants);
}

function allocateByWeights(
  method: 'equal' | 'percentage' | 'shares',
  totalMinor: bigint,
  entries: readonly (OrderedParticipant & { readonly weight: Rational })[],
): AllocationResult {
  assertMinorAmount(totalMinor);
  const ordered = normalizeOrderedParticipants(entries);
  const totalWeight = sumRationals(ordered.map((entry) => entry.weight));
  domainAssert(
    totalWeight.numerator > 0n,
    'ZERO_TOTAL_WEIGHT',
    'At least one beneficiary weight must be positive.',
  );

  const exactEntries = ordered.map((entry) => {
    domainAssert(
      entry.weight.numerator >= 0n,
      'NEGATIVE_WEIGHT',
      'Allocation weights cannot be negative.',
      { participantId: entry.participantId },
    );
    return {
      participantId: entry.participantId,
      allocationOrder: entry.allocationOrder,
      exactAmount: divideRational(
        multiplyRational(rational(totalMinor), entry.weight),
        totalWeight,
      ),
    };
  });

  return result(method, totalMinor, roundExactAmounts(totalMinor, exactEntries));
}

export function allocateEqual(
  totalMinor: bigint,
  beneficiaries: readonly OrderedParticipant[],
): AllocationResult {
  return allocateByWeights(
    'equal',
    totalMinor,
    beneficiaries.map((beneficiary) => ({ ...beneficiary, weight: rational(1n) })),
  );
}

export interface ExactAllocationInput extends OrderedParticipant {
  readonly amountMinor: bigint;
}

export function allocateExact(
  totalMinor: bigint,
  beneficiaries: readonly ExactAllocationInput[],
): AllocationResult {
  assertMinorAmount(totalMinor);
  const ordered = normalizeOrderedParticipants(beneficiaries);
  for (const beneficiary of ordered) {
    assertMinorAmount(beneficiary.amountMinor);
  }
  const exactTotal = ordered.reduce((sum, beneficiary) => sum + beneficiary.amountMinor, 0n);
  domainAssert(
    exactTotal === totalMinor,
    'EXACT_TOTAL_MISMATCH',
    'Exact allocations must sum exactly to the expense total.',
    { expectedMinor: totalMinor.toString(), actualMinor: exactTotal.toString() },
  );
  return result(
    'exact',
    totalMinor,
    ordered.map((entry) => ({ ...entry })),
  );
}

export interface PercentageAllocationInput extends OrderedParticipant {
  readonly percentage: string;
}

export function allocatePercentages(
  totalMinor: bigint,
  beneficiaries: readonly PercentageAllocationInput[],
): AllocationResult {
  assertMinorAmount(totalMinor);
  const entries = normalizeOrderedParticipants(beneficiaries).map((beneficiary) => {
    const percentage = parseDecimal(beneficiary.percentage);
    domainAssert(
      compareRational(percentage, rational(100n)) <= 0,
      'PERCENTAGE_OUT_OF_RANGE',
      'Each percentage must be between zero and 100.',
      { participantId: beneficiary.participantId, percentage: beneficiary.percentage },
    );
    return { ...beneficiary, weight: percentage };
  });
  const totalPercentage = sumRationals(entries.map((entry) => entry.weight));
  domainAssert(
    compareRational(totalPercentage, rational(100n)) === 0,
    'PERCENTAGE_TOTAL_MISMATCH',
    'Percentages must sum exactly to 100.',
  );
  return allocateByWeights('percentage', totalMinor, entries);
}

export interface SharesAllocationInput extends OrderedParticipant {
  readonly shares: string;
}

export function allocateShares(
  totalMinor: bigint,
  beneficiaries: readonly SharesAllocationInput[],
): AllocationResult {
  assertMinorAmount(totalMinor);
  const entries = normalizeOrderedParticipants(beneficiaries).map((beneficiary) => {
    const weight = parseDecimal(beneficiary.shares);
    domainAssert(
      compareRational(weight, rational(MAX_SHARE_WEIGHT)) <= 0,
      'SHARE_WEIGHT_OUT_OF_RANGE',
      `Share weights cannot exceed ${MAX_SHARE_WEIGHT.toString()}.`,
      { participantId: beneficiary.participantId, shares: beneficiary.shares },
    );
    return { ...beneficiary, weight };
  });
  return allocateByWeights('shares', totalMinor, entries);
}

export interface AdjustmentAllocationInput extends OrderedParticipant {
  readonly adjustmentMinor: bigint;
}

export function allocateAdjustments(
  totalMinor: bigint,
  beneficiaries: readonly AdjustmentAllocationInput[],
): AllocationResult {
  assertMinorAmount(totalMinor);
  const ordered = normalizeOrderedParticipants(beneficiaries);
  for (const beneficiary of ordered) {
    assertMinorAmount(beneficiary.adjustmentMinor, { allowNegative: true });
  }

  const adjustmentTotal = ordered.reduce(
    (sum, beneficiary) => sum + beneficiary.adjustmentMinor,
    0n,
  );
  const base = rational(totalMinor - adjustmentTotal, BigInt(ordered.length));
  const exactEntries = ordered.map((beneficiary) => {
    const exactAmount = addRational(base, rational(beneficiary.adjustmentMinor));
    domainAssert(
      exactAmount.numerator >= 0n,
      'NEGATIVE_ADJUSTED_ALLOCATION',
      "Adjustments would make a beneficiary's owed amount negative.",
      { participantId: beneficiary.participantId },
    );
    return {
      participantId: beneficiary.participantId,
      allocationOrder: beneficiary.allocationOrder,
      exactAmount,
    };
  });
  return result('adjustments', totalMinor, roundExactAmounts(totalMinor, exactEntries));
}

export function allocationToJson(value: AllocationResult): AllocationResultJson {
  return {
    method: value.method,
    totalMinor: value.totalMinor.toString(),
    algorithmVersion: value.algorithmVersion,
    allocations: value.allocations.map((allocation) => ({
      participantId: allocation.participantId,
      allocationOrder: allocation.allocationOrder,
      amountMinor: allocation.amountMinor.toString(),
    })),
  };
}

export type AllocationRequestJson =
  | {
      readonly method: 'equal';
      readonly totalMinor: string;
      readonly beneficiaries: readonly OrderedParticipant[];
    }
  | {
      readonly method: 'exact';
      readonly totalMinor: string;
      readonly beneficiaries: readonly (OrderedParticipant & { readonly amountMinor: string })[];
    }
  | {
      readonly method: 'percentage';
      readonly totalMinor: string;
      readonly beneficiaries: readonly PercentageAllocationInput[];
    }
  | {
      readonly method: 'shares';
      readonly totalMinor: string;
      readonly beneficiaries: readonly SharesAllocationInput[];
    }
  | {
      readonly method: 'adjustments';
      readonly totalMinor: string;
      readonly beneficiaries: readonly (OrderedParticipant & {
        readonly adjustmentMinor: string;
      })[];
    };

export function allocateFromJson(request: AllocationRequestJson): AllocationResultJson {
  const totalMinor = parseMinorAmount(request.totalMinor);
  switch (request.method) {
    case 'equal':
      return allocationToJson(allocateEqual(totalMinor, request.beneficiaries));
    case 'exact':
      return allocationToJson(
        allocateExact(
          totalMinor,
          request.beneficiaries.map((entry) => ({
            ...entry,
            amountMinor: parseMinorAmount(entry.amountMinor),
          })),
        ),
      );
    case 'percentage':
      return allocationToJson(allocatePercentages(totalMinor, request.beneficiaries));
    case 'shares':
      return allocationToJson(allocateShares(totalMinor, request.beneficiaries));
    case 'adjustments':
      return allocationToJson(
        allocateAdjustments(
          totalMinor,
          request.beneficiaries.map((entry) => ({
            ...entry,
            adjustmentMinor: parseMinorAmount(entry.adjustmentMinor, { allowNegative: true }),
          })),
        ),
      );
  }
}
