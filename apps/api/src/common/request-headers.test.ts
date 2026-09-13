import { describe, expect, it } from 'vitest';
import { requireResourceVersion } from './request-headers.js';

describe('If-Match resource version parsing', () => {
  it.each([
    ['1', '1'],
    ['"42"', '42'],
    ['  "900"  ', '900'],
  ])('accepts a positive bare or strong quoted decimal version', (header, expected) => {
    expect(requireResourceVersion(header)).toBe(expected);
  });

  it.each([undefined, [], '', '0', '-1', 'W/"2"', '*', '"2", "3"', '01'])(
    'rejects a missing or invalid resource version: %j',
    (header) => {
      expect(() => requireResourceVersion(header as string | string[] | undefined)).toThrow(
        expect.objectContaining({
          code:
            header === undefined || (Array.isArray(header) && header.length === 0) || header === ''
              ? 'RESOURCE_VERSION_REQUIRED'
              : 'INVALID_RESOURCE_VERSION',
        }),
      );
    },
  );
});
