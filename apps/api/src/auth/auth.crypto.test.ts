import { describe, expect, it } from 'vitest';
import { generateNumericOtp, hashesEqual, mobileOtpHash } from './auth.crypto.js';

describe('mobile OTP cryptography', () => {
  it('generates fixed-width decimal out-of-band secrets', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateNumericOtp()).toMatch(/^[0-9]{6}$/u);
    }
  });

  it('uses a keyed, challenge-bound and identity-bound hash', () => {
    const pepper = 'o'.repeat(32);
    const challengeId = '11111111-1111-4111-8111-111111111111';
    const hash = mobileOtpHash(pepper, challengeId, '+12025550101', '004201');
    expect(hash).toHaveLength(32);
    expect(hash.equals(Buffer.from('004201'))).toBe(false);
    expect(hash.equals(mobileOtpHash(pepper, challengeId, '+12025550101', '004201'))).toBe(true);
    expect(hash.equals(mobileOtpHash(pepper, challengeId, '+12025550102', '004201'))).toBe(false);
    expect(
      hash.equals(
        mobileOtpHash(pepper, '22222222-2222-4222-8222-222222222222', '+12025550101', '004201'),
      ),
    ).toBe(false);
    expect(hash.equals(mobileOtpHash('p'.repeat(32), challengeId, '+12025550101', '004201'))).toBe(
      false,
    );
  });

  it('compares equal-length hashes without accepting mismatches or truncated values', () => {
    const hash = Buffer.alloc(32, 7);
    expect(hashesEqual(hash, Buffer.alloc(32, 7))).toBe(true);
    expect(hashesEqual(hash, Buffer.alloc(32, 8))).toBe(false);
    expect(hashesEqual(hash, Buffer.alloc(31, 7))).toBe(false);
  });
});
