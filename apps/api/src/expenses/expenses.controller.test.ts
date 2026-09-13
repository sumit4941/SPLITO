import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../auth/auth.types.js';
import { ExpensesController } from './expenses.controller.js';
import type { ExpenseMutationInput } from './expenses.schemas.js';
import type { ExpensesService } from './expenses.service.js';
import type { ExpenseSummaryResponse } from './expenses.types.js';

const participantId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const groupId = '44444444-4444-4444-8444-444444444444';
const expenseId = '55555555-5555-4555-8555-555555555555';

const auth: AuthContext = {
  sessionId: '66666666-6666-4666-8666-666666666666',
  csrfHash: Buffer.alloc(32),
  user: {
    id: participantId,
    userId,
    participantId,
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
  description: 'Dinner',
  amountMinor: '6000',
  currency: 'INR',
  expenseDate: '2026-09-13',
  category: 'food',
  splitMethod: 'equal',
  payers: [{ participantId, paidAmountMinor: '6000' }],
  beneficiaries: [{ participantId }, { participantId: memberId }],
};

const expense: ExpenseSummaryResponse = {
  id: expenseId,
  description: 'Dinner',
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
  createdBy: { id: participantId, displayName: 'Alex' },
  canEdit: true,
};

function replyHarness() {
  const headers = new Map<string, string>();
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return reply;
    }),
  };
  return { headers, reply };
}

describe('expense optimistic-concurrency controller boundary', () => {
  it('requires and forwards both mutation headers, then returns the new strong ETag', async () => {
    const update = vi.fn().mockResolvedValue({ data: expense, replayed: false });
    const controller = new ExpensesController({ update } as unknown as ExpensesService);
    const { headers, reply } = replyHarness();

    await expect(
      controller.update(
        expenseId,
        input,
        'expense-update-1',
        '"3"',
        auth,
        { id: 'request-1' } as never,
        reply as never,
      ),
    ).resolves.toEqual({ data: expense });
    expect(update).toHaveBeenCalledWith(expenseId, input, auth, {
      idempotencyKey: 'expense-update-1',
      expectedVersion: '3',
      requestId: 'request-1',
    });
    expect(headers.get('etag')).toBe('"4"');
  });

  it('rejects a missing If-Match value before invoking the service', async () => {
    const update = vi.fn();
    const controller = new ExpensesController({ update } as unknown as ExpensesService);
    const { reply } = replyHarness();

    await expect(
      controller.update(
        expenseId,
        input,
        'expense-update-2',
        undefined,
        auth,
        { id: 'request-2' } as never,
        reply as never,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_VERSION_REQUIRED', status: 428 });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a missing Idempotency-Key before invoking the service', async () => {
    const update = vi.fn();
    const controller = new ExpensesController({ update } as unknown as ExpensesService);
    const { reply } = replyHarness();

    await expect(
      controller.update(
        expenseId,
        input,
        undefined,
        '"3"',
        auth,
        { id: 'request-3' } as never,
        reply as never,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it('publishes the current strong ETag on authorized detail reads', async () => {
    const detail = vi.fn().mockResolvedValue(expense);
    const controller = new ExpensesController({ detail } as unknown as ExpensesService);
    const { headers, reply } = replyHarness();

    await expect(controller.detail(expenseId, auth, reply as never)).resolves.toEqual({
      data: expense,
    });
    expect(headers.get('etag')).toBe('"4"');
  });
});
