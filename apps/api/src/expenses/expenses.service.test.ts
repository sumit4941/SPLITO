import { describe, expect, it, vi } from 'vitest';
import type { ContextAccessRepository } from '../access/context-access.repository.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { MongoService, MongoUnitOfWork } from '../database/mongo.service.js';
import type { IdempotencyService } from '../idempotency/idempotency.service.js';
import type { ExpenseMutationInput } from './expenses.schemas.js';
import type { ExpensesRepository, LockedExpenseForUpdate } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';
import type { ExpenseSummaryResponse } from './expenses.types.js';

const userId = '11111111-1111-4111-8111-111111111111';
const creatorId = '22222222-2222-4222-8222-222222222222';
const memberId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';
const contextId = '55555555-5555-4555-8555-555555555555';
const expenseId = '66666666-6666-4666-8666-666666666666';
const revisionId = '77777777-7777-4777-8777-777777777777';
const batchId = '88888888-8888-4888-8888-888888888888';
const idempotencyId = '99999999-9999-4999-8999-999999999999';

const auth: AuthContext = {
  sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  csrfHash: Buffer.alloc(32),
  user: {
    id: creatorId,
    userId,
    participantId: creatorId,
    displayName: 'Alex',
    mobileNumber: '+12025550101',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
    theme: 'system',
    reducedMotion: false,
    version: '1',
  },
};

const input: ExpenseMutationInput = {
  groupId,
  description: 'Updated dinner',
  amountMinor: '6000',
  currency: 'INR',
  expenseDate: '2026-09-13',
  category: 'food',
  notes: 'Creator correction',
  splitMethod: 'equal',
  payers: [{ participantId: creatorId, paidAmountMinor: '6000' }],
  beneficiaries: [{ participantId: creatorId }, { participantId: memberId }],
};

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
  createdByParticipantId: creatorId,
  createdByDisplayName: 'Alex',
};

function harness(
  options: {
    readonly locked?: LockedExpenseForUpdate | null;
    readonly replay?: ExpenseSummaryResponse;
  } = {},
) {
  const connection = {} as MongoUnitOfWork;
  const repository = {
    lockExpenseForUpdate: vi
      .fn()
      .mockResolvedValue(options.locked === null ? undefined : (options.locked ?? current)),
    activeParticipants: vi.fn().mockResolvedValue({
      groupName: 'Goa trip',
      participants: [
        { id: creatorId, displayName: 'Alex', allocationOrder: 0 },
        { id: memberId, displayName: 'Sam', allocationOrder: 1 },
      ],
    }),
    requireActiveCurrency: vi.fn().mockResolvedValue(undefined),
    currentFinancialEffect: vi.fn().mockResolvedValue({
      batchId,
      postings: [
        { participantId: creatorId, amountMinor: 5000n, postingOrder: 0 },
        { participantId: memberId, amountMinor: -5000n, postingOrder: 1 },
      ],
      obligations: [
        {
          debtorParticipantId: memberId,
          creditorParticipantId: creatorId,
          amountMinor: 5000n,
          matchOrder: 0,
        },
      ],
    }),
    replacePostedExpense: vi.fn().mockResolvedValue(undefined),
  };
  const idempotency = {
    claim: vi
      .fn()
      .mockResolvedValue(
        options.replay
          ? { id: idempotencyId, replay: { status: 200, body: options.replay } }
          : { id: idempotencyId },
      ),
    complete: vi.fn().mockResolvedValue(undefined),
  };
  const mongo = {
    withTransaction: vi.fn(async (operation: (value: MongoUnitOfWork) => Promise<unknown>) =>
      operation(connection),
    ),
  };
  return {
    idempotency,
    repository,
    service: new ExpensesService(
      mongo as unknown as MongoService,
      {} as ContextAccessRepository,
      repository as unknown as ExpensesRepository,
      idempotency as unknown as IdempotencyService,
    ),
  };
}

describe('creator-only expense update service', () => {
  it('appends the next revision and returns server-derived edit metadata for the creator', async () => {
    const { idempotency, repository, service } = harness();

    const result = await service.update(expenseId, input, auth, {
      idempotencyKey: 'expense-update-1',
      expectedVersion: '3',
      requestId: 'request-1',
    });

    expect(result.replayed).toBe(false);
    expect(result.data).toMatchObject({
      id: expenseId,
      description: 'Updated dinner',
      version: '4',
      revisionNumber: 3,
      createdBy: { id: creatorId, displayName: 'Alex' },
      canEdit: true,
    });
    expect(repository.lockExpenseForUpdate).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expenseId,
      creatorId,
      false,
    );
    expect(repository.lockExpenseForUpdate).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expenseId,
      creatorId,
      true,
    );
    expect(repository.replacePostedExpense).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        current,
        expectedVersion: '3',
        nextVersion: '4',
        nextRevisionNumber: 3,
        actorParticipantId: creatorId,
        idempotencyId,
        previousEffect: expect.objectContaining({ batchId }),
        ids: expect.objectContaining({
          revisionId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          reversalBatchId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          replacementBatchId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        }),
      }),
    );
    expect(idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ httpStatus: 200, resourceId: expenseId }),
    );
  });

  it('hides an active non-creator before claiming idempotency or preparing money', async () => {
    const { idempotency, repository, service } = harness({
      locked: null,
    });

    await expect(
      service.update(expenseId, input, auth, {
        idempotencyKey: 'expense-update-2',
        expectedVersion: '3',
        requestId: 'request-2',
      }),
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND', status: 404 });
    expect(idempotency.claim).not.toHaveBeenCalled();
    expect(repository.activeParticipants).not.toHaveBeenCalled();
    expect(repository.replacePostedExpense).not.toHaveBeenCalled();
  });

  it('fails closed for a removed or otherwise inactive caller hidden by the lock query', async () => {
    const { idempotency, service } = harness({ locked: null });

    await expect(
      service.update(expenseId, input, auth, {
        idempotencyKey: 'expense-update-3',
        expectedVersion: '3',
        requestId: 'request-3',
      }),
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND', status: 404 });
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('claims the request before checking the version so a completed retry can replay', async () => {
    const replay: ExpenseSummaryResponse = {
      id: expenseId,
      description: 'Updated dinner',
      amount: { amountMinor: '6000', currency: 'INR' },
      expenseDate: '2026-09-13',
      category: 'food',
      groupId,
      groupName: 'Goa trip',
      status: 'posted',
      version: '4',
      payers: [],
      allocations: [],
      revisionNumber: 3,
      splitMethod: 'equal',
      algorithmVersion: 'splito-largest-remainder-v1',
      createdBy: { id: creatorId, displayName: 'Alex' },
      canEdit: true,
    };
    const { idempotency, repository, service } = harness({
      locked: { ...current, version: '4', revisionNumber: 3 },
      replay,
    });

    await expect(
      service.update(expenseId, input, auth, {
        idempotencyKey: 'expense-update-4',
        expectedVersion: '3',
        requestId: 'request-4',
      }),
    ).resolves.toEqual({ data: replay, replayed: true });
    expect(idempotency.claim).toHaveBeenCalledOnce();
    expect(repository.lockExpenseForUpdate).toHaveBeenCalledOnce();
    expect(repository.lockExpenseForUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expenseId,
      creatorId,
      false,
    );
    expect(repository.activeParticipants).not.toHaveBeenCalled();
    expect(repository.currentFinancialEffect).not.toHaveBeenCalled();
    expect(repository.replacePostedExpense).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('returns precondition failed for a new request with a stale If-Match value', async () => {
    const { idempotency, repository, service } = harness();

    await expect(
      service.update(expenseId, input, auth, {
        idempotencyKey: 'expense-update-5',
        expectedVersion: '2',
        requestId: 'request-5',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_VERSION_MISMATCH', status: 412 });
    expect(idempotency.claim).toHaveBeenCalledOnce();
    expect(repository.activeParticipants).not.toHaveBeenCalled();
    expect(repository.currentFinancialEffect).not.toHaveBeenCalled();
    expect(repository.replacePostedExpense).not.toHaveBeenCalled();
  });

  it('hides archived contexts even when the caller is the creator', async () => {
    const { idempotency, service } = harness({
      locked: null,
    });

    await expect(
      service.update(expenseId, input, auth, {
        idempotencyKey: 'expense-update-6',
        expectedVersion: '3',
        requestId: 'request-6',
      }),
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND', status: 404 });
    expect(idempotency.claim).not.toHaveBeenCalled();
  });
});
