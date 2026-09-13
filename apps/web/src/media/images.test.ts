import { describe, expect, it } from 'vitest';
import { formatImageBytes, IMAGE_UPLOAD_MAX_BYTES, validateImageFile } from './images';

function imageFile(type: string, size = 4): File {
  return new File([new Uint8Array(size)], 'picture.bin', { type });
}

describe('image uploads', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(validateImageFile(imageFile(type))).toBeUndefined();
  });

  it('rejects empty, unsupported, and oversized files', () => {
    expect(validateImageFile(imageFile('image/png', 0))).toMatch(/not empty/i);
    expect(validateImageFile(imageFile('image/gif'))).toMatch(/JPEG, PNG, or WebP/i);
    expect(validateImageFile(imageFile('image/png', IMAGE_UPLOAD_MAX_BYTES + 1))).toMatch(
      /smaller than 10 MB/i,
    );
  });

  it('formats file sizes for concise preview copy', () => {
    expect(formatImageBytes(850)).toBe('850 B');
    expect(formatImageBytes(1_400)).toBe('2 KB');
    expect(formatImageBytes(2_500_000)).toBe('2.5 MB');
  });
});
