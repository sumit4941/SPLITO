import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import type { OracleService } from '../database/oracle.service.js';
import { GroupInvitationsRepository, type ManagedGroup } from './group-invitations.repository.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const contextId = '22222222-2222-4222-8222-222222222222';
const actorParticipantId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const invitationId = '55555555-5555-4555-8555-555555555555';
const inviterParticipantId = '66666666-6666-4666-8666-666666666666';
const mobileNumber = '+14155550123';
const tokenHash = Buffer.alloc(32, 7);

const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');

const group: ManagedGroup = {
  groupId,
  contextId,
  groupName: 'Goa trip',
  status: 'ACTIVE',
  callerRole: 'OWNER',
};

describe('Oracle group invitation persistence', () => {
  it('previews only a live pending token bound to the exact authenticated mobile', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          INVITATION_ID: raw(invitationId),
          CONTEXT_ID: raw(contextId),
          GROUP_ID: raw(groupId),
          GROUP_NAME: group.groupName,
          INVITER_DISPLAY_NAME: 'Alex',
          EXPIRES_AT_TEXT: '2030-01-01T00:00:00.000000Z',
        },
      ],
    });
    const repository = new GroupInvitationsRepository({ execute } as unknown as OracleService);

    await expect(repository.preview({} as Connection, tokenHash, mobileNumber)).resolves.toEqual({
      invitationId,
      groupId,
      groupName: group.groupName,
      inviterDisplayName: 'Alex',
      expiresAt: '2030-01-01T00:00:00.000000Z',
    });

    const sql = String(execute.mock.calls[0]?.[1]);
    expect(sql).toContain('I.TOKEN_HASH = :tokenHash');
    expect(sql).toContain('I.INVITEE_MOBILE_E164 = :mobileNumber');
    expect(sql).toContain("I.STATUS = 'PENDING'");
    expect(sql).toContain('I.EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)');
    expect(sql).toContain("INVITER_M.MEMBER_ROLE IN ('OWNER', 'ADMIN')");
    expect(execute.mock.calls[0]?.[2]).toEqual({ tokenHash, mobileNumber });
  });

  it('keeps phone and token material out of invitation outbox and audit JSON', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    const repository = new GroupInvitationsRepository({ execute } as unknown as OracleService);

    await repository.issueInvitation({} as Connection, {
      group,
      mobileNumber,
      tokenHash,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      actorParticipantId,
      actorUserId,
      requestId: 'request-invite',
    });

    const insertBinds = execute.mock.calls[1]?.[2] as Record<string, unknown>;
    expect(insertBinds).toMatchObject({ mobileNumber, tokenHash });
    const outboxJson = String((execute.mock.calls[2]?.[2] as Record<string, unknown>).payload);
    const auditJson = String((execute.mock.calls[3]?.[2] as Record<string, unknown>).metadata);
    expect(outboxJson).not.toContain(mobileNumber);
    expect(outboxJson).not.toContain(tokenHash.toString('hex'));
    expect(auditJson).not.toContain(mobileNumber);
    expect(auditJson).not.toContain(tokenHash.toString('hex'));
    expect(JSON.parse(outboxJson)).toEqual(
      expect.objectContaining({ groupId, invitationId: expect.any(String) }),
    );
    expect(JSON.parse(auditJson)).toEqual({ deliveryChannel: 'sms' });
  });

  it('returns a same-phone accepted replay without duplicating membership or events', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ CONTEXT_ID: raw(contextId) }] })
      .mockResolvedValueOnce({
        rows: [
          {
            INVITATION_ID: raw(invitationId),
            CONTEXT_ID: raw(contextId),
            INVITER_PARTICIPANT_ID: raw(inviterParticipantId),
            INVITEE_PARTICIPANT_ID: raw(actorParticipantId),
            STATUS: 'ACCEPTED',
            GROUP_ID: raw(groupId),
            GROUP_NAME: group.groupName,
            INVITER_DISPLAY_NAME: 'Alex',
            EXPIRES_AT_TEXT: '2030-01-01T00:00:00.000000Z',
            EXPIRED_FLAG: 'N',
            INVITER_AUTHORIZED_FLAG: 'Y',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            USER_ID: raw(actorUserId),
            PARTICIPANT_ID: raw(actorParticipantId),
            DISPLAY_NAME: 'Sam',
            STATUS: 'ACTIVE',
            VERIFIED_FLAG: 'Y',
            AVATAR_MEDIA_ID: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ MEMBER_ROLE: 'MEMBER', ALLOCATION_ORDER: '1' }],
      });
    const repository = new GroupInvitationsRepository({ execute } as unknown as OracleService);

    await expect(
      repository.accept({} as Connection, {
        locator: { invitationId, contextId },
        tokenHash,
        mobileNumber,
        actorParticipantId,
        actorUserId,
        requestId: 'request-replay',
      }),
    ).resolves.toMatchObject({
      preview: { invitationId, groupId },
      member: { id: actorParticipantId, status: 'active' },
    });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(execute.mock.calls.some((call) => String(call[1]).includes('INSERT INTO'))).toBe(false);
    expect(
      execute.mock.calls.some((call) => String(call[1]).trimStart().startsWith('UPDATE ')),
    ).toBe(false);
  });

  it('throws on a lost pending-to-accepted transition so membership work rolls back', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ CONTEXT_ID: raw(contextId) }] })
      .mockResolvedValueOnce({
        rows: [
          {
            INVITATION_ID: raw(invitationId),
            CONTEXT_ID: raw(contextId),
            INVITER_PARTICIPANT_ID: raw(inviterParticipantId),
            INVITEE_PARTICIPANT_ID: null,
            STATUS: 'PENDING',
            GROUP_ID: raw(groupId),
            GROUP_NAME: group.groupName,
            INVITER_DISPLAY_NAME: 'Alex',
            EXPIRES_AT_TEXT: '2030-01-01T00:00:00.000000Z',
            EXPIRED_FLAG: 'N',
            INVITER_AUTHORIZED_FLAG: 'Y',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            USER_ID: raw(actorUserId),
            PARTICIPANT_ID: raw(actorParticipantId),
            DISPLAY_NAME: 'Sam',
            STATUS: 'ACTIVE',
            VERIFIED_FLAG: 'Y',
            AVATAR_MEDIA_ID: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ MEMBER_ROLE: 'MEMBER', ALLOCATION_ORDER: '1' }],
      })
      .mockResolvedValueOnce({ rowsAffected: 0 });
    const repository = new GroupInvitationsRepository({ execute } as unknown as OracleService);

    await expect(
      repository.accept({} as Connection, {
        locator: { invitationId, contextId },
        tokenHash,
        mobileNumber,
        actorParticipantId,
        actorUserId,
        requestId: 'request-transition-race',
      }),
    ).rejects.toThrow('Invitation acceptance was not persisted');
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
