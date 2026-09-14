import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ContextAccessRepository,
  type ContextAccess,
} from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiError } from '../common/api-error.js';
import { MongoService } from '../database/mongo.service.js';
import { ImageProcessor } from './image.processor.js';
import { MediaRepository } from './media.repository.js';
import {
  groupImageUrl,
  participantAvatarUrl,
  type MediaDownload,
  type MediaKind,
  type MediaMutationResult,
  type MediaObject,
  type RawImageUpload,
} from './media.types.js';
import { PrivateMediaStorage } from './private-media.storage.js';

@Injectable()
export class MediaService {
  readonly #logger = new Logger(MediaService.name);

  constructor(
    private readonly mongo: MongoService,
    private readonly access: ContextAccessRepository,
    private readonly repository: MediaRepository,
    private readonly storage: PrivateMediaStorage,
    private readonly processor: ImageProcessor,
  ) {}

  assertUploadAvailable(): void {
    try {
      this.storage.assertAvailable();
    } catch {
      throw new ApiError(
        503,
        'MEDIA_STORAGE_UNAVAILABLE',
        'Private image storage is temporarily unavailable.',
      );
    }
  }

  async uploadAvatar(
    upload: RawImageUpload,
    auth: AuthContext,
    requestId: string,
  ): Promise<MediaMutationResult> {
    this.assertUploadAvailable();
    const processed = await this.processor.process(upload, 'USER_AVATAR');
    const mediaId = randomUUID();
    const storageKey = await this.store(mediaId, 'USER_AVATAR', processed.bytes);
    let previousStorageKey: string | undefined;
    try {
      previousStorageKey = await this.mongo.withTransaction((work) =>
        this.repository.replaceUserAvatar(work, auth.user.userId, {
          mediaId,
          storageKey,
          processed,
          actorParticipantId: auth.user.participantId,
          actorUserId: auth.user.userId,
          auditId: randomUUID(),
          requestId,
        }),
      );
    } catch (error) {
      await this.cleanup(storageKey, mediaId);
      throw error;
    }
    if (previousStorageKey) await this.cleanup(previousStorageKey, mediaId);
    return {
      url: participantAvatarUrl(auth.user.participantId, mediaId),
      version: mediaId,
    };
  }

  async deleteAvatar(auth: AuthContext, requestId: string): Promise<void> {
    const storageKey = await this.mongo.withTransaction((work) =>
      this.repository.deleteUserAvatar(work, {
        userId: auth.user.userId,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        auditId: randomUUID(),
        requestId,
      }),
    );
    if (storageKey) await this.cleanup(storageKey, auth.user.userId);
  }

  async participantAvatar(
    participantId: string,
    mediaId: string,
    auth: AuthContext,
  ): Promise<MediaDownload> {
    const media = await this.mongo.withTransaction((work) =>
      this.repository.findParticipantAvatar(work, participantId, auth.user.participantId, mediaId),
    );
    return this.download(media);
  }

  async uploadGroupImage(
    groupId: string,
    upload: RawImageUpload,
    auth: AuthContext,
    requestId: string,
  ): Promise<MediaMutationResult> {
    this.assertUploadAvailable();
    await this.mongo.withConnection(async (work) => {
      const access = await this.access.contextIdForGroup(work, groupId, auth.user.participantId, {
        writable: true,
      });
      this.requireGroupImageManager(access);
    });

    const processed = await this.processor.process(upload, 'GROUP_IMAGE');
    const mediaId = randomUUID();
    const storageKey = await this.store(mediaId, 'GROUP_IMAGE', processed.bytes);
    let previousStorageKey: string | undefined;
    try {
      previousStorageKey = await this.mongo.withTransaction(async (work) => {
        const access = await this.access.contextIdForGroup(work, groupId, auth.user.participantId, {
          lock: true,
          writable: true,
        });
        this.requireGroupImageManager(access);
        return this.repository.replaceGroupImage(work, groupId, access.contextId, {
          mediaId,
          storageKey,
          processed,
          actorParticipantId: auth.user.participantId,
          actorUserId: auth.user.userId,
          auditId: randomUUID(),
          requestId,
        });
      });
    } catch (error) {
      await this.cleanup(storageKey, mediaId);
      throw error;
    }
    if (previousStorageKey) await this.cleanup(previousStorageKey, mediaId);
    return { url: groupImageUrl(groupId, mediaId), version: mediaId };
  }

  async deleteGroupImage(groupId: string, auth: AuthContext, requestId: string): Promise<void> {
    const storageKey = await this.mongo.withTransaction(async (work) => {
      const access = await this.access.contextIdForGroup(work, groupId, auth.user.participantId, {
        lock: true,
        writable: true,
      });
      this.requireGroupImageManager(access);
      return this.repository.deleteGroupImage(work, {
        groupId,
        contextId: access.contextId,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        auditId: randomUUID(),
        requestId,
      });
    });
    if (storageKey) await this.cleanup(storageKey, groupId);
  }

  async groupImage(groupId: string, mediaId: string, auth: AuthContext): Promise<MediaDownload> {
    const media = await this.mongo.withTransaction((work) =>
      this.repository.findGroupImage(work, groupId, auth.user.participantId, mediaId),
    );
    return this.download(media);
  }

  private requireGroupImageManager(access: ContextAccess): void {
    if (access.role !== 'OWNER' && access.role !== 'ADMIN') {
      throw new ApiError(
        403,
        'GROUP_IMAGE_PERMISSION_DENIED',
        'Only a group owner or administrator can change its image.',
      );
    }
  }

  private async store(mediaId: string, kind: MediaKind, bytes: Buffer): Promise<string> {
    try {
      return await this.storage.store(mediaId, kind, bytes);
    } catch (error) {
      this.#logger.error({ err: error, mediaId }, 'Private media write failed');
      throw new ApiError(
        503,
        'MEDIA_STORAGE_UNAVAILABLE',
        'Private image storage is temporarily unavailable.',
      );
    }
  }

  private async download(media: MediaObject | undefined): Promise<MediaDownload> {
    if (!media) {
      throw new ApiError(404, 'IMAGE_NOT_FOUND', 'The image does not exist or is not accessible.');
    }
    let bytes: Buffer | undefined;
    try {
      bytes = await this.storage.read(media.storageKey);
    } catch (error) {
      this.#logger.error({ err: error, mediaId: media.id }, 'Private media read failed');
    }
    const hash = bytes ? createHash('sha256').update(bytes).digest() : undefined;
    if (
      !bytes ||
      bytes.length !== media.byteSize ||
      !hash ||
      hash.length !== media.sha256Hash.length ||
      !timingSafeEqual(hash, media.sha256Hash)
    ) {
      this.#logger.error({ mediaId: media.id }, 'Private media integrity check failed');
      throw new ApiError(
        503,
        'MEDIA_STORAGE_UNAVAILABLE',
        'Private image storage is temporarily unavailable.',
      );
    }
    return {
      bytes,
      mediaType: media.mediaType,
      byteSize: media.byteSize,
      etag: `"${media.sha256Hash.toString('hex')}"`,
    };
  }

  private async cleanup(storageKey: string, reference: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (error) {
      this.#logger.warn({ err: error, reference }, 'Private media cleanup deferred');
    }
  }
}
