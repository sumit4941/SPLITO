import { describe, expect, it } from 'vitest';
import { formatCountdown, maskMobileNumber, normalizeMobileNumber, sanitizeOtp } from './mobile';

describe('mobile OTP helpers', () => {
  it('normalizes national numbers to E.164 without number arithmetic', () => {
    expect(normalizeMobileNumber('+91', '098765 43210')).toBe('+919876543210');
    expect(normalizeMobileNumber('+44', '07700 900123')).toBe('+447700900123');
  });

  it('preserves an explicitly entered international calling code', () => {
    expect(normalizeMobileNumber('+91', '+1 (202) 555-0123')).toBe('+12025550123');
  });

  it('rejects values outside E.164 length boundaries', () => {
    expect(normalizeMobileNumber('+91', '123')).toBeNull();
    expect(normalizeMobileNumber('+1', '1234567890123456')).toBeNull();
  });

  it('sanitizes typed, pasted, and autofilled verification codes', () => {
    expect(sanitizeOtp('12 3-45a6 789')).toBe('123456');
  });

  it('masks numbers and formats a stable resend countdown', () => {
    expect(maskMobileNumber('+919876543210')).toMatch(/^\+91 .* 3210$/);
    expect(formatCountdown(65.9)).toBe('1:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
