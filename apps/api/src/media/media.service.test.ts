import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { MongoService, MongoUnitOfWork } from '../database/mongo.service.js';
import type { ImageProcessor } from './image.processor.js';
import type { MediaRepository } from './media.repository.js';
import { MediaService } from './media.service.js';
import type { MediaObject, ProcessedImage } from './media.types.js';
import type { PrivateMediaStorage } from './private-media.storage.js';

const userId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const contextId = '44444444-4444-4444-8444-444444444444';

const auth: AuthContext = {
  sessionId: '55555555-5555-4555-8555-555555555555',
  csrfHash: Buffer.alloc(32),
  user: {
    id: participantId,
    userId,
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

const imageBytes = Buffer.from('normalized-image');
const processed: ProcessedImage = {
  bytes: imageBytes,
  mediaType: 'image/webp',
  byteSize: imageBytes.length,
  sha256Hash: createHash('sha256').update(imageBytes).digest(),
  width: 512,
  height: 512,
};

function harness(
  options: {
    access?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    storage?: Record<string, unknown>;
    processor?: Record<string, unknown>;
  } = {},
) {
  const access = {
    contextIdForGroup: vi.fn().mockResolvedValue({
      contextId,
      contextType: 'GROUP',
      status: 'ACTIVE',
      defaultCurrency: 'INR',
      version: '1',
      role: 'OWNER',
      allocationOrder: 0,
      groupId,
    }),
    ...options.access,
  };
  const repository = {
    replaceUserAvatar: vi.fn().mockResolvedValue(undefined),
    deleteUserAvatar: vi.fn().mockResolvedValue(undefined),
    findParticipantAvatar: vi.fn(),
    replaceGroupImage: vi.fn().mockResolvedValue(undefined),
    deleteGroupImage: vi.fn().mockResolvedValue(undefined),
    findGroupImage: vi.fn(),
    ...options.repository,
  };
  const storage = {
    assertAvailable: vi.fn(),
    store: vi
      .fn()
      .mockImplementation((mediaId: string, kind: string) =>
        Promise.resolve(
          `${kind === 'USER_AVATAR' ? 'user-avatar' : 'group-image'}/${mediaId.slice(0, 2)}/${mediaId}.webp`,
        ),
      ),
    read: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    ...options.storage,
  };
  const processor = { process: vi.fn().mockResolvedValue(processed), ...options.processor };
  const work = {} as MongoUnitOfWork;
  const mongo = {
    withConnection: vi.fn(async (operation: (value: MongoUnitOfWork) => Promise<unknown>) =>
      operation(work),
    ),
    withTransaction: vi.fn(async (operation: (value: MongoUnitOfWork) => Promise<unknown>) =>
      operation(work),
    ),
  };
  return {
    access,
    repository,
    storage,
    processor,
    mongo,
    service: new MediaService(
      mongo as unknown as MongoService,
      access as unknown as ContextAccessRepository,
      repository as unknown as MediaRepository,
      storage as unknown as PrivateMediaStorage,
      processor as unknown as ImageProcessor,
    ),
  };
}

describe('authenticated media service', () => {
  it('fails before decoding when private upload storage is unavailable', async () => {
    const { processor, service, storage } = harness({
      storage: {
        assertAvailable: vi.fn(() => {
          throw new Error('disabled in production');
        }),
      },
    });

    expect(() => service.assertUploadAvailable()).toThrow(
      expect.objectContaining({ code: 'MEDIA_STORAGE_UNAVAILABLE', status: 503 }),
    );
    await expect(
      service.uploadAvatar(
        { bytes: Buffer.from('png'), declaredMediaType: 'image/png' },
        auth,
        'request-storage-disabled',
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE', status: 503 });
    expect(processor.process).not.toHaveBeenCalled();
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('stores a sanitized avatar, swaps it transactionally, and cleans the old object', async () => {
    const replaceUserAvatar = vi.fn().mockResolvedValue('user-avatar/aa/old.webp');
    const { processor, repository, service, storage } = harness({
      repository: { replaceUserAvatar },
    });

    const result = await service.uploadAvatar(
      { bytes: Buffer.from('png'), declaredMediaType: 'image/png' },
      auth,
      'request-1',
    );

    expect(processor.process).toHaveBeenCalledWith(expect.anything(), 'USER_AVATAR');
    expect(repository.replaceUserAvatar).toHaveBeenCalledOnce();
    expect(result.version).toMatch(/^[0-9a-f-]{36}$/u);
    expect(result.url).toBe(`/api/v1/participants/${participantId}/avatar?v=${result.version}`);
    expect(storage.delete).toHaveBeenCalledWith('user-avatar/aa/old.webp');
  });

  it('compensates a stored avatar when its database transaction fails', async () => {
    const replaceUserAvatar = vi.fn().mockRejectedValue(new Error('database unavailable'));
    const { service, storage } = harness({ repository: { replaceUserAvatar } });

    await expect(
      service.uploadAvatar(
        { bytes: Buffer.from('png'), declaredMediaType: 'image/png' },
        auth,
        'request-2',
      ),
    ).rejects.toThrow('database unavailable');
    const storedKey = (storage.store as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(storedKey).toBeDefined();
    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it('rejects a regular member before decoding or storing a group image', async () => {
    const contextIdForGroup = vi.fn().mockResolvedValue({
      contextId,
      status: 'ACTIVE',
      role: 'MEMBER',
    });
    const { processor, service, storage } = harness({ access: { contextIdForGroup } });

    await expect(
      service.uploadGroupImage(
        groupId,
        { bytes: Buffer.from('png'), declaredMediaType: 'image/png' },
        auth,
        'request-3',
      ),
    ).rejects.toMatchObject({ code: 'GROUP_IMAGE_PERMISSION_DENIED', status: 403 });
    expect(processor.process).not.toHaveBeenCalled();
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('reauthorizes a group manager under lock and cleans the object if access changed', async () => {
    const contextIdForGroup = vi
      .fn()
      .mockResolvedValueOnce({ contextId, status: 'ACTIVE', role: 'OWNER' })
      .mockResolvedValueOnce({ contextId, status: 'ACTIVE', role: 'MEMBER' });
    const { repository, service, storage } = harness({ access: { contextIdForGroup } });

    await expect(
      service.uploadGroupImage(
        groupId,
        { bytes: Buffer.from('png'), declaredMediaType: 'image/png' },
        auth,
        'request-4',
      ),
    ).rejects.toMatchObject({ code: 'GROUP_IMAGE_PERMISSION_DENIED', status: 403 });
    expect(contextIdForGroup.mock.calls[1]?.[3]).toEqual({ lock: true, writable: true });
    expect(repository.replaceGroupImage).not.toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledOnce();
  });

  it('returns a verified private image and rejects missing or corrupt storage', async () => {
    const media: MediaObject = {
      id: '66666666-6666-4666-8666-666666666666',
      storageKey: 'user-avatar/66/image.webp',
      mediaType: 'image/webp',
      byteSize: imageBytes.length,
      sha256Hash: createHash('sha256').update(imageBytes).digest(),
      width: 512,
      height: 512,
    };
    const findParticipantAvatar = vi.fn().mockResolvedValue(media);
    const read = vi.fn().mockResolvedValue(imageBytes);
    const { service } = harness({
      repository: { findParticipantAvatar },
      storage: { read },
    });
    await expect(service.participantAvatar(participantId, media.id, auth)).resolves.toMatchObject({
      bytes: imageBytes,
      mediaType: 'image/webp',
      byteSize: imageBytes.length,
      etag: `"${media.sha256Hash.toString('hex')}"`,
    });

    findParticipantAvatar.mockResolvedValueOnce(undefined);
    await expect(service.participantAvatar(participantId, media.id, auth)).rejects.toMatchObject({
      code: 'IMAGE_NOT_FOUND',
      status: 404,
    });

    findParticipantAvatar.mockResolvedValueOnce(media);
    read.mockResolvedValueOnce(Buffer.from('tampered'));
    await expect(service.participantAvatar(participantId, media.id, auth)).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      status: 503,
    });
  });
});
