import { Decimal128, MongoServerError, type ClientSession } from 'mongodb';
import type { MongoUnitOfWork } from './mongo.service.js';

const MAX_MINOR = 9_999_999_999_999_999_999n;
const DECIMAL_INTEGER = /^(-?)(\d+)(?:\.(\d*))?(?:E([+-]?\d+))?$/iu;

export function mongoOptions(work: MongoUnitOfWork): { readonly session?: ClientSession } {
  return work.session ? { session: work.session } : {};
}

export function minorToDecimal(value: bigint | string): Decimal128 {
  const minor = typeof value === 'bigint' ? value : parseInteger(value);
  assertMinorBound(minor);
  return Decimal128.fromString(minor.toString());
}

export function decimalToMinor(value: Decimal128): bigint {
  const match = DECIMAL_INTEGER.exec(value.toString());
  if (!match) throw new Error('MongoDB returned a non-integer monetary value');

  const negative = match[1] === '-';
  const whole = match[2] ?? '';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4] ?? '0');
  if (!Number.isSafeInteger(exponent)) {
    throw new Error('MongoDB returned an unsupported monetary exponent');
  }

  const digits = `${whole}${fraction}`;
  const scale = exponent - fraction.length;
  let integerDigits: string;
  if (scale >= 0) {
    integerDigits = `${digits}${'0'.repeat(scale)}`;
  } else {
    const split = digits.length + scale;
    if (split < 0 || !/^0*$/u.test(digits.slice(Math.max(0, split)))) {
      throw new Error('MongoDB returned a fractional monetary value');
    }
    integerDigits = split <= 0 ? '0' : digits.slice(0, split);
  }

  const minor = BigInt(`${negative ? '-' : ''}${integerDigits || '0'}`);
  assertMinorBound(minor);
  return minor;
}

export function isMongoDuplicateKey(error: unknown): boolean {
  return (
    (error instanceof MongoServerError || (typeof error === 'object' && error !== null)) &&
    'code' in error &&
    Number(error.code) === 11_000
  );
}

function parseInteger(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error('Monetary values must be base-10 integer strings');
  }
  return BigInt(value);
}

function assertMinorBound(value: bigint): void {
  if (value < -MAX_MINOR || value > MAX_MINOR) {
    throw new Error('Monetary value exceeds the supported 19-digit minor-unit bound');
  }
}
