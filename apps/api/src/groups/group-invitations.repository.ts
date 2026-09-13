import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import { ApiError } from '../common/api-error.js';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';
import { participantAvatarUrl } from '../media/media.types.js';
import type { GroupMember } from './groups.repository.js';

interface ManagedGroupRow {
  CONTEXT_ID: Buffer;
  GROUP_ID: Buffer;
  GROUP_NAME: string;
  CONTEXT_STATUS: 'ACTIVE' | 'ARCHIVED';
  MEMBER_ROLE: 'OWNER' | 'ADMIN' | 'MEMBER';
}

interface RegisteredTargetRow {
  USER_ID: Buffer;
  PARTICIPANT_ID: Buffer;
  DISPLAY_NAME: string;
  STATUS: 'PENDING' | 'ACTIVE' | 'LOCKED' | 'DELETION_PENDING' | 'ANONYMIZED';
  VERIFIED_FLAG: 'Y' | 'N';
  AVATAR_MEDIA_ID: Buffer | null;
}

interface ActiveMemberRow {
  MEMBER_ROLE: 'OWNER' | 'ADMIN' | 'MEMBER';
  ALLOCATION_ORDER: string;
}

interface PendingInvitationRow {
  INVITATION_ID: Buffer;
  RESEND_COUNT: string;
  EXPIRED_FLAG: 'Y' | 'N';
}

interface InvitationPreviewRow {
  INVITATION_ID: Buffer;
  CONTEXT_ID: Buffer;
  GROUP_ID: Buffer;
  GROUP_NAME: string;
  INVITER_DISPLAY_NAME: string;
  EXPIRES_AT_TEXT: string;
}

interface InvitationLocatorRow {
  INVITATION_ID: Buffer;
  CONTEXT_ID: Buffer;
}

interface LockedInvitationRow extends InvitationPreviewRow {
  INVITER_PARTICIPANT_ID: Buffer;
  INVITEE_PARTICIPANT_ID: Buffer | null;
  STATUS: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED' | 'EXPIRED';
  EXPIRED_FLAG: 'Y' | 'N';
  INVITER_AUTHORIZED_FLAG: 'Y' | 'N';
}

export interface ManagedGroup {
  readonly contextId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly status: ManagedGroupRow['CONTEXT_STATUS'];
  readonly callerRole: ManagedGroupRow['MEMBER_ROLE'];
}

export interface RegisteredTarget {
  readonly userId: string;
  readonly participantId: string;
  readonly displayName: string;
  readonly status: RegisteredTargetRow['STATUS'];
  readonly mobileVerified: boolean;
  readonly avatarUrl?: string;
}

export interface InvitationPreview {
  readonly invitationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly inviterDisplayName: string;
  readonly expiresAt: string;
}

const invitationTimestamp = `TO_CHAR(I.EXPIRES_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"')`;

@Injectable()
export class GroupInvitationsRepository {
  constructor(private readonly oracle: OracleService) {}

  async lockManagedGroup(
    connection: Connection,
    groupId: string,
    callerParticipantId: string,
  ): Promise<ManagedGroup | undefined> {
    const result = await this.oracle.execute<ManagedGroupRow>(
      connection,
      `SELECT C.CONTEXT_ID, G.GROUP_ID, G.GROUP_NAME,
              C.STATUS AS CONTEXT_STATUS, CALLER_M.MEMBER_ROLE
         FROM SPLITO_GROUPS G
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = G.CONTEXT_ID
         JOIN SPLITO_CONTEXT_MEMBERS CALLER_M
           ON CALLER_M.CONTEXT_ID = C.CONTEXT_ID
          AND CALLER_M.PARTICIPANT_ID = :callerParticipantId
          AND CALLER_M.STATUS = 'ACTIVE'
        WHERE G.GROUP_ID = :groupId
        FOR UPDATE OF C.STATUS, CALLER_M.STATUS`,
      {
        groupId: uuidToRaw(groupId),
        callerParticipantId: uuidToRaw(callerParticipantId),
      },
    );
    const row = result.rows?.[0];
    return row
      ? {
          contextId: rawToUuid(row.CONTEXT_ID),
          groupId: rawToUuid(row.GROUP_ID),
          groupName: row.GROUP_NAME,
          status: row.CONTEXT_STATUS,
          callerRole: row.MEMBER_ROLE,
        }
      : undefined;
  }

  async findRegisteredTarget(
    connection: Connection,
    mobileNumber: string,
  ): Promise<RegisteredTarget | undefined> {
    const result = await this.oracle.execute<RegisteredTargetRow>(
      connection,
      `SELECT U.USER_ID, P.PARTICIPANT_ID, P.DISPLAY_NAME, U.STATUS,
              CASE WHEN U.MOBILE_VERIFIED_AT_UTC IS NULL THEN 'N' ELSE 'Y' END AS VERIFIED_FLAG,
              AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID
         FROM SPLITO_USERS U
         JOIN SPLITO_PARTICIPANTS P ON P.USER_ID = U.USER_ID AND P.KIND = 'USER'
         LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
           ON AVATAR.OWNER_USER_ID = U.USER_ID
          AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
          AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
          AND AVATAR.STATUS = 'ACTIVE'
        WHERE U.MOBILE_E164 = :mobileNumber
        FOR UPDATE OF U.STATUS`,
      { mobileNumber },
    );
    const row = result.rows?.[0];
    if (!row) return undefined;
    const participantId = rawToUuid(row.PARTICIPANT_ID);
    return {
      userId: rawToUuid(row.USER_ID),
      participantId,
      displayName: row.DISPLAY_NAME,
      status: row.STATUS,
      mobileVerified: row.VERIFIED_FLAG === 'Y',
      ...(row.AVATAR_MEDIA_ID
        ? { avatarUrl: participantAvatarUrl(participantId, rawToUuid(row.AVATAR_MEDIA_ID)) }
        : {}),
    };
  }

  async ensureRegisteredMember(
    connection: Connection,
    values: {
      readonly group: ManagedGroup;
      readonly target: RegisteredTarget;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly member: GroupMember; readonly created: boolean }> {
    const activeResult = await this.oracle.execute<ActiveMemberRow>(
      connection,
      `SELECT MEMBER_ROLE, TO_CHAR(ALLOCATION_ORDER) AS ALLOCATION_ORDER
         FROM SPLITO_CONTEXT_MEMBERS
        WHERE CONTEXT_ID = :contextId
          AND PARTICIPANT_ID = :participantId
          AND STATUS = 'ACTIVE'
        FOR UPDATE`,
      {
        contextId: uuidToRaw(values.group.contextId),
        participantId: uuidToRaw(values.target.participantId),
      },
    );
    const existing = activeResult.rows?.[0];
    if (existing) {
      await this.revokePendingInvitations(
        connection,
        values.group.contextId,
        values.target.participantId,
      );
      return {
        member: this.memberResponse(values.target, existing.MEMBER_ROLE, existing.ALLOCATION_ORDER),
        created: false,
      };
    }

    const orderResult = await this.oracle.execute<{ NEXT_ORDER: string }>(
      connection,
      `SELECT TO_CHAR(NVL(MAX(ALLOCATION_ORDER), -1) + 1) AS NEXT_ORDER
         FROM SPLITO_CONTEXT_MEMBERS
        WHERE CONTEXT_ID = :contextId`,
      { contextId: uuidToRaw(values.group.contextId) },
    );
    const allocationOrder = orderResult.rows?.[0]?.NEXT_ORDER;
    if (allocationOrder === undefined) throw new Error('Oracle did not return a membership order');

    const membershipId = randomUUID();
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_CONTEXT_MEMBERS (
         MEMBERSHIP_ID, CONTEXT_ID, PARTICIPANT_ID, MEMBER_ROLE,
         ALLOCATION_ORDER, ADDED_BY_PARTICIPANT_ID
       ) VALUES (
         :membershipId, :contextId, :participantId, 'MEMBER',
         :allocationOrder, :actorParticipantId
       )`,
      {
        membershipId: uuidToRaw(membershipId),
        contextId: uuidToRaw(values.group.contextId),
        participantId: uuidToRaw(values.target.participantId),
        allocationOrder,
        actorParticipantId: uuidToRaw(values.actorParticipantId),
      },
    );
    await this.bumpContextVersion(connection, values.group.contextId);
    await this.revokePendingInvitations(
      connection,
      values.group.contextId,
      values.target.participantId,
    );
    await this.insertOutbox(connection, {
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
    await this.insertAudit(connection, {
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
    connection: Connection,
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
    const pendingResult = await this.oracle.execute<PendingInvitationRow>(
      connection,
      `SELECT INVITATION_ID, TO_CHAR(RESEND_COUNT) AS RESEND_COUNT,
              CASE WHEN EXPIRES_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 'Y' ELSE 'N' END
                AS EXPIRED_FLAG
         FROM SPLITO_INVITATIONS
        WHERE INVITATION_TYPE = 'GROUP'
          AND CONTEXT_ID = :contextId
          AND INVITEE_MOBILE_E164 = :mobileNumber
          AND STATUS = 'PENDING'
        FOR UPDATE`,
      { contextId: uuidToRaw(values.group.contextId), mobileNumber: values.mobileNumber },
    );
    let pending = pendingResult.rows?.[0];
    if (pending?.EXPIRED_FLAG === 'Y') {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_INVITATIONS
            SET STATUS = 'EXPIRED', RESPONDED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE INVITATION_ID = :invitationId AND STATUS = 'PENDING'`,
        { invitationId: pending.INVITATION_ID },
      );
      pending = undefined;
    }

    if (pending && Number(pending.RESEND_COUNT) >= 5) {
      throw new ApiError(
        429,
        'INVITATION_RESEND_LIMIT',
        'This invitation has reached its resend limit. Revoke it before creating another.',
      );
    }

    const invitationId = pending ? rawToUuid(pending.INVITATION_ID) : randomUUID();
    if (pending) {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_INVITATIONS
            SET INVITER_PARTICIPANT_ID = :actorParticipantId,
                TOKEN_HASH = :tokenHash,
                EXPIRES_AT_UTC = :expiresAt,
                RESEND_COUNT = RESEND_COUNT + 1
          WHERE INVITATION_ID = :invitationId
            AND STATUS = 'PENDING'`,
        {
          actorParticipantId: uuidToRaw(values.actorParticipantId),
          tokenHash: values.tokenHash,
          expiresAt: values.expiresAt,
          invitationId: pending.INVITATION_ID,
        },
      );
    } else {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_INVITATIONS (
           INVITATION_ID, INVITATION_TYPE, CONTEXT_ID, INVITER_PARTICIPANT_ID,
           INVITEE_MOBILE_E164, TOKEN_HASH, EXPIRES_AT_UTC
         ) VALUES (
           :invitationId, 'GROUP', :contextId, :actorParticipantId,
           :mobileNumber, :tokenHash, :expiresAt
         )`,
        {
          invitationId: uuidToRaw(invitationId),
          contextId: uuidToRaw(values.group.contextId),
          actorParticipantId: uuidToRaw(values.actorParticipantId),
          mobileNumber: values.mobileNumber,
          tokenHash: values.tokenHash,
          expiresAt: values.expiresAt,
        },
      );
    }

    await this.insertOutbox(connection, {
      eventType: 'group.invitation.requested',
      aggregateType: 'INVITATION',
      aggregateId: invitationId,
      payload: { invitationId, groupId: values.group.groupId },
    });
    await this.insertAudit(connection, {
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      actionKey: pending ? 'group.invitation.resend' : 'group.invitation.create',
      resourceType: 'INVITATION',
      resourceId: invitationId,
      contextId: values.group.contextId,
      requestId: values.requestId,
      metadata: { deliveryChannel: 'sms' },
    });
    return { invitationId, resend: Boolean(pending) };
  }

  async preview(
    connection: Connection,
    tokenHash: Buffer,
    mobileNumber: string,
  ): Promise<InvitationPreview | undefined> {
    const result = await this.oracle.execute<InvitationPreviewRow>(
      connection,
      `SELECT I.INVITATION_ID, I.CONTEXT_ID, G.GROUP_ID, G.GROUP_NAME,
              INVITER.DISPLAY_NAME AS INVITER_DISPLAY_NAME,
              ${invitationTimestamp} AS EXPIRES_AT_TEXT
         FROM SPLITO_INVITATIONS I
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = I.CONTEXT_ID AND C.STATUS = 'ACTIVE'
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = I.CONTEXT_ID
         JOIN SPLITO_PARTICIPANTS INVITER
           ON INVITER.PARTICIPANT_ID = I.INVITER_PARTICIPANT_ID
        WHERE I.INVITATION_TYPE = 'GROUP'
          AND I.TOKEN_HASH = :tokenHash
          AND I.INVITEE_MOBILE_E164 = :mobileNumber
          AND I.STATUS = 'PENDING'
          AND I.EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
          AND EXISTS (
            SELECT 1 FROM SPLITO_CONTEXT_MEMBERS INVITER_M
             WHERE INVITER_M.CONTEXT_ID = I.CONTEXT_ID
               AND INVITER_M.PARTICIPANT_ID = I.INVITER_PARTICIPANT_ID
               AND INVITER_M.STATUS = 'ACTIVE'
               AND INVITER_M.MEMBER_ROLE IN ('OWNER', 'ADMIN')
          )`,
      { tokenHash, mobileNumber },
    );
    return this.mapPreview(result.rows?.[0]);
  }

  async invitationLocator(
    connection: Connection,
    tokenHash: Buffer,
    mobileNumber: string,
  ): Promise<{ readonly invitationId: string; readonly contextId: string } | undefined> {
    const result = await this.oracle.execute<InvitationLocatorRow>(
      connection,
      `SELECT INVITATION_ID, CONTEXT_ID
         FROM SPLITO_INVITATIONS
        WHERE INVITATION_TYPE = 'GROUP'
          AND TOKEN_HASH = :tokenHash
          AND INVITEE_MOBILE_E164 = :mobileNumber
          AND STATUS IN ('PENDING', 'ACCEPTED')`,
      { tokenHash, mobileNumber },
    );
    const row = result.rows?.[0];
    return row
      ? { invitationId: rawToUuid(row.INVITATION_ID), contextId: rawToUuid(row.CONTEXT_ID) }
      : undefined;
  }

  async accept(
    connection: Connection,
    values: {
      readonly locator: { readonly invitationId: string; readonly contextId: string };
      readonly tokenHash: Buffer;
      readonly mobileNumber: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly preview: InvitationPreview; readonly member: GroupMember } | undefined> {
    const contextLock = await this.oracle.execute<{ CONTEXT_ID: Buffer }>(
      connection,
      `SELECT C.CONTEXT_ID
         FROM SPLITO_CONTEXTS C
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = C.CONTEXT_ID
        WHERE C.CONTEXT_ID = :contextId
          AND C.STATUS = 'ACTIVE'
        FOR UPDATE OF C.STATUS`,
      { contextId: uuidToRaw(values.locator.contextId) },
    );
    if (!contextLock.rows?.[0]) return undefined;

    const invitationResult = await this.oracle.execute<LockedInvitationRow>(
      connection,
      `SELECT I.INVITATION_ID, I.CONTEXT_ID, I.INVITER_PARTICIPANT_ID,
              I.INVITEE_PARTICIPANT_ID, I.STATUS,
              G.GROUP_ID, G.GROUP_NAME, INVITER.DISPLAY_NAME AS INVITER_DISPLAY_NAME,
              ${invitationTimestamp} AS EXPIRES_AT_TEXT,
              CASE WHEN I.EXPIRES_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 'Y' ELSE 'N' END
                AS EXPIRED_FLAG,
              CASE WHEN EXISTS (
                SELECT 1 FROM SPLITO_CONTEXT_MEMBERS INVITER_M
                 WHERE INVITER_M.CONTEXT_ID = I.CONTEXT_ID
                   AND INVITER_M.PARTICIPANT_ID = I.INVITER_PARTICIPANT_ID
                   AND INVITER_M.STATUS = 'ACTIVE'
                   AND INVITER_M.MEMBER_ROLE IN ('OWNER', 'ADMIN')
              ) THEN 'Y' ELSE 'N' END AS INVITER_AUTHORIZED_FLAG
         FROM SPLITO_INVITATIONS I
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = I.CONTEXT_ID
         JOIN SPLITO_PARTICIPANTS INVITER
           ON INVITER.PARTICIPANT_ID = I.INVITER_PARTICIPANT_ID
        WHERE I.INVITATION_ID = :invitationId
          AND I.CONTEXT_ID = :contextId
          AND I.INVITATION_TYPE = 'GROUP'
          AND I.TOKEN_HASH = :tokenHash
          AND I.INVITEE_MOBILE_E164 = :mobileNumber
          AND I.STATUS IN ('PENDING', 'ACCEPTED')
        FOR UPDATE OF I.STATUS`,
      {
        invitationId: uuidToRaw(values.locator.invitationId),
        contextId: uuidToRaw(values.locator.contextId),
        tokenHash: values.tokenHash,
        mobileNumber: values.mobileNumber,
      },
    );
    const invitation = invitationResult.rows?.[0];
    if (!invitation) return undefined;
    if (
      invitation.STATUS === 'PENDING' &&
      (invitation.EXPIRED_FLAG === 'Y' || invitation.INVITER_AUTHORIZED_FLAG !== 'Y')
    ) {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_INVITATIONS
            SET STATUS = :status,
                RESPONDED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                REVOKED_AT_UTC = CASE WHEN :status = 'REVOKED'
                  THEN SYS_EXTRACT_UTC(SYSTIMESTAMP) ELSE NULL END
          WHERE INVITATION_ID = :invitationId AND STATUS = 'PENDING'`,
        {
          invitationId: invitation.INVITATION_ID,
          status: invitation.EXPIRED_FLAG === 'Y' ? 'EXPIRED' : 'REVOKED',
        },
      );
      return undefined;
    }

    const actorResult = await this.oracle.execute<RegisteredTargetRow>(
      connection,
      `SELECT U.USER_ID, P.PARTICIPANT_ID, P.DISPLAY_NAME, U.STATUS,
              CASE WHEN U.MOBILE_VERIFIED_AT_UTC IS NULL THEN 'N' ELSE 'Y' END AS VERIFIED_FLAG,
              AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID
         FROM SPLITO_USERS U
         JOIN SPLITO_PARTICIPANTS P ON P.USER_ID = U.USER_ID AND P.KIND = 'USER'
         LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
           ON AVATAR.OWNER_USER_ID = U.USER_ID
          AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
          AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
          AND AVATAR.STATUS = 'ACTIVE'
        WHERE U.USER_ID = :actorUserId
          AND P.PARTICIPANT_ID = :actorParticipantId
          AND U.MOBILE_E164 = :mobileNumber
          AND U.MOBILE_VERIFIED_AT_UTC IS NOT NULL
          AND U.STATUS = 'ACTIVE'
        FOR UPDATE OF U.STATUS`,
      {
        actorUserId: uuidToRaw(values.actorUserId),
        actorParticipantId: uuidToRaw(values.actorParticipantId),
        mobileNumber: values.mobileNumber,
      },
    );
    const actorRow = actorResult.rows?.[0];
    if (!actorRow) return undefined;
    if (
      invitation.STATUS === 'ACCEPTED' &&
      !invitation.INVITEE_PARTICIPANT_ID?.equals(actorRow.PARTICIPANT_ID)
    ) {
      return undefined;
    }
    const target = this.mapTarget(actorRow);

    const activeResult = await this.oracle.execute<ActiveMemberRow>(
      connection,
      `SELECT MEMBER_ROLE, TO_CHAR(ALLOCATION_ORDER) AS ALLOCATION_ORDER
         FROM SPLITO_CONTEXT_MEMBERS
        WHERE CONTEXT_ID = :contextId
          AND PARTICIPANT_ID = :participantId
          AND STATUS = 'ACTIVE'
        FOR UPDATE`,
      {
        contextId: invitation.CONTEXT_ID,
        participantId: actorRow.PARTICIPANT_ID,
      },
    );
    let membership = activeResult.rows?.[0];
    let membershipId: string | undefined;
    if (invitation.STATUS === 'ACCEPTED') {
      if (!membership) return undefined;
      return {
        preview: this.mapPreview(invitation) as InvitationPreview,
        member: this.memberResponse(target, membership.MEMBER_ROLE, membership.ALLOCATION_ORDER),
      };
    }

    if (!membership) {
      const orderResult = await this.oracle.execute<{ NEXT_ORDER: string }>(
        connection,
        `SELECT TO_CHAR(NVL(MAX(ALLOCATION_ORDER), -1) + 1) AS NEXT_ORDER
           FROM SPLITO_CONTEXT_MEMBERS
          WHERE CONTEXT_ID = :contextId`,
        { contextId: invitation.CONTEXT_ID },
      );
      const allocationOrder = orderResult.rows?.[0]?.NEXT_ORDER;
      if (allocationOrder === undefined)
        throw new Error('Oracle did not return a membership order');
      membershipId = randomUUID();
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_CONTEXT_MEMBERS (
           MEMBERSHIP_ID, CONTEXT_ID, PARTICIPANT_ID, MEMBER_ROLE,
           ALLOCATION_ORDER, ADDED_BY_PARTICIPANT_ID
         ) VALUES (
           :membershipId, :contextId, :participantId, 'MEMBER',
           :allocationOrder, :inviterParticipantId
         )`,
        {
          membershipId: uuidToRaw(membershipId),
          contextId: invitation.CONTEXT_ID,
          participantId: actorRow.PARTICIPANT_ID,
          allocationOrder,
          inviterParticipantId: invitation.INVITER_PARTICIPANT_ID,
        },
      );
      membership = { MEMBER_ROLE: 'MEMBER', ALLOCATION_ORDER: allocationOrder };
      await this.bumpContextVersion(connection, values.locator.contextId);
    }

    const accepted = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_INVITATIONS
          SET STATUS = 'ACCEPTED',
              INVITEE_PARTICIPANT_ID = :participantId,
              RESPONDED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE INVITATION_ID = :invitationId
          AND STATUS = 'PENDING'`,
      { participantId: actorRow.PARTICIPANT_ID, invitationId: invitation.INVITATION_ID },
    );
    if (accepted.rowsAffected !== 1) {
      throw new Error('Invitation acceptance was not persisted');
    }

    await this.insertOutbox(connection, {
      eventType: 'group.invitation.accepted',
      aggregateType: 'INVITATION',
      aggregateId: values.locator.invitationId,
      payload: {
        invitationId: values.locator.invitationId,
        groupId: rawToUuid(invitation.GROUP_ID),
        participantId: values.actorParticipantId,
      },
    });
    await this.insertAudit(connection, {
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      actionKey: 'group.invitation.accept',
      resourceType: 'INVITATION',
      resourceId: values.locator.invitationId,
      contextId: values.locator.contextId,
      requestId: values.requestId,
      metadata: membershipId ? { membershipId } : { membershipAlreadyActive: true },
    });
    return {
      preview: this.mapPreview(invitation) as InvitationPreview,
      member: this.memberResponse(target, membership.MEMBER_ROLE, membership.ALLOCATION_ORDER),
    };
  }

  private mapTarget(row: RegisteredTargetRow): RegisteredTarget {
    const participantId = rawToUuid(row.PARTICIPANT_ID);
    return {
      userId: rawToUuid(row.USER_ID),
      participantId,
      displayName: row.DISPLAY_NAME,
      status: row.STATUS,
      mobileVerified: row.VERIFIED_FLAG === 'Y',
      ...(row.AVATAR_MEDIA_ID
        ? { avatarUrl: participantAvatarUrl(participantId, rawToUuid(row.AVATAR_MEDIA_ID)) }
        : {}),
    };
  }

  private memberResponse(
    target: RegisteredTarget,
    role: ActiveMemberRow['MEMBER_ROLE'],
    allocationOrder: string,
  ): GroupMember {
    return {
      id: target.participantId,
      displayName: target.displayName,
      ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
      kind: 'USER',
      role: role === 'OWNER' ? 'owner' : role === 'ADMIN' ? 'administrator' : 'member',
      status: 'active',
      allocationOrder: Number(allocationOrder),
    };
  }

  private mapPreview(row: InvitationPreviewRow | undefined): InvitationPreview | undefined {
    return row
      ? {
          invitationId: rawToUuid(row.INVITATION_ID),
          groupId: rawToUuid(row.GROUP_ID),
          groupName: row.GROUP_NAME,
          inviterDisplayName: row.INVITER_DISPLAY_NAME,
          expiresAt: row.EXPIRES_AT_TEXT,
        }
      : undefined;
  }

  private async revokePendingInvitations(
    connection: Connection,
    contextId: string,
    inviteeParticipantId: string,
  ): Promise<void> {
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_INVITATIONS
          SET STATUS = 'REVOKED',
              INVITEE_PARTICIPANT_ID = :participantId,
              RESPONDED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              REVOKED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE INVITATION_TYPE = 'GROUP'
          AND CONTEXT_ID = :contextId
          AND STATUS = 'PENDING'
          AND INVITEE_MOBILE_E164 = (
            SELECT U.MOBILE_E164
              FROM SPLITO_PARTICIPANTS P
              JOIN SPLITO_USERS U ON U.USER_ID = P.USER_ID
             WHERE P.PARTICIPANT_ID = :participantId
          )`,
      {
        participantId: uuidToRaw(inviteeParticipantId),
        contextId: uuidToRaw(contextId),
      },
    );
  }

  private async bumpContextVersion(connection: Connection, contextId: string): Promise<void> {
    const result = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_CONTEXTS
          SET VERSION_NO = VERSION_NO + 1,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE CONTEXT_ID = :contextId`,
      { contextId: uuidToRaw(contextId) },
    );
    if (result.rowsAffected !== 1) throw new Error('Group context version was not updated');
  }

  private insertOutbox(
    connection: Connection,
    values: {
      readonly eventType: string;
      readonly aggregateType: string;
      readonly aggregateId: string;
      readonly payload: unknown;
    },
  ): Promise<unknown> {
    return this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (:outboxId, :eventType, :aggregateType, :aggregateId, :payload)`,
      {
        outboxId: uuidToRaw(randomUUID()),
        eventType: values.eventType,
        aggregateType: values.aggregateType,
        aggregateId: uuidToRaw(values.aggregateId),
        payload: JSON.stringify(values.payload),
      },
    );
  }

  private insertAudit(
    connection: Connection,
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
  ): Promise<unknown> {
    return this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, CONTEXT_ID, REQUEST_ID, METADATA_JSON
       ) VALUES (
         :auditId, :actorParticipantId, :actorUserId, :actionKey,
         :resourceType, :resourceId, :contextId, :requestId, :metadata
       )`,
      {
        auditId: uuidToRaw(randomUUID()),
        actorParticipantId: uuidToRaw(values.actorParticipantId),
        actorUserId: uuidToRaw(values.actorUserId),
        actionKey: values.actionKey,
        resourceType: values.resourceType,
        resourceId: uuidToRaw(values.resourceId),
        contextId: uuidToRaw(values.contextId),
        requestId: values.requestId,
        metadata: JSON.stringify(values.metadata),
      },
    );
  }
}
