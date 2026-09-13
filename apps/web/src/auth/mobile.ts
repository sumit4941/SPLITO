export interface DialingCountry {
  code: string;
  dialCode: string;
  flag: string;
  name: string;
  example: string;
}

export const dialingCountries: readonly DialingCountry[] = [
  { code: 'IN', dialCode: '+91', flag: '🇮🇳', name: 'India', example: '98765 43210' },
  { code: 'US', dialCode: '+1', flag: '🇺🇸', name: 'United States', example: '202 555 0123' },
  { code: 'GB', dialCode: '+44', flag: '🇬🇧', name: 'United Kingdom', example: '7700 900123' },
  {
    code: 'AE',
    dialCode: '+971',
    flag: '🇦🇪',
    name: 'United Arab Emirates',
    example: '50 123 4567',
  },
  { code: 'SG', dialCode: '+65', flag: '🇸🇬', name: 'Singapore', example: '8123 4567' },
  { code: 'AU', dialCode: '+61', flag: '🇦🇺', name: 'Australia', example: '412 345 678' },
] as const;

export function normalizeMobileNumber(dialCode: string, nationalNumber: string): string | null {
  const international = nationalNumber.trim().startsWith('+');
  const inputDigits = nationalNumber.replace(/\D/g, '');
  const nationalDigits = international ? inputDigits : inputDigits.replace(/^0+/, '');
  const dialDigits = dialCode.replace(/\D/g, '');
  const combined = international ? nationalDigits : `${dialDigits}${nationalDigits}`;
  if (combined.length < 8 || combined.length > 15) return null;
  return `+${combined}`;
}

export function maskMobileNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 5) return value;
  const visible = digits.slice(-4);
  const prefixLength = Math.min(3, Math.max(1, digits.length - 10));
  const prefix = digits.slice(0, prefixLength);
  return `+${prefix} ${'•'.repeat(Math.max(4, digits.length - prefixLength - 4))} ${visible}`;
}

export function sanitizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function formatCountdown(seconds: number): string {
  const bounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(bounded / 60)}:${String(bounded % 60).padStart(2, '0')}`;
}
