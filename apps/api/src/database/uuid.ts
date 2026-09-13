import { ApiError } from '../common/api-error.js';

// Oracle RAW(16) identifiers may include deterministic seed/import values that do
// not carry RFC UUID version bits. Newly generated application IDs are UUIDv4,
// while the boundary accepts any canonical 16-byte hexadecimal representation.
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function uuidToRaw(value: string): Buffer {
  if (!UUID_PATTERN.test(value)) {
    throw new ApiError(400, 'INVALID_ID', 'Resource IDs must be UUIDs.');
  }
  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

export function rawToUuid(value: Buffer): string {
  if (!Buffer.isBuffer(value) || value.length !== 16) {
    throw new Error('Oracle RAW UUID must contain exactly 16 bytes');
  }
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function compareUuid(left: string, right: string): number {
  return left.replaceAll('-', '').localeCompare(right.replaceAll('-', ''));
}
