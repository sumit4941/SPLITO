import { describe, expect, it } from 'vitest';

import {
  MAX_MINOR_AMOUNT,
  allocateAdjustments,
  allocateEqual,
  allocateExact,
  allocateFromJson,
  allocatePercentages,
  allocateShares,
  moneyFromJson,
  moneyToJson,
  parseMinorAmount,
  validateCurrencyMetadata,
} from '../src/index.js';

const people = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    participantId: String.fromCharCode(65 + index),
    allocationOrder: index,
  }));

describe('money boundaries', () => {
  it('keeps money as bigint internally and canonical strings in JSON', () => {
    const internal = moneyFromJson({ currency: 'INR', amountMinor: '12345' });
    expect(internal).toEqual({ currency: 'INR', amountMinor: 12_345n });
    expect(moneyToJson(internal)).toEqual({ currency: 'INR', amountMinor: '12345' });
  });

  it.each(['01', '+1', '1.0', '1e3', '-0', ' 1'])(
    'rejects non-canonical minor-unit input %s',
    (value) => {
      expect(() => parseMinorAmount(value, { allowNegative: true })).toThrowError(
        expect.objectContaining({ code: 'INVALID_MINOR_AMOUNT' }),
      );
    },
  );

  it('enforces the persisted 19-digit minor-unit domain limit', () => {
    expect(parseMinorAmount(MAX_MINOR_AMOUNT.toString())).toBe(MAX_MINOR_AMOUNT);
    expect(() => parseMinorAmount((MAX_MINOR_AMOUNT + 1n).toString())).toThrowError(
      expect.objectContaining({ code: 'MINOR_AMOUNT_OUT_OF_RANGE' }),
    );
  });

  it('supports zero-, two-, and three-decimal currency metadata', () => {
    expect(validateCurrencyMetadata({ code: 'JPY', minorUnitDigits: 0 })).toBeTruthy();
    expect(validateCurrencyMetadata({ code: 'INR', minorUnitDigits: 2 })).toBeTruthy();
    expect(validateCurrencyMetadata({ code: 'KWD', minorUnitDigits: 3 })).toBeTruthy();
  });
});

describe('deterministic allocation examples', () => {
  it('splits INR 100 three ways as 33.34, 33.33, 33.33 in persisted order', () => {
    const allocation = allocateEqual(10_000n, people(3));
    expect(allocation.allocations.map(({ amountMinor }) => amountMinor)).toEqual([
      3_334n,
      3_333n,
      3_333n,
    ]);
  });

  it('uses persisted order, not input array order, to break equal remainders', () => {
    const [a, b, c] = people(3);
    expect(a && b && c).toBeTruthy();
    const allocation = allocateEqual(10_000n, [c!, a!, b!]);
    expect(allocation.allocations).toMatchObject([
      { participantId: 'A', amountMinor: 3_334n },
      { participantId: 'B', amountMinor: 3_333n },
      { participantId: 'C', amountMinor: 3_333n },
    ]);
  });

  it('splits INR 1,000 with shares 1:2:3', () => {
    const [a, b, c] = people(3);
    const allocation = allocateShares(100_000n, [
      { ...a!, shares: '1' },
      { ...b!, shares: '2' },
      { ...c!, shares: '3' },
    ]);
    expect(allocation.allocations.map(({ amountMinor }) => amountMinor)).toEqual([
      16_667n,
      33_333n,
      50_000n,
    ]);
  });

  it('splits INR 1,000 using exact 55%/45% rational percentages', () => {
    const [a, b] = people(2);
    const allocation = allocatePercentages(100_000n, [
      { ...a!, percentage: '55' },
      { ...b!, percentage: '45.0' },
    ]);
    expect(allocation.allocations.map(({ amountMinor }) => amountMinor)).toEqual([
      55_000n,
      45_000n,
    ]);
  });

  it('uses base=(T-sum(adjustments))/count before applying adjustments', () => {
    const [a, b] = people(2);
    const allocation = allocateAdjustments(100_000n, [
      { ...a!, adjustmentMinor: 10_000n },
      { ...b!, adjustmentMinor: 0n },
    ]);
    expect(allocation.allocations.map(({ amountMinor }) => amountMinor)).toEqual([
      55_000n,
      45_000n,
    ]);
  });

  it('validates exact totals without tolerance', () => {
    const [a, b] = people(2);
    expect(() =>
      allocateExact(100n, [
        { ...a!, amountMinor: 49n },
        { ...b!, amountMinor: 50n },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'EXACT_TOTAL_MISMATCH' }));
  });

  it('requires percentages to sum exactly to 100', () => {
    const [a, b] = people(2);
    expect(() =>
      allocatePercentages(100n, [
        { ...a!, percentage: '33.33' },
        { ...b!, percentage: '66.66' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'PERCENTAGE_TOTAL_MISMATCH' }));
  });

  it('requires at least one positive share weight', () => {
    const [a, b] = people(2);
    expect(() =>
      allocateShares(100n, [
        { ...a!, shares: '0' },
        { ...b!, shares: '0.0' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'ZERO_TOTAL_WEIGHT' }));
  });

  it('allows zero-weight beneficiaries while preserving the total', () => {
    const [a, b, c] = people(3);
    const allocation = allocateShares(101n, [
      { ...a!, shares: '0' },
      { ...b!, shares: '1' },
      { ...c!, shares: '1' },
    ]);
    expect(allocation.allocations.map(({ amountMinor }) => amountMinor)).toEqual([0n, 51n, 50n]);
  });

  it('rejects an adjustment that creates a negative owed amount', () => {
    const [a, b] = people(2);
    expect(() =>
      allocateAdjustments(100n, [
        { ...a!, adjustmentMinor: -201n },
        { ...b!, adjustmentMinor: 0n },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'NEGATIVE_ADJUSTED_ALLOCATION' }));
  });

  it('provides an API-safe allocation adapter with only string money', () => {
    expect(
      allocateFromJson({ method: 'equal', totalMinor: '100', beneficiaries: people(3) }),
    ).toMatchObject({
      totalMinor: '100',
      allocations: [
        { participantId: 'A', amountMinor: '34' },
        { participantId: 'B', amountMinor: '33' },
        { participantId: 'C', amountMinor: '33' },
      ],
    });
  });
});
