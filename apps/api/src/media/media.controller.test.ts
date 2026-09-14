import { loadEnvironment } from '@splito/config';
import { describe, expect, it, vi } from 'vitest';
import type { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { MongoService } from '../database/mongo.service.js';
import type { ImageProcessor } from './image.processor.js';
import { MediaController } from './media.controller.js';
import type { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';
import type { MediaDownload } from './media.types.js';
import { PrivateMediaStorage } from './private-media.storage.js';

const participantId = '11111111-1111-4111-8111-111111111111';
const auth: AuthContext = {
  sessionId: '22222222-2222-4222-8222-222222222222',
  csrfHash: Buffer.alloc(32),
  user: {
    id: participantId,
    userId: '33333333-3333-4333-8333-333333333333',
    participantId,
    displayName: 'Alex',
    mobileNumber: '+12025550101',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
    theme: 'system',
    reducedMotion: false,
    version: '1',
  },
};

function controller(overrides: Record<string, unknown> = {}) {
  const media = {
    assertUploadAvailable: vi.fn(),
    uploadAvatar: vi.fn(),
    participantAvatar: vi.fn(),
    ...overrides,
  };
  return { instance: new MediaController(media as unknown as MediaService), media };
}

describe('authenticated media controller boundary', () => {
  it('fails closed in production before inspecting or parsing multipart input', async () => {
    const developmentConfig = loadEnvironment({ ATTACHMENT_STORAGE_PATH: './unused-media-test' });
    const storage = new PrivateMediaStorage({
      ...developmentConfig,
      NODE_ENV: 'production',
    });
    const service = new MediaService(
      {} as MongoService,
      {} as ContextAccessRepository,
      {} as MediaRepository,
      storage,
      {} as ImageProcessor,
    );
    const instance = new MediaController(service);
    const request = {
      id: 'request-production',
      isMultipart: vi.fn(),
      file: vi.fn(),
    };

    await expect(instance.uploadAvatar(auth, request as never)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      status: 503,
    });
    expect(request.isMultipart).not.toHaveBeenCalled();
    expect(request.file).not.toHaveBeenCalled();
  });

  it('rejects a non-multipart upload with 415 without delegating image work', async () => {
    const uploadAvatar = vi.fn();
    const { instance } = controller({ uploadAvatar });
    const request = { id: 'request-415', isMultipart: vi.fn(() => false), file: vi.fn() };

    await expect(instance.uploadAvatar(auth, request as never)).rejects.toMatchObject({
      code: 'MULTIPART_IMAGE_REQUIRED',
      status: 415,
    });
    expect(request.file).not.toHaveBeenCalled();
    expect(uploadAvatar).not.toHaveBeenCalled();
  });

  it('reads one valid file part and delegates the bounded raw image once', async () => {
    const result = {
      url: `/api/v1/participants/${participantId}/avatar?v=44444444-4444-4444-8444-444444444444`,
      version: '44444444-4444-4444-8444-444444444444',
    };
    const uploadAvatar = vi.fn().mockResolvedValue(result);
    const { instance, media } = controller({ uploadAvatar });
    const bytes = Buffer.from('valid-png');
    const file = vi.fn().mockResolvedValue({
      fieldname: 'file',
      mimetype: 'image/png',
      file: { resume: vi.fn() },
      toBuffer: vi.fn().mockResolvedValue(bytes),
    });
    const request = { id: 'request-valid', isMultipart: vi.fn(() => true), file };

    await expect(instance.uploadAvatar(auth, request as never)).resolves.toEqual({ data: result });
    expect(media.assertUploadAvailable).toHaveBeenCalledOnce();
    expect(uploadAvatar).toHaveBeenCalledWith(
      { bytes, declaredMediaType: 'image/png' },
      auth,
      'request-valid',
    );
  });

  it('sends sanitized WebP with private no-store and anti-sniffing headers', async () => {
    const bytes = Buffer.from('RIFF----WEBP');
    const download: MediaDownload = {
      bytes,
      mediaType: 'image/webp',
      byteSize: bytes.length,
      etag: '"abc123"',
    };
    const participantAvatar = vi.fn().mockResolvedValue(download);
    const { instance } = controller({ participantAvatar });
    const headers = new Map<string, string>();
    const reply = {
      header: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
        return reply;
      }),
      type: vi.fn((value: string) => {
        headers.set('content-type', value);
        return reply;
      }),
      send: vi.fn(() => reply),
    };

    await instance.participantAvatar(
      participantId,
      '44444444-4444-4444-8444-444444444444',
      auth,
      reply as never,
    );

    expect(participantAvatar).toHaveBeenCalledWith(
      participantId,
      '44444444-4444-4444-8444-444444444444',
      auth,
    );
    expect(Object.fromEntries(headers)).toMatchObject({
      'cache-control': 'private, no-store',
      'content-type': 'image/webp',
      etag: '"abc123"',
      vary: 'Cookie',
      'x-content-type-options': 'nosniff',
    });
    expect(reply.send).toHaveBeenCalledWith(bytes);
  });
});
