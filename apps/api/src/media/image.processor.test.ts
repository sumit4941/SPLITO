import { createHash } from 'node:crypto';
import { loadEnvironment } from '@splito/config';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageProcessor } from './image.processor.js';

function processor(maximumBytes = '10000000'): ImageProcessor {
  return new ImageProcessor(loadEnvironment({ MAX_UPLOAD_BYTES: maximumBytes }));
}

describe('profile and group image normalization', () => {
  it('decodes PNG bytes, crops an avatar, strips metadata, and emits hashed WebP', async () => {
    const input = await sharp({
      create: { width: 900, height: 600, channels: 4, background: '#7c3aed' },
    })
      .withMetadata({ orientation: 6 })
      .png()
      .toBuffer();

    const result = await processor().process(
      { bytes: input, declaredMediaType: 'image/png' },
      'USER_AVATAR',
    );
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({ mediaType: 'image/webp', width: 512, height: 512 });
    expect(result.byteSize).toBe(result.bytes.length);
    expect(result.sha256Hash).toEqual(createHash('sha256').update(result.bytes).digest());
    expect(metadata.format).toBe('webp');
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it('preserves group-image aspect ratio without enlarging small inputs', async () => {
    const input = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#0891b2' },
    })
      .jpeg()
      .toBuffer();
    const result = await processor().process(
      { bytes: input, declaredMediaType: 'image/jpeg' },
      'GROUP_IMAGE',
    );
    expect(result).toMatchObject({ width: 800, height: 400, mediaType: 'image/webp' });
  });

  it('rejects declared MIME types that do not match decoded bytes', async () => {
    const input = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    await expect(
      processor().process({ bytes: input, declaredMediaType: 'image/jpeg' }, 'USER_AVATAR'),
    ).rejects.toMatchObject({ code: 'IMAGE_TYPE_MISMATCH', status: 415 });
  });

  it('rejects unsupported, empty, malformed, and over-limit inputs with bounded errors', async () => {
    await expect(
      processor().process(
        { bytes: Buffer.from('svg'), declaredMediaType: 'image/svg+xml' },
        'USER_AVATAR',
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE_TYPE', status: 415 });
    await expect(
      processor().process(
        { bytes: Buffer.alloc(0), declaredMediaType: 'image/png' },
        'USER_AVATAR',
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_FILE_EMPTY', status: 400 });
    await expect(
      processor().process(
        { bytes: Buffer.from('not an image'), declaredMediaType: 'image/png' },
        'USER_AVATAR',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE', status: 422 });
    await expect(
      processor('1024').process(
        { bytes: Buffer.alloc(1025), declaredMediaType: 'image/png' },
        'USER_AVATAR',
      ),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', status: 413 });
  });

  it('rejects multi-frame image payloads rather than silently saving only one frame', async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 16,
        pageHeight: 8,
        channels: 4,
        background: '#f97316',
      },
    })
      .tiff()
      .toBuffer();
    const metadata = await sharp(input, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);
    await expect(
      processor().process({ bytes: input, declaredMediaType: 'image/png' }, 'GROUP_IMAGE'),
    ).rejects.toMatchObject({ code: 'ANIMATED_IMAGE_NOT_ALLOWED', status: 422 });
  });
});
