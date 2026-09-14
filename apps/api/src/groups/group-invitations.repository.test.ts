import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, type MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import { GroupInvitationsRepository, type ManagedGroup } from './group-invitations.repository.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const contextId = '22222222-2222-4222-8222-222222222222';
const actorParticipantId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const invitationId = '55555555-5555-4555-8555-555555555555';
const inviterParticipantId = '66666666-6666-4666-8666-666666666666';
const mobileNumber = '+14155550123';
const tokenHash = Buffer.alloc(32, 7);

const group: ManagedGroup = {
  groupId,
  contextId,
  groupName: 'Goa trip',
  status: 'ACTIVE',
  callerRole: 'OWNER',
};

function createWork(collections: Record<string, unknown>): MongoUnitOfWork {
  return {
    db: { collection: vi.fn((name: string) => collections[name]) },
  } as unknown as MongoUnitOfWork;
}

function invitation(status: 'PENDING' | 'ACCEPTED' = 'PENDING') {
  return {
    _id: invitationId,
    invitationType: 'GROUP' as const,
    contextId,
    inviterParticipantId,
    inviteeMobileE164: mobileNumber,
    ...(status === 'ACCEPTED' ? { inviteeParticipantId: actorParticipantId } : {}),
    tokenHash,
    status,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    resendCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('Mongo group invitation persistence', () => {
  it('previews only a live pending token bound to the exact authenticated mobile', async () => {
    const invitations = { findOne: vi.fn().mockResolvedValue(invitation()) };
    const contexts = {
      findOne: vi.fn().mockResolvedValue({ _id: contextId, status: 'ACTIVE', mutationVersion: 1 }),
    };
    const groups = {
      findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId, name: group.groupName }),
    };
    const members = {
      findOne: vi.fn().mockResolvedValue({
        contextId,
        participantId: inviterParticipantId,
        status: 'ACTIVE',
        role: 'OWNER',
      }),
    };
    const participants = {
      findOne: vi.fn().mockResolvedValue({
        _id: inviterParticipantId,
        displayName: 'Alex',
        kind: 'USER',
      }),
    };
    const repository = new GroupInvitationsRepository({} as MongoService);

    await expect(
      repository.preview(
        createWork({
          [COLLECTIONS.invitations]: invitations,
          [COLLECTIONS.contexts]: contexts,
          [COLLECTIONS.groups]: groups,
          [COLLECTIONS.contextMembers]: members,
          [COLLECTIONS.participants]: participants,
        }),
        tokenHash,
        mobileNumber,
      ),
    ).resolves.toEqual({
      invitationId,
      groupId,
      groupName: group.groupName,
      inviterDisplayName: 'Alex',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(invitations.findOne).toHaveBeenCalledWith(
      {
        invitationType: 'GROUP',
        tokenHash,
        inviteeMobileE164: mobileNumber,
        status: 'PENDING',
        expiresAt: { $gt: expect.any(Date) },
      },
      expect.anything(),
    );
    expect(members.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: inviterParticipantId,
        status: 'ACTIVE',
        role: { $in: ['OWNER', 'ADMIN'] },
      }),
      expect.anything(),
    );
  });

  it('keeps phone and token material out of invitation outbox and audit documents', async () => {
    const contexts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const invitations = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const outbox = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const audit = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new GroupInvitationsRepository({} as MongoService);

    const result = await repository.issueInvitation(
      createWork({
        [COLLECTIONS.contexts]: contexts,
        [COLLECTIONS.invitations]: invitations,
        [COLLECTIONS.outbox]: outbox,
        [COLLECTIONS.auditEvents]: audit,
      }),
      {
        group,
        mobileNumber,
        tokenHash,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        actorParticipantId,
        actorUserId,
        requestId: 'request-invite',
      },
    );

    expect(result).toMatchObject({ invitationId: expect.any(String), resend: false });
    expect(contexts.updateOne).toHaveBeenCalledWith(
      { _id: contextId, status: 'ACTIVE' },
      expect.objectContaining({ $inc: { mutationVersion: 1 } }),
      expect.anything(),
    );
    expect(invitations.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ inviteeMobileE164: mobileNumber, tokenHash }),
      expect.anything(),
    );
    const outboxDocument = outbox.insertOne.mock.calls[0]?.[0];
    const auditDocument = audit.insertOne.mock.calls[0]?.[0];
    expect(JSON.stringify(outboxDocument)).not.toContain(mobileNumber);
    expect(JSON.stringify(outboxDocument)).not.toContain(tokenHash.toString('hex'));
    expect(JSON.stringify(auditDocument)).not.toContain(mobileNumber);
    expect(JSON.stringify(auditDocument)).not.toContain(tokenHash.toString('hex'));
    expect(outboxDocument).toMatchObject({
      eventType: 'group.invitation.requested',
      payload: { invitationId: expect.any(String), groupId },
    });
    expect(auditDocument).toMatchObject({ metadata: { deliveryChannel: 'sms' } });
  });

  it('renews an expired pending slot in place without reusing its unique key', async () => {
    const contexts = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }) };
    const invitations = {
      findOne: vi
        .fn()
        .mockResolvedValue({ ...invitation(), expiresAt: new Date('2020-01-01T00:00:00Z') }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn(),
    };
    const outbox = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const audit = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new GroupInvitationsRepository({} as MongoService);

    await expect(
      repository.issueInvitation(
        createWork({
          [COLLECTIONS.contexts]: contexts,
          [COLLECTIONS.invitations]: invitations,
          [COLLECTIONS.outbox]: outbox,
          [COLLECTIONS.auditEvents]: audit,
        }),
        {
          group,
          mobileNumber,
          tokenHash: Buffer.alloc(32, 8),
          expiresAt: new Date('2031-01-01T00:00:00Z'),
          actorParticipantId,
          actorUserId,
          requestId: 'request-renew',
        },
      ),
    ).resolves.toEqual({ invitationId, resend: false });

    expect(invitations.updateOne).toHaveBeenCalledWith(
      { _id: invitationId, status: 'PENDING' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'PENDING', resendCount: 0 }),
        $unset: { respondedAt: '', revokedAt: '' },
      }),
      expect.anything(),
    );
    expect(invitations.insertOne).not.toHaveBeenCalled();
    expect(audit.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'group.invitation.create' }),
      expect.anything(),
    );
  });

  it('returns a same-phone accepted replay without duplicating membership or events', async () => {
    const contexts = {
      findOne: vi.fn().mockResolvedValue({ _id: contextId, status: 'ACTIVE', mutationVersion: 3 }),
      updateOne: vi.fn(),
    };
    const groups = {
      findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId, name: group.groupName }),
    };
    const invitations = {
      findOne: vi.fn().mockResolvedValue(invitation('ACCEPTED')),
      updateOne: vi.fn(),
    };
    const members = {
      findOne: vi.fn(async (filter: { participantId?: string }) =>
        filter.participantId === inviterParticipantId
          ? { contextId, participantId: inviterParticipantId, status: 'ACTIVE', role: 'OWNER' }
          : {
              contextId,
              participantId: actorParticipantId,
              status: 'ACTIVE',
              role: 'MEMBER',
              allocationOrder: 1,
            },
      ),
      insertOne: vi.fn(),
    };
    const users = {
      findOne: vi.fn().mockResolvedValue({
        _id: actorUserId,
        mobileE164: mobileNumber,
        mobileVerifiedAt: new Date(),
        status: 'ACTIVE',
      }),
    };
    const participants = {
      findOne: vi.fn(async (filter: { _id?: string }) =>
        filter._id === actorParticipantId
          ? {
              _id: actorParticipantId,
              userId: actorUserId,
              kind: 'USER',
              displayName: 'Sam',
            }
          : { _id: inviterParticipantId, kind: 'USER', displayName: 'Alex' },
      ),
    };
    const outbox = { insertOne: vi.fn() };
    const audit = { insertOne: vi.fn() };
    const repository = new GroupInvitationsRepository({} as MongoService);

    await expect(
      repository.accept(
        createWork({
          [COLLECTIONS.contexts]: contexts,
          [COLLECTIONS.groups]: groups,
          [COLLECTIONS.invitations]: invitations,
          [COLLECTIONS.contextMembers]: members,
          [COLLECTIONS.users]: users,
          [COLLECTIONS.participants]: participants,
          [COLLECTIONS.outbox]: outbox,
          [COLLECTIONS.auditEvents]: audit,
        }),
        {
          locator: { invitationId, contextId },
          tokenHash,
          mobileNumber,
          actorParticipantId,
          actorUserId,
          requestId: 'request-replay',
        },
      ),
    ).resolves.toMatchObject({
      preview: { invitationId, groupId },
      member: { id: actorParticipantId, status: 'active', allocationOrder: 1 },
    });
    expect(contexts.updateOne).not.toHaveBeenCalled();
    expect(invitations.updateOne).not.toHaveBeenCalled();
    expect(members.insertOne).not.toHaveBeenCalled();
    expect(outbox.insertOne).not.toHaveBeenCalled();
    expect(audit.insertOne).not.toHaveBeenCalled();
  });

  it('throws on a lost pending-to-accepted transition so membership work rolls back', async () => {
    const contexts = {
      findOne: vi.fn().mockResolvedValue({ _id: contextId, status: 'ACTIVE', mutationVersion: 3 }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const groups = {
      findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId, name: group.groupName }),
    };
    const invitations = {
      findOne: vi.fn().mockResolvedValue(invitation()),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    const members = {
      findOne: vi.fn(async (filter: { participantId?: string }) =>
        filter.participantId === inviterParticipantId
          ? { contextId, participantId: inviterParticipantId, status: 'ACTIVE', role: 'OWNER' }
          : {
              contextId,
              participantId: actorParticipantId,
              status: 'ACTIVE',
              role: 'MEMBER',
              allocationOrder: 1,
            },
      ),
    };
    const users = {
      findOne: vi.fn().mockResolvedValue({
        _id: actorUserId,
        mobileE164: mobileNumber,
        mobileVerifiedAt: new Date(),
        status: 'ACTIVE',
      }),
    };
    const participants = {
      findOne: vi.fn().mockResolvedValue({
        _id: actorParticipantId,
        userId: actorUserId,
        kind: 'USER',
        displayName: 'Sam',
      }),
    };
    const repository = new GroupInvitationsRepository({} as MongoService);

    await expect(
      repository.accept(
        createWork({
          [COLLECTIONS.contexts]: contexts,
          [COLLECTIONS.groups]: groups,
          [COLLECTIONS.invitations]: invitations,
          [COLLECTIONS.contextMembers]: members,
          [COLLECTIONS.users]: users,
          [COLLECTIONS.participants]: participants,
        }),
        {
          locator: { invitationId, contextId },
          tokenHash,
          mobileNumber,
          actorParticipantId,
          actorUserId,
          requestId: 'request-transition-race',
        },
      ),
    ).rejects.toThrow('Invitation acceptance was not persisted');
  });
});
