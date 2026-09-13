import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite values cannot be canonicalized');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function canonicalJsonHash(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest();
}
