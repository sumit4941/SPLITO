import { describe, expect, it } from 'vitest';
import type { ExpenseSummary, Participant } from '../types';
import { canEditExpense, expenseEditEntries, expenseEditValues } from './ExpensesPage';

const members: Participant[] = [
  { id: 'creator', displayName: 'Asha', status: 'active' },
  { id: 'friend', displayName: 'Kabir', status: 'active' },
  { id: 'new-member', displayName: 'Meera', status: 'active' },
  { id: 'former', displayName: 'Former member', status: 'former' },
];

function expense(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: 'expense-1',
    description: 'Dinner',
    amount: { amountMinor: '12345', currency: 'INR' },
    expenseDate: '2026-09-13',
    category: 'food',
    groupId: 'group-1',
    groupName: 'Weekend',
    createdBy: { id: 'creator', displayName: 'Asha' },
    canEdit: true,
    status: 'posted',
    version: '4',
    splitMethod: 'exact',
    payers: [{ id: 'creator', displayName: 'Asha', paidAmountMinor: '12345' }],
    allocations: [
      {
        id: 'creator',
        displayName: 'Asha',
        owedAmountMinor: '6000',
        inputValue: '6000',
      },
      {
        id: 'friend',
        displayName: 'Kabir',
        owedAmountMinor: '6345',
        inputValue: '6345',
      },
    ],
    ...overrides,
  };
}

describe('expense editing helpers', () => {
  it('honors the server-authoritative edit permission', () => {
    expect(canEditExpense(expense())).toBe(true);
    expect(canEditExpense(expense({ canEdit: false }))).toBe(false);
    expect(
      canEditExpense(
        expense({ canEdit: false, createdBy: { id: 'creator', displayName: 'Asha' } }),
      ),
    ).toBe(false);
  });

  it('hydrates exact money values without losing minor-unit precision', () => {
    expect(expenseEditValues(expense())).toMatchObject({
      amountMajor: '123.45',
      currency: 'INR',
      groupId: 'group-1',
      splitMethod: 'exact',
    });

    const entries = expenseEditEntries(expense(), members);
    expect(entries.creator).toEqual({ included: true, paidMajor: '123.45', value: '60.00' });
    expect(entries.friend).toEqual({ included: true, paidMajor: '', value: '63.45' });
    expect(entries['new-member']).toEqual({ included: false, paidMajor: '', value: '' });
    expect(entries.former).toBeUndefined();
  });

  it('retains percentage inputs for a replacement revision', () => {
    const percentageExpense = expense({
      splitMethod: 'percentage',
      allocations: [
        {
          id: 'creator',
          displayName: 'Asha',
          owedAmountMinor: '6173',
          inputValue: '50',
        },
        {
          id: 'friend',
          displayName: 'Kabir',
          owedAmountMinor: '6172',
          inputValue: '50',
        },
      ],
    });

    expect(expenseEditEntries(percentageExpense, members).creator.value).toBe('50');
    expect(expenseEditEntries(percentageExpense, members).friend.value).toBe('50');
  });
});
