import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const optionalEnvironmentString = (schema: z.ZodString) =>
  z.union([schema, z.literal('').transform(() => undefined)]).optional();

function isLocalMongoUri(value: string): boolean {
  return /^mongodb:\/\/(?:[^/?#@]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|\?|$)/iu.test(value);
}

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: booleanFromEnv,
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => /^mongodb(?:\+srv)?:\/\//u.test(value), {
      message: 'MONGODB_URI must use mongodb:// or mongodb+srv://',
    })
    .default('mongodb://127.0.0.1:27017/?replicaSet=rs0'),
  MONGODB_DATABASE: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,63}$/u)
    .default('splito'),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(20).default(1),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120_000)
    .default(10_000),
  MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  SESSION_PEPPER: z.string().min(32).optional(),
  CSRF_SECRET: z.string().min(32).optional(),
  OTP_PEPPER: z.string().min(32).optional(),
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^(?:[A-Za-z0-9_-]{43}=?|[A-Fa-f0-9]{64})$/)
    .optional(),
  COOKIE_SECURE: booleanFromEnv,
  COOKIE_DOMAIN: z.string().min(1).optional(),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(10_080).default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(2_160).default(720),
  ATTACHMENT_STORAGE_PATH: z.string().min(1).default('./storage/private'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(25_000_000).default(10_000_000),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  SMS_PROVIDER: z.enum(['disabled', 'twilio']).default('disabled'),
  SMS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  TWILIO_ACCOUNT_SID: optionalEnvironmentString(z.string().regex(/^AC[0-9a-fA-F]{32}$/u)),
  TWILIO_API_KEY_SID: optionalEnvironmentString(z.string().regex(/^SK[0-9a-fA-F]{32}$/u)),
  TWILIO_API_KEY_SECRET: optionalEnvironmentString(z.string().min(20).max(200)),
  TWILIO_FROM_E164: optionalEnvironmentString(z.string().regex(/^\+[1-9][0-9]{7,14}$/u)),
  TWILIO_MESSAGING_SERVICE_SID: optionalEnvironmentString(z.string().regex(/^MG[0-9a-fA-F]{32}$/u)),
  FX_PROVIDER: z.enum(['manual', 'ecb', 'sandbox']).default('manual'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

const commonEnvironmentSchema = baseEnvironmentSchema.superRefine((env, context) => {
  if (env.MONGODB_MIN_POOL_SIZE > env.MONGODB_MAX_POOL_SIZE) {
    context.addIssue({
      code: 'custom',
      path: ['MONGODB_MIN_POOL_SIZE'],
      message: 'MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE',
    });
  }

  const configuredSecrets = [
    ['SESSION_PEPPER', env.SESSION_PEPPER],
    ['CSRF_SECRET', env.CSRF_SECRET],
    ['OTP_PEPPER', env.OTP_PEPPER],
    ['MFA_ENCRYPTION_KEY', env.MFA_ENCRYPTION_KEY],
  ] as const;
  for (const [index, [key, value]] of configuredSecrets.entries()) {
    if (!value) continue;
    const duplicate = configuredSecrets
      .slice(0, index)
      .find(([, previousValue]) => previousValue === value);
    if (duplicate) {
      context.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} must be independent from ${duplicate[0]}`,
      });
    }
  }
});

export const environmentSchema = commonEnvironmentSchema.superRefine((env, context) => {
  if (env.SMS_PROVIDER === 'twilio') {
    for (const key of [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_API_KEY_SID',
      'TWILIO_API_KEY_SECRET',
    ] as const) {
      if (!env[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when SMS_PROVIDER is twilio`,
        });
      }
    }

    if (Boolean(env.TWILIO_FROM_E164) === Boolean(env.TWILIO_MESSAGING_SERVICE_SID)) {
      context.addIssue({
        code: 'custom',
        path: ['TWILIO_FROM_E164'],
        message:
          'Exactly one of TWILIO_FROM_E164 or TWILIO_MESSAGING_SERVICE_SID is required when SMS_PROVIDER is twilio',
      });
    }
  }

  if (env.NODE_ENV === 'production') {
    if (isLocalMongoUri(env.MONGODB_URI)) {
      context.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI must point to a non-local deployment in production',
      });
    }

    for (const key of [
      'SESSION_PEPPER',
      'CSRF_SECRET',
      'OTP_PEPPER',
      'MFA_ENCRYPTION_KEY',
    ] as const) {
      if (!env[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required in production`,
        });
      }
    }

    if (!env.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }

    if (new URL(env.WEB_ORIGIN).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'WEB_ORIGIN must use HTTPS in production',
      });
    }

    if (env.SMS_PROVIDER !== 'twilio') {
      context.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'SMS_PROVIDER must be twilio in production',
      });
    }
  }
});

export const workerEnvironmentSchema = commonEnvironmentSchema.superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && isLocalMongoUri(env.MONGODB_URI)) {
    context.addIssue({
      code: 'custom',
      path: ['MONGODB_URI'],
      message: 'MONGODB_URI must point to a non-local deployment in production',
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return parseEnvironment(environmentSchema, source);
}

export function loadWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return parseEnvironment(workerEnvironmentSchema, source);
}

function parseEnvironment(schema: z.ZodType<Environment>, source: NodeJS.ProcessEnv): Environment {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = z.prettifyError(parsed.error);
    throw new Error(`Invalid SPLITO configuration:\n${details}`);
  }
  return parsed.data;
}

export const publicRuntimeConfigSchema = z.object({
  apiBaseUrl: z.string().default('/api/v1'),
  buildVersion: z.string().default('development'),
  sentryEnabled: z.boolean().default(false),
});

export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>;
