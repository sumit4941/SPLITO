import { describe, expect, it } from 'vitest';
import { loadEnvironment, loadWorkerEnvironment } from './index.js';

describe('runtime configuration', () => {
  it('uses bounded Oracle Thin-mode-friendly defaults for development', () => {
    const config = loadEnvironment({});
    expect(config.DATABASE_CONNECT_STRING).toBe('localhost:1521/FREEPDB1');
    expect(config.DATABASE_USER).toBe('SPLITO_APP');
    expect(config.DATABASE_OWNER_SCHEMA).toBe('SPLITO_OWNER');
    expect(config.DATABASE_POOL_MIN).toBeLessThanOrEqual(config.DATABASE_POOL_MAX);
  });

  it('rejects an inverted connection pool', () => {
    expect(() => loadEnvironment({ DATABASE_POOL_MIN: '9', DATABASE_POOL_MAX: '2' })).toThrow(
      /DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX/u,
    );
  });

  it('fails closed when production secrets or secure cookies are missing', () => {
    expect(() => loadEnvironment({ NODE_ENV: 'production' })).toThrow(/DATABASE_PASSWORD/u);
  });

  it('accepts an independently supplied production security configuration', () => {
    const config = loadEnvironment({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      DATABASE_PASSWORD: 'database-password-long',
      SESSION_PEPPER: 's'.repeat(32),
      CSRF_SECRET: 'c'.repeat(32),
      OTP_PEPPER: 'o'.repeat(32),
      MFA_ENCRYPTION_KEY: 'a'.repeat(64),
      WEB_ORIGIN: 'https://app.splito.example',
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
      TWILIO_API_KEY_SID: `SK${'2'.repeat(32)}`,
      TWILIO_API_KEY_SECRET: 'twilio-key-secret-value',
      TWILIO_MESSAGING_SERVICE_SID: `MG${'3'.repeat(32)}`,
    });
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('requires a complete and unambiguous Twilio configuration when enabled', () => {
    expect(() => loadEnvironment({ SMS_PROVIDER: 'twilio' })).toThrow(
      /TWILIO_ACCOUNT_SID is required/u,
    );
    expect(() =>
      loadEnvironment({
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`,
        TWILIO_API_KEY_SID: `SK${'2'.repeat(32)}`,
        TWILIO_API_KEY_SECRET: 'twilio-key-secret-value',
        TWILIO_FROM_E164: '+14155550100',
        TWILIO_MESSAGING_SERVICE_SID: `MG${'3'.repeat(32)}`,
      }),
    ).toThrow(/Exactly one of TWILIO_FROM_E164/u);
  });

  it('fails closed when production SMS delivery is disabled', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        DATABASE_PASSWORD: 'database-password-long',
        SESSION_PEPPER: 's'.repeat(32),
        CSRF_SECRET: 'c'.repeat(32),
        OTP_PEPPER: 'o'.repeat(32),
        MFA_ENCRYPTION_KEY: 'a'.repeat(64),
        WEB_ORIGIN: 'https://app.splito.example',
      }),
    ).toThrow(/SMS_PROVIDER must be twilio in production/u);
  });

  it('rejects an Oracle owner or administrative account as the runtime identity', () => {
    expect(() =>
      loadEnvironment({ DATABASE_USER: 'SPLITO_OWNER', DATABASE_OWNER_SCHEMA: 'SPLITO_OWNER' }),
    ).toThrow(/least-privilege runtime account/u);
    expect(() => loadEnvironment({ DATABASE_USER: 'SYSTEM' })).toThrow(/administrative account/u);
  });

  it('requires independent application secrets', () => {
    expect(() =>
      loadEnvironment({ SESSION_PEPPER: 'x'.repeat(64), CSRF_SECRET: 'x'.repeat(64) }),
    ).toThrow(/must be independent/u);
    expect(() =>
      loadEnvironment({ SESSION_PEPPER: 'x'.repeat(64), OTP_PEPPER: 'x'.repeat(64) }),
    ).toThrow(/OTP_PEPPER must be independent/u);
  });

  it('requires the dedicated OTP pepper in production', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        DATABASE_PASSWORD: 'database-password-long',
        SESSION_PEPPER: 's'.repeat(32),
        CSRF_SECRET: 'c'.repeat(32),
        MFA_ENCRYPTION_KEY: 'a'.repeat(64),
        WEB_ORIGIN: 'https://app.splito.example',
      }),
    ).toThrow(/OTP_PEPPER is required in production/u);
  });

  it('requires an HTTPS browser origin in production', () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        DATABASE_PASSWORD: 'database-password-long',
        SESSION_PEPPER: 's'.repeat(32),
        CSRF_SECRET: 'c'.repeat(32),
        OTP_PEPPER: 'o'.repeat(32),
        MFA_ENCRYPTION_KEY: 'a'.repeat(64),
      }),
    ).toThrow(/WEB_ORIGIN must use HTTPS/u);
  });

  it('keeps production worker secrets limited to its Oracle credential', () => {
    const config = loadWorkerEnvironment({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'worker-database-password',
    });
    expect(config.DATABASE_PASSWORD).toBe('worker-database-password');
    expect(config.SESSION_PEPPER).toBeUndefined();
    expect(config.CSRF_SECRET).toBeUndefined();
    expect(config.OTP_PEPPER).toBeUndefined();
    expect(config.MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('still requires the Oracle credential for a production worker', () => {
    expect(() => loadWorkerEnvironment({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_PASSWORD is required in production/u,
    );
  });
});
