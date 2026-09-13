import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';
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

interface GroupRow {
  GROUP_ID: Buffer;
  CONTEXT_ID: Buffer;
  GROUP_NAME: string;
  DESCRIPTION: string | null;
  IMAGE_MEDIA_ID: Buffer | null;
  GROUP_TYPE: string;
  DEFAULT_CURRENCY_CODE: string;
  SIMPLIFICATION_FLAG: 'Y' | 'N';
  STATUS: 'ACTIVE' | 'ARCHIVED';
  MEMBER_ROLE: 'OWNER' | 'ADMIN' | 'MEMBER';
  VERSION_NO: string;
  CREATED_AT: string;
  UPDATED_AT: string;
  MEMBER_COUNT: string;
}

function roleToJson(role: 'OWNER' | 'ADMIN' | 'MEMBER'): 'owner' | 'administrator' | 'member' {
  return role === 'OWNER' ? 'owner' : role === 'ADMIN' ? 'administrator' : 'member';
}

function maskMobileNumber(mobileNumber: string): string {
  const visibleDigits = mobileNumber.slice(-4);
  return `+${'*'.repeat(Math.max(4, mobileNumber.length - 5))}${visibleDigits}`;
}

function mapGroup(row: GroupRow): GroupSummary {
  const groupId = rawToUuid(row.GROUP_ID);
  return {
    id: groupId,
    contextId: rawToUuid(row.CONTEXT_ID),
    name: row.GROUP_NAME,
    ...(row.DESCRIPTION ? { description: row.DESCRIPTION } : {}),
    ...(row.IMAGE_MEDIA_ID
      ? { imageUrl: groupImageUrl(groupId, rawToUuid(row.IMAGE_MEDIA_ID)) }
      : {}),
    type: row.GROUP_TYPE.toLowerCase(),
    defaultCurrency: row.DEFAULT_CURRENCY_CODE.trim(),
    simplificationEnabled: row.SIMPLIFICATION_FLAG === 'Y',
    archived: row.STATUS === 'ARCHIVED',
    role: roleToJson(row.MEMBER_ROLE),
    memberCount: Number(row.MEMBER_COUNT),
    version: row.VERSION_NO,
    createdAt: row.CREATED_AT,
    updatedAt: row.UPDATED_AT,
  };
}

@Injectable()
export class GroupsRepository {
  constructor(private readonly oracle: OracleService) {}

  async list(participantId: string): Promise<GroupSummary[]> {
    return this.oracle.withConnection(async (connection) => {
      const result = await this.oracle.execute<GroupRow>(
        connection,
        `SELECT G.GROUP_ID, G.CONTEXT_ID, G.GROUP_NAME, G.DESCRIPTION, G.GROUP_TYPE,
                GROUP_IMAGE.MEDIA_ID AS IMAGE_MEDIA_ID,
                C.DEFAULT_CURRENCY_CODE, C.SIMPLIFICATION_FLAG, C.STATUS,
                M.MEMBER_ROLE, TO_CHAR(C.VERSION_NO) AS VERSION_NO,
                TO_CHAR(C.CREATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS CREATED_AT,
                TO_CHAR(C.UPDATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS UPDATED_AT,
                (SELECT COUNT(*) FROM SPLITO_CONTEXT_MEMBERS MC
                  WHERE MC.CONTEXT_ID = C.CONTEXT_ID AND MC.STATUS = 'ACTIVE') AS MEMBER_COUNT
           FROM SPLITO_GROUPS G
           JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = G.CONTEXT_ID
           LEFT JOIN SPLITO_MEDIA_OBJECTS GROUP_IMAGE
             ON GROUP_IMAGE.OWNER_GROUP_ID = G.GROUP_ID
            AND GROUP_IMAGE.STORAGE_KEY = G.IMAGE_KEY
            AND GROUP_IMAGE.MEDIA_KIND = 'GROUP_IMAGE'
            AND GROUP_IMAGE.STATUS = 'ACTIVE'
           JOIN SPLITO_CONTEXT_MEMBERS M
             ON M.CONTEXT_ID = C.CONTEXT_ID
            AND M.PARTICIPANT_ID = :participantId
            AND M.STATUS = 'ACTIVE'
          ORDER BY C.UPDATED_AT_UTC DESC, G.GROUP_ID`,
        { participantId: uuidToRaw(participantId) },
      );
      return (result.rows ?? []).map(mapGroup);
    });
  }

  async create(
    connection: Connection,
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
    const contextId = uuidToRaw(values.contextId);
    const actorParticipantId = uuidToRaw(values.actorParticipantId);
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_CONTEXTS (
         CONTEXT_ID, CONTEXT_TYPE, DEFAULT_CURRENCY_CODE, SIMPLIFICATION_FLAG,
         CREATED_BY_PARTICIPANT_ID
       ) VALUES (
         :contextId, 'GROUP', :currencyCode, :simplificationFlag, :actorParticipantId
       )`,
      {
        contextId,
        currencyCode: values.defaultCurrency,
        simplificationFlag: values.simplificationEnabled ? 'Y' : 'N',
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_GROUPS (
         GROUP_ID, CONTEXT_ID, GROUP_NAME, DESCRIPTION, GROUP_TYPE
       ) VALUES (:groupId, :contextId, :groupName, :description, :groupType)`,
      {
        groupId: uuidToRaw(values.groupId),
        contextId,
        groupName: values.name,
        description: values.description ?? null,
        groupType: values.type.toUpperCase(),
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_CONTEXT_MEMBERS (
         MEMBERSHIP_ID, CONTEXT_ID, PARTICIPANT_ID, MEMBER_ROLE, ALLOCATION_ORDER,
         ADDED_BY_PARTICIPANT_ID
       ) VALUES (
         :membershipId, :contextId, :actorParticipantId, 'OWNER', 0,
         :actorParticipantId
       )`,
      {
        membershipId: uuidToRaw(values.membershipId),
        contextId,
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (:outboxId, 'group.created', 'GROUP', :groupId, :payload)`,
      {
        outboxId: uuidToRaw(values.outboxId),
        groupId: uuidToRaw(values.groupId),
        payload: JSON.stringify({ groupId: values.groupId, contextId: values.contextId }),
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, CONTEXT_ID, REQUEST_ID, METADATA_JSON
       ) VALUES (
         :auditId, :actorParticipantId, :actorUserId, 'group.create',
         'GROUP', :groupId, :contextId, :requestId, '{}'
       )`,
      {
        auditId: uuidToRaw(values.auditId),
        actorParticipantId,
        actorUserId: uuidToRaw(values.actorUserId),
        groupId: uuidToRaw(values.groupId),
        contextId,
        requestId: values.requestId,
      },
    );
    return {
      id: values.groupId,
      contextId: values.contextId,
      name: values.name,
      ...(values.description ? { description: values.description } : {}),
      type: values.type,
      defaultCurrency: values.defaultCurrency,
      simplificationEnabled: values.simplificationEnabled,
      archived: false,
      role: 'owner',
      memberCount: 1,
      version: '1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async detail(
    connection: Connection,
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
    const groups = await this.oracle.execute<GroupRow>(
      connection,
      `SELECT G.GROUP_ID, G.CONTEXT_ID, G.GROUP_NAME, G.DESCRIPTION, G.GROUP_TYPE,
              GROUP_IMAGE.MEDIA_ID AS IMAGE_MEDIA_ID,
              C.DEFAULT_CURRENCY_CODE, C.SIMPLIFICATION_FLAG, C.STATUS,
              CALLER_M.MEMBER_ROLE, TO_CHAR(C.VERSION_NO) AS VERSION_NO,
              TO_CHAR(C.CREATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS CREATED_AT,
              TO_CHAR(C.UPDATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS UPDATED_AT,
              (SELECT COUNT(*) FROM SPLITO_CONTEXT_MEMBERS MC
                WHERE MC.CONTEXT_ID = C.CONTEXT_ID AND MC.STATUS = 'ACTIVE') AS MEMBER_COUNT
         FROM SPLITO_GROUPS G
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = G.CONTEXT_ID
         LEFT JOIN SPLITO_MEDIA_OBJECTS GROUP_IMAGE
           ON GROUP_IMAGE.OWNER_GROUP_ID = G.GROUP_ID
          AND GROUP_IMAGE.STORAGE_KEY = G.IMAGE_KEY
          AND GROUP_IMAGE.MEDIA_KIND = 'GROUP_IMAGE'
          AND GROUP_IMAGE.STATUS = 'ACTIVE'
         JOIN SPLITO_CONTEXT_MEMBERS CALLER_M
           ON CALLER_M.CONTEXT_ID = C.CONTEXT_ID
          AND CALLER_M.PARTICIPANT_ID = :participantId
          AND CALLER_M.STATUS = 'ACTIVE'
        WHERE G.GROUP_ID = :groupId`,
      { groupId: uuidToRaw(groupId), participantId: uuidToRaw(participantId) },
    );
    const groupRow = groups.rows?.[0];
    if (!groupRow) return undefined;

    const memberRows = await this.oracle.execute<{
      PARTICIPANT_ID: Buffer;
      DISPLAY_NAME: string;
      KIND: 'USER' | 'GUEST';
      MEMBER_ROLE: 'OWNER' | 'ADMIN' | 'MEMBER';
      STATUS: 'ACTIVE' | 'LEFT' | 'REMOVED';
      ALLOCATION_ORDER: string;
      AVATAR_MEDIA_ID: Buffer | null;
    }>(
      connection,
      `SELECT P.PARTICIPANT_ID, P.DISPLAY_NAME, P.KIND, M.MEMBER_ROLE, M.STATUS,
              TO_CHAR(M.ALLOCATION_ORDER) AS ALLOCATION_ORDER,
              AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID
         FROM SPLITO_CONTEXT_MEMBERS M
         JOIN SPLITO_PARTICIPANTS P ON P.PARTICIPANT_ID = M.PARTICIPANT_ID
         LEFT JOIN SPLITO_USERS U ON U.USER_ID = P.USER_ID
         LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
           ON AVATAR.OWNER_USER_ID = U.USER_ID
          AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
          AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
          AND AVATAR.STATUS = 'ACTIVE'
        WHERE M.CONTEXT_ID = :contextId
        ORDER BY M.ALLOCATION_ORDER, M.MEMBERSHIP_ID`,
      { contextId: groupRow.CONTEXT_ID },
    );

    const pendingInvitationRows =
      groupRow.MEMBER_ROLE === 'OWNER' || groupRow.MEMBER_ROLE === 'ADMIN'
        ? await this.oracle.execute<{
            INVITATION_ID: Buffer;
            INVITEE_MOBILE_E164: string;
            EXPIRES_AT: string;
          }>(
            connection,
            `SELECT INVITATION_ID, INVITEE_MOBILE_E164,
                    TO_CHAR(EXPIRES_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS EXPIRES_AT
               FROM SPLITO_INVITATIONS
              WHERE CONTEXT_ID = :contextId
                AND INVITATION_TYPE = 'GROUP'
                AND STATUS = 'PENDING'
                AND INVITEE_MOBILE_E164 IS NOT NULL
                AND EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
              ORDER BY CREATED_AT_UTC DESC, INVITATION_ID`,
            { contextId: groupRow.CONTEXT_ID },
          )
        : undefined;

    return {
      group: mapGroup(groupRow),
      members: (memberRows.rows ?? []).map((row) => {
        const id = rawToUuid(row.PARTICIPANT_ID);
        return {
          id,
          displayName: row.DISPLAY_NAME,
          ...(row.AVATAR_MEDIA_ID
            ? { avatarUrl: participantAvatarUrl(id, rawToUuid(row.AVATAR_MEDIA_ID)) }
            : {}),
          kind: row.KIND,
          role: row.KIND === 'GUEST' ? 'guest' : roleToJson(row.MEMBER_ROLE),
          status: row.STATUS === 'ACTIVE' ? 'active' : 'former',
          allocationOrder: Number(row.ALLOCATION_ORDER),
        };
      }),
      pendingInvitations: (pendingInvitationRows?.rows ?? []).map((row) => ({
        id: rawToUuid(row.INVITATION_ID),
        maskedMobileNumber: maskMobileNumber(row.INVITEE_MOBILE_E164),
        expiresAt: row.EXPIRES_AT,
        status: 'pending',
      })),
    };
  }
}
