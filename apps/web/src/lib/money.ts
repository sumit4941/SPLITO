const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  BHD: 3,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
  KWD: 3,
  OMR: 3,
  USD: 2,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function majorToMinor(value: string, currency: string): string | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const exponent = currencyExponent(currency);
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > exponent) return null;
  const padded = fraction.padEnd(exponent, '0');
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  try {
    return BigInt(combined || '0').toString();
  } catch {
    return null;
  }
}

export function signedMajorToMinor(value: string, currency: string): string | null {
  const normalized = value.trim();
  const negative = normalized.startsWith('-');
  const unsigned =
    normalized.startsWith('-') || normalized.startsWith('+') ? normalized.slice(1) : normalized;
  const minor = majorToMinor(unsigned || '0', currency);
  if (minor === null) return null;
  return negative && minor !== '0' ? `-${minor}` : minor;
}

export function minorToMajor(value: string, currency: string): string {
  const exponent = currencyExponent(currency);
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    return '—';
  }
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  if (exponent === 0) return `${negative ? '-' : ''}${absolute}`;
  const scale = 10n ** BigInt(exponent);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(exponent, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatMinor(value: string, currency: string, locale = 'en-IN'): string {
  const major = minorToMajor(value, currency);
  if (major === '—') return major;
  const exponent = currencyExponent(currency);
  const [integerPart, fractionPart] = major.replace('-', '').split('.');
  const safeInteger = Number(integerPart);
  // Formatting only: integer grouping is allowed to use Number while the exact
  // fractional money value remains a string and is never calculated with it.
  const grouped = Number.isSafeInteger(safeInteger)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(safeInteger)
    : integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const signed = major.startsWith('-') ? `-${grouped}` : grouped;
  const decimal = exponent > 0 ? `.${fractionPart ?? ''.padEnd(exponent, '0')}` : '';
  return `${currency.toUpperCase()} ${signed}${decimal}`;
}

export function compareMinor(value: string, threshold = 0n): -1 | 0 | 1 {
  try {
    const amount = BigInt(value);
    return amount < threshold ? -1 : amount > threshold ? 1 : 0;
  } catch {
    return 0;
  }
}

export function addMinor(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export const supportedCurrencies = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'KWD'] as const;
