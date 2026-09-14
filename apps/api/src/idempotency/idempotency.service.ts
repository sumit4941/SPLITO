import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { canonicalJsonHash } from '../common/canonical-json.js';
import { ApiError } from '../common/api-error.js';
import {
  MongoService,
  RetryableMongoTransactionError,
  type MongoTransactionalUnitOfWork,
} from '../database/mongo.service.js';
import { isMongoDuplicateKey } from '../database/mongo.helpers.js';

interface IdempotencySlotDocument {
  _id: string;
  id: string;
  actorParticipantId: string;
  operationKey: string;
  keyHash: string;
  requestHash: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  httpStatus?: number;
  responseBody?: unknown;
  resourceId?: string;
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

interface IdempotencyReceiptDocument {
  _id: string;
  scopeId: string;
  actorParticipantId: string;
  operationKey: string;
  keyHash: string;
  requestHash: string;
  httpStatus: number;
  resourceId?: string;
  createdAt: Date;
  completedAt: Date;
}

export interface IdempotencyClaim<T> {
  readonly id: string;
  readonly replay?: { readonly status: number; readonly body: T; readonly resourceId?: string };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function identityFor(actorParticipantId: string, operation: string, keyHash: string): string {
  return sha256(`${actorParticipantId}\u0000${operation}\u0000${keyHash}`);
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly mongo: MongoService) {}

  async claim<T>(
    work: MongoTransactionalUnitOfWork,
    values: {
      readonly actorParticipantId: string;
      readonly operation: string;
      readonly key: string;
      readonly requestBody: unknown;
    },
  ): Promise<IdempotencyClaim<T>> {
    if (!work.session) throw new Error('Idempotency claims require a MongoDB transaction');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
    const keyHash = sha256(values.key);
    const bodyHash = canonicalJsonHash(values.requestBody).toString('hex');
    const identity = identityFor(values.actorParticipantId, values.operation, keyHash);
    const proposedId = randomUUID();
    const collection = work.db.collection<IdempotencySlotDocument>('idempotencyKeys');
    const options = { upsert: true, returnDocument: 'after' as const, session: work.session };

    // A deterministic MongoDB _id makes this atomic without catching a
    // duplicate-key error in the usual case. A concurrent first insert can
    // still race, so that one narrowly scoped error restarts the whole
    // transaction in a fresh session.
    let row: IdempotencySlotDocument | null;
    try {
      row = await collection.findOneAndUpdate(
        { _id: identity },
        {
          $setOnInsert: {
            id: proposedId,
            actorParticipantId: values.actorParticipantId,
            operationKey: values.operation,
            keyHash,
            requestHash: bodyHash,
            status: 'IN_PROGRESS',
            createdAt: now,
            expiresAt,
          },
        },
        options,
      );
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new RetryableMongoTransactionError(error);
      throw error;
    }
    if (!row) throw new Error('Idempotency claim was not persisted');
    if (row.id === proposedId) return { id: proposedId };

    if (row.expiresAt.getTime() <= now.getTime()) {
      const reset = await collection.updateOne(
        { _id: identity, id: row.id, expiresAt: { $lte: now } },
        {
          $set: {
            id: proposedId,
            requestHash: bodyHash,
            status: 'IN_PROGRESS',
            createdAt: now,
            expiresAt,
          },
          $unset: { httpStatus: '', responseBody: '', resourceId: '', completedAt: '' },
        },
        { session: work.session },
      );
      if (reset.modifiedCount === 1) return { id: proposedId };
      throw new ApiError(
        409,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'A request with this idempotency key is still in progress.',
      );
    }

    if (row.requestHash !== bodyHash) {
      throw new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used with a different request payload.',
      );
    }
    if (row.status === 'IN_PROGRESS') {
      throw new ApiError(
        409,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'A request with this idempotency key is still in progress.',
      );
    }
    if (
      row.status !== 'COMPLETED' ||
      row.httpStatus === undefined ||
      row.responseBody === undefined
    ) {
      throw new Error('Completed idempotency result is missing its stored outcome');
    }
    return {
      id: row.id,
      replay: {
        status: row.httpStatus,
        body: row.responseBody as T,
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      },
    };
  }

  async complete(
    work: MongoTransactionalUnitOfWork,
    values: {
      readonly id: string;
      readonly httpStatus: number;
      readonly responseBody: unknown;
      readonly resourceId?: string;
    },
  ): Promise<void> {
    if (!work.session) throw new Error('Idempotency completion requires a MongoDB transaction');
    const completedAt = new Date();
    const slot = await work.db
      .collection<IdempotencySlotDocument>('idempotencyKeys')
      .findOneAndUpdate(
        { id: values.id, status: 'IN_PROGRESS' },
        {
          $set: {
            status: 'COMPLETED',
            httpStatus: values.httpStatus,
            responseBody: values.responseBody,
            completedAt,
            ...(values.resourceId ? { resourceId: values.resourceId } : {}),
          },
        },
        {
          returnDocument: 'after',
          session: work.session,
        },
      );
    if (!slot) {
      throw new Error('Idempotency outcome was not persisted exactly once');
    }
    await work.db.collection<IdempotencyReceiptDocument>('idempotencyReceipts').insertOne(
      {
        _id: slot.id,
        scopeId: slot._id,
        actorParticipantId: slot.actorParticipantId,
        operationKey: slot.operationKey,
        keyHash: slot.keyHash,
        requestHash: slot.requestHash,
        httpStatus: values.httpStatus,
        ...(values.resourceId ? { resourceId: values.resourceId } : {}),
        createdAt: slot.createdAt,
        completedAt,
      },
      { session: work.session },
    );
  }
}
