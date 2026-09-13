import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import type { OracleService } from '../database/oracle.service.js';
import { GroupsRepository } from './groups.repository.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const contextId = '22222222-2222-4222-8222-222222222222';
const participantId = '33333333-3333-4333-8333-333333333333';
const invitationId = '44444444-4444-4444-8444-444444444444';
const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');

function groupRow(role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  return {
    GROUP_ID: raw(groupId),
    CONTEXT_ID: raw(contextId),
    GROUP_NAME: 'Goa trip',
    DESCRIPTION: null,
    IMAGE_MEDIA_ID: null,
    GROUP_TYPE: 'TRIP',
    DEFAULT_CURRENCY_CODE: 'INR',
    SIMPLIFICATION_FLAG: 'N',
    STATUS: 'ACTIVE',
    MEMBER_ROLE: role,
    VERSION_NO: '2',
    CREATED_AT: '2026-01-01T00:00:00.000000Z',
    UPDATED_AT: '2026-01-02T00:00:00.000000Z',
    MEMBER_COUNT: '1',
  };
}

describe('group detail pending-invitation privacy', () => {
  it('returns masked live pending invitations to an owner', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [groupRow('OWNER')] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            INVITATION_ID: raw(invitationId),
            INVITEE_MOBILE_E164: '+14155550123',
            EXPIRES_AT: '2030-01-01T00:00:00.000000Z',
          },
        ],
      });
    const repository = new GroupsRepository({ execute } as unknown as OracleService);

    const detail = await repository.detail({} as Connection, groupId, participantId);

    expect(detail?.pendingInvitations).toEqual([
      {
        id: invitationId,
        maskedMobileNumber: '+*******0123',
        expiresAt: '2030-01-01T00:00:00.000000Z',
        status: 'pending',
      },
    ]);
    const pendingSql = String(execute.mock.calls[2]?.[1]);
    expect(pendingSql).toContain("INVITATION_TYPE = 'GROUP'");
    expect(pendingSql).toContain("STATUS = 'PENDING'");
    expect(pendingSql).toContain('EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)');
  });

  it('does not query or expose invitation targets to a normal member', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [groupRow('MEMBER')] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new GroupsRepository({ execute } as unknown as OracleService);

    const detail = await repository.detail({} as Connection, groupId, participantId);

    expect(detail?.pendingInvitations).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
