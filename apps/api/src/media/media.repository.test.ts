import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, type MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import { MediaRepository } from './media.repository.js';
import type { ProcessedImage } from './media.types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const contextId = '44444444-4444-4444-8444-444444444444';
const mediaId = '55555555-5555-4555-8555-555555555555';
const auditId = '66666666-6666-4666-8666-666666666666';
const processed: ProcessedImage = {
  bytes: Buffer.from('image'),
  mediaType: 'image/webp',
  byteSize: 5,
  sha256Hash: Buffer.alloc(32, 7),
  width: 512,
  height: 512,
};

function createWork(collections: Record<string, unknown>): MongoUnitOfWork {
  return {
    db: { collection: vi.fn((name: string) => collections[name]) },
  } as unknown as MongoUnitOfWork;
}

describe('Mongo-backed private media repository', () => {
  it('authorizes a self avatar read and pins both media ID and the current storage pointer', async () => {
    const participants = {
      findOne: vi.fn().mockResolvedValue({ _id: participantId, userId, kind: 'USER' }),
    };
    const users = {
      findOne: vi.fn().mockResolvedValue({
        _id: userId,
        status: 'ACTIVE',
        avatarKey: `user-avatar/55/${mediaId}.webp`,
      }),
    };
    const media = {
      findOne: vi.fn().mockResolvedValue({
        _id: mediaId,
        ownerUserId: userId,
        storageKey: `user-avatar/55/${mediaId}.webp`,
        mediaKind: 'USER_AVATAR',
        status: 'ACTIVE',
        mediaType: 'image/webp',
        byteSize: 5,
        sha256Hash: Buffer.alloc(32, 7),
        widthPixels: 512,
        heightPixels: 512,
      }),
    };
    const contextMembers = { find: vi.fn(), findOne: vi.fn() };
    const repository = new MediaRepository({} as MongoService);

    await expect(
      repository.findParticipantAvatar(
        createWork({
          [COLLECTIONS.participants]: participants,
          [COLLECTIONS.users]: users,
          [COLLECTIONS.mediaObjects]: media,
          [COLLECTIONS.contextMembers]: contextMembers,
        }),
        participantId,
        participantId,
        mediaId,
      ),
    ).resolves.toMatchObject({ id: mediaId, byteSize: 5, width: 512, height: 512 });
    expect(contextMembers.find).not.toHaveBeenCalled();
    expect(media.findOne).toHaveBeenCalledWith(
      {
        _id: mediaId,
        ownerUserId: userId,
        storageKey: `user-avatar/55/${mediaId}.webp`,
        mediaKind: 'USER_AVATAR',
        status: 'ACTIVE',
      },
      expect.anything(),
    );
  });

  it('requires active group membership before loading the current group image', async () => {
    const groups = {
      findOne: vi.fn().mockResolvedValue({
        _id: groupId,
        contextId,
        imageKey: `group-image/55/${mediaId}.webp`,
      }),
    };
    const members = { findOne: vi.fn().mockResolvedValue(null) };
    const media = { findOne: vi.fn() };
    const repository = new MediaRepository({} as MongoService);

    await expect(
      repository.findGroupImage(
        createWork({
          [COLLECTIONS.groups]: groups,
          [COLLECTIONS.contextMembers]: members,
          [COLLECTIONS.mediaObjects]: media,
        }),
        groupId,
        participantId,
        mediaId,
      ),
    ).resolves.toBeUndefined();
    expect(members.findOne).toHaveBeenCalledWith(
      { contextId, participantId, status: 'ACTIVE' },
      expect.anything(),
    );
    expect(media.findOne).not.toHaveBeenCalled();
  });

  it('supersedes the old avatar before inserting and CAS-pointing to new active media', async () => {
    const previous = 'user-avatar/aa/old.webp';
    const users = {
      findOne: vi.fn().mockResolvedValue({ _id: userId, status: 'ACTIVE', avatarKey: previous }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const media = {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const audits = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new MediaRepository({} as MongoService);

    await expect(
      repository.replaceUserAvatar(
        createWork({
          [COLLECTIONS.users]: users,
          [COLLECTIONS.mediaObjects]: media,
          [COLLECTIONS.auditEvents]: audits,
        }),
        userId,
        {
          mediaId,
          storageKey: `user-avatar/55/${mediaId}.webp`,
          processed,
          actorParticipantId: participantId,
          actorUserId: userId,
          auditId,
          requestId: 'request-1',
        },
      ),
    ).resolves.toBe(previous);

    expect(media.updateOne).toHaveBeenCalledWith(
      { storageKey: previous, status: 'ACTIVE' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'SUPERSEDED' }) }),
      expect.anything(),
    );
    expect(media.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: mediaId,
        ownerUserId: userId,
        status: 'ACTIVE',
        sha256Hash: Buffer.alloc(32, 7),
      }),
      expect.anything(),
    );
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: userId, status: 'ACTIVE', avatarKey: previous },
      expect.objectContaining({ $set: expect.objectContaining({ avatarKey: expect.any(String) }) }),
      expect.anything(),
    );
    expect(media.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      media.insertOne.mock.invocationCallOrder[0] ?? 0,
    );
    expect(JSON.stringify(audits.insertOne.mock.calls[0]?.[0])).not.toContain('storageKey');
  });

  it('replaces a group image and fences the context mutation in the same transaction', async () => {
    const groups = {
      findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const contexts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const media = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const audits = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new MediaRepository({} as MongoService);

    await repository.replaceGroupImage(
      createWork({
        [COLLECTIONS.groups]: groups,
        [COLLECTIONS.contexts]: contexts,
        [COLLECTIONS.mediaObjects]: media,
        [COLLECTIONS.auditEvents]: audits,
      }),
      groupId,
      contextId,
      {
        mediaId,
        storageKey: `group-image/55/${mediaId}.webp`,
        processed,
        actorParticipantId: participantId,
        actorUserId: userId,
        auditId,
        requestId: 'request-2',
      },
    );

    expect(contexts.updateOne).toHaveBeenCalledWith(
      { _id: contextId },
      expect.objectContaining({ $inc: { mutationVersion: 1 } }),
      expect.anything(),
    );
    expect(groups.updateOne).toHaveBeenCalledWith(
      { _id: groupId, imageKey: { $exists: false } },
      expect.objectContaining({ $set: expect.objectContaining({ imageKey: expect.any(String) }) }),
      expect.anything(),
    );
    expect(audits.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'group.image.replace', contextId }),
      expect.anything(),
    );
  });

  it('treats deleting an absent avatar as an idempotent no-op', async () => {
    const users = {
      findOne: vi.fn().mockResolvedValue({ _id: userId, status: 'ACTIVE' }),
      updateOne: vi.fn(),
    };
    const media = { updateOne: vi.fn() };
    const audit = { insertOne: vi.fn() };
    const repository = new MediaRepository({} as MongoService);

    await expect(
      repository.deleteUserAvatar(
        createWork({
          [COLLECTIONS.users]: users,
          [COLLECTIONS.mediaObjects]: media,
          [COLLECTIONS.auditEvents]: audit,
        }),
        {
          userId,
          actorParticipantId: participantId,
          actorUserId: userId,
          auditId,
          requestId: 'request-3',
        },
      ),
    ).resolves.toBeUndefined();
    expect(users.updateOne).not.toHaveBeenCalled();
    expect(media.updateOne).not.toHaveBeenCalled();
    expect(audit.insertOne).not.toHaveBeenCalled();
  });
});
