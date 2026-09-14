import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  allocateAdjustments,
  allocateEqual,
  allocateExact,
  allocatePercentages,
  allocateShares,
  createBilateralObligations,
  expenseNetPostings,
  parseMinorAmount,
  type AllocationResult,
} from '@splito/domain';
import { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiError } from '../common/api-error.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import type { ExpenseListQuery, ExpenseMutationInput } from './expenses.schemas.js';
import {
  ExpensesRepository,
  type ExpenseCursor,
  type LockedExpenseForUpdate,
} from './expenses.repository.js';
import type {
  ContextParticipant,
  ExpenseSummaryResponse,
  PreparedExpense,
  SplitPreviewResponse,
} from './expenses.types.js';

const explanationByMethod: Record<ExpenseMutationInput['splitMethod'], string> = {
  equal: 'The total is divided evenly; remainder units follow the saved participant order.',
  exact: 'The exact beneficiary amounts match the expense total.',
  percentage:
    'Exact decimal percentages are allocated rationally, then rounded by largest remainder.',
  shares:
    'Nonnegative relative shares are allocated rationally, then rounded by largest remainder.',
  adjustments:
    "Each owed amount is the common base plus that participant's adjustment; negative results are rejected.",
};

function encodeCursor(cursor: ExpenseCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): ExpenseCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<ExpenseCursor>;
    if (
      typeof parsed.expenseDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.expenseDate) ||
      typeof parsed.createdAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(parsed.createdAt) ||
      typeof parsed.id !== 'string'
    ) {
      throw new Error('shape');
    }
    return { expenseDate: parsed.expenseDate, createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly mongo: MongoService,
    private readonly access: ContextAccessRepository,
    private readonly repository: ExpensesRepository,
    private readonly idempotency: IdempotencyService,
  ) {}

  async preview(input: ExpenseMutationInput, auth: AuthContext): Promise<SplitPreviewResponse> {
    return this.mongo.withTransaction(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        input.groupId,
        auth.user.participantId,
      );
      const prepared = await this.prepare(connection, input, access.contextId);
      return this.previewResponse(prepared);
    });
  }

  async create(
    input: ExpenseMutationInput,
    auth: AuthContext,
    values: { readonly idempotencyKey: string; readonly requestId: string },
  ): Promise<{ readonly data: ExpenseSummaryResponse; readonly replayed: boolean }> {
    return this.mongo.withTransaction(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        input.groupId,
        auth.user.participantId,
        { writable: true },
      );
      const claim = await this.idempotency.claim<ExpenseSummaryResponse>(connection, {
        actorParticipantId: auth.user.participantId,
        operation: 'expense.create',
        key: values.idempotencyKey,
        requestBody: input,
      });
      if (claim.replay) return { data: claim.replay.body, replayed: true };

      await this.access.requireActiveMember(connection, access.contextId, auth.user.participantId, {
        lock: true,
        writable: true,
      });

      const prepared = await this.prepare(connection, input, access.contextId);
      const ids = {
        expenseId: randomUUID(),
        revisionId: randomUUID(),
        ...(prepared.postings.some((posting) => posting.amountMinor !== 0n)
          ? { ledgerBatchId: randomUUID() }
          : {}),
      };
      await this.repository.insertPostedExpense(connection, {
        prepared,
        ids,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        idempotencyId: claim.id,
        requestId: values.requestId,
        businessTimezone: auth.user.timezone,
      });
      const data = this.expenseResponse(ids.expenseId, prepared, {
        id: auth.user.participantId,
        displayName: auth.user.displayName,
      });
      await this.idempotency.complete(connection, {
        id: claim.id,
        httpStatus: 201,
        responseBody: data,
        resourceId: ids.expenseId,
      });
      return { data, replayed: false };
    });
  }

  async update(
    expenseId: string,
    input: ExpenseMutationInput,
    auth: AuthContext,
    values: {
      readonly idempotencyKey: string;
      readonly expectedVersion: string;
      readonly requestId: string;
    },
  ): Promise<{ readonly data: ExpenseSummaryResponse; readonly replayed: boolean }> {
    expenseId = expenseId.toLowerCase();
    return this.mongo.withTransaction(async (connection) => {
      let current = await this.repository.lockExpenseForUpdate(
        connection,
        expenseId,
        auth.user.participantId,
        false,
      );
      if (!current) {
        throw new ApiError(
          404,
          'EXPENSE_NOT_FOUND',
          'The expense does not exist or is not accessible.',
        );
      }
      this.requireCreatorCanEdit(current, auth.user.participantId);
      if (input.groupId !== current.groupId) {
        throw new ApiError(
          409,
          'EXPENSE_GROUP_MISMATCH',
          'An expense cannot be moved to a different group while it is edited.',
        );
      }

      const claim = await this.idempotency.claim<ExpenseSummaryResponse>(connection, {
        actorParticipantId: auth.user.participantId,
        operation: 'expense.update',
        key: values.idempotencyKey,
        requestBody: {
          expenseId,
          expectedVersion: values.expectedVersion,
          expense: input,
        },
      });
      if (claim.replay) return { data: claim.replay.body, replayed: true };

      current = await this.repository.lockExpenseForUpdate(
        connection,
        expenseId,
        auth.user.participantId,
        true,
      );
      if (!current) {
        throw new ApiError(
          404,
          'EXPENSE_NOT_FOUND',
          'The expense does not exist or is not accessible.',
        );
      }

      if (current.version !== values.expectedVersion) {
        throw new ApiError(
          412,
          'RESOURCE_VERSION_MISMATCH',
          'The expense changed since it was loaded. Refresh it and retry with the new version.',
        );
      }

      const prepared = await this.prepare(connection, input, current.contextId);
      const previousEffect = await this.repository.currentFinancialEffect(
        connection,
        current.expenseId,
        current.revisionId,
      );
      const nextVersion = (BigInt(current.version) + 1n).toString();
      const nextRevisionNumber = current.revisionNumber + 1;
      if (!Number.isSafeInteger(nextRevisionNumber)) {
        throw new Error('Expense revision number exceeds the supported response range');
      }
      const ids = {
        revisionId: randomUUID(),
        ...(previousEffect.batchId ? { reversalBatchId: randomUUID() } : {}),
        ...(prepared.postings.some((posting) => posting.amountMinor !== 0n)
          ? { replacementBatchId: randomUUID() }
          : {}),
      };
      await this.repository.replacePostedExpense(connection, {
        current,
        previousEffect,
        prepared,
        ids,
        expectedVersion: values.expectedVersion,
        nextVersion,
        nextRevisionNumber,
        actorParticipantId: auth.user.participantId,
        actorUserId: auth.user.userId,
        idempotencyId: claim.id,
        requestId: values.requestId,
        businessTimezone: auth.user.timezone,
      });
      const data = this.expenseResponse(
        current.expenseId,
        prepared,
        {
          id: current.createdByParticipantId,
          displayName: current.createdByDisplayName,
        },
        nextVersion,
        nextRevisionNumber,
      );
      await this.idempotency.complete(connection, {
        id: claim.id,
        httpStatus: 200,
        responseBody: data,
        resourceId: current.expenseId,
      });
      return { data, replayed: false };
    });
  }

  async listForGroup(
    groupId: string,
    query: ExpenseListQuery,
    auth: AuthContext,
  ): Promise<{ items: ExpenseSummaryResponse[]; nextCursor?: string }> {
    return this.mongo.withTransaction(async (connection) => {
      const access = await this.access.contextIdForGroup(
        connection,
        groupId,
        auth.user.participantId,
      );
      const cursor = decodeCursor(query.cursor);
      const page = await this.repository.list(connection, {
        contextId: access.contextId,
        groupId,
        callerParticipantId: auth.user.participantId,
        limit: query.limit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        items: page.items,
        ...(page.next ? { nextCursor: encodeCursor(page.next) } : {}),
      };
    });
  }

  async detail(expenseId: string, auth: AuthContext): Promise<ExpenseSummaryResponse> {
    expenseId = expenseId.toLowerCase();
    const expense = await this.mongo.withTransaction((connection) =>
      this.repository.detail(connection, expenseId, auth.user.participantId),
    );
    if (!expense) {
      throw new ApiError(
        404,
        'EXPENSE_NOT_FOUND',
        'The expense does not exist or is not accessible.',
      );
    }
    return expense;
  }

  private async prepare(
    connection: MongoUnitOfWork,
    input: ExpenseMutationInput,
    contextId: string,
  ): Promise<PreparedExpense> {
    const { participants, groupName } = await this.repository.activeParticipants(
      connection,
      contextId,
    );
    await this.repository.requireActiveCurrency(connection, input.currency);
    const participantById = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    const beneficiaryIds = new Set<string>();
    for (const beneficiary of input.beneficiaries) {
      this.requireEligibleParticipant(participantById, beneficiary.participantId);
      if (beneficiaryIds.has(beneficiary.participantId)) {
        throw new ApiError(422, 'DUPLICATE_BENEFICIARY', 'A beneficiary may appear only once.');
      }
      beneficiaryIds.add(beneficiary.participantId);
    }
    const payerIds = new Set<string>();
    for (const payer of input.payers) {
      this.requireEligibleParticipant(participantById, payer.participantId);
      if (payerIds.has(payer.participantId)) {
        throw new ApiError(422, 'DUPLICATE_PAYER', 'A payer may appear only once.');
      }
      payerIds.add(payer.participantId);
    }

    const totalMinor = parseMinorAmount(input.amountMinor);
    const allocation = this.allocate(input, totalMinor, participantById);
    const paid = new Map(
      input.payers.map((payer) => [payer.participantId, parseMinorAmount(payer.paidAmountMinor)]),
    );
    const owed = new Map(
      allocation.allocations.map((item) => [item.participantId, item.amountMinor]),
    );
    const involved = participants.filter(
      (participant) => paid.has(participant.id) || owed.has(participant.id),
    );
    const postings = expenseNetPostings(
      totalMinor,
      involved.map((participant) => ({
        participantId: participant.id,
        paidMinor: paid.get(participant.id) ?? 0n,
        owedMinor: owed.get(participant.id) ?? 0n,
      })),
    );
    const netByParticipant = new Map(
      postings.map((posting) => [posting.participantId, posting.amountMinor]),
    );
    const bilateral = createBilateralObligations(
      input.currency,
      involved.map((participant) => ({
        participantId: participant.id,
        allocationOrder: participant.allocationOrder,
        netMinor: netByParticipant.get(participant.id) ?? 0n,
      })),
    );
    return {
      input,
      contextId,
      groupName,
      participants,
      allocations: allocation.allocations,
      postings,
      obligations: bilateral.obligations,
      algorithmVersion: allocation.algorithmVersion,
      bilateralAlgorithmVersion: bilateral.algorithmVersion,
      splitMethod: allocation.method,
    };
  }

  private allocate(
    input: ExpenseMutationInput,
    totalMinor: bigint,
    participantById: ReadonlyMap<string, ContextParticipant>,
  ): AllocationResult {
    const ordered = (participantId: string) => {
      const participant = participantById.get(participantId);
      if (!participant) throw new Error('Eligibility was not checked');
      return { participantId, allocationOrder: participant.allocationOrder };
    };
    switch (input.splitMethod) {
      case 'equal':
        return allocateEqual(
          totalMinor,
          input.beneficiaries.map((item) => ordered(item.participantId)),
        );
      case 'exact':
        return allocateExact(
          totalMinor,
          input.beneficiaries.map((item) => ({
            ...ordered(item.participantId),
            amountMinor: parseMinorAmount(item.amountMinor),
          })),
        );
      case 'percentage':
        return allocatePercentages(
          totalMinor,
          input.beneficiaries.map((item) => ({
            ...ordered(item.participantId),
            percentage: item.percentage,
          })),
        );
      case 'shares':
        return allocateShares(
          totalMinor,
          input.beneficiaries.map((item) => ({
            ...ordered(item.participantId),
            shares: item.shares,
          })),
        );
      case 'adjustments':
        return allocateAdjustments(
          totalMinor,
          input.beneficiaries.map((item) => ({
            ...ordered(item.participantId),
            adjustmentMinor: parseMinorAmount(item.adjustmentMinor, { allowNegative: true }),
          })),
        );
    }
  }

  private requireEligibleParticipant(
    participantById: ReadonlyMap<string, ContextParticipant>,
    participantId: string,
  ): void {
    if (!participantById.has(participantId)) {
      throw new ApiError(
        422,
        'PARTICIPANT_NOT_ELIGIBLE',
        'Every payer and beneficiary must be an active member of this context.',
      );
    }
  }

  private requireCreatorCanEdit(
    expense: LockedExpenseForUpdate,
    callerParticipantId: string,
  ): void {
    if (expense.createdByParticipantId !== callerParticipantId) {
      throw new ApiError(
        403,
        'EXPENSE_EDIT_FORBIDDEN',
        'Only the participant who created this expense can edit it.',
      );
    }
    if (expense.contextStatus !== 'ACTIVE') {
      throw new ApiError(
        409,
        'CONTEXT_ARCHIVED',
        'Archived contexts are read-only until restored.',
      );
    }
    if (expense.status !== 'POSTED') {
      throw new ApiError(409, 'EXPENSE_NOT_EDITABLE', 'Only posted expenses can be edited.');
    }
  }

  private previewResponse(prepared: PreparedExpense): SplitPreviewResponse {
    const paid = new Map(
      prepared.input.payers.map((payer) => [payer.participantId, payer.paidAmountMinor]),
    );
    const owed = new Map(
      prepared.allocations.map((allocation) => [
        allocation.participantId,
        allocation.amountMinor.toString(),
      ]),
    );
    const ids = new Set([...paid.keys(), ...owed.keys()]);
    return {
      currency: prepared.input.currency,
      totalAmountMinor: prepared.input.amountMinor,
      allocations: prepared.participants
        .filter((participant) => ids.has(participant.id))
        .map((participant) => {
          const paidMinor = paid.get(participant.id) ?? '0';
          const owedMinor = owed.get(participant.id) ?? '0';
          return {
            participantId: participant.id,
            displayName: participant.displayName,
            paidAmountMinor: paidMinor,
            owedAmountMinor: owedMinor,
            netAmountMinor: (BigInt(paidMinor) - BigInt(owedMinor)).toString(),
          };
        }),
      explanation: explanationByMethod[prepared.input.splitMethod],
      algorithmVersion: prepared.algorithmVersion,
    };
  }

  private expenseResponse(
    expenseId: string,
    prepared: PreparedExpense,
    createdBy: { readonly id: string; readonly displayName: string },
    version = '1',
    revisionNumber = 1,
  ): ExpenseSummaryResponse {
    const participantById = new Map(prepared.participants.map((item) => [item.id, item]));
    const paid = new Map(
      prepared.input.payers.map((payer) => [payer.participantId, payer.paidAmountMinor]),
    );
    return {
      id: expenseId,
      description: prepared.input.description,
      amount: {
        amountMinor: prepared.input.amountMinor,
        currency: prepared.input.currency,
      },
      expenseDate: prepared.input.expenseDate,
      category: prepared.input.category,
      groupId: prepared.input.groupId,
      groupName: prepared.groupName,
      status: 'posted',
      version,
      ...(prepared.input.notes ? { notes: prepared.input.notes } : {}),
      payers: prepared.input.payers
        .map((payer) => ({
          id: payer.participantId,
          displayName: participantById.get(payer.participantId)?.displayName ?? 'Participant',
          paidAmountMinor: payer.paidAmountMinor,
        }))
        .sort(
          (left, right) =>
            (participantById.get(left.id)?.allocationOrder ?? 0) -
            (participantById.get(right.id)?.allocationOrder ?? 0),
        ),
      allocations: prepared.allocations.map((allocation) => ({
        id: allocation.participantId,
        displayName: participantById.get(allocation.participantId)?.displayName ?? 'Participant',
        owedAmountMinor: allocation.amountMinor.toString(),
        netAmountMinor: (
          BigInt(paid.get(allocation.participantId) ?? '0') - allocation.amountMinor
        ).toString(),
      })),
      revisionNumber,
      splitMethod: prepared.input.splitMethod,
      algorithmVersion: prepared.algorithmVersion,
      createdBy,
      canEdit: true,
    };
  }
}
