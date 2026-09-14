import { z } from 'zod';

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu)
  .transform((value) => value.toLowerCase());
const positiveMinor = z.string().regex(/^[1-9][0-9]{0,18}$/);
const validDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const base = z
  .object({
    context: z.object({ id: uuid, type: z.literal('group') }).strict(),
    senderId: uuid,
    recipientId: uuid,
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: positiveMinor,
    settlementDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(validDate, 'Invalid calendar date'),
    method: z.enum(['cash', 'bank', 'upi', 'card', 'other']),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .refine((value) => value.senderId !== value.recipientId, {
    message: 'Sender and recipient must be different.',
    path: ['recipientId'],
  });

export const settlementPreviewSchema = base;
export type SettlementPreviewInput = z.infer<typeof settlementPreviewSchema>;

export const createSettlementSchema = base.safeExtend({
  previewVersion: z.string().length(64),
  overpaymentConfirmed: z.boolean().default(false),
});
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
