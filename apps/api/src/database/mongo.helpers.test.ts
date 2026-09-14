import { Decimal128, MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { decimalToMinor, isMongoDuplicateKey, minorToDecimal } from './mongo.helpers.js';

describe('MongoDB persistence helpers', () => {
  it.each([0n, 1n, -1n, 9_999_999_999_999_999_999n, -9_999_999_999_999_999_999n])(
    'round-trips a bounded integer minor amount: %s',
    (amount) => {
      expect(decimalToMinor(minorToDecimal(amount))).toBe(amount);
    },
  );

  it('accepts exact Decimal128 exponent forms but rejects fractional values', () => {
    expect(decimalToMinor(Decimal128.fromString('1E+3'))).toBe(1_000n);
    expect(decimalToMinor(Decimal128.fromString('1000.00'))).toBe(1_000n);
    expect(() => decimalToMinor(Decimal128.fromString('1.5'))).toThrow(/fractional/u);
  });

  it('rejects malformed and out-of-range monetary input', () => {
    expect(() => minorToDecimal('01')).toThrow(/integer strings/u);
    expect(() => minorToDecimal('10000000000000000000')).toThrow(/19-digit/u);
  });

  it('recognizes MongoDB duplicate-key errors only', () => {
    const duplicate = new MongoServerError({ message: 'duplicate', ok: 0, code: 11_000 });
    const other = new MongoServerError({ message: 'other', ok: 0, code: 13 });
    expect(isMongoDuplicateKey(duplicate)).toBe(true);
    expect(isMongoDuplicateKey(other)).toBe(false);
    expect(isMongoDuplicateKey(new Error('duplicate'))).toBe(false);
    expect(isMongoDuplicateKey({ code: 11_000 })).toBe(true);
  });
});
