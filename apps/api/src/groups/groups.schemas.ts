import { z } from 'zod';
import { normalizeMobileNumber } from '../auth/auth.schemas.js';

const mobileNumber = z
  .string()
  .trim()
  .min(8)
  .max(40)
  .transform((value, context) => {
    try {
      return normalizeMobileNumber(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid mobile number. Indian local numbers or E.164 are supported.',
      });
      return z.NEVER;
    }
  });

export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1_000).optional(),
    type: z.enum(['home', 'trip', 'couple', 'family', 'project', 'other']).default('other'),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
    simplificationEnabled: z.boolean().default(false),
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const addGroupMemberSchema = z.object({ mobileNumber }).strict();

export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>;

export const groupInvitationTokenSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict();

export type GroupInvitationTokenInput = z.infer<typeof groupInvitationTokenSchema>;
