import { domainAssert } from './errors.js';

export const MAX_DECIMAL_SCALE = 12;

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function rational(numerator: bigint, denominator = 1n): Rational {
  domainAssert(
    denominator !== 0n,
    'ZERO_DENOMINATOR',
    'A rational value cannot have a zero denominator.',
  );

  const sign = denominator < 0n ? -1n : 1n;
  const signedNumerator = numerator * sign;
  const positiveDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(signedNumerator, positiveDenominator);

  return {
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
  };
}

export function addRational(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function subtractRational(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideRational(left: Rational, right: Rational): Rational {
  domainAssert(
    right.numerator !== 0n,
    'DIVISION_BY_ZERO',
    'Cannot divide a rational value by zero.',
  );
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function compareRational(left: Rational, right: Rational): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function sumRationals(values: readonly Rational[]): Rational {
  return values.reduce(addRational, rational(0n));
}

export function floorNonNegative(value: Rational): bigint {
  domainAssert(
    value.numerator >= 0n,
    'NEGATIVE_RATIONAL_FLOOR',
    'This operation only floors nonnegative rational values.',
  );
  return value.numerator / value.denominator;
}

export function fractionalPartNonNegative(value: Rational): Rational {
  const floor = floorNonNegative(value);
  return rational(value.numerator - floor * value.denominator, value.denominator);
}

export interface ParseDecimalOptions {
  readonly allowNegative?: boolean;
  readonly maxScale?: number;
}

/** Parses ordinary decimal notation without ever passing through IEEE-754 Number. */
export function parseDecimal(value: unknown, options: ParseDecimalOptions = {}): Rational {
  domainAssert(
    typeof value === 'string',
    'INVALID_DECIMAL',
    'Decimal values must be supplied as strings.',
    { value },
  );

  const match = /^(?<sign>-?)(?<whole>0|[1-9][0-9]*)(?:\.(?<fraction>[0-9]+))?$/.exec(value);
  domainAssert(match?.groups !== undefined, 'INVALID_DECIMAL', 'Invalid decimal syntax.', {
    value,
  });

  const isNegative = match.groups.sign === '-';
  domainAssert(
    options.allowNegative === true || !isNegative,
    'NEGATIVE_DECIMAL',
    'This decimal value cannot be negative.',
    { value },
  );

  const fraction = match.groups.fraction ?? '';
  const maxScale = options.maxScale ?? MAX_DECIMAL_SCALE;
  domainAssert(
    Number.isInteger(maxScale) && maxScale >= 0 && fraction.length <= maxScale,
    'DECIMAL_SCALE_EXCEEDED',
    `Decimal values support at most ${maxScale} fractional digits.`,
    { value, maxScale },
  );

  const whole = match.groups.whole;
  domainAssert(whole !== undefined, 'INVALID_DECIMAL', 'A decimal whole part is required.', {
    value,
  });
  const denominator = 10n ** BigInt(fraction.length);
  const unsignedNumerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  return rational(isNegative ? -unsignedNumerator : unsignedNumerator, denominator);
}
