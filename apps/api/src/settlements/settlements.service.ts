import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { parseMinorAmount } from '@splito/domain';
import type { Connection } from 'oracledb';
import {
  ContextAccessRepository,
  type ContextAccess,
} from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiError } from '../common/api-error.js';
import { ExpensesRepository } from '../expenses/expenses.repository.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { OracleService } from '../database/oracle.service.js';
import type { CreateSettlementInput, SettlementPreviewInput } from './settlements.schemas.js';
import { SettlementsRepository, type CurrentObligation } from './settlements.repository.js';

export interface SettlementPreviewResponse {
  readonly overpayment: boolean;
  readonly outstandingAmountMinor: string;
  readonly previewVersion: string;
  readonly explanation: string;
}

export interface SettlementCreatedResponse {
  readonly id: string;
  readonly version: string;
  readonly status: 'posted';
  readonly userAssertion: true;
}

function previewVersion(
  contextId: string,
  input: SettlementPreviewInput,
  current: CurrentObligation,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contextId,
        senderId: input.senderId,
        recipientId: input.recipientId,
        currency: input.currency,
        outstandingMinor: current.outstandingMinor.toString(),
        projectionVersion: current.projectionVersion,
      }),
      'utf8',
    )
    .digest('hex');
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly oracle: OracleService,
    private readonly access: ContextAccessRepository,
    private readonly expenses: ExpensesRepository,
    private readonly repository: SettlementsRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  preview(input: SettlementPreviewInput, auth: AuthContext): Promise<SettlementPreviewResponse> {
    return this.oracle.withConnection(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        input.context.id,
        auth.user.participantId,
      );
      await this.validateParticipantsAndCurrency(connection, access, input, false);
      const current = await this.repository.currentObligation(connection, {
        contextId: access.contextId,
        senderId: input.senderId,
        recipientId: input.recipientId,
        currency: input.currency,
        lock: false,
      });
      return this.toPreview(access.contextId, input, current);
    });
  }

  create(
    input: CreateSettlementInput,
    auth: AuthContext,
    values: { readonly idempotencyKey: string; readonly requestId: string },
  ): Promise<{ readonly data: SettlementCreatedResponse; readonly replayed: boolean }> {
    return this.oracle.withTransaction(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        input.context.id,
        auth.user.participantId,
        { lock: true, writable: true },
      );
      if (
        auth.user.participantId !== input.senderId &&
        access.role !== 'OWNER' &&
        access.role !== 'ADMIN'
      ) {
        throw new ApiError(
          403,
          'SETTLEMENT_FORBIDDEN',
          'Only the sender or a group administrator can record this settlement.',
        );
      }
      const claim = await this.idempotency.claim<SettlementCreatedResponse>(connection, {
        actorParticipantId: auth.user.participantId,
        operation: 'settlement.create',
        key: values.idempotencyKey,
        requestBody: input,
      });
      if (claim.replay) return { data: claim.replay.body, replayed: true };

      await this.validateParticipantsAndCurrency(connection, access, input, true);
      const current = await this.repository.currentObligation(connection, {
        contextId: access.contextId,
        senderId: input.senderId,
        recipientId: input.recipientId,
        currency: input.currency,
        lock: true,
      });
      if (previewVersion(access.contextId, input, current) !== input.previewVersion) {
        throw new ApiError(
          409,
          'STALE_SETTLEMENT_PREVIEW',
          'Balances changed after this preview. Refresh it before recording the payment.',
        );
      }
      const amountMinor = parseMinorAmount(input.amountMinor);
      if (amountMinor > current.outstandingMinor && !input.overpaymentConfirmed) {
        throw new ApiError(
          409,
          'OVERPAYMENT_CONFIRMATION_REQUIRED',
          'This amount exceeds the current debt and requires explicit confirmation.',
        );
      }

      const settlementId = randomUUID();
      await this.repository.insert(connection, {
        input,
        contextId: access.contextId,
        settlementId,
        revisionId: randomUUID(),
        batchId: randomUUID(),
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        idempotencyId: claim.id,
        businessTimezone: auth.user.timezone,
        requestId: values.requestId,
      });
      await this.expenses.applyBalanceDelta(connection, {
        contextId: access.contextId,
        participantId: input.senderId,
        currency: input.currency,
        deltaMinor: amountMinor,
      });
      await this.expenses.applyBalanceDelta(connection, {
        contextId: access.contextId,
        participantId: input.recipientId,
        currency: input.currency,
        deltaMinor: -amountMinor,
      });
      await this.expenses.applyBilateralDelta(connection, {
        contextId: access.contextId,
        debtorId: input.senderId,
        creditorId: input.recipientId,
        currency: input.currency,
        amountMinor: -amountMinor,
      });

      const data: SettlementCreatedResponse = {
        id: settlementId,
        version: '1',
        status: 'posted',
        userAssertion: true,
      };
      await this.idempotency.complete(connection, {
        id: claim.id,
        httpStatus: 201,
        responseBody: data,
        resourceId: settlementId,
      });
      return { data, replayed: false };
    });
  }

  private async validateParticipantsAndCurrency(
    connection: Connection,
    access: ContextAccess,
    input: SettlementPreviewInput,
    lock: boolean,
  ): Promise<void> {
    const { participants } = await this.expenses.activeParticipants(
      connection,
      access.contextId,
      lock,
    );
    const active = new Set(participants.map((participant) => participant.id));
    if (!active.has(input.senderId) || !active.has(input.recipientId)) {
      throw new ApiError(
        422,
        'PARTICIPANT_NOT_ELIGIBLE',
        'Settlement parties must be active members of this group.',
      );
    }
    await this.expenses.requireActiveCurrency(connection, input.currency);
  }

  private toPreview(
    contextId: string,
    input: SettlementPreviewInput,
    current: CurrentObligation,
  ): SettlementPreviewResponse {
    const amountMinor = parseMinorAmount(input.amountMinor);
    const overpayment = amountMinor > current.outstandingMinor;
    return {
      overpayment,
      outstandingAmountMinor: current.outstandingMinor.toString(),
      previewVersion: previewVersion(contextId, input, current),
      explanation: overpayment
        ? 'The entered payment exceeds the current bilateral debt; recording it would reverse who owes whom.'
        : 'This is a user-recorded payment assertion. It changes balances but is not bank verification.',
    };
  }
}
