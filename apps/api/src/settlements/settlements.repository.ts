import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import oracledb from 'oracledb';
import { OracleService } from '../database/oracle.service.js';
import { compareUuid, uuidToRaw } from '../database/uuid.js';
import type { CreateSettlementInput } from './settlements.schemas.js';

export interface CurrentObligation {
  readonly outstandingMinor: bigint;
  readonly projectionVersion: string;
}

@Injectable()
export class SettlementsRepository {
  constructor(private readonly oracle: OracleService) {}

  async currentObligation(
    connection: Connection,
    values: {
      readonly contextId: string;
      readonly senderId: string;
      readonly recipientId: string;
      readonly currency: string;
      readonly lock: boolean;
    },
  ): Promise<CurrentObligation> {
    const senderIsLow = compareUuid(values.senderId, values.recipientId) < 0;
    const lowId = senderIsLow ? values.senderId : values.recipientId;
    const highId = senderIsLow ? values.recipientId : values.senderId;
    const result = await this.oracle.execute<{ AMOUNT_MINOR: string; PROJECTION_VERSION: string }>(
      connection,
      `SELECT TO_CHAR(LOW_OWES_HIGH_MINOR_SIGNED) AS AMOUNT_MINOR,
              TO_CHAR(PROJECTION_VERSION) AS PROJECTION_VERSION
         FROM SPLITO_BILATERAL_PROJECTIONS
        WHERE CONTEXT_ID = :contextId
          AND PARTICIPANT_LOW_ID = :lowId
          AND PARTICIPANT_HIGH_ID = :highId
          AND CURRENCY_CODE = :currencyCode
        ${values.lock ? 'FOR UPDATE' : ''}`,
      {
        contextId: uuidToRaw(values.contextId),
        lowId: uuidToRaw(lowId),
        highId: uuidToRaw(highId),
        currencyCode: values.currency,
      },
    );
    const row = result.rows?.[0];
    if (!row) return { outstandingMinor: 0n, projectionVersion: '0' };
    const signed = BigInt(row.AMOUNT_MINOR);
    const senderOwes = senderIsLow ? signed : -signed;
    return {
      outstandingMinor: senderOwes > 0n ? senderOwes : 0n,
      projectionVersion: row.PROJECTION_VERSION,
    };
  }

  async insert(
    connection: Connection,
    values: {
      readonly input: CreateSettlementInput;
      readonly contextId: string;
      readonly settlementId: string;
      readonly revisionId: string;
      readonly batchId: string;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly idempotencyId: string;
      readonly businessTimezone: string;
      readonly requestId: string;
    },
  ): Promise<void> {
    const amountMinor = values.input.amountMinor;
    const settlementId = uuidToRaw(values.settlementId);
    const revisionId = uuidToRaw(values.revisionId);
    const contextId = uuidToRaw(values.contextId);
    const senderId = uuidToRaw(values.input.senderId);
    const recipientId = uuidToRaw(values.input.recipientId);
    const actorParticipantId = uuidToRaw(values.actorParticipantId);
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_SETTLEMENTS (
         SETTLEMENT_ID, CONTEXT_ID, SENDER_PARTICIPANT_ID, RECIPIENT_PARTICIPANT_ID,
         CURRENCY_CODE, AMOUNT_MINOR, SETTLEMENT_DATE, BUSINESS_TIMEZONE,
         METHOD, STATUS, ASSERTION_FLAG, CREATED_BY_PARTICIPANT_ID
       ) VALUES (
         :settlementId, :contextId, :senderId, :recipientId,
         :currencyCode, :amountMinor, TO_DATE(:settlementDate, 'YYYY-MM-DD'),
         :businessTimezone, :method, 'POSTED', 'Y', :actorParticipantId
       )`,
      {
        settlementId,
        contextId,
        senderId,
        recipientId,
        currencyCode: values.input.currency,
        amountMinor,
        settlementDate: values.input.settlementDate,
        businessTimezone: values.businessTimezone,
        method: values.input.method.toUpperCase(),
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_SETTLEMENT_REVISIONS (
         SETTLEMENT_REVISION_ID, SETTLEMENT_ID, REVISION_NO, AMOUNT_MINOR,
         METHOD, NOTE_TEXT, CHANGE_TYPE, CREATED_BY_PARTICIPANT_ID
       ) VALUES (
         :revisionId, :settlementId, 1, :amountMinor,
         :method, :noteText, 'CREATE', :actorParticipantId
       )`,
      {
        revisionId,
        settlementId,
        amountMinor,
        method: values.input.method.toUpperCase(),
        noteText: values.input.note ?? null,
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_SETTLEMENTS
          SET CURRENT_REVISION_ID = :revisionId
        WHERE SETTLEMENT_ID = :settlementId`,
      { revisionId, settlementId },
    );

    const batchId = uuidToRaw(values.batchId);
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_LEDGER_BATCHES (
         BATCH_ID, CONTEXT_ID, CURRENCY_CODE, BATCH_TYPE, SOURCE_TYPE,
         SOURCE_ID, SOURCE_REVISION_ID, IDEMPOTENCY_KEY_ID, ACTOR_PARTICIPANT_ID
       ) VALUES (
         :batchId, :contextId, :currencyCode, 'SETTLEMENT', 'SETTLEMENT',
         :settlementId, :revisionId, :idempotencyId, :actorParticipantId
       )`,
      {
        batchId,
        contextId,
        currencyCode: values.input.currency,
        settlementId,
        revisionId,
        idempotencyId: uuidToRaw(values.idempotencyId),
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_LEDGER_POSTINGS (
         POSTING_ID, BATCH_ID, PARTICIPANT_ID, AMOUNT_MINOR_SIGNED, POSTING_ORDER
       ) VALUES (:id, :batchId, :participantId, :amountMinor, 0)`,
      {
        id: uuidToRaw(randomUUID()),
        batchId,
        participantId: senderId,
        amountMinor,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_LEDGER_POSTINGS (
         POSTING_ID, BATCH_ID, PARTICIPANT_ID, AMOUNT_MINOR_SIGNED, POSTING_ORDER
       ) VALUES (:id, :batchId, :participantId, -:amountMinor, 1)`,
      {
        id: uuidToRaw(randomUUID()),
        batchId,
        participantId: recipientId,
        amountMinor,
      },
    );

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (:id, 'settlement.posted', 'SETTLEMENT', :settlementId, :payload)`,
      {
        id: uuidToRaw(randomUUID()),
        settlementId,
        payload: {
          val: JSON.stringify({
            settlementId: values.settlementId,
            contextId: values.contextId,
            invalidation: 'settlements-and-balances',
          }),
          type: oracledb.CLOB,
        },
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, CONTEXT_ID, REQUEST_ID, METADATA_JSON
       ) VALUES (
         :id, :actorParticipantId, :actorUserId, 'settlement.create',
         'SETTLEMENT', :settlementId, :contextId, :requestId, :metadata
       )`,
      {
        id: uuidToRaw(randomUUID()),
        actorParticipantId,
        actorUserId: uuidToRaw(values.actorUserId),
        settlementId,
        contextId,
        requestId: values.requestId,
        metadata: JSON.stringify({
          currency: values.input.currency,
          method: values.input.method,
          userAssertion: true,
        }),
      },
    );
  }
}
