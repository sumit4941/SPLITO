import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import {
  COLLECTIONS,
  MongoService,
  mongoOptions,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';

interface ContextDocument {
  _id: string;
  type: 'GROUP' | 'DIRECT' | 'PERSONAL';
  status: 'ACTIVE' | 'ARCHIVED';
  defaultCurrencyCode: string;
  mutationVersion: number;
  updatedAt?: Date;
}

interface ContextMemberDocument {
  _id: string;
  contextId: string;
  participantId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'FORMER';
  allocationOrder: number;
}

interface GroupDocument {
  _id: string;
  contextId: string;
}

export interface ContextAccess {
  readonly contextId: string;
  readonly contextType: ContextDocument['type'];
  readonly status: ContextDocument['status'];
  readonly defaultCurrency: string;
  readonly version: string;
  readonly role: ContextMemberDocument['role'];
  readonly allocationOrder: number;
  readonly groupId?: string;
}

@Injectable()
export class ContextAccessRepository {
  constructor(private readonly mongo: MongoService) {}

  async requireActiveMember(
    work: MongoUnitOfWork,
    contextId: string,
    participantId: string,
    options: { readonly lock?: boolean; readonly writable?: boolean } = {},
  ): Promise<ContextAccess> {
    const normalizedContextId = contextId.toLowerCase();
    const normalizedParticipantId = participantId.toLowerCase();
    const operationOptions = mongoOptions(work);
    const contexts = work.db.collection<ContextDocument>(COLLECTIONS.contexts);
    if (options.lock) {
      await contexts.updateOne(
        {
          _id: normalizedContextId,
          ...(options.writable ? { status: 'ACTIVE' as const } : {}),
        },
        { $inc: { mutationVersion: 1 }, $set: { updatedAt: new Date() } },
        operationOptions,
      );
    }
    const context = await contexts.findOne({ _id: normalizedContextId }, operationOptions);
    const member = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: normalizedContextId,
          participantId: normalizedParticipantId,
          status: 'ACTIVE',
        },
        operationOptions,
      );
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ contextId: normalizedContextId }, operationOptions);

    if (!context || !member) {
      throw new ApiError(
        404,
        'CONTEXT_NOT_FOUND',
        'The context does not exist or is not accessible.',
      );
    }
    if (options.writable && context.status !== 'ACTIVE') {
      throw new ApiError(
        409,
        'CONTEXT_ARCHIVED',
        'Archived contexts are read-only until restored.',
      );
    }
    return {
      contextId: context._id,
      contextType: context.type,
      status: context.status,
      defaultCurrency: context.defaultCurrencyCode,
      version: String(context.mutationVersion),
      role: member.role,
      allocationOrder: member.allocationOrder,
      ...(group ? { groupId: group._id } : {}),
    };
  }

  async contextIdForGroup(
    work: MongoUnitOfWork,
    groupId: string,
    participantId: string,
    options: { readonly lock?: boolean; readonly writable?: boolean } = {},
  ): Promise<ContextAccess> {
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ _id: groupId.toLowerCase() }, mongoOptions(work));
    if (!group) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    try {
      return await this.requireActiveMember(work, group.contextId, participantId, options);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONTEXT_NOT_FOUND') {
        throw new ApiError(
          404,
          'GROUP_NOT_FOUND',
          'The group does not exist or is not accessible.',
        );
      }
      throw error;
    }
  }
}
