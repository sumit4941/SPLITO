import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import {
  COLLECTIONS,
  MongoService,
  mongoOptions,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';
import { participantAvatarUrl } from '../media/media.types.js';
import type { GroupMember } from './groups.repository.js';

type AccountStatus = 'PENDING' | 'ACTIVE' | 'LOCKED' | 'DELETION_PENDING' | 'ANONYMIZED';
type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

interface ContextDocument {
  _id: string;
  status: 'ACTIVE' | 'ARCHIVED';
  mutationVersion: number;
  updatedAt: Date;
}

interface GroupDocument {
  _id: string;
  contextId: string;
  name: string;
}

interface UserDocument {
  _id: string;
  mobileE164?: string;
  mobileVerifiedAt?: Date;
  status: AccountStatus;
  avatarKey?: string;
}

interface ParticipantDocument {
  _id: string;
  userId?: string;
  kind: 'USER' | 'GUEST';
  displayName: string;
}

interface ContextMemberDocument {
  _id: string;
  contextId: string;
  participantId: string;
  role: MemberRole;
  status: 'ACTIVE' | 'FORMER';
  allocationOrder: number;
  addedByParticipantId: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface InvitationDocument {
  _id: string;
  invitationType: 'GROUP';
  contextId: string;
  inviterParticipantId: string;
  inviteeMobileE164: string;
  inviteeParticipantId?: string;
  tokenHash: Buffer;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: Date;
  resendCount: number;
  respondedAt?: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface MediaDocument {
  _id: string;
  ownerUserId?: string;
  storageKey: string;
  mediaKind: 'USER_AVATAR' | 'GROUP_IMAGE';
  status: 'ACTIVE' | 'SUPERSEDED' | 'DELETED';
}

interface EventDocument {
  _id: string;
  [key: string]: unknown;
}

export interface ManagedGroup {
  readonly contextId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly status: ContextDocument['status'];
  readonly callerRole: MemberRole;
}

export interface RegisteredTarget {
  readonly userId: string;
  readonly participantId: string;
  readonly displayName: string;
  readonly status: AccountStatus;
  readonly mobileVerified: boolean;
  readonly mobileNumber?: string;
  readonly avatarUrl?: string;
}

export interface InvitationPreview {
  readonly invitationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly inviterDisplayName: string;
  readonly expiresAt: string;
}

@Injectable()
export class GroupInvitationsRepository {
  constructor(private readonly mongo: MongoService) {}

  async lockManagedGroup(
    work: MongoUnitOfWork,
    groupId: string,
    callerParticipantId: string,
  ): Promise<ManagedGroup | undefined> {
    const options = mongoOptions(work);
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ _id: groupId.toLowerCase() }, options);
    if (!group) return undefined;
    const context = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .findOne({ _id: group.contextId }, options);
    const membership = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: group.contextId,
          participantId: callerParticipantId.toLowerCase(),
          status: 'ACTIVE',
        },
        options,
      );
    return context && membership
      ? {
          contextId: context._id,
          groupId: group._id,
          groupName: group.name,
          status: context.status,
          callerRole: membership.role,
        }
      : undefined;
  }

  async findRegisteredTarget(
    work: MongoUnitOfWork,
    mobileNumber: string,
  ): Promise<RegisteredTarget | undefined> {
    const options = mongoOptions(work);
    const user = await work.db
      .collection<UserDocument>(COLLECTIONS.users)
      .findOne({ mobileE164: mobileNumber }, options);
    if (!user) return undefined;
    const participant = await work.db
      .collection<ParticipantDocument>(COLLECTIONS.participants)
      .findOne({ userId: user._id, kind: 'USER' }, options);
    if (!participant) return undefined;
    const avatar = user.avatarKey
      ? await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
          {
            ownerUserId: user._id,
            storageKey: user.avatarKey,
            mediaKind: 'USER_AVATAR',
            status: 'ACTIVE',
          },
          options,
        )
      : undefined;
    return {
      userId: user._id,
      participantId: participant._id,
      displayName: participant.displayName,
      status: user.status,
      mobileVerified: Boolean(user.mobileVerifiedAt),
      ...(user.mobileE164 ? { mobileNumber: user.mobileE164 } : {}),
      ...(avatar ? { avatarUrl: participantAvatarUrl(participant._id, avatar._id) } : {}),
    };
  }

  async ensureRegisteredMember(
    work: MongoUnitOfWork,
    values: {
      readonly group: ManagedGroup;
      readonly target: RegisteredTarget;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly member: GroupMember; readonly created: boolean }> {
    const options = mongoOptions(work);
    const members = work.db.collection<ContextMemberDocument>(COLLECTIONS.contextMembers);
    const existing = await members.findOne(
      {
        contextId: values.group.contextId,
        participantId: values.target.participantId,
        status: 'ACTIVE',
      },
      options,
    );
    if (existing) {
      await this.revokePendingInvitations(
        work,
        values.group.contextId,
        values.target.participantId,
      );
      return {
        member: this.memberResponse(values.target, existing.role, existing.allocationOrder),
        created: false,
      };
    }

    await this.bumpContextVersion(work, values.group.contextId);
    const lastMember = await members
      .find({ contextId: values.group.contextId }, options)
      .sort({ allocationOrder: -1, _id: -1 })
      .limit(1)
      .next();
    const allocationOrder = (lastMember?.allocationOrder ?? -1) + 1;
    const membershipId = randomUUID();
    const now = new Date();
    await members.insertOne(
      {
        _id: membershipId,
        contextId: values.group.contextId,
        participantId: values.target.participantId,
        role: 'MEMBER',
        status: 'ACTIVE',
        allocationOrder,
        addedByParticipantId: values.actorParticipantId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      options,
    );
    await this.revokePendingInvitations(work, values.group.contextId, values.target.participantId);
    await this.insertOutbox(work, {
      eventType: 'group.member.added',
      aggregateType: 'GROUP',
      aggregateId: values.group.groupId,
      payload: {
        groupId: values.group.groupId,
        contextId: values.group.contextId,
        membershipId,
        participantId: values.target.participantId,
      },
    });
    await this.insertAudit(work, {
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      actionKey: 'group.member.add',
      resourceType: 'MEMBERSHIP',
      resourceId: membershipId,
      contextId: values.group.contextId,
      requestId: values.requestId,
      metadata: { targetParticipantId: values.target.participantId },
    });
    return {
      member: this.memberResponse(values.target, 'MEMBER', allocationOrder),
      created: true,
    };
  }

  async issueInvitation(
    work: MongoUnitOfWork,
    values: {
      readonly group: ManagedGroup;
      readonly mobileNumber: string;
      readonly tokenHash: Buffer;
      readonly expiresAt: Date;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly invitationId: string; readonly resend: boolean }> {
    const options = mongoOptions(work);
    const invitations = work.db.collection<InvitationDocument>(COLLECTIONS.invitations);
    await this.bumpContextVersion(work, values.group.contextId);
    const now = new Date();
    const pending = await invitations.findOne(
      {
        invitationType: 'GROUP',
        contextId: values.group.contextId,
        inviteeMobileE164: values.mobileNumber,
        status: 'PENDING',
      },
      options,
    );
    const renewExpired = Boolean(pending && pending.expiresAt <= now);
    if (pending && !renewExpired && pending.resendCount >= 5) {
      throw new ApiError(
        429,
        'INVITATION_RESEND_LIMIT',
        'This invitation has reached its resend limit. Revoke it before creating another.',
      );
    }

    const invitationId = pending?._id ?? randomUUID();
    if (pending) {
      const updated = await invitations.updateOne(
        { _id: pending._id, status: 'PENDING' },
        {
          $set: {
            inviterParticipantId: values.actorParticipantId,
            tokenHash: Buffer.from(values.tokenHash),
            expiresAt: values.expiresAt,
            updatedAt: now,
            ...(renewExpired ? { status: 'PENDING' as const, resendCount: 0 } : {}),
          },
          ...(!renewExpired ? { $inc: { resendCount: 1 } } : {}),
          ...(renewExpired ? { $unset: { respondedAt: '', revokedAt: '' } } : {}),
        },
        options,
      );
      if (updated.modifiedCount !== 1) throw new Error('Invitation resend was not persisted');
    } else {
      await invitations.insertOne(
        {
          _id: invitationId,
          invitationType: 'GROUP',
          contextId: values.group.contextId,
          inviterParticipantId: values.actorParticipantId,
          inviteeMobileE164: values.mobileNumber,
          tokenHash: Buffer.from(values.tokenHash),
          status: 'PENDING',
          expiresAt: values.expiresAt,
          resendCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        options,
      );
    }
    await this.insertOutbox(work, {
      eventType: 'group.invitation.requested',
      aggregateType: 'INVITATION',
      aggregateId: invitationId,
      payload: { invitationId, groupId: values.group.groupId },
    });
    await this.insertAudit(work, {
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      actionKey: pending && !renewExpired ? 'group.invitation.resend' : 'group.invitation.create',
      resourceType: 'INVITATION',
      resourceId: invitationId,
      contextId: values.group.contextId,
      requestId: values.requestId,
      metadata: { deliveryChannel: 'sms' },
    });
    return { invitationId, resend: Boolean(pending && !renewExpired) };
  }

  async preview(
    work: MongoUnitOfWork,
    tokenHash: Buffer,
    mobileNumber: string,
  ): Promise<InvitationPreview | undefined> {
    const invitation = await work.db
      .collection<InvitationDocument>(COLLECTIONS.invitations)
      .findOne(
        {
          invitationType: 'GROUP',
          tokenHash,
          inviteeMobileE164: mobileNumber,
          status: 'PENDING',
          expiresAt: { $gt: new Date() },
        },
        mongoOptions(work),
      );
    if (!invitation) return undefined;
    return this.previewForInvitation(work, invitation);
  }

  async invitationLocator(
    work: MongoUnitOfWork,
    tokenHash: Buffer,
    mobileNumber: string,
  ): Promise<{ readonly invitationId: string; readonly contextId: string } | undefined> {
    const invitation = await work.db
      .collection<InvitationDocument>(COLLECTIONS.invitations)
      .findOne(
        {
          invitationType: 'GROUP',
          tokenHash,
          inviteeMobileE164: mobileNumber,
          status: { $in: ['PENDING', 'ACCEPTED'] },
        },
        { ...mongoOptions(work), projection: { _id: 1, contextId: 1 } },
      );
    return invitation
      ? { invitationId: invitation._id, contextId: invitation.contextId }
      : undefined;
  }

  async accept(
    work: MongoUnitOfWork,
    values: {
      readonly locator: { readonly invitationId: string; readonly contextId: string };
      readonly tokenHash: Buffer;
      readonly mobileNumber: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly preview: InvitationPreview; readonly member: GroupMember } | undefined> {
    const options = mongoOptions(work);
    const context = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .findOne({ _id: values.locator.contextId, status: 'ACTIVE' }, options);
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ contextId: values.locator.contextId }, options);
    const invitation = await work.db
      .collection<InvitationDocument>(COLLECTIONS.invitations)
      .findOne(
        {
          _id: values.locator.invitationId,
          contextId: values.locator.contextId,
          invitationType: 'GROUP',
          tokenHash: values.tokenHash,
          inviteeMobileE164: values.mobileNumber,
          status: { $in: ['PENDING', 'ACCEPTED'] },
        },
        options,
      );
    if (!context || !group || !invitation) return undefined;

    const inviterMembership = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: invitation.contextId,
          participantId: invitation.inviterParticipantId,
          status: 'ACTIVE',
          role: { $in: ['OWNER', 'ADMIN'] },
        },
        options,
      );
    const now = new Date();
    if (invitation.status === 'PENDING' && (invitation.expiresAt <= now || !inviterMembership)) {
      const status = invitation.expiresAt <= now ? 'EXPIRED' : 'REVOKED';
      await work.db.collection<InvitationDocument>(COLLECTIONS.invitations).updateOne(
        { _id: invitation._id, status: 'PENDING' },
        {
          $set: {
            status,
            respondedAt: now,
            updatedAt: now,
            ...(status === 'REVOKED' ? { revokedAt: now } : {}),
          },
        },
        options,
      );
      return undefined;
    }

    const user = await work.db.collection<UserDocument>(COLLECTIONS.users).findOne(
      {
        _id: values.actorUserId,
        mobileE164: values.mobileNumber,
        mobileVerifiedAt: { $type: 'date' },
        status: 'ACTIVE',
      },
      options,
    );
    const participant = user
      ? await work.db
          .collection<ParticipantDocument>(COLLECTIONS.participants)
          .findOne({ _id: values.actorParticipantId, userId: user._id, kind: 'USER' }, options)
      : undefined;
    if (!user || !participant) return undefined;
    if (invitation.status === 'ACCEPTED' && invitation.inviteeParticipantId !== participant._id) {
      return undefined;
    }
    const target = await this.targetFromDocuments(work, user, participant);
    const members = work.db.collection<ContextMemberDocument>(COLLECTIONS.contextMembers);
    let membership = await members.findOne(
      {
        contextId: invitation.contextId,
        participantId: participant._id,
        status: 'ACTIVE',
      },
      options,
    );
    if (invitation.status === 'ACCEPTED') {
      if (!membership) return undefined;
      const replayPreview = await this.mapPreviewDocuments(work, invitation, group);
      return replayPreview
        ? {
            preview: replayPreview,
            member: this.memberResponse(target, membership.role, membership.allocationOrder),
          }
        : undefined;
    }

    await this.bumpContextVersion(work, invitation.contextId);
    let membershipId: string | undefined;
    if (!membership) {
      const lastMember = await members
        .find({ contextId: invitation.contextId }, options)
        .sort({ allocationOrder: -1, _id: -1 })
        .limit(1)
        .next();
      const allocationOrder = (lastMember?.allocationOrder ?? -1) + 1;
      membershipId = randomUUID();
      membership = {
        _id: membershipId,
        contextId: invitation.contextId,
        participantId: participant._id,
        role: 'MEMBER',
        status: 'ACTIVE',
        allocationOrder,
        addedByParticipantId: invitation.inviterParticipantId,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await members.insertOne(membership, options);
    }

    const accepted = await work.db
      .collection<InvitationDocument>(COLLECTIONS.invitations)
      .updateOne(
        { _id: invitation._id, status: 'PENDING' },
        {
          $set: {
            status: 'ACCEPTED',
            inviteeParticipantId: participant._id,
            respondedAt: now,
            updatedAt: now,
          },
        },
        options,
      );
    if (accepted.modifiedCount !== 1) throw new Error('Invitation acceptance was not persisted');
    await this.insertOutbox(work, {
      eventType: 'group.invitation.accepted',
      aggregateType: 'INVITATION',
      aggregateId: invitation._id,
      payload: {
        invitationId: invitation._id,
        groupId: group._id,
        participantId: participant._id,
      },
    });
    await this.insertAudit(work, {
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      actionKey: 'group.invitation.accept',
      resourceType: 'INVITATION',
      resourceId: invitation._id,
      contextId: invitation.contextId,
      requestId: values.requestId,
      metadata: membershipId ? { membershipId } : { membershipAlreadyActive: true },
    });
    const acceptedPreview = await this.mapPreviewDocuments(work, invitation, group);
    return acceptedPreview
      ? {
          preview: acceptedPreview,
          member: this.memberResponse(target, membership.role, membership.allocationOrder),
        }
      : undefined;
  }

  private async previewForInvitation(
    work: MongoUnitOfWork,
    invitation: InvitationDocument,
  ): Promise<InvitationPreview | undefined> {
    const options = mongoOptions(work);
    const context = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .findOne({ _id: invitation.contextId, status: 'ACTIVE' }, options);
    const group = await work.db
      .collection<GroupDocument>(COLLECTIONS.groups)
      .findOne({ contextId: invitation.contextId }, options);
    const inviterMembership = await work.db
      .collection<ContextMemberDocument>(COLLECTIONS.contextMembers)
      .findOne(
        {
          contextId: invitation.contextId,
          participantId: invitation.inviterParticipantId,
          status: 'ACTIVE',
          role: { $in: ['OWNER', 'ADMIN'] },
        },
        options,
      );
    if (!context || !group || !inviterMembership) return undefined;
    return this.mapPreviewDocuments(work, invitation, group);
  }

  private async mapPreviewDocuments(
    work: MongoUnitOfWork,
    invitation: InvitationDocument,
    group: GroupDocument,
  ): Promise<InvitationPreview | undefined> {
    const inviter = await work.db
      .collection<ParticipantDocument>(COLLECTIONS.participants)
      .findOne({ _id: invitation.inviterParticipantId }, mongoOptions(work));
    return inviter
      ? {
          invitationId: invitation._id,
          groupId: group._id,
          groupName: group.name,
          inviterDisplayName: inviter.displayName,
          expiresAt: invitation.expiresAt.toISOString(),
        }
      : undefined;
  }

  private async targetFromDocuments(
    work: MongoUnitOfWork,
    user: UserDocument,
    participant: ParticipantDocument,
  ): Promise<RegisteredTarget> {
    const avatar = user.avatarKey
      ? await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
          {
            ownerUserId: user._id,
            storageKey: user.avatarKey,
            mediaKind: 'USER_AVATAR',
            status: 'ACTIVE',
          },
          mongoOptions(work),
        )
      : undefined;
    return {
      userId: user._id,
      participantId: participant._id,
      displayName: participant.displayName,
      status: user.status,
      mobileVerified: Boolean(user.mobileVerifiedAt),
      ...(user.mobileE164 ? { mobileNumber: user.mobileE164 } : {}),
      ...(avatar ? { avatarUrl: participantAvatarUrl(participant._id, avatar._id) } : {}),
    };
  }

  private memberResponse(
    target: RegisteredTarget,
    role: MemberRole,
    allocationOrder: number,
  ): GroupMember {
    return {
      id: target.participantId,
      displayName: target.displayName,
      ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
      kind: 'USER',
      role: role === 'OWNER' ? 'owner' : role === 'ADMIN' ? 'administrator' : 'member',
      status: 'active',
      allocationOrder,
    };
  }

  private async revokePendingInvitations(
    work: MongoUnitOfWork,
    contextId: string,
    inviteeParticipantId: string,
  ): Promise<void> {
    const options = mongoOptions(work);
    const participant = await work.db
      .collection<ParticipantDocument>(COLLECTIONS.participants)
      .findOne({ _id: inviteeParticipantId }, options);
    const user = participant?.userId
      ? await work.db
          .collection<UserDocument>(COLLECTIONS.users)
          .findOne({ _id: participant.userId }, options)
      : undefined;
    if (!user?.mobileE164) return;
    const now = new Date();
    await work.db.collection<InvitationDocument>(COLLECTIONS.invitations).updateMany(
      {
        invitationType: 'GROUP',
        contextId,
        status: 'PENDING',
        inviteeMobileE164: user.mobileE164,
      },
      {
        $set: {
          status: 'REVOKED',
          inviteeParticipantId,
          respondedAt: now,
          revokedAt: now,
          updatedAt: now,
        },
      },
      options,
    );
  }

  private async bumpContextVersion(work: MongoUnitOfWork, contextId: string): Promise<void> {
    const result = await work.db
      .collection<ContextDocument>(COLLECTIONS.contexts)
      .updateOne(
        { _id: contextId, status: 'ACTIVE' },
        { $inc: { mutationVersion: 1 }, $set: { updatedAt: new Date() } },
        mongoOptions(work),
      );
    if (result.matchedCount !== 1) throw new Error('Group context version was not updated');
  }

  private async insertOutbox(
    work: MongoUnitOfWork,
    values: {
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly payload: unknown;
    },
  ): Promise<void> {
    const now = new Date();
    await work.db.collection<EventDocument>(COLLECTIONS.outbox).insertOne(
      {
        _id: randomUUID(),
        eventType: values.eventType,
        aggregateType: values.aggregateType,
        aggregateId: values.aggregateId,
        payload: values.payload,
        status: 'PENDING',
        availableAt: now,
        attempts: 0,
        createdAt: now,
      },
      mongoOptions(work),
    );
  }

  private async insertAudit(
    work: MongoUnitOfWork,
    values: {
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly actionKey: string;
      readonly resourceType: string;
      readonly resourceId: string;
      readonly contextId: string;
      readonly requestId: string;
      readonly metadata: unknown;
    },
  ): Promise<void> {
    await work.db.collection<EventDocument>(COLLECTIONS.auditEvents).insertOne(
      {
        _id: randomUUID(),
        actorParticipantId: values.actorParticipantId,
        actorUserId: values.actorUserId,
        actionKey: values.actionKey,
        resourceType: values.resourceType,
        resourceId: values.resourceId,
        contextId: values.contextId,
        requestId: values.requestId,
        metadata: values.metadata,
        createdAt: new Date(),
      },
      mongoOptions(work),
    );
  }
}
