import { Injectable } from '@nestjs/common';
import {
  COLLECTIONS,
  MongoService,
  mongoOptions,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';
import { groupImageUrl, participantAvatarUrl } from '../media/media.types.js';
import type { CreateGroupInput } from './groups.schemas.js';

export interface GroupSummary {
  readonly id: string;
  readonly contextId: string;
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly type: string;
  readonly defaultCurrency: string;
  readonly simplificationEnabled: boolean;
  readonly archived: boolean;
  readonly role: 'owner' | 'administrator' | 'member';
  readonly memberCount: number;
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GroupMember {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  readonly kind: 'USER' | 'GUEST';
  readonly role: 'owner' | 'administrator' | 'member' | 'guest';
  readonly status: 'active' | 'former';
  readonly allocationOrder: number;
}

export interface PendingGroupInvitation {
  readonly id: string;
  readonly maskedMobileNumber: string;
  readonly expiresAt: string;
  readonly status: 'pending';
}

interface ContextDocument {
  _id: string;
  type: 'GROUP' | 'DIRECT' | 'PERSONAL';
  defaultCurrencyCode: string;
  simplificationEnabled: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  mutationVersion: number;
  createdByParticipantId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface GroupDocument {
  _id: string;
  contextId: string;
  name: string;
  description?: string;
  type: string;
  status: 'ACTIVE' | 'ARCHIVED';
  imageKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ContextMemberDocument {
  _id: string;
  contextId: string;
  participantId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'FORMER';
  allocationOrder: number;
  addedByParticipantId: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ParticipantDocument {
  _id: string;
  userId?: string;
  kind: 'USER' | 'GUEST';
  displayName: string;
}

interface UserDocument {
  _id: string;
  avatarKey?: string;
}

interface MediaDocument {
  _id: string;
  ownerUserId?: string;
  ownerGroupId?: string;
  storageKey: string;
  mediaKind: 'USER_AVATAR' | 'GROUP_IMAGE';
  status: 'ACTIVE' | 'SUPERSEDED' | 'DELETED';
}

interface InvitationDocument {
  _id: string;
  invitationType: 'GROUP';
  contextId: string;
  inviteeMobileE164?: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
}

interface EventDocument {
  _id: string;
  [key: string]: unknown;
}

function roleToJson(role: ContextMemberDocument['role']): GroupSummary['role'] {
  return role === 'OWNER' ? 'owner' : role === 'ADMIN' ? 'administrator' : 'member';
}

function maskMobileNumber(mobileNumber: string): string {
  const visibleDigits = mobileNumber.slice(-4);
  return `+${'*'.repeat(Math.max(4, mobileNumber.length - 5))}${visibleDigits}`;
}

function mapGroup(
  group: GroupDocument,
  context: ContextDocument,
  membership: ContextMemberDocument,
  memberCount: number,
  imageId?: string,
): GroupSummary {
  return {
    id: group._id,
    contextId: context._id,
    name: group.name,
    ...(group.description ? { description: group.description } : {}),
    ...(imageId ? { imageUrl: groupImageUrl(group._id, imageId) } : {}),
    type: group.type.toLowerCase(),
    defaultCurrency: context.defaultCurrencyCode,
    simplificationEnabled: context.simplificationEnabled,
    archived: context.status === 'ARCHIVED',
    role: roleToJson(membership.role),
    memberCount,
    version: String(context.mutationVersion),
    createdAt: context.createdAt.toISOString(),
    updatedAt: context.updatedAt.toISOString(),
  };
}

@Injectable()
export class GroupsRepository {
  constructor(private readonly mongo: MongoService) {}

  async list(participantId: string): Promise<GroupSummary[]> {
    return this.mongo.withTransaction(async (work) => {
      const options = mongoOptions(work);
      const memberships = await work.db
        .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
        .find({ participantId: participantId.toLowerCase(), status: 'ACTIVE' }, options)
        .toArray();
      if (memberships.length === 0) return [];
      const contextIds = memberships.map((membership) => membership.contextId);
      const contexts = await work.db
        .collection<ContextDocument>(COLLECTIONS.contexts)
        .find({ _id: { $in: contextIds }, type: 'GROUP' }, options)
        .toArray();
      const groups = await work.db
        .collection<GroupDocument>(COLLECTIONS.groups)
        .find({ contextId: { $in: contextIds } }, options)
        .toArray();
      const counts = await work.db
        .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
        .aggregate<{ _id: string; count: number }>(
          [
            { $match: { contextId: { $in: contextIds }, status: 'ACTIVE' } },
            { $group: { _id: '$contextId', count: { $sum: 1 } } },
          ],
          options,
        )
        .toArray();
      const contextById = new Map(contexts.map((context) => [context._id, context]));
      const membershipByContext = new Map(
        memberships.map((membership) => [membership.contextId, membership]),
      );
      const countByContext = new Map(counts.map((entry) => [entry._id, entry.count]));
      const activeImages = await this.activeGroupImages(work, groups);
      return groups
        .map((group) => {
          const context = contextById.get(group.contextId);
          const membership = membershipByContext.get(group.contextId);
          if (!context || !membership) return undefined;
          return mapGroup(
            group,
            context,
            membership,
            countByContext.get(group.contextId) ?? 0,
            activeImages.get(group._id),
          );
        })
        .filter((group): group is GroupSummary => Boolean(group))
        .sort((left, right) => {
          const updated = right.updatedAt.localeCompare(left.updatedAt);
          return updated === 0 ? left.id.localeCompare(right.id) : updated;
        });
    });
  }

  async create(
    work: MongoUnitOfWork,
    values: CreateGroupInput & {
      readonly groupId: string;
      readonly contextId: string;
      readonly membershipId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
      readonly outboxId: string;
      readonly auditId: string;
    },
  ): Promise<GroupSummary> {
    const now = new Date();
    const contextId = values.contextId.toLowerCase();
    const groupId = values.groupId.toLowerCase();
    const actorParticipantId = values.actorParticipantId.toLowerCase();
    const options = mongoOptions(work);
    const context: ContextDocument = {
      _id: contextId,
      type: 'GROUP',
      defaultCurrencyCode: values.defaultCurrency,
      simplificationEnabled: values.simplificationEnabled,
      status: 'ACTIVE',
      mutationVersion: 1,
      createdByParticipantId: actorParticipantId,
      createdAt: now,
      updatedAt: now,
    };
    const group: GroupDocument = {
      _id: groupId,
      contextId,
      name: values.name,
      ...(values.description ? { description: values.description } : {}),
      type: values.type.toUpperCase(),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    const membership: ContextMemberDocument = {
      _id: values.membershipId.toLowerCase(),
      contextId,
      participantId: actorParticipantId,
      role: 'OWNER',
      status: 'ACTIVE',
      allocationOrder: 0,
      addedByParticipantId: actorParticipantId,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await work.db.collection<ContextDocument>(COLLECTIONS.contexts).insertOne(context, options);
    await work.db.collection<GroupDocument>(COLLECTIONS.groups).insertOne(group, options);
    await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .insertOne(membership, options);
    await work.db.collection<EventDocument>(COLLECTIONS.outbox).insertOne(
      {
        _id: values.outboxId.toLowerCase(),
        eventType: 'group.created',
        aggregateType: 'GROUP',
        aggregateId: groupId,
        payload: { groupId, contextId },
        status: 'PENDING',
        availableAt: now,
        attempts: 0,
        createdAt: now,
      },
      options,
    );
    await work.db.collection<EventDocument>(COLLECTIONS.auditEvents).insertOne(
      {
        _id: values.auditId.toLowerCase(),
        actorParticipantId,
        actorUserId: values.actorUserId.toLowerCase(),
        actionKey: 'group.create',
        resourceType: 'GROUP',
        resourceId: groupId,
        contextId,
        requestId: values.requestId,
        metadata: {},
        createdAt: now,
      },
      options,
    );
    return mapGroup(group, context, membership, 1);
  }

  async detail(
    work: MongoUnitOfWork,
    groupId: string,
    participantId: string,
  ): Promise<
    | {
        group: GroupSummary;
        members: GroupMember[];
        pendingInvitations: PendingGroupInvitation[];
      }
    | undefined
  > {
    const options = mongoOptions(work);
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ _id: groupId.toLowerCase() }, options);
    if (!group) return undefined;
    const context = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .findOne({ _id: group.contextId }, options);
    const callerMembership = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: group.contextId,
          participantId: participantId.toLowerCase(),
          status: 'ACTIVE',
        },
        options,
      );
    const memberships = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .find({ contextId: group.contextId }, options)
      .sort({ allocationOrder: 1, _id: 1 })
      .toArray();
    if (!context || !callerMembership) return undefined;

    const participantIds = memberships.map((membership) => membership.participantId);
    const participants =
      participantIds.length === 0
        ? []
        : await work.db
            .collection<ParticipantDocument>(COLLECTIONS.participants)
            .find({ _id: { $in: participantIds } }, options)
            .toArray();
    const participantById = new Map(
      participants.map((participant) => [participant._id, participant]),
    );
    const userIds = participants.flatMap((participant) =>
      participant.userId ? [participant.userId] : [],
    );
    const users =
      userIds.length === 0
        ? []
        : await work.db
            .collection<UserDocument>(COLLECTIONS.users)
            .find({ _id: { $in: userIds } }, options)
            .toArray();
    const userById = new Map(users.map((user) => [user._id, user]));
    const avatarKeys = users.flatMap((user) => (user.avatarKey ? [user.avatarKey] : []));
    const avatars =
      avatarKeys.length === 0
        ? []
        : await work.db
            .collection<MediaDocument>(COLLECTIONS.mediaObjects)
            .find(
              {
                storageKey: { $in: avatarKeys },
                mediaKind: 'USER_AVATAR',
                status: 'ACTIVE',
              },
              options,
            )
            .toArray();
    const avatarByStorageKey = new Map(avatars.map((avatar) => [avatar.storageKey, avatar._id]));
    const groupImage = await this.activeGroupImage(work, group);

    const members = memberships.flatMap((membership): GroupMember[] => {
      const participant = participantById.get(membership.participantId);
      if (!participant) return [];
      const user = participant.userId ? userById.get(participant.userId) : undefined;
      const avatarId = user?.avatarKey ? avatarByStorageKey.get(user.avatarKey) : undefined;
      return [
        {
          id: participant._id,
          displayName: participant.displayName,
          ...(avatarId ? { avatarUrl: participantAvatarUrl(participant._id, avatarId) } : {}),
          kind: participant.kind,
          role: participant.kind === 'GUEST' ? 'guest' : roleToJson(membership.role),
          status: membership.status === 'ACTIVE' ? 'active' : 'former',
          allocationOrder: membership.allocationOrder,
        },
      ];
    });

    const manager = callerMembership.role === 'OWNER' || callerMembership.role === 'ADMIN';
    const pendingInvitations = manager
      ? await work.db
          .collection<InvitationDocument>(COLLECTIONS.invitations)
          .find(
            {
              contextId: group.contextId,
              invitationType: 'GROUP',
              status: 'PENDING',
              inviteeMobileE164: { $type: 'string' },
              expiresAt: { $gt: new Date() },
            },
            options,
          )
          .sort({ createdAt: -1, _id: 1 })
          .toArray()
      : [];

    return {
      group: mapGroup(
        group,
        context,
        callerMembership,
        members.filter((m) => m.status === 'active').length,
        groupImage?._id,
      ),
      members,
      pendingInvitations: pendingInvitations.flatMap((invitation) =>
        invitation.inviteeMobileE164
          ? [
              {
                id: invitation._id,
                maskedMobileNumber: maskMobileNumber(invitation.inviteeMobileE164),
                expiresAt: invitation.expiresAt.toISOString(),
                status: 'pending' as const,
              },
            ]
          : [],
      ),
    };
  }

  private async activeGroupImages(
    work: MongoUnitOfWork,
    groups: readonly GroupDocument[],
  ): Promise<Map<string, string>> {
    const groupIds = groups.map((group) => group._id);
    if (groupIds.length === 0) return new Map();
    const images = await work.db
      .collection<MediaDocument>(COLLECTIONS.mediaObjects)
      .find(
        { ownerGroupId: { $in: groupIds }, mediaKind: 'GROUP_IMAGE', status: 'ACTIVE' },
        mongoOptions(work),
      )
      .toArray();
    return new Map(images.map((image) => [image.ownerGroupId as string, image._id]));
  }

  private async activeGroupImage(
    work: MongoUnitOfWork,
    group: GroupDocument,
  ): Promise<MediaDocument | undefined> {
    if (!group.imageKey) return undefined;
    return (
      (await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
        {
          ownerGroupId: group._id,
          storageKey: group.imageKey,
          mediaKind: 'GROUP_IMAGE',
          status: 'ACTIVE',
        },
        mongoOptions(work),
      )) ?? undefined
    );
  }
}
