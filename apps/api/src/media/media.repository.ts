import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import { ApiError } from '../common/api-error.js';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';
import type { MediaKind, MediaObject, ProcessedImage } from './media.types.js';

interface MediaRow {
  MEDIA_ID: Buffer;
  STORAGE_KEY: string;
  MEDIA_TYPE: 'image/webp';
  BYTE_SIZE: string;
  SHA256_HASH: Buffer;
  WIDTH_PX: string;
  HEIGHT_PX: string;
}

interface CurrentImageRow {
  CURRENT_STORAGE_KEY: string | null;
}

interface CurrentGroupImageRow extends CurrentImageRow {
  CONTEXT_ID: Buffer;
}

export interface NewMediaValues {
  readonly mediaId: string;
  readonly storageKey: string;
  readonly processed: ProcessedImage;
  readonly actorParticipantId: string;
  readonly actorUserId: string;
  readonly auditId: string;
  readonly requestId: string;
}

function mapMedia(row: MediaRow): MediaObject {
  return {
    id: rawToUuid(row.MEDIA_ID),
    storageKey: row.STORAGE_KEY,
    mediaType: row.MEDIA_TYPE,
    byteSize: Number(row.BYTE_SIZE),
    sha256Hash: row.SHA256_HASH,
    width: Number(row.WIDTH_PX),
    height: Number(row.HEIGHT_PX),
  };
}

@Injectable()
export class MediaRepository {
  constructor(private readonly oracle: OracleService) {}

  async findParticipantAvatar(
    connection: Connection,
    participantId: string,
    callerParticipantId: string,
    mediaId: string,
  ): Promise<MediaObject | undefined> {
    const result = await this.oracle.execute<MediaRow>(
      connection,
      `SELECT MO.MEDIA_ID, MO.STORAGE_KEY, MO.MEDIA_TYPE,
              TO_CHAR(MO.BYTE_SIZE) AS BYTE_SIZE, MO.SHA256_HASH,
              TO_CHAR(MO.WIDTH_PX) AS WIDTH_PX, TO_CHAR(MO.HEIGHT_PX) AS HEIGHT_PX
         FROM SPLITO_PARTICIPANTS TARGET_P
         JOIN SPLITO_USERS TARGET_U
           ON TARGET_U.USER_ID = TARGET_P.USER_ID
          AND TARGET_U.STATUS = 'ACTIVE'
         JOIN SPLITO_MEDIA_OBJECTS MO
           ON MO.OWNER_USER_ID = TARGET_U.USER_ID
          AND MO.STORAGE_KEY = TARGET_U.AVATAR_KEY
          AND MO.MEDIA_KIND = 'USER_AVATAR'
          AND MO.STATUS = 'ACTIVE'
        WHERE TARGET_P.PARTICIPANT_ID = :participantId
          AND MO.MEDIA_ID = :mediaId
          AND (
            TARGET_P.PARTICIPANT_ID = :callerParticipantId OR
            EXISTS (
              SELECT 1
                FROM SPLITO_CONTEXT_MEMBERS CALLER_M
                JOIN SPLITO_CONTEXT_MEMBERS TARGET_M
                  ON TARGET_M.CONTEXT_ID = CALLER_M.CONTEXT_ID
                 AND TARGET_M.PARTICIPANT_ID = TARGET_P.PARTICIPANT_ID
                 AND TARGET_M.STATUS = 'ACTIVE'
               WHERE CALLER_M.PARTICIPANT_ID = :callerParticipantId
                 AND CALLER_M.STATUS = 'ACTIVE'
            )
          )`,
      {
        participantId: uuidToRaw(participantId),
        callerParticipantId: uuidToRaw(callerParticipantId),
        mediaId: uuidToRaw(mediaId),
      },
    );
    const row = result.rows?.[0];
    return row ? mapMedia(row) : undefined;
  }

  async findGroupImage(
    connection: Connection,
    groupId: string,
    callerParticipantId: string,
    mediaId: string,
  ): Promise<MediaObject | undefined> {
    const result = await this.oracle.execute<MediaRow>(
      connection,
      `SELECT MO.MEDIA_ID, MO.STORAGE_KEY, MO.MEDIA_TYPE,
              TO_CHAR(MO.BYTE_SIZE) AS BYTE_SIZE, MO.SHA256_HASH,
              TO_CHAR(MO.WIDTH_PX) AS WIDTH_PX, TO_CHAR(MO.HEIGHT_PX) AS HEIGHT_PX
         FROM SPLITO_GROUPS G
         JOIN SPLITO_CONTEXT_MEMBERS CALLER_M
           ON CALLER_M.CONTEXT_ID = G.CONTEXT_ID
          AND CALLER_M.PARTICIPANT_ID = :callerParticipantId
          AND CALLER_M.STATUS = 'ACTIVE'
         JOIN SPLITO_MEDIA_OBJECTS MO
           ON MO.OWNER_GROUP_ID = G.GROUP_ID
          AND MO.STORAGE_KEY = G.IMAGE_KEY
          AND MO.MEDIA_KIND = 'GROUP_IMAGE'
          AND MO.STATUS = 'ACTIVE'
        WHERE G.GROUP_ID = :groupId
          AND MO.MEDIA_ID = :mediaId`,
      {
        groupId: uuidToRaw(groupId),
        callerParticipantId: uuidToRaw(callerParticipantId),
        mediaId: uuidToRaw(mediaId),
      },
    );
    const row = result.rows?.[0];
    return row ? mapMedia(row) : undefined;
  }

  async replaceUserAvatar(
    connection: Connection,
    userId: string,
    values: NewMediaValues,
  ): Promise<string | undefined> {
    const selected = await this.oracle.execute<CurrentImageRow>(
      connection,
      `SELECT AVATAR_KEY AS CURRENT_STORAGE_KEY
         FROM SPLITO_USERS
        WHERE USER_ID = :userId
          AND STATUS = 'ACTIVE'
        FOR UPDATE`,
      { userId: uuidToRaw(userId) },
    );
    const current = selected.rows?.[0];
    if (!current) {
      throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'The account cannot be changed.');
    }
    await this.supersede(connection, current.CURRENT_STORAGE_KEY);
    await this.insertMedia(connection, 'USER_AVATAR', values, { userId });
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_USERS
          SET AVATAR_KEY = :storageKey,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE USER_ID = :userId`,
      { storageKey: values.storageKey, userId: uuidToRaw(userId) },
    );
    await this.audit(connection, values, {
      action: 'profile.avatar.replace',
      resourceType: 'USER',
      resourceId: userId,
    });
    return current.CURRENT_STORAGE_KEY ?? undefined;
  }

  async deleteUserAvatar(
    connection: Connection,
    values: {
      readonly userId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
    },
  ): Promise<string | undefined> {
    const selected = await this.oracle.execute<CurrentImageRow>(
      connection,
      `SELECT AVATAR_KEY AS CURRENT_STORAGE_KEY
         FROM SPLITO_USERS
        WHERE USER_ID = :userId
          AND STATUS = 'ACTIVE'
        FOR UPDATE`,
      { userId: uuidToRaw(values.userId) },
    );
    const current = selected.rows?.[0];
    if (!current) {
      throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'The account cannot be changed.');
    }
    if (!current.CURRENT_STORAGE_KEY) return undefined;
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_USERS
          SET AVATAR_KEY = NULL,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE USER_ID = :userId`,
      { userId: uuidToRaw(values.userId) },
    );
    await this.markDeleted(connection, current.CURRENT_STORAGE_KEY);
    await this.audit(connection, values, {
      action: 'profile.avatar.delete',
      resourceType: 'USER',
      resourceId: values.userId,
    });
    return current.CURRENT_STORAGE_KEY;
  }

  async replaceGroupImage(
    connection: Connection,
    groupId: string,
    contextId: string,
    values: NewMediaValues,
  ): Promise<string | undefined> {
    const current = await this.lockGroup(connection, groupId);
    await this.supersede(connection, current.CURRENT_STORAGE_KEY);
    await this.insertMedia(connection, 'GROUP_IMAGE', values, { groupId });
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_GROUPS
          SET IMAGE_KEY = :storageKey,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE GROUP_ID = :groupId`,
      { storageKey: values.storageKey, groupId: uuidToRaw(groupId) },
    );
    await this.bumpContextVersion(connection, contextId);
    await this.audit(connection, values, {
      action: 'group.image.replace',
      resourceType: 'GROUP',
      resourceId: groupId,
      contextId,
    });
    return current.CURRENT_STORAGE_KEY ?? undefined;
  }

  async deleteGroupImage(
    connection: Connection,
    values: {
      readonly groupId: string;
      readonly contextId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
    },
  ): Promise<string | undefined> {
    const current = await this.lockGroup(connection, values.groupId);
    if (!current.CURRENT_STORAGE_KEY) return undefined;
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_GROUPS
          SET IMAGE_KEY = NULL,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE GROUP_ID = :groupId`,
      { groupId: uuidToRaw(values.groupId) },
    );
    await this.markDeleted(connection, current.CURRENT_STORAGE_KEY);
    await this.bumpContextVersion(connection, values.contextId);
    await this.audit(connection, values, {
      action: 'group.image.delete',
      resourceType: 'GROUP',
      resourceId: values.groupId,
      contextId: values.contextId,
    });
    return current.CURRENT_STORAGE_KEY;
  }

  private async lockGroup(connection: Connection, groupId: string): Promise<CurrentGroupImageRow> {
    const selected = await this.oracle.execute<CurrentGroupImageRow>(
      connection,
      `SELECT G.IMAGE_KEY AS CURRENT_STORAGE_KEY, G.CONTEXT_ID
         FROM SPLITO_GROUPS G
        WHERE G.GROUP_ID = :groupId
        FOR UPDATE OF G.IMAGE_KEY`,
      { groupId: uuidToRaw(groupId) },
    );
    const current = selected.rows?.[0];
    if (!current) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    return current;
  }

  private async insertMedia(
    connection: Connection,
    kind: MediaKind,
    values: NewMediaValues,
    owner: { readonly userId: string } | { readonly groupId: string },
  ): Promise<void> {
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_MEDIA_OBJECTS (
         MEDIA_ID, MEDIA_KIND, OWNER_USER_ID, OWNER_GROUP_ID,
         UPLOADED_BY_PARTICIPANT_ID, STORAGE_PROVIDER, STORAGE_KEY,
         MEDIA_TYPE, BYTE_SIZE, SHA256_HASH, WIDTH_PX, HEIGHT_PX
       ) VALUES (
         :mediaId, :kind, :ownerUserId, :ownerGroupId,
         :actorParticipantId, 'FILESYSTEM', :storageKey,
         :mediaType, :byteSize, :sha256Hash, :width, :height
       )`,
      {
        mediaId: uuidToRaw(values.mediaId),
        kind,
        ownerUserId: 'userId' in owner ? uuidToRaw(owner.userId) : null,
        ownerGroupId: 'groupId' in owner ? uuidToRaw(owner.groupId) : null,
        actorParticipantId: uuidToRaw(values.actorParticipantId),
        storageKey: values.storageKey,
        mediaType: values.processed.mediaType,
        byteSize: values.processed.byteSize,
        sha256Hash: values.processed.sha256Hash,
        width: values.processed.width,
        height: values.processed.height,
      },
    );
  }

  private async supersede(connection: Connection, storageKey: string | null): Promise<void> {
    if (!storageKey) return;
    const result = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MEDIA_OBJECTS
          SET STATUS = 'SUPERSEDED',
              SUPERSEDED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE STORAGE_KEY = :storageKey
          AND STATUS = 'ACTIVE'`,
      { storageKey },
    );
    if (result.rowsAffected !== 1) {
      throw new Error('Current image metadata was not superseded exactly once');
    }
  }

  private async markDeleted(connection: Connection, storageKey: string): Promise<void> {
    const result = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MEDIA_OBJECTS
          SET STATUS = 'DELETED',
              DELETED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE STORAGE_KEY = :storageKey
          AND STATUS = 'ACTIVE'`,
      { storageKey },
    );
    if (result.rowsAffected !== 1) {
      throw new Error('Current image metadata was not deleted exactly once');
    }
  }

  private async bumpContextVersion(connection: Connection, contextId: string): Promise<void> {
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_CONTEXTS
          SET VERSION_NO = VERSION_NO + 1,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE CONTEXT_ID = :contextId`,
      { contextId: uuidToRaw(contextId) },
    );
  }

  private async audit(
    connection: Connection,
    values: {
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly auditId: string;
      readonly requestId: string;
      readonly processed?: ProcessedImage;
    },
    resource: {
      readonly action: string;
      readonly resourceType: 'USER' | 'GROUP';
      readonly resourceId: string;
      readonly contextId?: string;
    },
  ): Promise<void> {
    const metadata = values.processed
      ? {
          mediaType: values.processed.mediaType,
          byteSize: values.processed.byteSize,
          width: values.processed.width,
          height: values.processed.height,
        }
      : {};
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, CONTEXT_ID, REQUEST_ID, METADATA_JSON
       ) VALUES (
         :auditId, :actorParticipantId, :actorUserId, :action,
         :resourceType, :resourceId, :contextId, :requestId, :metadata
       )`,
      {
        auditId: uuidToRaw(values.auditId),
        actorParticipantId: uuidToRaw(values.actorParticipantId),
        actorUserId: uuidToRaw(values.actorUserId),
        action: resource.action,
        resourceType: resource.resourceType,
        resourceId: uuidToRaw(resource.resourceId),
        contextId: resource.contextId ? uuidToRaw(resource.contextId) : null,
        requestId: values.requestId,
        metadata: JSON.stringify(metadata),
      },
    );
  }
}
