import { describe, expect, it } from 'vitest';
import {
  normalizeMobileNumber,
  requestMobileOtpSchema,
  verifyMobileOtpSchema,
} from './auth.schemas.js';

describe('mobile identity validation', () => {
  it('normalizes Indian local and explicit international numbers to E.164', () => {
    expect(normalizeMobileNumber('9876543210')).toBe('+919876543210');
    expect(normalizeMobileNumber('+12025550101')).toBe('+12025550101');
    expect(normalizeMobileNumber('00442079460018')).toBe('+442079460018');
  });

  it('does not guess country codes or silently discard punctuation', () => {
    for (const invalid of [
      '09876543210',
      '919876543210',
      '98765 43210',
      '(987)6543210',
      '+91-9876543210',
      '+915876543210',
      '+12025550101 ext 2',
      '１２３４５６７８９０',
    ]) {
      expect(() => normalizeMobileNumber(invalid), invalid).toThrow();
    }
  });

  it('keeps request intent constrained and rejects unknown input', () => {
    expect(requestMobileOtpSchema.parse({ mobileNumber: '9876543210', purpose: 'login' })).toEqual({
      mobileNumber: '+919876543210',
      purpose: 'login',
    });
    expect(() =>
      requestMobileOtpSchema.parse({ mobileNumber: '+12025550101', purpose: 'register' }),
    ).toThrow();
    expect(() =>
      requestMobileOtpSchema.parse({ mobileNumber: '+12025550101', accountExists: true }),
    ).toThrow();
  });

  it('requires a six-digit code and supplies safe first-account locale defaults', () => {
    const parsed = verifyMobileOtpSchema.parse({
      challengeId: '11111111-1111-4111-8111-111111111111',
      mobileNumber: '+12025550101',
      otp: '004201',
    });
    expect(parsed).toMatchObject({
      mobileNumber: '+12025550101',
      otp: '004201',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
    });
    expect(() => verifyMobileOtpSchema.parse({ ...parsed, otp: '4201' })).toThrow();
    expect(() => verifyMobileOtpSchema.parse({ ...parsed, otp: 'abcdef' })).toThrow();
  });
});
