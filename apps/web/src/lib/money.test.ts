import { describe, expect, it } from 'vitest';
import { addMinor, formatMinor, majorToMinor, minorToMajor, signedMajorToMinor } from './money';

describe('money boundary formatting', () => {
  it('converts two-decimal currencies without floating point', () => {
    expect(majorToMinor('1000.05', 'INR')).toBe('100005');
    expect(minorToMajor('100005', 'INR')).toBe('1000.05');
  });

  it('honours zero- and three-decimal currencies', () => {
    expect(majorToMinor('120', 'JPY')).toBe('120');
    expect(majorToMinor('12.345', 'KWD')).toBe('12345');
    expect(majorToMinor('12.34', 'JPY')).toBeNull();
    expect(minorToMajor('12345', 'KWD')).toBe('12.345');
  });

  it('keeps integers exact beyond Number safe range', () => {
    const huge = '900719925474099312345';
    expect(minorToMajor(huge, 'INR')).toBe('9007199254740993123.45');
    expect(addMinor([huge, '55'])).toBe('900719925474099312400');
    expect(formatMinor(huge, 'INR')).toContain('.45');
  });

  it('rejects malformed or over-precise input', () => {
    expect(majorToMinor('1.001', 'USD')).toBeNull();
    expect(majorToMinor('1e3', 'USD')).toBeNull();
    expect(majorToMinor('', 'USD')).toBeNull();
  });

  it('parses signed adjustment inputs without binary arithmetic', () => {
    expect(signedMajorToMinor('-100.25', 'INR')).toBe('-10025');
    expect(signedMajorToMinor('+0.500', 'KWD')).toBe('500');
  });
});
