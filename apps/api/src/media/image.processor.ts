import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@splito/config';
import sharp from 'sharp';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/app-config.js';
import type { MediaKind, ProcessedImage, RawImageUpload } from './media.types.js';

const MAX_INPUT_PIXELS = 16_777_216;
const OUTPUT_MEDIA_TYPE = 'image/webp' as const;
const acceptedFormats = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

@Injectable()
export class ImageProcessor {
  constructor(@Inject(APP_CONFIG) private readonly config: Environment) {}

  async process(upload: RawImageUpload, kind: MediaKind): Promise<ProcessedImage> {
    const maximumBytes = Math.min(this.config.MAX_UPLOAD_BYTES, 10_000_000);
    if (upload.bytes.length === 0) {
      throw new ApiError(400, 'IMAGE_FILE_EMPTY', 'Choose a non-empty image file.');
    }
    if (upload.bytes.length > maximumBytes) {
      throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The image exceeds the configured upload limit.');
    }
    if (![...acceptedFormats.values()].includes(upload.declaredMediaType)) {
      throw new ApiError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Upload a JPEG, PNG, or WebP image.');
    }

    try {
      const input = sharp(upload.bytes, {
        animated: true,
        failOn: 'warning',
        limitInputPixels: MAX_INPUT_PIXELS,
      });
      const metadata = await input.metadata();
      if ((metadata.pages ?? 1) !== 1) {
        throw new ApiError(422, 'ANIMATED_IMAGE_NOT_ALLOWED', 'Animated images are not supported.');
      }
      const detectedMediaType = metadata.format ? acceptedFormats.get(metadata.format) : undefined;
      if (!detectedMediaType || detectedMediaType !== upload.declaredMediaType) {
        throw new ApiError(
          415,
          'IMAGE_TYPE_MISMATCH',
          'The uploaded bytes do not match the declared image type.',
        );
      }
      if (!metadata.width || !metadata.height) {
        throw new ApiError(422, 'INVALID_IMAGE', 'The image dimensions could not be read.');
      }
      if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
        throw new ApiError(422, 'IMAGE_PIXEL_LIMIT_EXCEEDED', 'The image has too many pixels.');
      }

      const normalized = input.rotate();
      const resized =
        kind === 'USER_AVATAR'
          ? normalized.resize(512, 512, { fit: 'cover', position: 'attention' })
          : normalized.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
      const output = await resized
        .webp({ effort: 4, quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const bytes = Buffer.from(output.data);
      if (bytes.length === 0 || bytes.length > maximumBytes) {
        throw new ApiError(413, 'IMAGE_TOO_LARGE', 'The normalized image is too large.');
      }
      if (!output.info.width || !output.info.height) {
        throw new ApiError(422, 'INVALID_IMAGE', 'The image dimensions could not be read.');
      }
      return {
        bytes,
        mediaType: OUTPUT_MEDIA_TYPE,
        byteSize: bytes.length,
        sha256Hash: createHash('sha256').update(bytes).digest(),
        width: output.info.width,
        height: output.info.height,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(422, 'INVALID_IMAGE', 'The uploaded file is not a valid image.');
    }
  }
}
