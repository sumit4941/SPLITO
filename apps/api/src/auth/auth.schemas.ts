import { z } from 'zod';

const email = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());

export const registerSchema = z
  .object({
    email,
    password: z.string().min(12).max(128),
    displayName: z.string().trim().min(1).max(120),
    locale: z.string().trim().min(2).max(35).default('en-IN'),
    timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
    defaultCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('INR'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(40).max(100) }).strict();

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
    deviceName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export function normalizeMobileNumber(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:\+[0-9]+|00[0-9]+|[0-9]+)$/u.test(trimmed)) {
    throw new Error('Mobile number contains unsupported characters');
  }

  let normalized: string;
  if (trimmed.startsWith('+')) {
    normalized = trimmed;
  } else if (trimmed.startsWith('00')) {
    normalized = `+${trimmed.slice(2)}`;
  } else if (/^[6-9][0-9]{9}$/u.test(trimmed)) {
    normalized = `+91${trimmed}`;
  } else {
    throw new Error('International mobile numbers must include a + or 00 country code');
  }

  if (!/^\+[1-9][0-9]{7,14}$/u.test(normalized)) {
    throw new Error('Mobile number is not valid E.164');
  }
  if (normalized.startsWith('+91') && !/^\+91[6-9][0-9]{9}$/u.test(normalized)) {
    throw new Error('Indian mobile number is invalid');
  }
  return normalized;
}

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

export const requestMobileOtpSchema = z
  .object({ mobileNumber, purpose: z.literal('login').optional() })
  .strict();

export type RequestMobileOtpInput = z.infer<typeof requestMobileOtpSchema>;

export const verifyMobileOtpSchema = z
  .object({
    challengeId: z.uuid(),
    mobileNumber,
    otp: z.string().regex(/^[0-9]{6}$/u),
    deviceName: z.string().trim().min(1).max(200).optional(),
    locale: z.string().trim().min(2).max(35).default('en-IN'),
    timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  })
  .strict();

export type VerifyMobileOtpInput = z.infer<typeof verifyMobileOtpSchema>;
