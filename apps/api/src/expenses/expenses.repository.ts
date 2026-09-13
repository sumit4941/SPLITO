import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Connection } from 'oracledb';
import oracledb from 'oracledb';
import { ApiError } from '../common/api-error.js';
import { compareUuid } from '../database/uuid.js';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';
import type { ExpenseMutationInput } from './expenses.schemas.js';
import type {
  ContextParticipant,
  ExpenseSummaryResponse,
  PreparedExpense,
} from './expenses.types.js';

interface ParticipantRow {
  PARTICIPANT_ID: Buffer;
  DISPLAY_NAME: string;
  ALLOCATION_ORDER: string;
  GROUP_NAME: string;
}

interface ExpenseListRow {
  EXPENSE_ID: Buffer;
  DESCRIPTION: string;
  CURRENCY_CODE: string;
  EXPENSE_DATE_TEXT: string;
  CATEGORY_CODE: string;
  STATUS: 'DRAFT' | 'POSTED' | 'VOIDED';
  VERSION_NO: string;
  TOTAL_MINOR: string;
  GROUP_ID: Buffer;
  GROUP_NAME: string;
  NOTES_TEXT: string | null;
  CREATED_AT_TEXT: string;
  REVISION_NO: string;
  CREATED_BY_ID: Buffer;
  CREATED_BY_NAME: string;
  CAN_EDIT_FLAG: 'Y' | 'N';
}

interface ExpenseDetailRow extends ExpenseListRow {
  REVISION_ID: Buffer;
  SPLIT_METHOD: string;
  ALGORITHM_VERSION: string;
}

interface LockedExpenseRow {
  EXPENSE_ID: Buffer;
  CONTEXT_ID: Buffer;
  GROUP_ID: Buffer;
  GROUP_NAME: string;
  CONTEXT_STATUS: 'ACTIVE' | 'ARCHIVED';
  STATUS: 'DRAFT' | 'POSTED' | 'VOIDED';
  CURRENCY_CODE: string;
  VERSION_NO: string;
  REVISION_ID: Buffer;
  REVISION_NO: string;
  CREATED_BY_ID: Buffer;
  CREATED_BY_NAME: string;
}

interface LedgerBatchLocatorRow {
  BATCH_ID: Buffer;
}

interface LedgerBatchRow extends LedgerBatchLocatorRow {
  CONTEXT_ID: Buffer;
  CURRENCY_CODE: string;
}

interface LedgerPostingRow {
  PARTICIPANT_ID: Buffer;
  AMOUNT_MINOR: string;
  POSTING_ORDER: string;
}

interface ExpenseObligationRow {
  DEBTOR_PARTICIPANT_ID: Buffer;
  CREDITOR_PARTICIPANT_ID: Buffer;
  AMOUNT_MINOR: string;
  MATCH_ORDER: string;
}

interface ExpensePayerRow {
  PARTICIPANT_ID: Buffer;
  DISPLAY_NAME: string;
  PAID_MINOR: string;
}

interface ExpenseShareRow {
  PARTICIPANT_ID: Buffer;
  DISPLAY_NAME: string;
  OWED_MINOR: string;
  INPUT_VALUE_DECIMAL: string | null;
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

function inputValueFor(input: ExpenseMutationInput, participantId: string): string | null {
  switch (input.splitMethod) {
    case 'equal':
      return null;
    case 'exact': {
      const item = input.beneficiaries.find((value) => value.participantId === participantId);
      return item?.amountMinor ?? null;
    }
    case 'percentage': {
      const item = input.beneficiaries.find((value) => value.participantId === participantId);
      return item?.percentage ?? null;
    }
    case 'shares': {
      const item = input.beneficiaries.find((value) => value.participantId === participantId);
      return item?.shares ?? null;
    }
    case 'adjustments': {
      const item = input.beneficiaries.find((value) => value.participantId === participantId);
      return item?.adjustmentMinor ?? null;
    }
  }
}

@Injectable()
export class ExpensesRepository {
  constructor(private readonly oracle: OracleService) {}

  async activeParticipants(
    connection: Connection,
    contextId: string,
    lock: boolean,
  ): Promise<{ participants: ContextParticipant[]; groupName: string }> {
    const result = await this.oracle.execute<ParticipantRow>(
      connection,
      `SELECT P.PARTICIPANT_ID, P.DISPLAY_NAME,
              TO_CHAR(M.ALLOCATION_ORDER) AS ALLOCATION_ORDER,
              G.GROUP_NAME
         FROM SPLITO_CONTEXT_MEMBERS M
         JOIN SPLITO_PARTICIPANTS P ON P.PARTICIPANT_ID = M.PARTICIPANT_ID
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = M.CONTEXT_ID
        WHERE M.CONTEXT_ID = :contextId
          AND M.STATUS = 'ACTIVE'
        ORDER BY M.ALLOCATION_ORDER, P.PARTICIPANT_ID
        ${lock ? 'FOR UPDATE' : ''}`,
      { contextId: uuidToRaw(contextId) },
    );
    const rows = result.rows ?? [];
    return {
      groupName: rows[0]?.GROUP_NAME ?? 'Group',
      participants: rows.map((row) => ({
        id: rawToUuid(row.PARTICIPANT_ID),
        displayName: row.DISPLAY_NAME,
        allocationOrder: Number(row.ALLOCATION_ORDER),
      })),
    };
  }

  async requireActiveCurrency(connection: Connection, currency: string): Promise<void> {
    const result = await this.oracle.execute<{ CURRENCY_CODE: string }>(
      connection,
      `SELECT CURRENCY_CODE
         FROM SPLITO_CURRENCIES
        WHERE CURRENCY_CODE = :currencyCode
          AND ACTIVE_FLAG = 'Y'`,
      { currencyCode: currency },
    );
    if (!result.rows?.[0]) {
      throw new ApiError(422, 'UNSUPPORTED_CURRENCY', 'The requested currency is not active.');
    }
  }

  async lockExpenseForUpdate(
    connection: Connection,
    expenseId: string,
    callerParticipantId: string,
  ): Promise<LockedExpenseForUpdate | undefined> {
    const result = await this.oracle.execute<LockedExpenseRow>(
      connection,
      `SELECT E.EXPENSE_ID, E.CONTEXT_ID, G.GROUP_ID, G.GROUP_NAME,
              C.STATUS AS CONTEXT_STATUS, E.STATUS, E.CURRENCY_CODE,
              TO_CHAR(E.VERSION_NO) AS VERSION_NO,
              R.REVISION_ID, TO_CHAR(R.REVISION_NO) AS REVISION_NO,
              CREATOR.PARTICIPANT_ID AS CREATED_BY_ID,
              CREATOR.DISPLAY_NAME AS CREATED_BY_NAME
         FROM SPLITO_EXPENSES E
         JOIN SPLITO_EXPENSE_REVISIONS R
           ON R.REVISION_ID = E.CURRENT_REVISION_ID
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_PARTICIPANTS CREATOR
           ON CREATOR.PARTICIPANT_ID = E.CREATED_BY_PARTICIPANT_ID
         JOIN SPLITO_CONTEXT_MEMBERS CALLER_M
           ON CALLER_M.CONTEXT_ID = E.CONTEXT_ID
          AND CALLER_M.PARTICIPANT_ID = :callerParticipantId
          AND CALLER_M.STATUS = 'ACTIVE'
        WHERE E.EXPENSE_ID = :expenseId
          AND E.CREATED_BY_PARTICIPANT_ID = :callerParticipantId
          AND E.STATUS = 'POSTED'
          AND C.STATUS = 'ACTIVE'
        FOR UPDATE OF E.VERSION_NO, C.STATUS, CALLER_M.STATUS`,
      {
        expenseId: uuidToRaw(expenseId),
        callerParticipantId: uuidToRaw(callerParticipantId),
      },
    );
    const row = result.rows?.[0];
    if (!row) return undefined;
    const revisionNumber = Number(row.REVISION_NO);
    if (!Number.isSafeInteger(revisionNumber)) {
      throw new Error('Expense revision number exceeds the supported response range');
    }
    return {
      expenseId: rawToUuid(row.EXPENSE_ID),
      contextId: rawToUuid(row.CONTEXT_ID),
      groupId: rawToUuid(row.GROUP_ID),
      groupName: row.GROUP_NAME,
      contextStatus: row.CONTEXT_STATUS,
      status: row.STATUS,
      currency: row.CURRENCY_CODE.trim(),
      version: row.VERSION_NO,
      revisionId: rawToUuid(row.REVISION_ID),
      revisionNumber,
      createdByParticipantId: rawToUuid(row.CREATED_BY_ID),
      createdByDisplayName: row.CREATED_BY_NAME,
    };
  }

  async currentFinancialEffect(
    connection: Connection,
    expenseId: string,
    revisionId: string,
  ): Promise<ExpenseFinancialEffect> {
    const expenseIdRaw = uuidToRaw(expenseId);
    const revisionIdRaw = uuidToRaw(revisionId);
    const batches = await this.oracle.execute<LedgerBatchRow>(
      connection,
      `SELECT B.BATCH_ID, B.CONTEXT_ID, B.CURRENCY_CODE
         FROM SPLITO_LEDGER_BATCHES B
        WHERE B.SOURCE_TYPE = 'EXPENSE'
          AND B.SOURCE_ID = :expenseId
          AND B.SOURCE_REVISION_ID = :revisionId
          AND B.BATCH_TYPE = 'EXPENSE'
        ORDER BY B.POSTED_AT_UTC, B.BATCH_ID
        FOR UPDATE OF B.BATCH_ID`,
      { expenseId: expenseIdRaw, revisionId: revisionIdRaw },
    );
    if ((batches.rows?.length ?? 0) > 1) {
      throw new Error('Current expense revision has multiple expense ledger batches');
    }
    const batch = batches.rows?.[0];

    const obligationsResult = await this.oracle.execute<ExpenseObligationRow>(
      connection,
      `SELECT O.DEBTOR_PARTICIPANT_ID, O.CREDITOR_PARTICIPANT_ID,
              TO_CHAR(O.AMOUNT_MINOR) AS AMOUNT_MINOR,
              TO_CHAR(O.MATCH_ORDER) AS MATCH_ORDER
         FROM SPLITO_EXPENSE_OBLIGATIONS O
        WHERE O.REVISION_ID = :revisionId
        ORDER BY O.MATCH_ORDER, O.OBLIGATION_ID
        FOR UPDATE OF O.AMOUNT_MINOR`,
      { revisionId: revisionIdRaw },
    );
    const obligations = (obligationsResult.rows ?? []).map((row) => ({
      debtorParticipantId: rawToUuid(row.DEBTOR_PARTICIPANT_ID),
      creditorParticipantId: rawToUuid(row.CREDITOR_PARTICIPANT_ID),
      amountMinor: BigInt(row.AMOUNT_MINOR),
      matchOrder: Number(row.MATCH_ORDER),
    }));

    if (!batch) {
      if (obligations.length > 0) {
        throw new Error('Expense obligations exist without an expense ledger batch');
      }
      return { postings: [], obligations: [] };
    }

    const reversal = await this.oracle.execute<LedgerBatchLocatorRow>(
      connection,
      `SELECT BATCH_ID
         FROM SPLITO_LEDGER_BATCHES
        WHERE REVERSES_BATCH_ID = :batchId
        FETCH FIRST 1 ROW ONLY`,
      { batchId: batch.BATCH_ID },
    );
    if (reversal.rows?.[0]) {
      throw new Error('Current expense revision ledger batch has already been reversed');
    }

    const postingsResult = await this.oracle.execute<LedgerPostingRow>(
      connection,
      `SELECT P.PARTICIPANT_ID,
              TO_CHAR(P.AMOUNT_MINOR_SIGNED) AS AMOUNT_MINOR,
              TO_CHAR(P.POSTING_ORDER) AS POSTING_ORDER
         FROM SPLITO_LEDGER_POSTINGS P
        WHERE P.BATCH_ID = :batchId
        ORDER BY P.POSTING_ORDER, P.POSTING_ID
        FOR UPDATE OF P.AMOUNT_MINOR_SIGNED`,
      { batchId: batch.BATCH_ID },
    );
    const postings = (postingsResult.rows ?? []).map((row) => ({
      participantId: rawToUuid(row.PARTICIPANT_ID),
      amountMinor: BigInt(row.AMOUNT_MINOR),
      postingOrder: Number(row.POSTING_ORDER),
    }));
    if (postings.length === 0) {
      throw new Error('Expense ledger batch contains no postings');
    }
    if (postings.reduce((sum, posting) => sum + posting.amountMinor, 0n) !== 0n) {
      throw new Error('Expense ledger batch postings are not balanced');
    }
    if (obligations.length === 0) {
      throw new Error('Expense ledger batch has no matching bilateral obligations');
    }
    return {
      batchId: rawToUuid(batch.BATCH_ID),
      batchContextId: rawToUuid(batch.CONTEXT_ID),
      batchCurrency: batch.CURRENCY_CODE.trim(),
      postings,
      obligations,
    };
  }

  async insertPostedExpense(
    connection: Connection,
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
    const { input } = values.prepared;
    const expenseId = uuidToRaw(values.ids.expenseId);
    const revisionId = uuidToRaw(values.ids.revisionId);
    const contextId = uuidToRaw(values.prepared.contextId);
    const actorParticipantId = uuidToRaw(values.actorParticipantId);

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_EXPENSES (
         EXPENSE_ID, CONTEXT_ID, DESCRIPTION, CURRENCY_CODE, EXPENSE_DATE,
         BUSINESS_TIMEZONE, CATEGORY_CODE, STATUS, CREATED_BY_PARTICIPANT_ID
       ) VALUES (
         :expenseId, :contextId, :description, :currencyCode,
         TO_DATE(:expenseDate, 'YYYY-MM-DD'), :businessTimezone,
         :categoryCode, 'POSTED', :actorParticipantId
       )`,
      {
        expenseId,
        contextId,
        description: input.description,
        currencyCode: input.currency,
        expenseDate: input.expenseDate,
        businessTimezone: values.businessTimezone,
        categoryCode: input.category,
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_EXPENSE_REVISIONS (
         REVISION_ID, EXPENSE_ID, REVISION_NO, TOTAL_MINOR, SPLIT_METHOD,
         ALGORITHM_VERSION, ORIGINAL_INPUTS_JSON, NOTES_TEXT,
         CREATED_BY_PARTICIPANT_ID
       ) VALUES (
         :revisionId, :expenseId, 1, :totalMinor, :splitMethod,
         :algorithmVersion, :originalInputs, :notesText, :actorParticipantId
       )`,
      {
        revisionId,
        expenseId,
        totalMinor: input.amountMinor,
        splitMethod: input.splitMethod.toUpperCase(),
        algorithmVersion: values.prepared.algorithmVersion,
        originalInputs: {
          val: JSON.stringify({
            splitMethod: input.splitMethod,
            beneficiaries: input.beneficiaries,
            payers: input.payers,
          }),
          type: oracledb.CLOB,
        },
        notesText: input.notes ?? null,
        actorParticipantId,
      },
    );
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_EXPENSES
          SET CURRENT_REVISION_ID = :revisionId
        WHERE EXPENSE_ID = :expenseId`,
      { revisionId, expenseId },
    );

    const orderByParticipant = new Map(
      values.prepared.participants.map((participant) => [
        participant.id,
        participant.allocationOrder,
      ]),
    );
    for (const payer of input.payers) {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_EXPENSE_PAYERS (
           EXPENSE_PAYER_ID, REVISION_ID, PARTICIPANT_ID, PAID_MINOR, ALLOCATION_ORDER
         ) VALUES (:id, :revisionId, :participantId, :paidMinor, :allocationOrder)`,
        {
          id: uuidToRaw(randomUUID()),
          revisionId,
          participantId: uuidToRaw(payer.participantId),
          paidMinor: payer.paidAmountMinor,
          allocationOrder: orderByParticipant.get(payer.participantId),
        },
      );
    }
    for (const allocation of values.prepared.allocations) {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_EXPENSE_SHARES (
           EXPENSE_SHARE_ID, REVISION_ID, PARTICIPANT_ID, OWED_MINOR,
           ALLOCATION_ORDER, INPUT_VALUE_DECIMAL
         ) VALUES (:id, :revisionId, :participantId, :owedMinor, :allocationOrder, :inputValue)`,
        {
          id: uuidToRaw(randomUUID()),
          revisionId,
          participantId: uuidToRaw(allocation.participantId),
          owedMinor: allocation.amountMinor.toString(),
          allocationOrder: allocation.allocationOrder,
          inputValue: inputValueFor(input, allocation.participantId),
        },
      );
    }

    if (values.ids.ledgerBatchId) {
      const batchId = uuidToRaw(values.ids.ledgerBatchId);
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_LEDGER_BATCHES (
           BATCH_ID, CONTEXT_ID, CURRENCY_CODE, BATCH_TYPE, SOURCE_TYPE,
           SOURCE_ID, SOURCE_REVISION_ID, IDEMPOTENCY_KEY_ID, ACTOR_PARTICIPANT_ID
         ) VALUES (
           :batchId, :contextId, :currencyCode, 'EXPENSE', 'EXPENSE',
           :expenseId, :revisionId, :idempotencyId, :actorParticipantId
         )`,
        {
          batchId,
          contextId,
          currencyCode: input.currency,
          expenseId,
          revisionId,
          idempotencyId: uuidToRaw(values.idempotencyId),
          actorParticipantId,
        },
      );
      const orderedPostings = [...values.prepared.postings]
        .filter((posting) => posting.amountMinor !== 0n)
        .sort(
          (left, right) =>
            (orderByParticipant.get(left.participantId) ?? 0) -
            (orderByParticipant.get(right.participantId) ?? 0),
        );
      for (const [postingOrder, posting] of orderedPostings.entries()) {
        await this.oracle.execute(
          connection,
          `INSERT INTO SPLITO_LEDGER_POSTINGS (
             POSTING_ID, BATCH_ID, PARTICIPANT_ID, AMOUNT_MINOR_SIGNED, POSTING_ORDER
           ) VALUES (:id, :batchId, :participantId, :amountMinor, :postingOrder)`,
          {
            id: uuidToRaw(randomUUID()),
            batchId,
            participantId: uuidToRaw(posting.participantId),
            amountMinor: posting.amountMinor.toString(),
            postingOrder,
          },
        );
        await this.applyBalanceDelta(connection, {
          contextId: values.prepared.contextId,
          participantId: posting.participantId,
          currency: input.currency,
          deltaMinor: posting.amountMinor,
        });
      }
      for (const [matchOrder, obligation] of values.prepared.obligations.entries()) {
        await this.oracle.execute(
          connection,
          `INSERT INTO SPLITO_EXPENSE_OBLIGATIONS (
             OBLIGATION_ID, REVISION_ID, DEBTOR_PARTICIPANT_ID,
             CREDITOR_PARTICIPANT_ID, AMOUNT_MINOR, MATCH_ORDER, ALGORITHM_VERSION
           ) VALUES (
             :id, :revisionId, :debtorId, :creditorId,
             :amountMinor, :matchOrder, :algorithmVersion
           )`,
          {
            id: uuidToRaw(randomUUID()),
            revisionId,
            debtorId: uuidToRaw(obligation.debtorParticipantId),
            creditorId: uuidToRaw(obligation.creditorParticipantId),
            amountMinor: obligation.amountMinor.toString(),
            matchOrder,
            algorithmVersion: values.prepared.bilateralAlgorithmVersion,
          },
        );
        await this.applyBilateralDelta(connection, {
          contextId: values.prepared.contextId,
          debtorId: obligation.debtorParticipantId,
          creditorId: obligation.creditorParticipantId,
          currency: input.currency,
          amountMinor: obligation.amountMinor,
        });
      }
    }

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (:outboxId, 'expense.posted', 'EXPENSE', :expenseId, :payload)`,
      {
        outboxId: uuidToRaw(randomUUID()),
        expenseId,
        payload: {
          val: JSON.stringify({
            expenseId: values.ids.expenseId,
            contextId: values.prepared.contextId,
            invalidation: 'expenses-and-balances',
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
         :id, :actorParticipantId, :actorUserId, 'expense.create',
         'EXPENSE', :expenseId, :contextId, :requestId, :metadata
       )`,
      {
        id: uuidToRaw(randomUUID()),
        actorParticipantId,
        actorUserId: uuidToRaw(values.actorUserId),
        expenseId,
        contextId,
        requestId: values.requestId,
        metadata: JSON.stringify({ currency: input.currency, splitMethod: input.splitMethod }),
      },
    );
  }

  async replacePostedExpense(
    connection: Connection,
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
    const { input } = values.prepared;
    const expenseId = uuidToRaw(values.current.expenseId);
    const contextId = uuidToRaw(values.current.contextId);
    const revisionId = uuidToRaw(values.ids.revisionId);
    const previousRevisionId = uuidToRaw(values.current.revisionId);
    const actorParticipantId = uuidToRaw(values.actorParticipantId);
    const idempotencyId = uuidToRaw(values.idempotencyId);
    if (
      values.previousEffect.batchId &&
      (values.previousEffect.batchContextId !== values.current.contextId ||
        values.previousEffect.batchCurrency !== values.current.currency)
    ) {
      throw new Error('Current expense ledger batch context or currency does not match its head');
    }

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_EXPENSE_REVISIONS (
         REVISION_ID, EXPENSE_ID, REVISION_NO, TOTAL_MINOR, SPLIT_METHOD,
         ALGORITHM_VERSION, ORIGINAL_INPUTS_JSON, NOTES_TEXT,
         PREVIOUS_REVISION_ID, CREATED_BY_PARTICIPANT_ID, CHANGE_REASON
       ) VALUES (
         :revisionId, :expenseId, :revisionNumber, :totalMinor, :splitMethod,
         :algorithmVersion, :originalInputs, :notesText,
         :previousRevisionId, :actorParticipantId, :changeReason
       )`,
      {
        revisionId,
        expenseId,
        revisionNumber: values.nextRevisionNumber,
        totalMinor: input.amountMinor,
        splitMethod: input.splitMethod.toUpperCase(),
        algorithmVersion: values.prepared.algorithmVersion,
        originalInputs: {
          val: JSON.stringify({
            splitMethod: input.splitMethod,
            beneficiaries: input.beneficiaries,
            payers: input.payers,
          }),
          type: oracledb.CLOB,
        },
        notesText: input.notes ?? null,
        previousRevisionId,
        actorParticipantId,
        changeReason: 'Creator edited expense',
      },
    );

    const orderByParticipant = new Map(
      values.prepared.participants.map((participant) => [
        participant.id,
        participant.allocationOrder,
      ]),
    );
    for (const payer of input.payers) {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_EXPENSE_PAYERS (
           EXPENSE_PAYER_ID, REVISION_ID, PARTICIPANT_ID, PAID_MINOR, ALLOCATION_ORDER
         ) VALUES (:id, :revisionId, :participantId, :paidMinor, :allocationOrder)`,
        {
          id: uuidToRaw(randomUUID()),
          revisionId,
          participantId: uuidToRaw(payer.participantId),
          paidMinor: payer.paidAmountMinor,
          allocationOrder: orderByParticipant.get(payer.participantId),
        },
      );
    }
    for (const allocation of values.prepared.allocations) {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_EXPENSE_SHARES (
           EXPENSE_SHARE_ID, REVISION_ID, PARTICIPANT_ID, OWED_MINOR,
           ALLOCATION_ORDER, INPUT_VALUE_DECIMAL
         ) VALUES (:id, :revisionId, :participantId, :owedMinor, :allocationOrder, :inputValue)`,
        {
          id: uuidToRaw(randomUUID()),
          revisionId,
          participantId: uuidToRaw(allocation.participantId),
          owedMinor: allocation.amountMinor.toString(),
          allocationOrder: allocation.allocationOrder,
          inputValue: inputValueFor(input, allocation.participantId),
        },
      );
    }

    const headUpdate = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_EXPENSES
          SET DESCRIPTION = :description,
              CURRENCY_CODE = :currencyCode,
              EXPENSE_DATE = TO_DATE(:expenseDate, 'YYYY-MM-DD'),
              BUSINESS_TIMEZONE = :businessTimezone,
              CATEGORY_CODE = :categoryCode,
              CURRENT_REVISION_ID = :revisionId,
              VERSION_NO = VERSION_NO + 1,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE EXPENSE_ID = :expenseId
          AND CURRENT_REVISION_ID = :previousRevisionId
          AND VERSION_NO = :expectedVersion
          AND STATUS = 'POSTED'`,
      {
        description: input.description,
        currencyCode: input.currency,
        expenseDate: input.expenseDate,
        businessTimezone: values.businessTimezone,
        categoryCode: input.category,
        revisionId,
        expenseId,
        previousRevisionId,
        expectedVersion: values.expectedVersion,
      },
    );
    if (headUpdate.rowsAffected !== 1) {
      throw new ApiError(
        412,
        'RESOURCE_VERSION_MISMATCH',
        'The expense changed since it was loaded. Refresh it and retry with the new version.',
      );
    }

    if (values.previousEffect.batchId) {
      if (!values.ids.reversalBatchId) {
        throw new Error('A reversal batch ID is required for the current financial effect');
      }
      const reversalBatchId = uuidToRaw(values.ids.reversalBatchId);
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_LEDGER_BATCHES (
           BATCH_ID, CONTEXT_ID, CURRENCY_CODE, BATCH_TYPE, SOURCE_TYPE,
           SOURCE_ID, SOURCE_REVISION_ID, REVERSES_BATCH_ID,
           IDEMPOTENCY_KEY_ID, ACTOR_PARTICIPANT_ID
         ) VALUES (
           :batchId, :contextId, :currencyCode, 'REVERSAL', 'EXPENSE',
           :expenseId, :revisionId, :reversesBatchId,
           :idempotencyId, :actorParticipantId
         )`,
        {
          batchId: reversalBatchId,
          contextId: uuidToRaw(values.previousEffect.batchContextId),
          currencyCode: values.previousEffect.batchCurrency,
          expenseId,
          revisionId: previousRevisionId,
          reversesBatchId: uuidToRaw(values.previousEffect.batchId),
          idempotencyId,
          actorParticipantId,
        },
      );
      for (const posting of values.previousEffect.postings) {
        const reversalAmount = -posting.amountMinor;
        await this.oracle.execute(
          connection,
          `INSERT INTO SPLITO_LEDGER_POSTINGS (
             POSTING_ID, BATCH_ID, PARTICIPANT_ID, AMOUNT_MINOR_SIGNED, POSTING_ORDER
           ) VALUES (:id, :batchId, :participantId, :amountMinor, :postingOrder)`,
          {
            id: uuidToRaw(randomUUID()),
            batchId: reversalBatchId,
            participantId: uuidToRaw(posting.participantId),
            amountMinor: reversalAmount.toString(),
            postingOrder: posting.postingOrder,
          },
        );
        await this.applyBalanceDelta(connection, {
          contextId: values.previousEffect.batchContextId,
          participantId: posting.participantId,
          currency: values.previousEffect.batchCurrency,
          deltaMinor: reversalAmount,
        });
      }
      for (const obligation of values.previousEffect.obligations) {
        await this.applyBilateralDelta(connection, {
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
      const replacementBatchId = uuidToRaw(values.ids.replacementBatchId);
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_LEDGER_BATCHES (
           BATCH_ID, CONTEXT_ID, CURRENCY_CODE, BATCH_TYPE, SOURCE_TYPE,
           SOURCE_ID, SOURCE_REVISION_ID, IDEMPOTENCY_KEY_ID, ACTOR_PARTICIPANT_ID
         ) VALUES (
           :batchId, :contextId, :currencyCode, 'EXPENSE', 'EXPENSE',
           :expenseId, :revisionId, :idempotencyId, :actorParticipantId
         )`,
        {
          batchId: replacementBatchId,
          contextId,
          currencyCode: input.currency,
          expenseId,
          revisionId,
          idempotencyId,
          actorParticipantId,
        },
      );
      const orderedPostings = [...values.prepared.postings]
        .filter((posting) => posting.amountMinor !== 0n)
        .sort(
          (left, right) =>
            (orderByParticipant.get(left.participantId) ?? 0) -
            (orderByParticipant.get(right.participantId) ?? 0),
        );
      if (orderedPostings.length === 0) {
        throw new Error('A replacement batch ID was supplied for an expense with no postings');
      }
      for (const [postingOrder, posting] of orderedPostings.entries()) {
        await this.oracle.execute(
          connection,
          `INSERT INTO SPLITO_LEDGER_POSTINGS (
             POSTING_ID, BATCH_ID, PARTICIPANT_ID, AMOUNT_MINOR_SIGNED, POSTING_ORDER
           ) VALUES (:id, :batchId, :participantId, :amountMinor, :postingOrder)`,
          {
            id: uuidToRaw(randomUUID()),
            batchId: replacementBatchId,
            participantId: uuidToRaw(posting.participantId),
            amountMinor: posting.amountMinor.toString(),
            postingOrder,
          },
        );
        await this.applyBalanceDelta(connection, {
          contextId: values.prepared.contextId,
          participantId: posting.participantId,
          currency: input.currency,
          deltaMinor: posting.amountMinor,
        });
      }
      for (const [matchOrder, obligation] of values.prepared.obligations.entries()) {
        await this.oracle.execute(
          connection,
          `INSERT INTO SPLITO_EXPENSE_OBLIGATIONS (
             OBLIGATION_ID, REVISION_ID, DEBTOR_PARTICIPANT_ID,
             CREDITOR_PARTICIPANT_ID, AMOUNT_MINOR, MATCH_ORDER, ALGORITHM_VERSION
           ) VALUES (
             :id, :revisionId, :debtorId, :creditorId,
             :amountMinor, :matchOrder, :algorithmVersion
           )`,
          {
            id: uuidToRaw(randomUUID()),
            revisionId,
            debtorId: uuidToRaw(obligation.debtorParticipantId),
            creditorId: uuidToRaw(obligation.creditorParticipantId),
            amountMinor: obligation.amountMinor.toString(),
            matchOrder,
            algorithmVersion: values.prepared.bilateralAlgorithmVersion,
          },
        );
        await this.applyBilateralDelta(connection, {
          contextId: values.prepared.contextId,
          debtorId: obligation.debtorParticipantId,
          creditorId: obligation.creditorParticipantId,
          currency: input.currency,
          amountMinor: obligation.amountMinor,
        });
      }
    } else {
      if (values.prepared.postings.some((posting) => posting.amountMinor !== 0n)) {
        throw new Error('A replacement ledger batch ID is required for nonzero postings');
      }
      if (values.prepared.obligations.length > 0) {
        throw new Error('An expense without postings cannot contain bilateral obligations');
      }
    }

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (:outboxId, 'expense.updated', 'EXPENSE', :expenseId, :payload)`,
      {
        outboxId: uuidToRaw(randomUUID()),
        expenseId,
        payload: {
          val: JSON.stringify({
            expenseId: values.current.expenseId,
            contextId: values.current.contextId,
            revisionNumber: values.nextRevisionNumber,
            version: values.nextVersion,
            invalidation: 'expenses-and-balances',
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
         :id, :actorParticipantId, :actorUserId, 'expense.update',
         'EXPENSE', :expenseId, :contextId, :requestId, :metadata
       )`,
      {
        id: uuidToRaw(randomUUID()),
        actorParticipantId,
        actorUserId: uuidToRaw(values.actorUserId),
        expenseId,
        contextId,
        requestId: values.requestId,
        metadata: JSON.stringify({
          previousCurrency: values.current.currency,
          currency: input.currency,
          splitMethod: input.splitMethod,
          previousRevisionNumber: values.current.revisionNumber,
          revisionNumber: values.nextRevisionNumber,
          previousVersion: values.expectedVersion,
          version: values.nextVersion,
        }),
      },
    );
  }

  async applyBalanceDelta(
    connection: Connection,
    value: {
      readonly contextId: string;
      readonly participantId: string;
      readonly currency: string;
      readonly deltaMinor: bigint;
    },
  ): Promise<void> {
    await this.oracle.execute(
      connection,
      `MERGE INTO SPLITO_BALANCE_PROJECTIONS TARGET
       USING (
         SELECT :contextId AS CONTEXT_ID, :participantId AS PARTICIPANT_ID,
                :currencyCode AS CURRENCY_CODE, :deltaMinor AS DELTA_MINOR
           FROM DUAL
       ) SOURCE
       ON (
         TARGET.CONTEXT_ID = SOURCE.CONTEXT_ID
         AND TARGET.PARTICIPANT_ID = SOURCE.PARTICIPANT_ID
         AND TARGET.CURRENCY_CODE = SOURCE.CURRENCY_CODE
       )
       WHEN MATCHED THEN UPDATE SET
         TARGET.NET_MINOR_SIGNED = TARGET.NET_MINOR_SIGNED + SOURCE.DELTA_MINOR,
         TARGET.PROJECTION_VERSION = TARGET.PROJECTION_VERSION + 1,
         TARGET.UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
       WHEN NOT MATCHED THEN INSERT (
         CONTEXT_ID, PARTICIPANT_ID, CURRENCY_CODE, NET_MINOR_SIGNED, PROJECTION_VERSION
       ) VALUES (
         SOURCE.CONTEXT_ID, SOURCE.PARTICIPANT_ID, SOURCE.CURRENCY_CODE, SOURCE.DELTA_MINOR, 1
       )`,
      {
        contextId: uuidToRaw(value.contextId),
        participantId: uuidToRaw(value.participantId),
        currencyCode: value.currency,
        deltaMinor: value.deltaMinor.toString(),
      },
    );
  }

  async applyBilateralDelta(
    connection: Connection,
    value: {
      readonly contextId: string;
      readonly debtorId: string;
      readonly creditorId: string;
      readonly currency: string;
      readonly amountMinor: bigint;
    },
  ): Promise<void> {
    const debtorIsLow = compareUuid(value.debtorId, value.creditorId) < 0;
    const lowId = debtorIsLow ? value.debtorId : value.creditorId;
    const highId = debtorIsLow ? value.creditorId : value.debtorId;
    const signedDelta = debtorIsLow ? value.amountMinor : -value.amountMinor;
    const identityBinds = {
      contextId: uuidToRaw(value.contextId),
      lowId: uuidToRaw(lowId),
      highId: uuidToRaw(highId),
      currencyCode: value.currency,
    };
    const current = await this.oracle.execute<{ AMOUNT_MINOR: string }>(
      connection,
      `SELECT TO_CHAR(LOW_OWES_HIGH_MINOR_SIGNED) AS AMOUNT_MINOR
         FROM SPLITO_BILATERAL_PROJECTIONS
        WHERE CONTEXT_ID = :contextId
          AND PARTICIPANT_LOW_ID = :lowId
          AND PARTICIPANT_HIGH_ID = :highId
          AND CURRENCY_CODE = :currencyCode
        FOR UPDATE`,
      identityBinds,
    );
    const existing = current.rows?.[0];
    if (!existing) {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_BILATERAL_PROJECTIONS (
           CONTEXT_ID, PARTICIPANT_LOW_ID, PARTICIPANT_HIGH_ID,
           CURRENCY_CODE, LOW_OWES_HIGH_MINOR_SIGNED, PROJECTION_VERSION
         ) VALUES (
           :contextId, :lowId, :highId, :currencyCode, :deltaMinor, 1
         )`,
        { ...identityBinds, deltaMinor: signedDelta.toString() },
      );
      return;
    }

    const nextAmount = BigInt(existing.AMOUNT_MINOR) + signedDelta;
    if (nextAmount === 0n) {
      await this.oracle.execute(
        connection,
        `DELETE FROM SPLITO_BILATERAL_PROJECTIONS
          WHERE CONTEXT_ID = :contextId
            AND PARTICIPANT_LOW_ID = :lowId
            AND PARTICIPANT_HIGH_ID = :highId
            AND CURRENCY_CODE = :currencyCode`,
        identityBinds,
      );
      return;
    }
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_BILATERAL_PROJECTIONS
          SET LOW_OWES_HIGH_MINOR_SIGNED = :nextAmount,
              PROJECTION_VERSION = PROJECTION_VERSION + 1,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE CONTEXT_ID = :contextId
          AND PARTICIPANT_LOW_ID = :lowId
          AND PARTICIPANT_HIGH_ID = :highId
          AND CURRENCY_CODE = :currencyCode`,
      { ...identityBinds, nextAmount: nextAmount.toString() },
    );
  }

  async list(
    connection: Connection,
    values: {
      readonly contextId: string;
      readonly groupId: string;
      readonly callerParticipantId: string;
      readonly limit: number;
      readonly cursor?: ExpenseCursor;
    },
  ): Promise<ExpensePage> {
    const cursorPredicate = values.cursor
      ? `AND (
           E.EXPENSE_DATE < TO_DATE(:cursorDate, 'YYYY-MM-DD') OR
           (E.EXPENSE_DATE = TO_DATE(:cursorDate, 'YYYY-MM-DD') AND E.CREATED_AT_UTC < TO_TIMESTAMP(:cursorCreatedAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"')) OR
           (E.EXPENSE_DATE = TO_DATE(:cursorDate, 'YYYY-MM-DD') AND E.CREATED_AT_UTC = TO_TIMESTAMP(:cursorCreatedAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AND E.EXPENSE_ID > :cursorId)
         )`
      : '';
    const result = await this.oracle.execute<ExpenseListRow>(
      connection,
      `SELECT E.EXPENSE_ID, E.DESCRIPTION, E.CURRENCY_CODE,
              TO_CHAR(E.EXPENSE_DATE, 'YYYY-MM-DD') AS EXPENSE_DATE_TEXT,
              E.CATEGORY_CODE, E.STATUS, TO_CHAR(E.VERSION_NO) AS VERSION_NO,
              TO_CHAR(R.TOTAL_MINOR) AS TOTAL_MINOR, G.GROUP_ID, G.GROUP_NAME,
              R.NOTES_TEXT, TO_CHAR(R.REVISION_NO) AS REVISION_NO,
              CREATOR.PARTICIPANT_ID AS CREATED_BY_ID,
              CREATOR.DISPLAY_NAME AS CREATED_BY_NAME,
              CASE
                WHEN E.CREATED_BY_PARTICIPANT_ID = :callerParticipantId
                 AND E.STATUS = 'POSTED'
                 AND C.STATUS = 'ACTIVE'
                 AND EXISTS (
                   SELECT 1
                     FROM SPLITO_CONTEXT_MEMBERS EDITOR_M
                    WHERE EDITOR_M.CONTEXT_ID = E.CONTEXT_ID
                      AND EDITOR_M.PARTICIPANT_ID = :callerParticipantId
                      AND EDITOR_M.STATUS = 'ACTIVE'
                 )
                THEN 'Y' ELSE 'N'
              END AS CAN_EDIT_FLAG,
              TO_CHAR(E.CREATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS CREATED_AT_TEXT
         FROM SPLITO_EXPENSES E
         JOIN SPLITO_EXPENSE_REVISIONS R ON R.REVISION_ID = E.CURRENT_REVISION_ID
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_PARTICIPANTS CREATOR
           ON CREATOR.PARTICIPANT_ID = E.CREATED_BY_PARTICIPANT_ID
        WHERE E.CONTEXT_ID = :contextId
          ${cursorPredicate}
        ORDER BY E.EXPENSE_DATE DESC, E.CREATED_AT_UTC DESC, E.EXPENSE_ID
        FETCH FIRST :fetchCount ROWS ONLY`,
      {
        contextId: uuidToRaw(values.contextId),
        callerParticipantId: uuidToRaw(values.callerParticipantId),
        fetchCount: values.limit + 1,
        ...(values.cursor
          ? {
              cursorDate: values.cursor.expenseDate,
              cursorCreatedAt: values.cursor.createdAt,
              cursorId: uuidToRaw(values.cursor.id),
            }
          : {}),
      },
    );
    const rows = result.rows ?? [];
    const hasMore = rows.length > values.limit;
    const visible = rows.slice(0, values.limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => ({
        id: rawToUuid(row.EXPENSE_ID),
        description: row.DESCRIPTION,
        amount: { amountMinor: row.TOTAL_MINOR, currency: row.CURRENCY_CODE.trim() },
        expenseDate: row.EXPENSE_DATE_TEXT,
        category: row.CATEGORY_CODE,
        groupId: rawToUuid(row.GROUP_ID),
        groupName: row.GROUP_NAME,
        status: row.STATUS.toLowerCase() as ExpenseSummaryResponse['status'],
        version: row.VERSION_NO,
        ...(row.NOTES_TEXT ? { notes: row.NOTES_TEXT } : {}),
        payers: [],
        allocations: [],
        revisionNumber: Number(row.REVISION_NO),
        createdBy: {
          id: rawToUuid(row.CREATED_BY_ID),
          displayName: row.CREATED_BY_NAME,
        },
        canEdit: row.CAN_EDIT_FLAG === 'Y',
      })),
      ...(hasMore && last
        ? {
            next: {
              expenseDate: last.EXPENSE_DATE_TEXT,
              createdAt: last.CREATED_AT_TEXT,
              id: rawToUuid(last.EXPENSE_ID),
            },
          }
        : {}),
    };
  }

  async detail(
    connection: Connection,
    expenseId: string,
    callerParticipantId: string,
  ): Promise<ExpenseSummaryResponse | undefined> {
    const result = await this.oracle.execute<ExpenseDetailRow>(
      connection,
      `SELECT E.EXPENSE_ID, E.DESCRIPTION, E.CURRENCY_CODE,
              TO_CHAR(E.EXPENSE_DATE, 'YYYY-MM-DD') AS EXPENSE_DATE_TEXT,
              E.CATEGORY_CODE, E.STATUS, TO_CHAR(E.VERSION_NO) AS VERSION_NO,
              TO_CHAR(R.TOTAL_MINOR) AS TOTAL_MINOR, G.GROUP_ID, G.GROUP_NAME,
              R.NOTES_TEXT, R.REVISION_ID, TO_CHAR(R.REVISION_NO) AS REVISION_NO,
              R.SPLIT_METHOD, R.ALGORITHM_VERSION,
              CREATOR.PARTICIPANT_ID AS CREATED_BY_ID,
              CREATOR.DISPLAY_NAME AS CREATED_BY_NAME,
              CASE
                WHEN E.CREATED_BY_PARTICIPANT_ID = :callerParticipantId
                 AND E.STATUS = 'POSTED'
                 AND C.STATUS = 'ACTIVE'
                 AND EXISTS (
                   SELECT 1
                     FROM SPLITO_CONTEXT_MEMBERS EDITOR_M
                    WHERE EDITOR_M.CONTEXT_ID = E.CONTEXT_ID
                      AND EDITOR_M.PARTICIPANT_ID = :callerParticipantId
                      AND EDITOR_M.STATUS = 'ACTIVE'
                 )
                THEN 'Y' ELSE 'N'
              END AS CAN_EDIT_FLAG,
              TO_CHAR(E.CREATED_AT_UTC, 'YYYY-MM-DD"T"HH24:MI:SS.FF6"Z"') AS CREATED_AT_TEXT
         FROM SPLITO_EXPENSES E
         JOIN SPLITO_EXPENSE_REVISIONS R ON R.REVISION_ID = E.CURRENT_REVISION_ID
         JOIN SPLITO_CONTEXTS C ON C.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_GROUPS G ON G.CONTEXT_ID = E.CONTEXT_ID
         JOIN SPLITO_PARTICIPANTS CREATOR
           ON CREATOR.PARTICIPANT_ID = E.CREATED_BY_PARTICIPANT_ID
        WHERE E.EXPENSE_ID = :expenseId
          AND EXISTS (
            SELECT 1
              FROM SPLITO_CONTEXT_MEMBERS CALLER_M
             WHERE CALLER_M.CONTEXT_ID = E.CONTEXT_ID
               AND CALLER_M.PARTICIPANT_ID = :callerParticipantId
               AND (
                 CALLER_M.STATUS = 'ACTIVE'
                 OR (
                   CALLER_M.STATUS IN ('LEFT', 'REMOVED')
                   AND (
                     EXISTS (
                       SELECT 1 FROM SPLITO_EXPENSE_PAYERS EP
                        WHERE EP.REVISION_ID = R.REVISION_ID
                          AND EP.PARTICIPANT_ID = :callerParticipantId
                     )
                     OR EXISTS (
                       SELECT 1 FROM SPLITO_EXPENSE_SHARES ES
                        WHERE ES.REVISION_ID = R.REVISION_ID
                          AND ES.PARTICIPANT_ID = :callerParticipantId
                     )
                   )
                 )
               )
          )`,
      {
        expenseId: uuidToRaw(expenseId),
        callerParticipantId: uuidToRaw(callerParticipantId),
      },
    );
    const row = result.rows?.[0];
    if (!row) return undefined;

    const payersResult = await this.oracle.execute<ExpensePayerRow>(
      connection,
      `SELECT P.PARTICIPANT_ID, P.DISPLAY_NAME, TO_CHAR(EP.PAID_MINOR) AS PAID_MINOR
         FROM SPLITO_EXPENSE_PAYERS EP
         JOIN SPLITO_PARTICIPANTS P ON P.PARTICIPANT_ID = EP.PARTICIPANT_ID
        WHERE EP.REVISION_ID = :revisionId
        ORDER BY EP.ALLOCATION_ORDER, EP.EXPENSE_PAYER_ID`,
      { revisionId: row.REVISION_ID },
    );
    const sharesResult = await this.oracle.execute<ExpenseShareRow>(
      connection,
      `SELECT P.PARTICIPANT_ID, P.DISPLAY_NAME, TO_CHAR(ES.OWED_MINOR) AS OWED_MINOR,
              ES.INPUT_VALUE_DECIMAL
         FROM SPLITO_EXPENSE_SHARES ES
         JOIN SPLITO_PARTICIPANTS P ON P.PARTICIPANT_ID = ES.PARTICIPANT_ID
        WHERE ES.REVISION_ID = :revisionId
        ORDER BY ES.ALLOCATION_ORDER, ES.EXPENSE_SHARE_ID`,
      { revisionId: row.REVISION_ID },
    );
    const payers = (payersResult.rows ?? []).map((payer) => ({
      id: rawToUuid(payer.PARTICIPANT_ID),
      displayName: payer.DISPLAY_NAME,
      paidAmountMinor: payer.PAID_MINOR,
    }));
    const paidByParticipant = new Map(
      payers.map((payer) => [payer.id, BigInt(payer.paidAmountMinor)]),
    );

    return {
      id: rawToUuid(row.EXPENSE_ID),
      description: row.DESCRIPTION,
      amount: { amountMinor: row.TOTAL_MINOR, currency: row.CURRENCY_CODE.trim() },
      expenseDate: row.EXPENSE_DATE_TEXT,
      category: row.CATEGORY_CODE,
      groupId: rawToUuid(row.GROUP_ID),
      groupName: row.GROUP_NAME,
      status: row.STATUS.toLowerCase() as ExpenseSummaryResponse['status'],
      version: row.VERSION_NO,
      ...(row.NOTES_TEXT ? { notes: row.NOTES_TEXT } : {}),
      payers,
      allocations: (sharesResult.rows ?? []).map((share) => {
        const id = rawToUuid(share.PARTICIPANT_ID);
        const owed = BigInt(share.OWED_MINOR);
        return {
          id,
          displayName: share.DISPLAY_NAME,
          owedAmountMinor: share.OWED_MINOR,
          netAmountMinor: ((paidByParticipant.get(id) ?? 0n) - owed).toString(),
          ...(share.INPUT_VALUE_DECIMAL ? { inputValue: share.INPUT_VALUE_DECIMAL } : {}),
        };
      }),
      revisionNumber: Number(row.REVISION_NO),
      splitMethod: row.SPLIT_METHOD.toLowerCase(),
      algorithmVersion: row.ALGORITHM_VERSION,
      createdBy: {
        id: rawToUuid(row.CREATED_BY_ID),
        displayName: row.CREATED_BY_NAME,
      },
      canEdit: row.CAN_EDIT_FLAG === 'Y',
    };
  }
}
