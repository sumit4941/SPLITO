import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import { ApiError } from '../common/api-error.js';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';

interface AccessRow {
  CONTEXT_ID: Buffer;
  CONTEXT_TYPE: 'GROUP' | 'DIRECT' | 'PERSONAL';
  CONTEXT_STATUS: 'ACTIVE' | 'ARCHIVED';
  DEFAULT_CURRENCY_CODE: string;
  VERSION_NO: string;
  MEMBER_ROLE: 'OWNER' | 'ADMIN' | 'MEMBER';
  ALLOCATION_ORDER: string;
  GROUP_ID: Buffer | null;
}

export interface ContextAccess {
  readonly contextId: string;
  readonly contextType: AccessRow['CONTEXT_TYPE'];
  readonly status: AccessRow['CONTEXT_STATUS'];
  readonly defaultCurrency: string;
  readonly version: string;
  readonly role: AccessRow['MEMBER_ROLE'];
  readonly allocationOrder: number;
  readonly groupId?: string;
}

@Injectable()
export class ContextAccessRepository {
  constructor(private readonly oracle: OracleService) {}

  async requireActiveMember(
    connection: Connection,
    contextId: string,
    participantId: string,
    options: { readonly lock?: boolean; readonly writable?: boolean } = {},
  ): Promise<ContextAccess> {
    const result = await this.oracle.execute<AccessRow>(
      connection,
      `SELECT C.CONTEXT_ID, C.CONTEXT_TYPE, C.STATUS AS CONTEXT_STATUS,
              C.DEFAULT_CURRENCY_CODE, TO_CHAR(C.VERSION_NO) AS VERSION_NO,
              M.MEMBER_ROLE, TO_CHAR(M.ALLOCATION_ORDER) AS ALLOCATION_ORDER,
              (SELECT G.GROUP_ID FROM SPLITO_GROUPS G WHERE G.CONTEXT_ID = C.CONTEXT_ID) AS GROUP_ID
         FROM SPLITO_CONTEXTS C
         JOIN SPLITO_CONTEXT_MEMBERS M
           ON M.CONTEXT_ID = C.CONTEXT_ID AND M.STATUS = 'ACTIVE'
        WHERE C.CONTEXT_ID = :contextId
          AND M.PARTICIPANT_ID = :participantId
        ${options.lock ? 'FOR UPDATE OF C.STATUS, M.STATUS' : ''}`,
      { contextId: uuidToRaw(contextId), participantId: uuidToRaw(participantId) },
    );
    const row = result.rows?.[0];
    if (!row) {
      throw new ApiError(
        404,
        'CONTEXT_NOT_FOUND',
        'The context does not exist or is not accessible.',
      );
    }
    if (options.writable && row.CONTEXT_STATUS !== 'ACTIVE') {
      throw new ApiError(
        409,
        'CONTEXT_ARCHIVED',
        'Archived contexts are read-only until restored.',
      );
    }
    return {
      contextId: rawToUuid(row.CONTEXT_ID),
      contextType: row.CONTEXT_TYPE,
      status: row.CONTEXT_STATUS,
      defaultCurrency: row.DEFAULT_CURRENCY_CODE.trim(),
      version: row.VERSION_NO,
      role: row.MEMBER_ROLE,
      allocationOrder: Number(row.ALLOCATION_ORDER),
      ...(row.GROUP_ID ? { groupId: rawToUuid(row.GROUP_ID) } : {}),
    };
  }

  async contextIdForGroup(
    connection: Connection,
    groupId: string,
    participantId: string,
    options: { readonly lock?: boolean; readonly writable?: boolean } = {},
  ): Promise<ContextAccess> {
    const result = await this.oracle.execute<{ CONTEXT_ID: Buffer }>(
      connection,
      `SELECT CONTEXT_ID FROM SPLITO_GROUPS WHERE GROUP_ID = :groupId`,
      { groupId: uuidToRaw(groupId) },
    );
    const contextId = result.rows?.[0]?.CONTEXT_ID;
    if (!contextId) {
      throw new ApiError(404, 'GROUP_NOT_FOUND', 'The group does not exist or is not accessible.');
    }
    return this.requireActiveMember(connection, rawToUuid(contextId), participantId, options);
  }
}
