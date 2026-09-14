import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Decimal128, type Long } from 'mongodb';
import { decimalToMinor, minorToDecimal, type MongoUnitOfWork } from '../database/mongo.service.js';
import { compareUuid } from '../database/uuid.js';
import type { CreateSettlementInput } from './settlements.schemas.js';

interface BilateralDocument {
  _id: string;
  contextId: string;
  participantLowId: string;
  participantHighId: string;
  currencyCode: string;
  lowOwesHighMinor: Decimal128;
  version: number | Long;
}

interface StringIdDocument {
  _id: string;
  [key: string]: unknown;
}

export interface CurrentObligation {
  readonly outstandingMinor: bigint;
  readonly projectionVersion: string;
}

@Injectable()
export class SettlementsRepository {
  async currentObligation(
    work: MongoUnitOfWork,
    values: {
      readonly contextId: string;
      readonly senderId: string;
      readonly recipientId: string;
      readonly currency: string;
    },
  ): Promise<CurrentObligation> {
    const senderIsLow = compareUuid(values.senderId, values.recipientId) < 0;
    const lowId = senderIsLow ? values.senderId : values.recipientId;
    const highId = senderIsLow ? values.recipientId : values.senderId;
    const row = await work.db.collection<BilateralDocument>('bilateralProjections').findOne(
      {
        contextId: values.contextId,
        participantLowId: lowId,
        participantHighId: highId,
        currencyCode: values.currency,
      },
      work.session ? { session: work.session } : undefined,
    );
    if (!row) return { outstandingMinor: 0n, projectionVersion: '0' };
    const signed = decimalToMinor(row.lowOwesHighMinor);
    const senderOwes = senderIsLow ? signed : -signed;
    return {
      outstandingMinor: senderOwes > 0n ? senderOwes : 0n,
      projectionVersion: row.version.toString(),
    };
  }

  async insert(
    work: MongoUnitOfWork,
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
    const now = new Date();
    const options = work.session ? { session: work.session } : undefined;
    const amountMinor = minorToDecimal(values.input.amountMinor);
    await work.db.collection<StringIdDocument>('settlements').insertOne(
      {
        _id: values.settlementId,
        contextId: values.contextId,
        senderParticipantId: values.input.senderId,
        recipientParticipantId: values.input.recipientId,
        currencyCode: values.input.currency,
        amountMinor,
        settlementDate: values.input.settlementDate,
        businessTimezone: values.businessTimezone,
        method: values.input.method.toUpperCase(),
        status: 'POSTED',
        assertion: true,
        currentRevisionId: values.revisionId,
        version: 1,
        createdByParticipantId: values.actorParticipantId,
        createdAt: now,
        updatedAt: now,
      },
      options,
    );
    await work.db.collection<StringIdDocument>('settlementRevisions').insertOne(
      {
        _id: values.revisionId,
        settlementId: values.settlementId,
        revisionNumber: 1,
        amountMinor,
        method: values.input.method.toUpperCase(),
        ...(values.input.note ? { note: values.input.note } : {}),
        changeType: 'CREATE',
        createdByParticipantId: values.actorParticipantId,
        createdAt: now,
      },
      options,
    );
    await work.db.collection<StringIdDocument>('ledgerBatches').insertOne(
      {
        _id: values.batchId,
        contextId: values.contextId,
        currencyCode: values.input.currency,
        batchType: 'SETTLEMENT',
        sourceType: 'SETTLEMENT',
        sourceId: values.settlementId,
        sourceRevisionId: values.revisionId,
        idempotencyId: values.idempotencyId,
        actorParticipantId: values.actorParticipantId,
        postings: [
          {
            id: randomUUID(),
            participantId: values.input.senderId,
            amountMinor,
            postingOrder: 0,
          },
          {
            id: randomUUID(),
            participantId: values.input.recipientId,
            amountMinor: minorToDecimal(-BigInt(values.input.amountMinor)),
            postingOrder: 1,
          },
        ],
        postedAt: now,
      },
      options,
    );
    await work.db.collection<StringIdDocument>('outbox').insertOne(
      {
        _id: randomUUID(),
        eventType: 'settlement.posted',
        aggregateType: 'SETTLEMENT',
        aggregateId: values.settlementId,
        payload: {
          settlementId: values.settlementId,
          contextId: values.contextId,
          invalidation: 'settlements-and-balances',
        },
        status: 'PENDING',
        attempts: 0,
        availableAt: now,
        createdAt: now,
      },
      options,
    );
    await work.db.collection<StringIdDocument>('auditEvents').insertOne(
      {
        _id: randomUUID(),
        actorParticipantId: values.actorParticipantId,
        actorUserId: values.actorUserId,
        actionKey: 'settlement.create',
        resourceType: 'SETTLEMENT',
        resourceId: values.settlementId,
        contextId: values.contextId,
        requestId: values.requestId,
        metadata: {
          currency: values.input.currency,
          method: values.input.method,
          userAssertion: true,
        },
        createdAt: now,
      },
      options,
    );
  }
}
