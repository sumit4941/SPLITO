import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, type MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import { ContextAccessRepository } from './context-access.repository.js';

const contextId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';

function workWith(context: Record<string, unknown>) {
  const contexts = {
    updateOne: vi.fn().mockResolvedValue({ matchedCount: context.status === 'ACTIVE' ? 1 : 0 }),
    findOne: vi.fn().mockResolvedValue(context),
  };
  const members = {
    findOne: vi.fn().mockResolvedValue({
      _id: '44444444-4444-4444-8444-444444444444',
      contextId,
      participantId,
      role: 'OWNER',
      status: 'ACTIVE',
      allocationOrder: 0,
    }),
  };
  const groups = { findOne: vi.fn().mockResolvedValue({ _id: groupId, contextId }) };
  return {
    contexts,
    members,
    work: {
      db: {
        collection: vi.fn(
          (name: string) =>
            ({
              [COLLECTIONS.contexts]: contexts,
              [COLLECTIONS.contextMembers]: members,
              [COLLECTIONS.groups]: groups,
            })[name],
        ),
      },
    } as unknown as MongoUnitOfWork,
  };
}

describe('Mongo context access fencing', () => {
  it('increments the active context mutation version before a locked writable access', async () => {
    const { contexts, work } = workWith({
      _id: contextId,
      type: 'GROUP',
      status: 'ACTIVE',
      defaultCurrencyCode: 'INR',
      mutationVersion: 4,
    });
    const repository = new ContextAccessRepository({} as MongoService);

    await expect(
      repository.requireActiveMember(work, contextId, participantId, {
        lock: true,
        writable: true,
      }),
    ).resolves.toMatchObject({ contextId, groupId, role: 'OWNER', version: '4' });
    expect(contexts.updateOne).toHaveBeenCalledWith(
      { _id: contextId, status: 'ACTIVE' },
      expect.objectContaining({ $inc: { mutationVersion: 1 } }),
      expect.anything(),
    );
    expect(contexts.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      contexts.findOne.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not fence an archived writable context and returns the archived conflict', async () => {
    const { contexts, work } = workWith({
      _id: contextId,
      type: 'GROUP',
      status: 'ARCHIVED',
      defaultCurrencyCode: 'INR',
      mutationVersion: 4,
    });
    const repository = new ContextAccessRepository({} as MongoService);

    await expect(
      repository.requireActiveMember(work, contextId, participantId, {
        lock: true,
        writable: true,
      }),
    ).rejects.toMatchObject({ code: 'CONTEXT_ARCHIVED', status: 409 });
    expect(contexts.updateOne).toHaveBeenCalledWith(
      { _id: contextId, status: 'ACTIVE' },
      expect.anything(),
      expect.anything(),
    );
  });

  it('uses the same concealed error for a missing group and an inaccessible group', async () => {
    const { members, work } = workWith({
      _id: contextId,
      type: 'GROUP',
      status: 'ACTIVE',
      defaultCurrencyCode: 'INR',
      mutationVersion: 4,
    });
    members.findOne.mockResolvedValueOnce(null);
    const repository = new ContextAccessRepository({} as MongoService);

    await expect(repository.contextIdForGroup(work, groupId, participantId)).rejects.toMatchObject({
      code: 'GROUP_NOT_FOUND',
      status: 404,
    });
  });
});
