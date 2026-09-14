import { describe, expect, it } from 'vitest';
import { expenseMutationSchema } from './expenses.schemas.js';

const participantA = '11111111-1111-4111-8111-111111111111';
const participantB = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';

function generatedParticipant(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function baseExpense() {
  return {
    groupId,
    description: 'Dinner',
    amountMinor: '10000',
    currency: 'INR',
    expenseDate: '2026-09-12',
    category: 'food',
    payers: [{ participantId: participantA, paidAmountMinor: '10000' }],
  };
}

describe('expense request allowlists', () => {
  it("accepts the web client's equal-split wire contract", () => {
    const result = expenseMutationSchema.safeParse({
      ...baseExpense(),
      splitMethod: 'equal',
      beneficiaries: [{ participantId: participantA }, { participantId: participantB }],
      originalSplitInputs: [{ participantId: participantA }, { participantId: participantB }],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    {
      splitMethod: 'exact',
      beneficiaries: [
        { participantId: participantA, amountMinor: '5000' },
        { participantId: participantB, amountMinor: '5000' },
      ],
    },
    {
      splitMethod: 'percentage',
      beneficiaries: [
        { participantId: participantA, percentage: '55.5' },
        { participantId: participantB, percentage: '44.5' },
      ],
    },
    {
      splitMethod: 'shares',
      beneficiaries: [
        { participantId: participantA, shares: '1' },
        { participantId: participantB, shares: '2' },
      ],
    },
    {
      splitMethod: 'adjustments',
      beneficiaries: [
        { participantId: participantA, adjustmentMinor: '-100' },
        { participantId: participantB, adjustmentMinor: '100' },
      ],
    },
  ])('accepts $splitMethod inputs with decimal strings', (split) => {
    expect(expenseMutationSchema.safeParse({ ...baseExpense(), ...split }).success).toBe(true);
  });

  it('rejects unknown writable fields at the root and nested levels', () => {
    expect(
      expenseMutationSchema.safeParse({
        ...baseExpense(),
        splitMethod: 'equal',
        beneficiaries: [{ participantId: participantA, isAdmin: true }],
        forcePosted: true,
      }).success,
    ).toBe(false);
  });

  it('caps the combined payer and beneficiary posting fan-out at 100 participants', () => {
    const beneficiaries = Array.from({ length: 100 }, (_, index) => ({
      participantId: generatedParticipant(index + 1),
    }));
    expect(
      expenseMutationSchema.safeParse({
        ...baseExpense(),
        splitMethod: 'equal',
        beneficiaries,
      }).success,
    ).toBe(false);

    expect(
      expenseMutationSchema.safeParse({
        ...baseExpense(),
        payers: [{ participantId: beneficiaries[0]?.participantId, paidAmountMinor: '10000' }],
        splitMethod: 'equal',
        beneficiaries,
      }).success,
    ).toBe(true);
  });

  it.each([
    { amountMinor: 10000 },
    { amountMinor: '010000' },
    { amountMinor: '100.00' },
    { amountMinor: '10000000000000000000' },
    { expenseDate: '2026-02-30' },
  ])('rejects unsafe money/date representation %#', (change) => {
    expect(
      expenseMutationSchema.safeParse({
        ...baseExpense(),
        ...change,
        splitMethod: 'equal',
        beneficiaries: [{ participantId: participantA }],
      }).success,
    ).toBe(false);
  });
});
