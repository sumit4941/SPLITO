import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Decimal128 } from 'mongodb';
import { ApiError } from '../common/api-error.js';
import { decimalToMinor, minorToDecimal, type MongoUnitOfWork } from '../database/mongo.service.js';
import { compareUuid } from '../database/uuid.js';
import type { ExpenseMutationInput } from './expenses.schemas.js';
import type {
  ContextParticipant,
  ExpenseSummaryResponse,
  PreparedExpense,
} from './expenses.types.js';

interface ExpenseDocument {
  _id: string;
  contextId: string;
  description: string;
  currencyCode: string;
  expenseDate: string;
  businessTimezone: string;
  categoryCode: string;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  createdByParticipantId: string;
  currentRevisionId: string;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ExpensePayerDocument {
  id: string;
  participantId: string;
  paidMinor: Decimal128;
  allocationOrder: number;
}

interface ExpenseShareDocument {
  id: string;
  participantId: string;
  owedMinor: Decimal128;
  allocationOrder: number;
  inputValue?: string;
}

interface ExpenseObligationDocument {
  id: string;
  debtorParticipantId: string;
  creditorParticipantId: string;
  amountMinor: Decimal128;
  matchOrder: number;
  algorithmVersion: string;
}

interface ExpenseRevisionDocument {
  _id: string;
  expenseId: string;
  revisionNumber: number;
  totalMinor: Decimal128;
  splitMethod: string;
  algorithmVersion: string;
  originalInputs: unknown;
  notes?: string;
  previousRevisionId?: string;
  createdByParticipantId: string;
  changeReason?: string;
  payers: ExpensePayerDocument[];
  shares: ExpenseShareDocument[];
  obligations: ExpenseObligationDocument[];
  createdAt: Date;
}

interface LedgerPostingDocument {
  id: string;
  participantId: string;
  amountMinor: Decimal128;
  postingOrder: number;
}

interface LedgerBatchDocument {
  _id: string;
  contextId: string;
  currencyCode: string;
  batchType: 'EXPENSE' | 'REVERSAL' | 'SETTLEMENT';
  sourceType: 'EXPENSE' | 'SETTLEMENT';
  sourceId: string;
  sourceRevisionId: string;
  reversesBatchId?: string;
  idempotencyId: string;
  actorParticipantId: string;
  postings: LedgerPostingDocument[];
  postedAt: Date;
}

interface ParticipantDocument {
  _id: string;
  displayName: string;
}

interface MemberDocument {
  contextId: string;
  participantId: string;
  status: string;
  allocationOrder: number;
}

interface GroupDocument {
  _id: string;
  contextId: string;
  name: string;
}

interface ContextDocument {
  _id: string;
  status: 'ACTIVE' | 'ARCHIVED';
  mutationVersion: number;
}

interface BalanceProjectionDocument {
  _id: string;
  contextId: string;
  participantId: string;
  currencyCode: string;
  netMinor: Decimal128;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StringIdDocument {
  _id: string;
  [key: string]: unknown;
}

export interface ExpenseCursor {
  readonly expenseDate: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface ExpensePage {
  readonly items: ExpenseSummaryResponse[];
  readonly next?: ExpenseCursor;
}

export interface CreateExpenseIds {
  readonly expenseId: string;
  readonly revisionId: string;
  readonly ledgerBatchId?: string;
}

export interface LockedExpenseForUpdate {
  readonly expenseId: string;
  readonly contextId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly contextStatus: 'ACTIVE' | 'ARCHIVED';
  readonly status: 'DRAFT' | 'POSTED' | 'VOIDED';
  readonly currency: string;
  readonly version: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly createdByParticipantId: string;
  readonly createdByDisplayName: string;
}

interface ExpenseFinancialLines {
  readonly postings: readonly {
    readonly participantId: string;
    readonly amountMinor: bigint;
    readonly postingOrder: number;
  }[];
  readonly obligations: readonly {
    readonly debtorParticipantId: string;
    readonly creditorParticipantId: string;
    readonly amountMinor: bigint;
    readonly matchOrder: number;
  }[];
}

export type ExpenseFinancialEffect = ExpenseFinancialLines &
  (
    | {
        readonly batchId?: undefined;
        readonly batchContextId?: undefined;
        readonly batchCurrency?: undefined;
      }
    | {
        readonly batchId: string;
        readonly batchContextId: string;
        readonly batchCurrency: string;
      }
  );

export interface UpdateExpenseIds {
  readonly revisionId: string;
  readonly reversalBatchId?: string;
  readonly replacementBatchId?: string;
}

function options(
  work: MongoUnitOfWork,
): { session: NonNullable<MongoUnitOfWork['session']> } | undefined {
  return work.session ? { session: work.session } : undefined;
}

function inputValueFor(input: ExpenseMutationInput, participantId: string): string | undefined {
  switch (input.splitMethod) {
    case 'equal':
      return undefined;
    case 'exact':
      return input.beneficiaries.find((value) => value.participantId === participantId)
        ?.amountMinor;
    case 'percentage':
      return input.beneficiaries.find((value) => value.participantId === participantId)?.percentage;
    case 'shares':
      return input.beneficiaries.find((value) => value.participantId === participantId)?.shares;
    case 'adjustments':
      return input.beneficiaries.find((value) => value.participantId === participantId)
        ?.adjustmentMinor;
  }
}

function revisionDocument(
  prepared: PreparedExpense,
  values: {
    id: string;
    expenseId: string;
    revisionNumber: number;
    actorParticipantId: string;
    previousRevisionId?: string;
    changeReason?: string;
    createdAt: Date;
  },
): ExpenseRevisionDocument {
  const orderByParticipant = new Map(
    prepared.participants.map((participant) => [participant.id, participant.allocationOrder]),
  );
  return {
    _id: values.id,
    expenseId: values.expenseId,
    revisionNumber: values.revisionNumber,
    totalMinor: minorToDecimal(prepared.input.amountMinor),
    splitMethod: prepared.input.splitMethod.toUpperCase(),
    algorithmVersion: prepared.algorithmVersion,
    originalInputs: {
      splitMethod: prepared.input.splitMethod,
      beneficiaries: prepared.input.beneficiaries,
      payers: prepared.input.payers,
    },
    ...(prepared.input.notes ? { notes: prepared.input.notes } : {}),
    ...(values.previousRevisionId ? { previousRevisionId: values.previousRevisionId } : {}),
    ...(values.changeReason ? { changeReason: values.changeReason } : {}),
    createdByParticipantId: values.actorParticipantId,
    payers: prepared.input.payers.map((payer) => ({
      id: randomUUID(),
      participantId: payer.participantId,
      paidMinor: minorToDecimal(payer.paidAmountMinor),
      allocationOrder: orderByParticipant.get(payer.participantId) ?? 0,
    })),
    shares: prepared.allocations.map((share) => {
      const inputValue = inputValueFor(prepared.input, share.participantId);
      return {
        id: randomUUID(),
        participantId: share.participantId,
        owedMinor: minorToDecimal(share.amountMinor),
        allocationOrder: share.allocationOrder,
        ...(inputValue === undefined ? {} : { inputValue }),
      };
    }),
    obligations: prepared.obligations.map((obligation, matchOrder) => ({
      id: randomUUID(),
      debtorParticipantId: obligation.debtorParticipantId,
      creditorParticipantId: obligation.creditorParticipantId,
      amountMinor: minorToDecimal(obligation.amountMinor),
      matchOrder,
      algorithmVersion: prepared.bilateralAlgorithmVersion,
    })),
    createdAt: values.createdAt,
  };
}

@Injectable()
export class ExpensesRepository {
  async activeParticipants(
    work: MongoUnitOfWork,
    contextId: string,
  ): Promise<{ participants: ContextParticipant[]; groupName: string }> {
    const queryOptions = options(work);
    // MongoDB ClientSession operations must not run in parallel inside a
    // transaction, so transaction-capable repository methods stay sequential.
    const members = await work.db
      .collection<MemberDocument>('contextMembers')
      .find({ contextId, status: 'ACTIVE' }, queryOptions)
      .sort({ allocationOrder: 1, participantId: 1 })
      .toArray();
    const group = await work.db
      .collection<GroupDocument>('groups')
      .findOne({ contextId }, queryOptions);
    const participantIds = members.map((member) => member.participantId);
    const participants = participantIds.length
      ? await work.db
          .collection<ParticipantDocument>('participants')
          .find({ _id: { $in: participantIds } }, queryOptions)
          .toArray()
      : [];
    const participantById = new Map(
      participants.map((participant) => [participant._id, participant]),
    );
    return {
      groupName: group?.name ?? 'Group',
      participants: members.flatMap((member) => {
        const participant = participantById.get(member.participantId);
        return participant
          ? [
              {
                id: participant._id,
                displayName: participant.displayName,
                allocationOrder: member.allocationOrder,
              },
            ]
          : [];
      }),
    };
  }

  async requireActiveCurrency(work: MongoUnitOfWork, currency: string): Promise<void> {
    const row = await work.db
      .collection<{ _id: string; active: boolean }>('currencies')
      .findOne({ _id: currency, active: true }, options(work));
    if (!row) {
      throw new ApiError(422, 'UNSUPPORTED_CURRENCY', 'The requested currency is not active.');
    }
  }

  async lockExpenseForUpdate(
    work: MongoUnitOfWork,
    expenseId: string,
    callerParticipantId: string,
    lock = true,
  ): Promise<LockedExpenseForUpdate | undefined> {
    const queryOptions = options(work);
    const expense = await work.db
      .collection<ExpenseDocument>('expenses')
      .findOne(
        { _id: expenseId, createdByParticipantId: callerParticipantId, status: 'POSTED' },
        queryOptions,
      );
    if (!expense) return undefined;
    // MongoDB has no SELECT ... FOR UPDATE. Mutating the context fence inside
    // the transaction makes concurrent archive/member changes conflict with
    // this edit, while the expense head CAS below fences concurrent edits.
    if (lock) {
      const now = new Date();
      const fence = await work.db
        .collection<ContextDocument>('contexts')
        .updateOne(
          { _id: expense.contextId, status: 'ACTIVE' },
          { $inc: { mutationVersion: 1 }, $set: { updatedAt: now } },
          queryOptions,
        );
      if (fence.modifiedCount !== 1) return undefined;
    }
    const member = await work.db
      .collection<MemberDocument>('contextMembers')
      .findOne(
        { contextId: expense.contextId, participantId: callerParticipantId, status: 'ACTIVE' },
        queryOptions,
      );
    const context = await work.db
      .collection<ContextDocument>('contexts')
      .findOne({ _id: expense.contextId }, queryOptions);
    const group = await work.db
      .collection<GroupDocument>('groups')
      .findOne({ contextId: expense.contextId }, queryOptions);
    const revision = await work.db
      .collection<ExpenseRevisionDocument>('expenseRevisions')
      .findOne({ _id: expense.currentRevisionId }, queryOptions);
    const creator = await work.db
      .collection<ParticipantDocument>('participants')
      .findOne({ _id: expense.createdByParticipantId }, queryOptions);
    if (!member || !context || !group || !revision || !creator || context.status !== 'ACTIVE') {
      return undefined;
    }
    return {
      expenseId: expense._id,
      contextId: expense.contextId,
      groupId: group._id,
      groupName: group.name,
      contextStatus: context.status,
      status: expense.status,
      currency: expense.currencyCode,
      version: expense.version,
      revisionId: revision._id,
      revisionNumber: revision.revisionNumber,
      createdByParticipantId: creator._id,
      createdByDisplayName: creator.displayName,
    };
  }

  async currentFinancialEffect(
    work: MongoUnitOfWork,
    expenseId: string,
    revisionId: string,
  ): Promise<ExpenseFinancialEffect> {
    const queryOptions = options(work);
    const batches = await work.db
      .collection<LedgerBatchDocument>('ledgerBatches')
      .find(
        {
          sourceType: 'EXPENSE',
          sourceId: expenseId,
          sourceRevisionId: revisionId,
          batchType: 'EXPENSE',
        },
        queryOptions,
      )
      .sort({ postedAt: 1, _id: 1 })
      .limit(2)
      .toArray();
    const revision = await work.db
      .collection<ExpenseRevisionDocument>('expenseRevisions')
      .findOne({ _id: revisionId, expenseId }, queryOptions);
    if (batches.length > 1)
      throw new Error('Current expense revision has multiple expense ledger batches');
    if (!revision) throw new Error('Current expense revision is missing');
    const obligations = revision.obligations.map((row) => ({
      debtorParticipantId: row.debtorParticipantId,
      creditorParticipantId: row.creditorParticipantId,
      amountMinor: decimalToMinor(row.amountMinor),
      matchOrder: row.matchOrder,
    }));
    const batch = batches[0];
    if (!batch) {
      if (obligations.length)
        throw new Error('Expense obligations exist without an expense ledger batch');
      return { postings: [], obligations: [] };
    }
    const reversal = await work.db
      .collection<LedgerBatchDocument>('ledgerBatches')
      .findOne({ reversesBatchId: batch._id }, queryOptions);
    if (reversal)
      throw new Error('Current expense revision ledger batch has already been reversed');
    const postings = [...batch.postings]
      .sort(
        (left, right) => left.postingOrder - right.postingOrder || left.id.localeCompare(right.id),
      )
      .map((row) => ({
        participantId: row.participantId,
        amountMinor: decimalToMinor(row.amountMinor),
        postingOrder: row.postingOrder,
      }));
    if (!postings.length) throw new Error('Expense ledger batch contains no postings');
    if (postings.reduce((sum, posting) => sum + posting.amountMinor, 0n) !== 0n) {
      throw new Error('Expense ledger batch postings are not balanced');
    }
    if (!obligations.length)
      throw new Error('Expense ledger batch has no matching bilateral obligations');
    return {
      batchId: batch._id,
      batchContextId: batch.contextId,
      batchCurrency: batch.currencyCode,
      postings,
      obligations,
    };
  }

  async insertPostedExpense(
    work: MongoUnitOfWork,
    values: {
      readonly prepared: PreparedExpense;
      readonly ids: CreateExpenseIds;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly idempotencyId: string;
      readonly requestId: string;
      readonly businessTimezone: string;
    },
  ): Promise<void> {
    const now = new Date();
    const writeOptions = options(work);
    const revision = revisionDocument(values.prepared, {
      id: values.ids.revisionId,
      expenseId: values.ids.expenseId,
      revisionNumber: 1,
      actorParticipantId: values.actorParticipantId,
      createdAt: now,
    });
    await work.db
      .collection<ExpenseRevisionDocument>('expenseRevisions')
      .insertOne(revision, writeOptions);
    await work.db.collection<ExpenseDocument>('expenses').insertOne(
      {
        _id: values.ids.expenseId,
        contextId: values.prepared.contextId,
        description: values.prepared.input.description,
        currencyCode: values.prepared.input.currency,
        expenseDate: values.prepared.input.expenseDate,
        businessTimezone: values.businessTimezone,
        categoryCode: values.prepared.input.category,
        status: 'POSTED',
        createdByParticipantId: values.actorParticipantId,
        currentRevisionId: values.ids.revisionId,
        version: '1',
        createdAt: now,
        updatedAt: now,
      },
      writeOptions,
    );

    if (values.ids.ledgerBatchId) {
      const postings = this.orderedPostings(values.prepared);
      await work.db
        .collection<LedgerBatchDocument>('ledgerBatches')
        .insertOne(
          this.ledgerBatch(
            values.ids.ledgerBatchId,
            values.prepared,
            values.ids.expenseId,
            values.ids.revisionId,
            values,
            postings,
            now,
          ),
          writeOptions,
        );
      for (const posting of postings) {
        await this.applyBalanceDelta(work, {
          contextId: values.prepared.contextId,
          participantId: posting.participantId,
          currency: values.prepared.input.currency,
          deltaMinor: decimalToMinor(posting.amountMinor),
        });
      }
      for (const obligation of values.prepared.obligations) {
        await this.applyBilateralDelta(work, {
          contextId: values.prepared.contextId,
          debtorId: obligation.debtorParticipantId,
          creditorId: obligation.creditorParticipantId,
          currency: values.prepared.input.currency,
          amountMinor: obligation.amountMinor,
        });
      }
    }
    await this.recordMutation(work, {
      now,
      eventType: 'expense.posted',
      action: 'expense.create',
      expenseId: values.ids.expenseId,
      contextId: values.prepared.contextId,
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      requestId: values.requestId,
      metadata: {
        currency: values.prepared.input.currency,
        splitMethod: values.prepared.input.splitMethod,
      },
    });
  }

  async replacePostedExpense(
    work: MongoUnitOfWork,
    values: {
      readonly current: LockedExpenseForUpdate;
      readonly previousEffect: ExpenseFinancialEffect;
      readonly prepared: PreparedExpense;
      readonly ids: UpdateExpenseIds;
      readonly expectedVersion: string;
      readonly nextVersion: string;
      readonly nextRevisionNumber: number;
      readonly actorParticipantId: string;
      readonly actorUserId: string;
      readonly idempotencyId: string;
      readonly requestId: string;
      readonly businessTimezone: string;
    },
  ): Promise<void> {
    if (
      values.previousEffect.batchId &&
      (values.previousEffect.batchContextId !== values.current.contextId ||
        values.previousEffect.batchCurrency !== values.current.currency)
    ) {
      throw new Error('Current expense ledger batch context or currency does not match its head');
    }
    const now = new Date();
    const writeOptions = options(work);
    await work.db.collection<ExpenseRevisionDocument>('expenseRevisions').insertOne(
      revisionDocument(values.prepared, {
        id: values.ids.revisionId,
        expenseId: values.current.expenseId,
        revisionNumber: values.nextRevisionNumber,
        actorParticipantId: values.actorParticipantId,
        previousRevisionId: values.current.revisionId,
        changeReason: 'Creator edited expense',
        createdAt: now,
      }),
      writeOptions,
    );
    const head = await work.db.collection<ExpenseDocument>('expenses').updateOne(
      {
        _id: values.current.expenseId,
        currentRevisionId: values.current.revisionId,
        version: values.expectedVersion,
        status: 'POSTED',
      },
      {
        $set: {
          description: values.prepared.input.description,
          currencyCode: values.prepared.input.currency,
          expenseDate: values.prepared.input.expenseDate,
          businessTimezone: values.businessTimezone,
          categoryCode: values.prepared.input.category,
          currentRevisionId: values.ids.revisionId,
          version: values.nextVersion,
          updatedAt: now,
        },
      },
      writeOptions,
    );
    if (head.modifiedCount !== 1) {
      throw new ApiError(
        412,
        'RESOURCE_VERSION_MISMATCH',
        'The expense changed since it was loaded. Refresh it and retry with the new version.',
      );
    }

    if (values.previousEffect.batchId) {
      if (!values.ids.reversalBatchId)
        throw new Error('A reversal batch ID is required for the current financial effect');
      const reversalPostings = values.previousEffect.postings.map((posting) => ({
        id: randomUUID(),
        participantId: posting.participantId,
        amountMinor: minorToDecimal(-posting.amountMinor),
        postingOrder: posting.postingOrder,
      }));
      await work.db.collection<LedgerBatchDocument>('ledgerBatches').insertOne(
        {
          _id: values.ids.reversalBatchId,
          contextId: values.previousEffect.batchContextId,
          currencyCode: values.previousEffect.batchCurrency,
          batchType: 'REVERSAL',
          sourceType: 'EXPENSE',
          sourceId: values.current.expenseId,
          sourceRevisionId: values.current.revisionId,
          reversesBatchId: values.previousEffect.batchId,
          idempotencyId: values.idempotencyId,
          actorParticipantId: values.actorParticipantId,
          postings: reversalPostings,
          postedAt: now,
        },
        writeOptions,
      );
      for (const posting of values.previousEffect.postings) {
        await this.applyBalanceDelta(work, {
          contextId: values.previousEffect.batchContextId,
          participantId: posting.participantId,
          currency: values.previousEffect.batchCurrency,
          deltaMinor: -posting.amountMinor,
        });
      }
      for (const obligation of values.previousEffect.obligations) {
        await this.applyBilateralDelta(work, {
          contextId: values.previousEffect.batchContextId,
          debtorId: obligation.debtorParticipantId,
          creditorId: obligation.creditorParticipantId,
          currency: values.previousEffect.batchCurrency,
          amountMinor: -obligation.amountMinor,
        });
      }
    } else if (values.ids.reversalBatchId) {
      throw new Error('A reversal batch ID was supplied without a financial effect to reverse');
    }

    if (values.ids.replacementBatchId) {
      const postings = this.orderedPostings(values.prepared);
      if (!postings.length)
        throw new Error('A replacement batch ID was supplied for an expense with no postings');
      await work.db
        .collection<LedgerBatchDocument>('ledgerBatches')
        .insertOne(
          this.ledgerBatch(
            values.ids.replacementBatchId,
            values.prepared,
            values.current.expenseId,
            values.ids.revisionId,
            values,
            postings,
            now,
          ),
          writeOptions,
        );
      for (const posting of postings) {
        await this.applyBalanceDelta(work, {
          contextId: values.prepared.contextId,
          participantId: posting.participantId,
          currency: values.prepared.input.currency,
          deltaMinor: decimalToMinor(posting.amountMinor),
        });
      }
      for (const obligation of values.prepared.obligations) {
        await this.applyBilateralDelta(work, {
          contextId: values.prepared.contextId,
          debtorId: obligation.debtorParticipantId,
          creditorId: obligation.creditorParticipantId,
          currency: values.prepared.input.currency,
          amountMinor: obligation.amountMinor,
        });
      }
    } else if (values.prepared.postings.some((posting) => posting.amountMinor !== 0n)) {
      throw new Error('A replacement ledger batch is required for non-zero postings');
    }

    await this.recordMutation(work, {
      now,
      eventType: 'expense.updated',
      action: 'expense.update',
      expenseId: values.current.expenseId,
      contextId: values.current.contextId,
      actorParticipantId: values.actorParticipantId,
      actorUserId: values.actorUserId,
      requestId: values.requestId,
      metadata: {
        currency: values.prepared.input.currency,
        splitMethod: values.prepared.input.splitMethod,
        previousRevisionNumber: values.current.revisionNumber,
        revisionNumber: values.nextRevisionNumber,
        previousVersion: values.expectedVersion,
        version: values.nextVersion,
      },
    });
  }

  async applyBalanceDelta(
    work: MongoUnitOfWork,
    value: { contextId: string; participantId: string; currency: string; deltaMinor: bigint },
  ): Promise<void> {
    if (value.deltaMinor === 0n) return;
    const now = new Date();
    const projection = await work.db
      .collection<BalanceProjectionDocument>('balanceProjections')
      .findOneAndUpdate(
        {
          contextId: value.contextId,
          participantId: value.participantId,
          currencyCode: value.currency,
        },
        {
          $setOnInsert: { _id: randomUUID(), createdAt: now },
          $inc: { netMinor: minorToDecimal(value.deltaMinor), version: 1 },
          $set: { updatedAt: now },
        },
        {
          upsert: true,
          returnDocument: 'after',
          ...(work.session ? { session: work.session } : {}),
        },
      );
    if (!projection) throw new Error('Balance projection was not persisted');
    // Also enforces the same signed 19-digit storage bound after accumulation.
    decimalToMinor(projection.netMinor);
  }

  async applyBilateralDelta(
    work: MongoUnitOfWork,
    value: {
      contextId: string;
      debtorId: string;
      creditorId: string;
      currency: string;
      amountMinor: bigint;
    },
  ): Promise<void> {
    if (value.amountMinor === 0n) return;
    const debtorIsLow = compareUuid(value.debtorId, value.creditorId) < 0;
    const participantLowId = debtorIsLow ? value.debtorId : value.creditorId;
    const participantHighId = debtorIsLow ? value.creditorId : value.debtorId;
    const signedDelta = debtorIsLow ? value.amountMinor : -value.amountMinor;
    const filter = {
      contextId: value.contextId,
      participantLowId,
      participantHighId,
      currencyCode: value.currency,
    };
    const collection = work.db.collection<{
      _id: string;
      lowOwesHighMinor: Decimal128;
      version: number;
      contextId: string;
      participantLowId: string;
      participantHighId: string;
      currencyCode: string;
    }>('bilateralProjections');
    const now = new Date();
    // Keep zero-valued projection documents. Deleting a unique-index key and
    // reinserting the same pair during an expense replacement can fail inside
    // one MongoDB transaction because the index key is released only at commit.
    const projection = await collection.findOneAndUpdate(
      filter,
      {
        $setOnInsert: { _id: randomUUID() },
        $inc: { lowOwesHighMinor: minorToDecimal(signedDelta), version: 1 },
        $set: { updatedAt: now },
      },
      {
        upsert: true,
        returnDocument: 'after',
        ...(work.session ? { session: work.session } : {}),
      },
    );
    if (!projection) throw new Error('Bilateral projection was not persisted');
    decimalToMinor(projection.lowOwesHighMinor);
  }

  async list(
    work: MongoUnitOfWork,
    values: {
      readonly contextId: string;
      readonly groupId: string;
      readonly callerParticipantId: string;
      readonly limit: number;
      readonly cursor?: ExpenseCursor;
    },
  ): Promise<ExpensePage> {
    const queryOptions = options(work);
    const cursorFilter = values.cursor
      ? {
          $or: [
            { expenseDate: { $lt: values.cursor.expenseDate } },
            {
              expenseDate: values.cursor.expenseDate,
              createdAt: { $lt: new Date(values.cursor.createdAt) },
            },
            {
              expenseDate: values.cursor.expenseDate,
              createdAt: new Date(values.cursor.createdAt),
              _id: { $gt: values.cursor.id },
            },
          ],
        }
      : {};
    const expenses = await work.db
      .collection<ExpenseDocument>('expenses')
      .find({ contextId: values.contextId, ...cursorFilter }, queryOptions)
      .sort({ expenseDate: -1, createdAt: -1, _id: 1 })
      .limit(values.limit + 1)
      .toArray();
    const visible = expenses.slice(0, values.limit);
    const revisionIds = visible.map((expense) => expense.currentRevisionId);
    const participantIds = [...new Set(visible.map((expense) => expense.createdByParticipantId))];
    const revisions = revisionIds.length
      ? await work.db
          .collection<ExpenseRevisionDocument>('expenseRevisions')
          .find({ _id: { $in: revisionIds } }, queryOptions)
          .toArray()
      : [];
    const participants = participantIds.length
      ? await work.db
          .collection<ParticipantDocument>('participants')
          .find({ _id: { $in: participantIds } }, queryOptions)
          .toArray()
      : [];
    const context = await work.db
      .collection<ContextDocument>('contexts')
      .findOne({ _id: values.contextId }, queryOptions);
    const member = await work.db.collection<MemberDocument>('contextMembers').findOne(
      {
        contextId: values.contextId,
        participantId: values.callerParticipantId,
        status: 'ACTIVE',
      },
      queryOptions,
    );
    const group = await work.db
      .collection<GroupDocument>('groups')
      .findOne({ _id: values.groupId }, queryOptions);
    const revisionById = new Map(revisions.map((revision) => [revision._id, revision]));
    const participantById = new Map(
      participants.map((participant) => [participant._id, participant]),
    );
    const last = visible.at(-1);
    return {
      items: visible.flatMap((expense) => {
        const revision = revisionById.get(expense.currentRevisionId);
        const creator = participantById.get(expense.createdByParticipantId);
        if (!revision || !creator) return [];
        return [
          this.summary(
            expense,
            revision,
            values.groupId,
            group?.name ?? 'Group',
            creator,
            Boolean(
              member &&
              context?.status === 'ACTIVE' &&
              expense.createdByParticipantId === values.callerParticipantId,
            ),
          ),
        ];
      }),
      ...(expenses.length > values.limit && last
        ? {
            next: {
              expenseDate: last.expenseDate,
              createdAt: last.createdAt.toISOString(),
              id: last._id,
            },
          }
        : {}),
    };
  }

  async detail(
    work: MongoUnitOfWork,
    expenseId: string,
    callerParticipantId: string,
  ): Promise<ExpenseSummaryResponse | undefined> {
    const queryOptions = options(work);
    const expense = await work.db
      .collection<ExpenseDocument>('expenses')
      .findOne({ _id: expenseId }, queryOptions);
    if (!expense) return undefined;
    const revision = await work.db
      .collection<ExpenseRevisionDocument>('expenseRevisions')
      .findOne({ _id: expense.currentRevisionId }, queryOptions);
    const activeMember = await work.db
      .collection<MemberDocument>('contextMembers')
      .findOne(
        { contextId: expense.contextId, participantId: callerParticipantId, status: 'ACTIVE' },
        queryOptions,
      );
    const member =
      activeMember ??
      (await work.db
        .collection<MemberDocument>('contextMembers')
        .findOne(
          { contextId: expense.contextId, participantId: callerParticipantId, status: 'FORMER' },
          { ...queryOptions, sort: { updatedAt: -1, _id: 1 } },
        ));
    const group = await work.db
      .collection<GroupDocument>('groups')
      .findOne({ contextId: expense.contextId }, queryOptions);
    const context = await work.db
      .collection<ContextDocument>('contexts')
      .findOne({ _id: expense.contextId }, queryOptions);
    const creator = await work.db
      .collection<ParticipantDocument>('participants')
      .findOne({ _id: expense.createdByParticipantId }, queryOptions);
    if (!revision || !member || !group || !context || !creator) return undefined;
    const involved =
      revision.payers.some((payer) => payer.participantId === callerParticipantId) ||
      revision.shares.some((share) => share.participantId === callerParticipantId);
    if (member.status !== 'ACTIVE' && (member.status !== 'FORMER' || !involved)) return undefined;

    const detailParticipantIds = [
      ...new Set([
        ...revision.payers.map((payer) => payer.participantId),
        ...revision.shares.map((share) => share.participantId),
      ]),
    ];
    const detailParticipants = detailParticipantIds.length
      ? await work.db
          .collection<ParticipantDocument>('participants')
          .find({ _id: { $in: detailParticipantIds } }, queryOptions)
          .toArray()
      : [];
    const participantById = new Map(
      detailParticipants.map((participant) => [participant._id, participant]),
    );
    const payers = [...revision.payers]
      .sort(
        (left, right) =>
          left.allocationOrder - right.allocationOrder || left.id.localeCompare(right.id),
      )
      .map((payer) => ({
        id: payer.participantId,
        displayName: participantById.get(payer.participantId)?.displayName ?? 'Participant',
        paidAmountMinor: decimalToMinor(payer.paidMinor).toString(),
      }));
    const paidByParticipant = new Map(
      payers.map((payer) => [payer.id, BigInt(payer.paidAmountMinor)]),
    );
    return {
      ...this.summary(
        expense,
        revision,
        group._id,
        group.name,
        creator,
        Boolean(
          member.status === 'ACTIVE' &&
          context.status === 'ACTIVE' &&
          expense.createdByParticipantId === callerParticipantId,
        ),
      ),
      payers,
      allocations: [...revision.shares]
        .sort(
          (left, right) =>
            left.allocationOrder - right.allocationOrder || left.id.localeCompare(right.id),
        )
        .map((share) => {
          const owed = decimalToMinor(share.owedMinor);
          return {
            id: share.participantId,
            displayName: participantById.get(share.participantId)?.displayName ?? 'Participant',
            owedAmountMinor: owed.toString(),
            netAmountMinor: ((paidByParticipant.get(share.participantId) ?? 0n) - owed).toString(),
            ...(share.inputValue === undefined ? {} : { inputValue: share.inputValue }),
          };
        }),
      splitMethod: revision.splitMethod.toLowerCase(),
      algorithmVersion: revision.algorithmVersion,
    };
  }

  private orderedPostings(prepared: PreparedExpense): LedgerPostingDocument[] {
    const order = new Map(
      prepared.participants.map((participant) => [participant.id, participant.allocationOrder]),
    );
    return [...prepared.postings]
      .filter((posting) => posting.amountMinor !== 0n)
      .sort(
        (left, right) =>
          (order.get(left.participantId) ?? 0) - (order.get(right.participantId) ?? 0),
      )
      .map((posting, postingOrder) => ({
        id: randomUUID(),
        participantId: posting.participantId,
        amountMinor: minorToDecimal(posting.amountMinor),
        postingOrder,
      }));
  }

  private ledgerBatch(
    batchId: string,
    prepared: PreparedExpense,
    expenseId: string,
    revisionId: string,
    values: { idempotencyId: string; actorParticipantId: string },
    postings: LedgerPostingDocument[],
    now: Date,
  ): LedgerBatchDocument {
    return {
      _id: batchId,
      contextId: prepared.contextId,
      currencyCode: prepared.input.currency,
      batchType: 'EXPENSE',
      sourceType: 'EXPENSE',
      sourceId: expenseId,
      sourceRevisionId: revisionId,
      idempotencyId: values.idempotencyId,
      actorParticipantId: values.actorParticipantId,
      postings,
      postedAt: now,
    };
  }

  private async recordMutation(
    work: MongoUnitOfWork,
    values: {
      now: Date;
      eventType: string;
      action: string;
      expenseId: string;
      contextId: string;
      actorParticipantId: string;
      actorUserId: string;
      requestId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const writeOptions = options(work);
    await work.db.collection<StringIdDocument>('outbox').insertOne(
      {
        _id: randomUUID(),
        eventType: values.eventType,
        aggregateType: 'EXPENSE',
        aggregateId: values.expenseId,
        payload: {
          expenseId: values.expenseId,
          contextId: values.contextId,
          invalidation: 'expenses-and-balances',
        },
        status: 'PENDING',
        attempts: 0,
        availableAt: values.now,
        createdAt: values.now,
      },
      writeOptions,
    );
    await work.db.collection<StringIdDocument>('auditEvents').insertOne(
      {
        _id: randomUUID(),
        actorParticipantId: values.actorParticipantId,
        actorUserId: values.actorUserId,
        actionKey: values.action,
        resourceType: 'EXPENSE',
        resourceId: values.expenseId,
        contextId: values.contextId,
        requestId: values.requestId,
        metadata: values.metadata,
        createdAt: values.now,
      },
      writeOptions,
    );
  }

  private summary(
    expense: ExpenseDocument,
    revision: ExpenseRevisionDocument,
    groupId: string,
    groupName: string,
    creator: ParticipantDocument,
    canEdit: boolean,
  ): ExpenseSummaryResponse {
    return {
      id: expense._id,
      description: expense.description,
      amount: {
        amountMinor: decimalToMinor(revision.totalMinor).toString(),
        currency: expense.currencyCode,
      },
      expenseDate: expense.expenseDate,
      category: expense.categoryCode,
      groupId,
      groupName,
      status: expense.status.toLowerCase() as ExpenseSummaryResponse['status'],
      version: expense.version,
      ...(revision.notes ? { notes: revision.notes } : {}),
      payers: [],
      allocations: [],
      revisionNumber: revision.revisionNumber,
      createdBy: { id: creator._id, displayName: creator.displayName },
      canEdit: canEdit && expense.status === 'POSTED',
    };
  }
}
