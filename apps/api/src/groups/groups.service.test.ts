import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../auth/auth.crypto.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { OracleService } from '../database/oracle.service.js';
import type {
  GroupInvitationsRepository,
  ManagedGroup,
  RegisteredTarget,
} from './group-invitations.repository.js';
import type { GroupsRepository, GroupMember } from './groups.repository.js';
import { GroupsService } from './groups.service.js';
import type { InvitationSmsService } from './invitation-sms.service.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const contextId = '22222222-2222-4222-8222-222222222222';
const actorParticipantId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const targetParticipantId = '55555555-5555-4555-8555-555555555555';
const targetUserId = '66666666-6666-4666-8666-666666666666';
const invitationId = '77777777-7777-4777-8777-777777777777';
const mobileNumber = '+14155550123';

const auth: AuthContext = {
  sessionId: '88888888-8888-4888-8888-888888888888',
  csrfHash: Buffer.alloc(32, 1),
  user: {
    id: actorParticipantId,
    userId: actorUserId,
    participantId: actorParticipantId,
    mobileNumber: '+14155550999',
    displayName: 'Alex',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
    theme: 'system',
    reducedMotion: false,
    version: '1',
  },
};

const managedGroup: ManagedGroup = {
  contextId,
  groupId,
  groupName: 'Goa trip',
  status: 'ACTIVE',
  callerRole: 'OWNER',
};

const target: RegisteredTarget = {
  userId: targetUserId,
  participantId: targetParticipantId,
  displayName: 'Sam',
  status: 'ACTIVE',
  mobileVerified: true,
};

const member: GroupMember = {
  id: targetParticipantId,
  displayName: 'Sam',
  kind: 'USER',
  role: 'member',
  status: 'active',
  allocationOrder: 1,
};

function createHarness() {
  const connection = {} as Connection;
  const invitations = {
    lockManagedGroup: vi.fn().mockResolvedValue(managedGroup),
    findRegisteredTarget: vi.fn(),
    ensureRegisteredMember: vi.fn().mockResolvedValue({ member, created: true }),
    issueInvitation: vi.fn().mockResolvedValue({ invitationId, resend: false }),
    preview: vi.fn(),
    invitationLocator: vi.fn(),
    accept: vi.fn(),
  };
  const sms = {
    assertAvailable: vi.fn(),
    deliver: vi.fn().mockResolvedValue({
      mode: 'development_capture',
      inviteUrl: `http://localhost:5173/join#invite=${'x'.repeat(43)}`,
    }),
  };
  const oracle = {
    withConnection: vi.fn(async (operation: (value: Connection) => Promise<unknown>) =>
      operation(connection),
    ),
    withTransaction: vi.fn(async (operation: (value: Connection) => Promise<unknown>) =>
      operation(connection),
    ),
  };
  return {
    invitations,
    sms,
    service: new GroupsService(
      {} as GroupsRepository,
      invitations as unknown as GroupInvitationsRepository,
      sms as unknown as InvitationSmsService,
      oracle as unknown as OracleService,
    ),
  };
}

describe('group membership and invitation service', () => {
  it('adds an active registered account directly without sending an SMS', async () => {
    const { service, invitations, sms } = createHarness();
    invitations.findRegisteredTarget.mockResolvedValue(target);

    await expect(
      service.addMember(groupId, { mobileNumber }, auth, 'request-direct-add'),
    ).resolves.toEqual({ outcome: 'member_added', member });

    expect(invitations.ensureRegisteredMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ group: managedGroup, target }),
    );
    expect(invitations.issueInvitation).not.toHaveBeenCalled();
    expect(sms.assertAvailable).not.toHaveBeenCalled();
    expect(sms.deliver).not.toHaveBeenCalled();
  });

  it('stores only the token hash and sends the raw token after the transaction commits', async () => {
    const { service, invitations, sms } = createHarness();
    invitations.findRegisteredTarget.mockResolvedValue(undefined);

    const result = await service.addMember(groupId, { mobileNumber }, auth, 'request-invitation');

    expect(sms.assertAvailable).toHaveBeenCalledOnce();
    expect(invitations.issueInvitation).toHaveBeenCalledOnce();
    expect(sms.deliver).toHaveBeenCalledOnce();
    const invitationValues = invitations.issueInvitation.mock.calls[0]?.[1] as {
      tokenHash: Buffer;
    };
    const smsValues = sms.deliver.mock.calls[0]?.[0] as { token: string };
    expect(smsValues.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(invitationValues.tokenHash.equals(sha256(smsValues.token))).toBe(true);
    expect(invitationValues).not.toHaveProperty('token');
    expect(result).toMatchObject({
      outcome: 'invitation_sent',
      invitation: {
        id: invitationId,
        maskedMobileNumber: '+*******0123',
        status: 'pending',
      },
    });
  });

  it('rejects a normal member before looking up or messaging the target account', async () => {
    const { service, invitations, sms } = createHarness();
    invitations.lockManagedGroup.mockResolvedValue({ ...managedGroup, callerRole: 'MEMBER' });

    await expect(
      service.addMember(groupId, { mobileNumber }, auth, 'request-forbidden'),
    ).rejects.toMatchObject({ code: 'GROUP_MEMBERSHIP_FORBIDDEN', status: 403 });
    expect(invitations.findRegisteredTarget).not.toHaveBeenCalled();
    expect(sms.deliver).not.toHaveBeenCalled();
  });

  it('binds invitation preview to the authenticated mobile and returns a generic miss', async () => {
    const { service, invitations } = createHarness();
    const token = 'a'.repeat(43);
    invitations.preview.mockResolvedValue(undefined);

    await expect(service.previewInvitation({ token }, auth)).rejects.toMatchObject({
      code: 'GROUP_INVITATION_NOT_FOUND',
      status: 404,
    });
    const [connection, tokenHash, boundMobile] = invitations.preview.mock.calls[0] as [
      Connection,
      Buffer,
      string,
    ];
    expect(connection).toEqual(expect.anything());
    expect(tokenHash.equals(sha256(token))).toBe(true);
    expect(boundMobile).toBe(auth.user.mobileNumber);
  });

  it('accepts through the phone-bound locator and returns the joined member', async () => {
    const { service, invitations } = createHarness();
    const token = 'b'.repeat(43);
    invitations.invitationLocator.mockResolvedValue({ invitationId, contextId });
    invitations.accept.mockResolvedValue({
      preview: {
        invitationId,
        groupId,
        groupName: managedGroup.groupName,
        inviterDisplayName: auth.user.displayName,
        expiresAt: '2030-01-01T00:00:00.000000Z',
      },
      member,
    });

    await expect(service.acceptInvitation({ token }, auth, 'request-accept')).resolves.toEqual({
      outcome: 'joined',
      groupId,
      groupName: managedGroup.groupName,
      member,
    });
    expect(invitations.accept).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        locator: { invitationId, contextId },
        mobileNumber: auth.user.mobileNumber,
        actorParticipantId,
        actorUserId,
      }),
    );
  });
});
