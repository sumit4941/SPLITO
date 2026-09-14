import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, type MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import { GroupsRepository } from './groups.repository.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const contextId = '22222222-2222-4222-8222-222222222222';
const participantId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const invitationId = '55555555-5555-4555-8555-555555555555';

function cursor<T>(items: T[]) {
  const value = {
    sort: vi.fn(),
    toArray: vi.fn().mockResolvedValue(items),
  };
  value.sort.mockReturnValue(value);
  return value;
}

function detailWork(role: 'OWNER' | 'MEMBER') {
  const group = {
    _id: groupId,
    contextId,
    name: 'Goa trip',
    type: 'TRIP',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
  const context = {
    _id: contextId,
    type: 'GROUP',
    defaultCurrencyCode: 'INR',
    simplificationEnabled: false,
    status: 'ACTIVE',
    mutationVersion: 2,
    createdByParticipantId: participantId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
  const membership = {
    _id: '66666666-6666-4666-8666-666666666666',
    contextId,
    participantId,
    role,
    status: 'ACTIVE',
    allocationOrder: 0,
  };
  const invitations = {
    find: vi.fn(() =>
      cursor([
        {
          _id: invitationId,
          invitationType: 'GROUP',
          contextId,
          inviteeMobileE164: '+14155550123',
          status: 'PENDING',
          expiresAt: new Date('2030-01-01T00:00:00Z'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
    ),
  };
  const collections: Record<string, unknown> = {
    [COLLECTIONS.groups]: { findOne: vi.fn().mockResolvedValue(group) },
    [COLLECTIONS.contexts]: { findOne: vi.fn().mockResolvedValue(context) },
    [COLLECTIONS.contextMembers]: {
      findOne: vi.fn().mockResolvedValue(membership),
      find: vi.fn(() => cursor([])),
    },
    [COLLECTIONS.invitations]: invitations,
  };
  const collection = vi.fn((name: string) => collections[name]);
  return {
    invitations,
    collection,
    work: { db: { collection } } as unknown as MongoUnitOfWork,
  };
}

describe('Mongo group persistence', () => {
  it('returns masked live pending invitations to an owner', async () => {
    const { work, invitations } = detailWork('OWNER');
    const repository = new GroupsRepository({} as MongoService);

    const detail = await repository.detail(work, groupId, participantId);

    expect(detail?.pendingInvitations).toEqual([
      {
        id: invitationId,
        maskedMobileNumber: '+*******0123',
        expiresAt: '2030-01-01T00:00:00.000Z',
        status: 'pending',
      },
    ]);
    expect(invitations.find).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId,
        invitationType: 'GROUP',
        status: 'PENDING',
        expiresAt: { $gt: expect.any(Date) },
      }),
      expect.anything(),
    );
  });

  it('does not query or expose invitation targets to a normal member', async () => {
    const { work, invitations, collection } = detailWork('MEMBER');
    const repository = new GroupsRepository({} as MongoService);

    const detail = await repository.detail(work, groupId, participantId);

    expect(detail?.pendingInvitations).toEqual([]);
    expect(invitations.find).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalledWith(COLLECTIONS.invitations);
  });

  it('creates canonical context, group, owner membership, outbox, and audit documents', async () => {
    const contexts = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const groups = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const members = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const outbox = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const audits = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const work = {
      db: {
        collection: vi.fn(
          (name: string) =>
            ({
              [COLLECTIONS.contexts]: contexts,
              [COLLECTIONS.groups]: groups,
              [COLLECTIONS.contextMembers]: members,
              [COLLECTIONS.outbox]: outbox,
              [COLLECTIONS.auditEvents]: audits,
            })[name],
        ),
      },
    } as unknown as MongoUnitOfWork;
    const repository = new GroupsRepository({} as MongoService);

    const created = await repository.create(work, {
      name: 'Goa trip',
      type: 'trip',
      defaultCurrency: 'INR',
      simplificationEnabled: true,
      groupId,
      contextId,
      membershipId: invitationId,
      actorParticipantId: participantId,
      actorUserId: userId,
      requestId: 'request-create',
      outboxId: '77777777-7777-4777-8777-777777777777',
      auditId: '88888888-8888-4888-8888-888888888888',
    });

    expect(created).toMatchObject({ id: groupId, contextId, role: 'owner', version: '1' });
    expect(contexts.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: contextId, type: 'GROUP', mutationVersion: 1 }),
      expect.anything(),
    );
    expect(members.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId,
        participantId,
        role: 'OWNER',
        allocationOrder: 0,
      }),
      expect.anything(),
    );
    expect(outbox.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'group.created', payload: { groupId, contextId } }),
      expect.anything(),
    );
  });
});
