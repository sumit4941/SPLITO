import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import oracledb, { type Connection } from 'oracledb';
import { canonicalJsonHash } from '../common/canonical-json.js';
import { ApiError } from '../common/api-error.js';
import { readTextLob } from '../database/lob.js';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';

interface IdempotencyRow {
  IDEMPOTENCY_KEY_ID: Buffer;
  REQUEST_HASH: Buffer;
  STATUS: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  HTTP_STATUS: string | null;
  RESPONSE_BODY_JSON: unknown;
  RESOURCE_ID: Buffer | null;
  EXPIRED_FLAG: 'Y' | 'N';
}

export interface IdempotencyClaim<T> {
  readonly id: string;
  readonly replay?: { readonly status: number; readonly body: T; readonly resourceId?: string };
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errorNum' in error &&
    Number(error.errorNum) === 1
  );
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly oracle: OracleService) {}

  async claim<T>(
    connection: Connection,
    values: {
      readonly actorParticipantId: string;
      readonly operation: string;
      readonly key: string;
      readonly requestBody: unknown;
    },
  ): Promise<IdempotencyClaim<T>> {
    const id = randomUUID();
    const keyHash = sha256(values.key);
    const requestHash = canonicalJsonHash(values.requestBody);
    try {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_IDEMPOTENCY_KEYS (
           IDEMPOTENCY_KEY_ID, ACTOR_PARTICIPANT_ID, OPERATION_KEY,
           KEY_HASH, REQUEST_HASH, EXPIRES_AT_UTC
         ) VALUES (
           :id, :actorId, :operation, :keyHash, :requestHash,
           SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(24, 'HOUR')
         )`,
        {
          id: uuidToRaw(id),
          actorId: uuidToRaw(values.actorParticipantId),
          operation: values.operation,
          keyHash,
          requestHash,
        },
      );
      return { id };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const selected = await this.oracle.execute<IdempotencyRow>(
      connection,
      `SELECT IDEMPOTENCY_KEY_ID, REQUEST_HASH, STATUS,
              TO_CHAR(HTTP_STATUS) AS HTTP_STATUS, RESPONSE_BODY_JSON, RESOURCE_ID,
              CASE WHEN EXPIRES_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 'Y' ELSE 'N' END AS EXPIRED_FLAG
         FROM SPLITO_IDEMPOTENCY_KEYS
        WHERE ACTOR_PARTICIPANT_ID = :actorId
          AND OPERATION_KEY = :operation
          AND KEY_HASH = :keyHash
        FOR UPDATE`,
      {
        actorId: uuidToRaw(values.actorParticipantId),
        operation: values.operation,
        keyHash,
      },
    );
    const row = selected.rows?.[0];
    if (!row) throw new Error('Idempotency uniqueness conflict had no matching row');
    const existingId = rawToUuid(row.IDEMPOTENCY_KEY_ID);

    if (row.EXPIRED_FLAG === 'Y') {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_IDEMPOTENCY_KEYS
            SET REQUEST_HASH = :requestHash,
                STATUS = 'IN_PROGRESS', HTTP_STATUS = NULL, RESPONSE_BODY_JSON = NULL,
                RESOURCE_ID = NULL, CREATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                COMPLETED_AT_UTC = NULL,
                EXPIRES_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(24, 'HOUR')
          WHERE IDEMPOTENCY_KEY_ID = :id`,
        { requestHash, id: row.IDEMPOTENCY_KEY_ID },
      );
      return { id: existingId };
    }

    if (!sameHash(row.REQUEST_HASH, requestHash)) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request payload.',
      );
    }
    if (row.STATUS === 'IN_PROGRESS') {
      throw new ApiError(
        409,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'A request with this idempotency key is still in progress.',
      );
    }

    const text = await readTextLob(row.RESPONSE_BODY_JSON);
    if (!text || !row.HTTP_STATUS) {
      throw new Error('Completed idempotency result is missing its stored outcome');
    }
    return {
      id: existingId,
      replay: {
        status: Number(row.HTTP_STATUS),
        body: JSON.parse(text) as T,
        ...(row.RESOURCE_ID ? { resourceId: rawToUuid(row.RESOURCE_ID) } : {}),
      },
    };
  }

  async complete(
    connection: Connection,
    values: {
      readonly id: string;
      readonly httpStatus: number;
      readonly responseBody: unknown;
      readonly resourceId?: string;
    },
  ): Promise<void> {
    const result = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_IDEMPOTENCY_KEYS
          SET STATUS = 'COMPLETED', HTTP_STATUS = :httpStatus,
              RESPONSE_BODY_JSON = :responseBody,
              RESOURCE_ID = :resourceId,
              COMPLETED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE IDEMPOTENCY_KEY_ID = :id
          AND STATUS = 'IN_PROGRESS'`,
      {
        httpStatus: values.httpStatus,
        responseBody: { val: JSON.stringify(values.responseBody), type: oracledb.CLOB },
        resourceId: values.resourceId ? uuidToRaw(values.resourceId) : null,
        id: uuidToRaw(values.id),
      },
    );
    if (result.rowsAffected !== 1) {
      throw new Error('Idempotency outcome was not persisted exactly once');
    }
  }
}
