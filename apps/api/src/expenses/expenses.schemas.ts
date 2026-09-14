import { z } from 'zod';

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu)
  .transform((value) => value.toLowerCase());
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,18}$/);
const unsignedMinor = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/);
const signedMinor = z.string().regex(/^(?:0|[1-9][0-9]{0,18}|-[1-9][0-9]{0,18})$/);
const MAX_EXPENSE_PARTICIPANTS = 100;

const validDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const participant = z.object({ participantId: uuid }).strict();
const exactParticipant = participant.extend({ amountMinor: unsignedMinor }).strict();
const percentageParticipant = participant
  .extend({
    percentage: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
      .max(80),
  })
  .strict();
const sharesParticipant = participant
  .extend({
    shares: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/)
      .max(80),
  })
  .strict();
const adjustmentParticipant = participant.extend({ adjustmentMinor: signedMinor }).strict();
const originalParticipant = z.union([
  participant,
  exactParticipant,
  percentageParticipant,
  sharesParticipant,
  adjustmentParticipant,
]);

const base = z
  .object({
    groupId: uuid,
    description: z.string().trim().min(1).max(300),
    amountMinor: positiveMinor,
    currency: z.string().regex(/^[A-Z]{3}$/),
    expenseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(validDate, 'Invalid calendar date'),
    category: z.string().trim().min(1).max(50),
    notes: z.string().trim().max(4_000).optional(),
    payers: z
      .array(z.object({ participantId: uuid, paidAmountMinor: positiveMinor }).strict())
      .min(1)
      .max(MAX_EXPENSE_PARTICIPANTS),
    originalSplitInputs: z
      .array(originalParticipant)
      .min(1)
      .max(MAX_EXPENSE_PARTICIPANTS)
      .optional(),
  })
  .strict();

export const expenseMutationSchema = z
  .discriminatedUnion('splitMethod', [
    base.extend({
      splitMethod: z.literal('equal'),
      beneficiaries: z.array(participant).min(1).max(MAX_EXPENSE_PARTICIPANTS),
    }),
    base.extend({
      splitMethod: z.literal('exact'),
      beneficiaries: z.array(exactParticipant).min(1).max(MAX_EXPENSE_PARTICIPANTS),
    }),
    base.extend({
      splitMethod: z.literal('percentage'),
      beneficiaries: z.array(percentageParticipant).min(1).max(MAX_EXPENSE_PARTICIPANTS),
    }),
    base.extend({
      splitMethod: z.literal('shares'),
      beneficiaries: z.array(sharesParticipant).min(1).max(MAX_EXPENSE_PARTICIPANTS),
    }),
    base.extend({
      splitMethod: z.literal('adjustments'),
      beneficiaries: z.array(adjustmentParticipant).min(1).max(MAX_EXPENSE_PARTICIPANTS),
    }),
  ])
  .superRefine((value, context) => {
    const postingParticipants = new Set([
      ...value.payers.map(({ participantId }) => participantId),
      ...value.beneficiaries.map(({ participantId }) => participantId),
    ]);
    if (postingParticipants.size > MAX_EXPENSE_PARTICIPANTS) {
      context.addIssue({
        code: 'custom',
        path: ['beneficiaries'],
        message: `An expense may involve at most ${MAX_EXPENSE_PARTICIPANTS} distinct participants`,
      });
    }
  });

export type ExpenseMutationInput = z.infer<typeof expenseMutationSchema>;

export const expenseListQuerySchema = z
  .object({
    cursor: z.string().max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
