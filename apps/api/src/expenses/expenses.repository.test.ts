import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import type { OracleService } from '../database/oracle.service.js';
import { ExpensesRepository } from './expenses.repository.js';
import type { LockedExpenseForUpdate } from './expenses.repository.js';
import type { PreparedExpense } from './expenses.types.js';

const expenseId = '11111111-1111-4111-8111-111111111111';
const callerId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const revisionId = '44444444-4444-4444-8444-444444444444';
const contextId = '55555555-5555-4555-8555-555555555555';
const memberId = '66666666-6666-4666-8666-666666666666';
const previousBatchId = '77777777-7777-4777-8777-777777777777';
const nextRevisionId = '88888888-8888-4888-8888-888888888888';
const reversalBatchId = '99999999-9999-4999-8999-999999999999';
const replacementBatchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idempotencyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');

describe('authorized expense detail repository mapping', () => {
  it('maps current revision, payers, shares, and signed nets with string money', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            EXPENSE_ID: raw(expenseId),
            DESCRIPTION: 'Dinner',
            CURRENCY_CODE: 'INR',
            EXPENSE_DATE_TEXT: '2026-09-12',
            CATEGORY_CODE: 'food',
            STATUS: 'POSTED',
            VERSION_NO: '3',
            TOTAL_MINOR: '10000',
            GROUP_ID: raw(groupId),
            GROUP_NAME: 'Goa trip',
            NOTES_TEXT: 'Shared meal',
            CREATED_AT_TEXT: '2026-09-12T12:00:00.000000Z',
            REVISION_ID: raw(revisionId),
            REVISION_NO: '2',
            SPLIT_METHOD: 'EQUAL',
            ALGORITHM_VERSION: 'splito-largest-remainder-v1',
            CREATED_BY_ID: raw(callerId),
            CREATED_BY_NAME: 'Alex',
            CAN_EDIT_FLAG: 'Y',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ PARTICIPANT_ID: raw(callerId), DISPLAY_NAME: 'Alex', PAID_MINOR: '10000' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            PARTICIPANT_ID: raw(callerId),
            DISPLAY_NAME: 'Alex',
            OWED_MINOR: '5000',
            INPUT_VALUE_DECIMAL: null,
          },
          {
            PARTICIPANT_ID: raw('55555555-5555-4555-8555-555555555555'),
            DISPLAY_NAME: 'Sam',
            OWED_MINOR: '5000',
            INPUT_VALUE_DECIMAL: null,
          },
        ],
      });
    const repository = new ExpensesRepository({ execute } as unknown as OracleService);

    const detail = await repository.detail({} as Connection, expenseId, callerId);

    expect(detail).toMatchObject({
      id: expenseId,
      amount: { amountMinor: '10000', currency: 'INR' },
      status: 'posted',
      version: '3',
      revisionNumber: 2,
      splitMethod: 'equal',
      algorithmVersion: 'splito-largest-remainder-v1',
      createdBy: { id: callerId, displayName: 'Alex' },
      canEdit: true,
      payers: [{ id: callerId, paidAmountMinor: '10000' }],
      allocations: [
        { id: callerId, owedAmountMinor: '5000', netAmountMinor: '5000' },
        {
          id: '55555555-5555-4555-8555-555555555555',
          owedAmountMinor: '5000',
          netAmountMinor: '-5000',
        },
      ],
    });
    const authorizationSql = String(execute.mock.calls[0]?.[1]);
    expect(authorizationSql).toContain('SPLITO_CONTEXT_MEMBERS');
    expect(authorizationSql).toContain('CALLER_M.PARTICIPANT_ID = :callerParticipantId');
    expect(authorizationSql).toContain("EDITOR_M.STATUS = 'ACTIVE'");
    expect(authorizationSql).toContain("C.STATUS = 'ACTIVE'");
    expect(execute.mock.calls[0]?.[2]).toMatchObject({
      expenseId: raw(expenseId),
      callerParticipantId: raw(callerId),
    });
  });

  it('returns no data and does not query nested rows when authorization filters the expense', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
    const repository = new ExpensesRepository({ execute } as unknown as OracleService);

    await expect(repository.detail({} as Connection, expenseId, callerId)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('creator-only expense update repository', () => {
  it('locks the expense head, context, and active caller membership before mapping edit state', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          EXPENSE_ID: raw(expenseId),
          CONTEXT_ID: raw(contextId),
          GROUP_ID: raw(groupId),
          GROUP_NAME: 'Goa trip',
          CONTEXT_STATUS: 'ACTIVE',
          STATUS: 'POSTED',
          CURRENCY_CODE: 'INR',
          VERSION_NO: '3',
          REVISION_ID: raw(revisionId),
          REVISION_NO: '2',
          CREATED_BY_ID: raw(callerId),
          CREATED_BY_NAME: 'Alex',
        },
      ],
    });
    const repository = new ExpensesRepository({ execute } as unknown as OracleService);

    await expect(
      repository.lockExpenseForUpdate({} as Connection, expenseId, callerId),
    ).resolves.toEqual({
      expenseId,
      contextId,
      groupId,
      groupName: 'Goa trip',
      contextStatus: 'ACTIVE',
      status: 'POSTED',
      currency: 'INR',
      version: '3',
      revisionId,
      revisionNumber: 2,
      createdByParticipantId: callerId,
      createdByDisplayName: 'Alex',
    });
    const sql = String(execute.mock.calls[0]?.[1]);
    expect(sql).toContain("CALLER_M.STATUS = 'ACTIVE'");
    expect(sql).toContain('E.CREATED_BY_PARTICIPANT_ID = :callerParticipantId');
    expect(sql).toContain("E.STATUS = 'POSTED'");
    expect(sql).toContain("C.STATUS = 'ACTIVE'");
    expect(sql).toContain('FOR UPDATE OF E.VERSION_NO, C.STATUS, CALLER_M.STATUS');
  });

  it('loads only the unreversed current expense batch and preserves exact posting order', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            BATCH_ID: raw(previousBatchId),
            CONTEXT_ID: raw(contextId),
            CURRENCY_CODE: 'INR',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            DEBTOR_PARTICIPANT_ID: raw(memberId),
            CREDITOR_PARTICIPANT_ID: raw(callerId),
            AMOUNT_MINOR: '5000',
            MATCH_ORDER: '0',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { PARTICIPANT_ID: raw(callerId), AMOUNT_MINOR: '5000', POSTING_ORDER: '0' },
          { PARTICIPANT_ID: raw(memberId), AMOUNT_MINOR: '-5000', POSTING_ORDER: '1' },
        ],
      });
    const repository = new ExpensesRepository({ execute } as unknown as OracleService);

    await expect(
      repository.currentFinancialEffect({} as Connection, expenseId, revisionId),
    ).resolves.toEqual({
      batchId: previousBatchId,
      batchContextId: contextId,
      batchCurrency: 'INR',
      postings: [
        { participantId: callerId, amountMinor: 5000n, postingOrder: 0 },
        { participantId: memberId, amountMinor: -5000n, postingOrder: 1 },
      ],
      obligations: [
        {
          debtorParticipantId: memberId,
          creditorParticipantId: callerId,
          amountMinor: 5000n,
          matchOrder: 0,
        },
      ],
    });
    expect(String(execute.mock.calls[0]?.[1])).toContain("B.BATCH_TYPE = 'EXPENSE'");
    expect(String(execute.mock.calls[2]?.[1])).toContain('REVERSES_BATCH_ID = :batchId');
    expect(String(execute.mock.calls[3]?.[1])).toContain('ORDER BY P.POSTING_ORDER');
  });

  it('writes an immutable revision, exact reversal, replacement, projections, outbox, and audit', async () => {
    const execute = vi.fn().mockImplementation((_connection, sql: string) => {
      if (sql.includes('UPDATE SPLITO_EXPENSES')) return Promise.resolve({ rowsAffected: 1 });
      if (sql.includes('SELECT TO_CHAR(LOW_OWES_HIGH_MINOR_SIGNED)')) {
        return Promise.resolve({ rows: [{ AMOUNT_MINOR: '5000' }] });
      }
      return Promise.resolve({ rows: [], rowsAffected: 1 });
    });
    const repository = new ExpensesRepository({ execute } as unknown as OracleService);
    const current: LockedExpenseForUpdate = {
      expenseId,
      contextId,
      groupId,
      groupName: 'Goa trip',
      contextStatus: 'ACTIVE',
      status: 'POSTED',
      currency: 'INR',
      version: '3',
      revisionId,
      revisionNumber: 2,
      createdByParticipantId: callerId,
      createdByDisplayName: 'Alex',
    };
    const prepared: PreparedExpense = {
      input: {
        groupId,
        description: 'Updated dinner',
        amountMinor: '6000',
        currency: 'USD',
        expenseDate: '2026-09-13',
        category: 'food',
        notes: 'Corrected',
        splitMethod: 'equal',
        payers: [{ participantId: callerId, paidAmountMinor: '6000' }],
        beneficiaries: [{ participantId: callerId }, { participantId: memberId }],
      },
      contextId,
      groupName: 'Goa trip',
      participants: [
        { id: callerId, displayName: 'Alex', allocationOrder: 0 },
        { id: memberId, displayName: 'Sam', allocationOrder: 1 },
      ],
      allocations: [
        { participantId: callerId, amountMinor: 3000n, allocationOrder: 0 },
        { participantId: memberId, amountMinor: 3000n, allocationOrder: 1 },
      ],
      postings: [
        { participantId: callerId, amountMinor: 3000n },
        { participantId: memberId, amountMinor: -3000n },
      ],
      obligations: [
        {
          debtorParticipantId: memberId,
          creditorParticipantId: callerId,
          amountMinor: 3000n,
        },
      ],
      algorithmVersion: 'splito-largest-remainder-v1',
      bilateralAlgorithmVersion: 'splito-bilateral-greedy-v1',
      splitMethod: 'equal',
    };

    await repository.replacePostedExpense({} as Connection, {
      current,
      previousEffect: {
        batchId: previousBatchId,
        batchContextId: contextId,
        batchCurrency: 'INR',
        postings: [
          { participantId: callerId, amountMinor: 5000n, postingOrder: 0 },
          { participantId: memberId, amountMinor: -5000n, postingOrder: 1 },
        ],
        obligations: [
          {
            debtorParticipantId: memberId,
            creditorParticipantId: callerId,
            amountMinor: 5000n,
            matchOrder: 0,
          },
        ],
      },
      prepared,
      ids: { revisionId: nextRevisionId, reversalBatchId, replacementBatchId },
      expectedVersion: '3',
      nextVersion: '4',
      nextRevisionNumber: 3,
      actorParticipantId: callerId,
      actorUserId,
      idempotencyId,
      requestId: 'request-update',
      businessTimezone: 'Asia/Kolkata',
    });

    const calls = execute.mock.calls.map((call) => ({
      sql: String(call[1]),
      binds: call[2] as Record<string, unknown>,
    }));
    const revision = calls.find((call) =>
      call.sql.includes('INSERT INTO SPLITO_EXPENSE_REVISIONS'),
    );
    expect(revision?.sql).toContain('PREVIOUS_REVISION_ID');
    expect(revision?.binds).toMatchObject({
      revisionId: raw(nextRevisionId),
      previousRevisionId: raw(revisionId),
      revisionNumber: 3,
    });

    const head = calls.find((call) => call.sql.includes('UPDATE SPLITO_EXPENSES'));
    expect(head?.sql).toContain('VERSION_NO = VERSION_NO + 1');
    expect(head?.sql).toContain('AND VERSION_NO = :expectedVersion');
    expect(head?.binds).toMatchObject({ expectedVersion: '3', revisionId: raw(nextRevisionId) });

    const batchCalls = calls.filter((call) =>
      call.sql.includes('INSERT INTO SPLITO_LEDGER_BATCHES'),
    );
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0]?.sql).toContain("'REVERSAL'");
    expect(batchCalls[0]?.binds).toMatchObject({
      currencyCode: 'INR',
      reversesBatchId: raw(previousBatchId),
      revisionId: raw(revisionId),
    });
    expect(batchCalls[1]?.sql).toContain("'EXPENSE'");
    expect(batchCalls[1]?.binds).toMatchObject({
      currencyCode: 'USD',
      revisionId: raw(nextRevisionId),
    });

    const postingCalls = calls.filter((call) =>
      call.sql.includes('INSERT INTO SPLITO_LEDGER_POSTINGS'),
    );
    expect(postingCalls.map((call) => call.binds.amountMinor)).toEqual([
      '-5000',
      '5000',
      '3000',
      '-3000',
    ]);
    expect(postingCalls.slice(0, 2).map((call) => call.binds.postingOrder)).toEqual([0, 1]);

    const balanceCalls = calls.filter((call) =>
      call.sql.includes('MERGE INTO SPLITO_BALANCE_PROJECTIONS'),
    );
    expect(balanceCalls.map((call) => [call.binds.currencyCode, call.binds.deltaMinor])).toEqual([
      ['INR', '-5000'],
      ['INR', '5000'],
      ['USD', '3000'],
      ['USD', '-3000'],
    ]);
    expect(calls.some((call) => call.sql.includes("'expense.updated'"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("'expense.update'"))).toBe(true);
  });
});
