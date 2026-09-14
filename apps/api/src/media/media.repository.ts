import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import {
  COLLECTIONS,
  MongoService,
  mongoOptions,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';
import type { MediaKind, MediaObject, ProcessedImage } from './media.types.js';

interface UserDocument {
  _id: string;
  status: 'PENDING' | 'ACTIVE' | 'LOCKED' | 'DELETION_PENDING' | 'ANONYMIZED';
  avatarKey?: string;
  updatedAt: Date;
}

interface ParticipantDocument {
  _id: string;
  userId?: string;
  kind: 'USER' | 'GUEST';
}

interface ContextMemberDocument {
  _id: string;
  contextId: string;
  participantId: string;
  status: 'ACTIVE' | 'FORMER';
}

interface GroupDocument {
  _id: string;
  contextId: string;
  imageKey?: string;
  updatedAt: Date;
}

interface ContextDocument {
  _id: string;
  mutationVersion: number;
  updatedAt: Date;
}

interface MediaDocument {
  _id: string;
  mediaKind: MediaKind;
  ownerUserId?: string;
  ownerGroupId?: string;
  uploadedByParticipantId: string;
  storageProvider: 'FILESYSTEM';
  storageKey: string;
  mediaType: 'image/webp';
  byteSize: number;
  sha256Hash: Buffer;
  widthPixels: number;
  heightPixels: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'DELETED';
  supersededAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewMediaValues {
  readonly mediaId: string;
  readonly storageKey: string;
  readonly processed: ProcessedImage;
  readonly actorParticipantId: string;
  readonly actorUserId: string;
  readonly auditId: string;
  readonly requestId: string;
}

function mapMedia(document: MediaDocument): MediaObject {
  return {
    id: document._id,
    storageKey: document.storageKey,
    mediaType: document.mediaType,
    byteSize: document.byteSize,
    sha256Hash: Buffer.from(document.sha256Hash),
    width: document.widthPixels,
    height: document.heightPixels,
  };
}

@Injectable()
export class MediaRepository {
  constructor(private readonly mongo: MongoService) {}

  async findParticipantAvatar(
    work: MongoUnitOfWork,
    participantId: string,
    callerParticipantId: string,
    mediaId: string,
  ): Promise<MediaObject | undefined> {
    const options = mongoOptions(work);
    const target = await work.db
      .collection<ParticipantDocument>(COLLECTIONS.participants)
      .findOne({ _id: participantId.toLowerCase(), kind: 'USER' }, options);
    if (!target?.userId) return undefined;
    const user = await work.db
      .collection<UserDocument>(COLLECTIONS.users)
      .findOne({ _id: target.userId, status: 'ACTIVE' }, options);
    if (!user?.avatarKey) return undefined;
    const callerId = callerParticipantId.toLowerCase();
    if (target._id !== callerId) {
      const callerMemberships = await work.db
        .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
        .find({ participantId: callerId, status: 'ACTIVE' }, options)
        .project<{ contextId: string }>({ contextId: 1 })
        .toArray();
      if (callerMemberships.length === 0) return undefined;
      const shared = await work.db
        .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
        .findOne(
          {
            participantId: target._id,
            status: 'ACTIVE',
            contextId: { $in: callerMemberships.map((membership) => membership.contextId) },
          },
          options,
        );
      if (!shared) return undefined;
    }
    const media = await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
      {
        _id: mediaId.toLowerCase(),
        ownerUserId: user._id,
        storageKey: user.avatarKey,
        mediaKind: 'USER_AVATAR',
        status: 'ACTIVE',
      },
      options,
    );
    return media ? mapMedia(media) : undefined;
  }

  async findGroupImage(
    work: MongoUnitOfWork,
    groupId: string,
    callerParticipantId: string,
    mediaId: string,
  ): Promise<MediaObject | undefined> {
    const options = mongoOptions(work);
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ _id: groupId.toLowerCase() }, options);
    if (!group?.imageKey) return undefined;
    const membership = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: group.contextId,
          participantId: callerParticipantId.toLowerCase(),
          status: 'ACTIVE',
        },
        options,
      );
    if (!membership) return undefined;
    const media = await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
      {
        _id: mediaId.toLowerCase(),
        ownerGroupId: group._id,
        storageKey: group.imageKey,
        mediaKind: 'GROUP_IMAGE',
        status: 'ACTIVE',
      },
      options,
    );
    return media ? mapMedia(media) : undefined;
  }

  async replaceUserAvatar(
    work: MongoUnitOfWork,
    userId: string,
    values: NewMediaValues,
  ): Promise<string | undefined> {
    const options = mongoOptions(work);
    const users = work.db.collection<UserDocument>(COLLECTIONS.users);
    const user = await users.findOne({ _id: userId.toLowerCase(), status: 'ACTIVE' }, options);
    if (!user) {
      throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'The account cannot be changed.');
    }
    await this.supersede(work, user.avatarKey);
    await this.insertMedia(work, 'USER_AVATAR', values, { userId: user._id });
    const updated = await users.updateOne(
      {
        _id: user._id,
        status: 'ACTIVE',
        ...(user.avatarKey ? { avatarKey: user.avatarKey } : { avatarKey: { $exists: false } }),
      },
      { $set: { avatarKey: values.storageKey, updatedAt: new Date() } },
      options,
    );
    if (updated.modifiedCount !== 1) throw new Error('Profile image reference was not updated');
    await this.audit(work, values, {
      action: 'profile.avatar.replace',
      resourceType: 'USER',
      resourceId: user._id,
    });
    return user.avatarKey;
  }

  async deleteUserAvatar(
    work: MongoUnitOfWork,
    values: {
      readonly userId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
    },
  ): Promise<string | undefined> {
    const options = mongoOptions(work);
    const users = work.db.collection<UserDocument>(COLLECTIONS.users);
    const user = await users.findOne(
      { _id: values.userId.toLowerCase(), status: 'ACTIVE' },
      options,
    );
    if (!user) {
      throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'The account cannot be changed.');
    }
    if (!user.avatarKey) return undefined;
    const updated = await users.updateOne(
      { _id: user._id, status: 'ACTIVE', avatarKey: user.avatarKey },
      { $unset: { avatarKey: '' }, $set: { updatedAt: new Date() } },
      options,
    );
    if (updated.modifiedCount !== 1) throw new Error('Profile image reference was not removed');
    await this.markDeleted(work, user.avatarKey);
    await this.audit(work, values, {
      action: 'profile.avatar.delete',
      resourceType: 'USER',
      resourceId: user._id,
    });
    return user.avatarKey;
  }

  async replaceGroupImage(
    work: MongoUnitOfWork,
    groupId: string,
    contextId: string,
    values: NewMediaValues,
  ): Promise<string | undefined> {
    const options = mongoOptions(work);
    const group = await this.requireGroup(work, groupId);
    await this.bumpContextVersion(work, contextId);
    await this.supersede(work, group.imageKey);
    await this.insertMedia(work, 'GROUP_IMAGE', values, { groupId: group._id });
    const updated = await work.db.collection<GroupDocument>(COLLECTIONS.groups).updateOne(
      {
        _id: group._id,
        ...(group.imageKey ? { imageKey: group.imageKey } : { imageKey: { $exists: false } }),
      },
      { $set: { imageKey: values.storageKey, updatedAt: new Date() } },
      options,
    );
    if (updated.modifiedCount !== 1) throw new Error('Group image reference was not updated');
    await this.audit(work, values, {
      action: 'group.image.replace',
      resourceType: 'GROUP',
      resourceId: group._id,
      contextId,
    });
    return group.imageKey;
  }

  async deleteGroupImage(
    work: MongoUnitOfWork,
    values: {
      readonly groupId: string;
      readonly contextId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
    },
  ): Promise<string | undefined> {
    const options = mongoOptions(work);
    const group = await this.requireGroup(work, values.groupId);
    if (!group.imageKey) return undefined;
    await this.bumpContextVersion(work, values.contextId);
    const updated = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .updateOne(
        { _id: group._id, imageKey: group.imageKey },
        { $unset: { imageKey: '' }, $set: { updatedAt: new Date() } },
        options,
      );
    if (updated.modifiedCount !== 1) throw new Error('Group image reference was not removed');
    await this.markDeleted(work, group.imageKey);
    await this.audit(work, values, {
      action: 'group.image.delete',
      resourceType: 'GROUP',
      resourceId: group._id,
      contextId: values.contextId,
    });
    return group.imageKey;
  }

  private async requireGroup(work: MongoUnitOfWork, groupId: string): Promise<GroupDocument> {
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ _id: groupId.toLowerCase() }, mongoOptions(work));
    if (!group) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    return group;
  }

  private async insertMedia(
    work: MongoUnitOfWork,
    kind: MediaKind,
    values: NewMediaValues,
    owner: { readonly userId: string } | { readonly groupId: string },
  ): Promise<void> {
    const now = new Date();
    await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).insertOne(
      {
        _id: values.mediaId.toLowerCase(),
        mediaKind: kind,
        ...('userId' in owner
          ? { ownerUserId: owner.userId.toLowerCase() }
          : { ownerGroupId: owner.groupId.toLowerCase() }),
        uploadedByParticipantId: values.actorParticipantId.toLowerCase(),
        storageProvider: 'FILESYSTEM',
        storageKey: values.storageKey,
        mediaType: values.processed.mediaType,
        byteSize: values.processed.byteSize,
        sha256Hash: Buffer.from(values.processed.sha256Hash),
        widthPixels: values.processed.width,
        heightPixels: values.processed.height,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      mongoOptions(work),
    );
  }

  private async supersede(work: MongoUnitOfWork, storageKey?: string): Promise<void> {
    if (!storageKey) return;
    const now = new Date();
    const result = await work.db
      .collection<MediaDocument>(COLLECTIONS.mediaObjects)
      .updateOne(
        { storageKey, status: 'ACTIVE' },
        { $set: { status: 'SUPERSEDED', supersededAt: now, updatedAt: now } },
        mongoOptions(work),
      );
    if (result.modifiedCount !== 1) {
      throw new Error('Current image metadata was not superseded exactly once');
    }
  }

  private async markDeleted(work: MongoUnitOfWork, storageKey: string): Promise<void> {
    const now = new Date();
    const result = await work.db
      .collection<MediaDocument>(COLLECTIONS.mediaObjects)
      .updateOne(
        { storageKey, status: 'ACTIVE' },
        { $set: { status: 'DELETED', deletedAt: now, updatedAt: now } },
        mongoOptions(work),
      );
    if (result.modifiedCount !== 1) {
      throw new Error('Current image metadata was not deleted exactly once');
    }
  }

  private async bumpContextVersion(work: MongoUnitOfWork, contextId: string): Promise<void> {
    const result = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .updateOne(
        { _id: contextId.toLowerCase() },
        { $inc: { mutationVersion: 1 }, $set: { updatedAt: new Date() } },
        mongoOptions(work),
      );
    if (result.matchedCount !== 1) throw new Error('Group context version was not updated');
  }

  private async audit(
    work: MongoUnitOfWork,
    values: {
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
      readonly processed?: ProcessedImage;
    },
    resource: {
      readonly action: string;
      readonly resourceType: 'USER' | 'GROUP';
      readonly resourceId: string;
      readonly contextId?: string;
    },
  ): Promise<void> {
    const metadata = values.processed
      ? {
          mediaType: values.processed.mediaType,
          byteSize: values.processed.byteSize,
          width: values.processed.width,
          height: values.processed.height,
        }
      : {};
    await work.db
      .collection<{ _id: string } & Record<string, unknown>>(COLLECTIONS.auditEvents)
      .insertOne(
        {
          _id: values.auditId.toLowerCase(),
          actorParticipantId: values.actorParticipantId.toLowerCase(),
          actorUserId: values.actorUserId.toLowerCase(),
          actionKey: resource.action,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId.toLowerCase(),
          ...(resource.contextId ? { contextId: resource.contextId.toLowerCase() } : {}),
          requestId: values.requestId,
          metadata,
          createdAt: new Date(),
        },
        mongoOptions(work),
      );
  }
}
