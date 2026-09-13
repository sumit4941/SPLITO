import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import type { OracleService } from '../database/oracle.service.js';
import { MediaRepository } from './media.repository.js';
import type { ProcessedImage } from './media.types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const contextId = '44444444-4444-4444-8444-444444444444';
const mediaId = '55555555-5555-4555-8555-555555555555';
const auditId = '66666666-6666-4666-8666-666666666666';
const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');
const processed: ProcessedImage = {
  bytes: Buffer.from('image'),
  mediaType: 'image/webp',
  byteSize: 5,
  sha256Hash: Buffer.alloc(32, 7),
  width: 512,
  height: 512,
};

describe('Oracle-backed private media repository', () => {
  it('authorizes participant avatar reads by self or shared active context and pins media ID', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          MEDIA_ID: raw(mediaId),
          STORAGE_KEY: `user-avatar/55/${mediaId}.webp`,
          MEDIA_TYPE: 'image/webp',
          BYTE_SIZE: '5',
          SHA256_HASH: Buffer.alloc(32, 7),
          WIDTH_PX: '512',
          HEIGHT_PX: '512',
        },
      ],
    });
    const repository = new MediaRepository({ execute } as unknown as OracleService);

    await expect(
      repository.findParticipantAvatar({} as Connection, participantId, participantId, mediaId),
    ).resolves.toMatchObject({ id: mediaId, byteSize: 5, width: 512, height: 512 });
    const sql = String(execute.mock.calls[0]?.[1]);
    expect(sql).toContain('MO.MEDIA_ID = :mediaId');
    expect(sql).toContain('TARGET_P.PARTICIPANT_ID = :callerParticipantId');
    expect(sql).toContain("CALLER_M.STATUS = 'ACTIVE'");
    expect(sql).toContain("TARGET_M.STATUS = 'ACTIVE'");
    expect(execute.mock.calls[0]?.[2]).toMatchObject({
      participantId: raw(participantId),
      callerParticipantId: raw(participantId),
      mediaId: raw(mediaId),
    });
  });

  it('requires active group membership and the current versioned pointer for image reads', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new MediaRepository({ execute } as unknown as OracleService);
    await expect(
      repository.findGroupImage({} as Connection, groupId, participantId, mediaId),
    ).resolves.toBeUndefined();
    const sql = String(execute.mock.calls[0]?.[1]);
    expect(sql).toContain('MO.STORAGE_KEY = G.IMAGE_KEY');
    expect(sql).toContain('MO.MEDIA_ID = :mediaId');
    expect(sql).toContain("CALLER_M.STATUS = 'ACTIVE'");
  });

  it('supersedes the old avatar before inserting and pointing to the new active media', async () => {
    const previous = 'user-avatar/aa/old.webp';
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ CURRENT_STORAGE_KEY: previous, VERSION_NO: '3' }] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    const repository = new MediaRepository({ execute } as unknown as OracleService);

    await expect(
      repository.replaceUserAvatar({} as Connection, userId, {
        mediaId,
        storageKey: `user-avatar/55/${mediaId}.webp`,
        processed,
        actorParticipantId: participantId,
        actorUserId: userId,
        auditId,
        requestId: 'request-1',
      }),
    ).resolves.toBe(previous);

    expect(String(execute.mock.calls[0]?.[1])).toContain('FOR UPDATE');
    expect(String(execute.mock.calls[1]?.[1])).toContain("STATUS = 'SUPERSEDED'");
    expect(String(execute.mock.calls[2]?.[1])).toContain('INSERT INTO SPLITO_MEDIA_OBJECTS');
    expect(String(execute.mock.calls[3]?.[1])).toContain('AVATAR_KEY = :storageKey');
    expect(String(execute.mock.calls[4]?.[1])).toContain('SPLITO_AUDIT_EVENTS');
    const auditBinds = execute.mock.calls[4]?.[2] as Record<string, unknown>;
    expect(auditBinds.metadata).not.toContain('storageKey');
  });

  it('replaces a group image and bumps the context version in the same transaction', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ CURRENT_STORAGE_KEY: null, CONTEXT_ID: raw(contextId), VERSION_NO: '9' }],
      })
      .mockResolvedValue({ rowsAffected: 1 });
    const repository = new MediaRepository({ execute } as unknown as OracleService);

    await repository.replaceGroupImage({} as Connection, groupId, contextId, {
      mediaId,
      storageKey: `group-image/55/${mediaId}.webp`,
      processed,
      actorParticipantId: participantId,
      actorUserId: userId,
      auditId,
      requestId: 'request-2',
    });

    expect(String(execute.mock.calls[1]?.[1])).toContain('INSERT INTO SPLITO_MEDIA_OBJECTS');
    expect(String(execute.mock.calls[2]?.[1])).toContain('IMAGE_KEY = :storageKey');
    expect(String(execute.mock.calls[3]?.[1])).toContain('VERSION_NO = VERSION_NO + 1');
    expect(String(execute.mock.calls[4]?.[1])).not.toContain("'group.image.replace'");
    expect(execute.mock.calls[4]?.[2]).toMatchObject({ action: 'group.image.replace' });
  });

  it('treats deleting an absent avatar as an idempotent no-op', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [{ CURRENT_STORAGE_KEY: null, VERSION_NO: '4' }],
    });
    const repository = new MediaRepository({ execute } as unknown as OracleService);
    await expect(
      repository.deleteUserAvatar({} as Connection, {
        userId,
        actorParticipantId: participantId,
        actorUserId: userId,
        auditId,
        requestId: 'request-3',
      }),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
  });
});
