import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { generateOpaqueToken, sha256 } from '../auth/auth.crypto.js';
import { maskMobileNumber } from '../auth/auth.service.js';
import { ApiError } from '../common/api-error.js';
import { OracleService } from '../database/oracle.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  GroupInvitationsRepository,
  type InvitationPreview,
  type ManagedGroup,
} from './group-invitations.repository.js';
import { GroupsRepository, type GroupMember, type GroupSummary } from './groups.repository.js';
import type {
  AddGroupMemberInput,
  CreateGroupInput,
  GroupInvitationTokenInput,
} from './groups.schemas.js';
import { InvitationSmsService } from './invitation-sms.service.js';

const INVITATION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

@Injectable()
export class GroupsService {
  constructor(
    private readonly repository: GroupsRepository,
    private readonly invitations: GroupInvitationsRepository,
    private readonly invitationSms: InvitationSmsService,
    private readonly oracle: OracleService,
  ) {}

  list(auth: AuthContext): Promise<GroupSummary[]> {
    return this.repository.list(auth.user.participantId);
  }

  create(input: CreateGroupInput, auth: AuthContext, requestId: string): Promise<GroupSummary> {
    return this.oracle.withTransaction((connection) =>
      this.repository.create(connection, {
        ...input,
        groupId: randomUUID(),
        contextId: randomUUID(),
        membershipId: randomUUID(),
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        requestId,
        outboxId: randomUUID(),
        auditId: randomUUID(),
      }),
    );
  }

  async detail(
    groupId: string,
    auth: AuthContext,
  ): Promise<NonNullable<Awaited<ReturnType<GroupsRepository['detail']>>>> {
    const detail = await this.oracle.withConnection((connection) =>
      this.repository.detail(connection, groupId, auth.user.participantId),
    );
    if (!detail) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    return detail;
  }

  async addMember(
    groupId: string,
    input: AddGroupMemberInput,
    auth: AuthContext,
    requestId: string,
  ): Promise<
    | {
        readonly outcome: 'member_added';
        readonly member: Awaited<
          ReturnType<GroupInvitationsRepository['ensureRegisteredMember']>
        >['member'];
      }
    | {
        readonly outcome: 'invitation_sent';
        readonly invitation: {
          readonly id: string;
          readonly maskedMobileNumber: string;
          readonly expiresAt: string;
          readonly status: 'pending';
        };
        readonly developmentJoinUrl?: string;
      }
  > {
    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MILLISECONDS);
    const result = await this.oracle.withTransaction(async (connection) => {
      const group = await this.invitations.lockManagedGroup(
        connection,
        groupId,
        auth.user.participantId,
      );
      this.requireManager(group);

      const target = await this.invitations.findRegisteredTarget(connection, input.mobileNumber);
      if (target) {
        if (target.status !== 'ACTIVE' || !target.mobileVerified) {
          throw new ApiError(
            409,
            'INVITEE_ACCOUNT_UNAVAILABLE',
            'This mobile number belongs to an account that is not available for group membership.',
          );
        }
        const membership = await this.invitations.ensureRegisteredMember(connection, {
          group,
          target,
          actorParticipantId: auth.user.participantId,
          actorUserId: auth.user.userId,
          requestId,
        });
        return { kind: 'member' as const, member: membership.member };
      }

      // Fail before persisting an invitation when carrier delivery is unavailable.
      this.invitationSms.assertAvailable();
      const invitation = await this.invitations.issueInvitation(connection, {
        group,
        mobileNumber: input.mobileNumber,
        tokenHash: sha256(token),
        expiresAt,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        requestId,
      });
      return { kind: 'invitation' as const, group, invitation };
    });

    if (result.kind === 'member') {
      return { outcome: 'member_added', member: result.member };
    }

    const delivery = await this.invitationSms.deliver({
      invitationId: result.invitation.invitationId,
      mobileNumber: input.mobileNumber,
      groupName: result.group.groupName,
      inviterDisplayName: auth.user.displayName,
      token,
    });
    return {
      outcome: 'invitation_sent',
      invitation: {
        id: result.invitation.invitationId,
        maskedMobileNumber: maskMobileNumber(input.mobileNumber),
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
      },
      ...(delivery.mode === 'development_capture'
        ? { developmentJoinUrl: delivery.inviteUrl }
        : {}),
    };
  }

  async previewInvitation(
    input: GroupInvitationTokenInput,
    auth: AuthContext,
  ): Promise<InvitationPreview> {
    const mobileNumber = this.requireVerifiedMobile(auth);
    const invitation = await this.oracle.withConnection((connection) =>
      this.invitations.preview(connection, sha256(input.token), mobileNumber),
    );
    if (!invitation) this.invalidInvitation();
    return invitation;
  }

  async acceptInvitation(
    input: GroupInvitationTokenInput,
    auth: AuthContext,
    requestId: string,
  ): Promise<{
    readonly outcome: 'joined';
    readonly groupId: string;
    readonly groupName: string;
    readonly member: GroupMember;
  }> {
    const mobileNumber = this.requireVerifiedMobile(auth);
    const tokenHash = sha256(input.token);
    const result = await this.oracle.withTransaction(async (connection) => {
      const locator = await this.invitations.invitationLocator(connection, tokenHash, mobileNumber);
      if (!locator) return undefined;
      return this.invitations.accept(connection, {
        locator,
        tokenHash,
        mobileNumber,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        requestId,
      });
    });
    if (!result) this.invalidInvitation();
    return {
      outcome: 'joined',
      groupId: result.preview.groupId,
      groupName: result.preview.groupName,
      member: result.member,
    };
  }

  private requireManager(group: ManagedGroup | undefined): asserts group is ManagedGroup {
    if (!group) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    if (group.status !== 'ACTIVE') {
      throw new ApiError(409, 'GROUP_ARCHIVED', 'Archived groups are read-only until restored.');
    }
    if (group.callerRole !== 'OWNER' && group.callerRole !== 'ADMIN') {
      throw new ApiError(
        403,
        'GROUP_MEMBERSHIP_FORBIDDEN',
        'Only group owners and administrators can add or invite members.',
      );
    }
  }

  private requireVerifiedMobile(auth: AuthContext): string {
    if (!auth.user.mobileNumber) this.invalidInvitation();
    return auth.user.mobileNumber;
  }

  private invalidInvitation(): never {
    throw new ApiError(
      404,
      'GROUP_INVITATION_NOT_FOUND',
      'The invitation is invalid, expired, or not available to this account.',
    );
  }
}
