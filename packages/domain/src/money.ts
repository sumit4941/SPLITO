import { domainAssert } from './errors.js';

/** Oracle NUMBER(19,0) supports at most 19 decimal digits. */
export const MAX_MINOR_AMOUNT = 9_999_999_999_999_999_999n;

const CANONICAL_SIGNED_INTEGER = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const ISO_STYLE_CURRENCY_CODE = /^[A-Z]{3}$/;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface MoneyJson {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface CurrencyMetadata {
  readonly code: string;
  readonly minorUnitDigits: 0 | 1 | 2 | 3;
  readonly name?: string;
  readonly symbol?: string;
}

export function assertCurrencyCode(currency: unknown): asserts currency is string {
  domainAssert(
    typeof currency === 'string' && ISO_STYLE_CURRENCY_CODE.test(currency),
    'INVALID_CURRENCY',
    'Currency must be a three-letter uppercase code.',
    { currency },
  );
}

export function assertMinorAmount(
  amountMinor: bigint,
  options: { readonly allowNegative?: boolean } = {},
): bigint {
  domainAssert(
    typeof amountMinor === 'bigint',
    'INVALID_MINOR_AMOUNT',
    'Minor-unit amounts must use bigint internally.',
  );
  domainAssert(
    options.allowNegative === true || amountMinor >= 0n,
    'NEGATIVE_MINOR_AMOUNT',
    'This amount cannot be negative.',
    { amountMinor: amountMinor.toString() },
  );
  domainAssert(
    amountMinor >= -MAX_MINOR_AMOUNT && amountMinor <= MAX_MINOR_AMOUNT,
    'MINOR_AMOUNT_OUT_OF_RANGE',
    "The amount exceeds SPLITO's NUMBER(19,0) domain limit.",
    { amountMinor: amountMinor.toString(), maximum: MAX_MINOR_AMOUNT.toString() },
  );
  return amountMinor;
}

/** Parses the canonical decimal-integer representation used at JSON boundaries. */
export function parseMinorAmount(
  value: unknown,
  options: { readonly allowNegative?: boolean } = {},
): bigint {
  if (typeof value === 'bigint') {
    return assertMinorAmount(value, options);
  }

  domainAssert(
    typeof value === 'string' && CANONICAL_SIGNED_INTEGER.test(value),
    'INVALID_MINOR_AMOUNT',
    'Minor-unit amounts must be canonical base-10 integer strings.',
    { value },
  );
  return assertMinorAmount(BigInt(value), options);
}

export function moneyFromJson(value: MoneyJson): Money {
  assertCurrencyCode(value.currency);
  return {
    currency: value.currency,
    amountMinor: parseMinorAmount(value.amountMinor, { allowNegative: true }),
  };
}

export function moneyToJson(value: Money): MoneyJson {
  assertCurrencyCode(value.currency);
  assertMinorAmount(value.amountMinor, { allowNegative: true });
  return { currency: value.currency, amountMinor: value.amountMinor.toString() };
}

export function validateCurrencyMetadata(metadata: CurrencyMetadata): CurrencyMetadata {
  assertCurrencyCode(metadata.code);
  domainAssert(
    Number.isInteger(metadata.minorUnitDigits) &&
      metadata.minorUnitDigits >= 0 &&
      metadata.minorUnitDigits <= 3,
    'INVALID_CURRENCY_MINOR_UNITS',
    'Currency minor-unit digits must be an integer from zero through three.',
    { minorUnitDigits: metadata.minorUnitDigits },
  );
  return metadata;
}
