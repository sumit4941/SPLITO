import { describe, expect, it } from 'vitest';
import { loadEnvironment, loadWorkerEnvironment } from './index.js';

describe('runtime configuration', () => {
  const productionMongoUri =
    'mongodb+srv://app-user:placeholder@cluster.example.mongodb.net/?retryWrites=true&w=majority';

  it('uses bounded MongoDB replica-set defaults for development', () => {
    const config = loadEnvironment({});
    expect(config.MONGODB_URI).toBe('mongodb://127.0.0.1:27017/?replicaSet=rs0');
    expect(config.MONGODB_DATABASE).toBe('splito');
    expect(config.MONGODB_MIN_POOL_SIZE).toBeLessThanOrEqual(config.MONGODB_MAX_POOL_SIZE);
  });

  it('uses the standard platform port only when API_PORT is absent', () => {
    expect(loadEnvironment({ PORT: '8080' }).API_PORT).toBe(8080);
    expect(loadEnvironment({ PORT: '8080', API_PORT: '3001' }).API_PORT).toBe(3001);
  });

  it('rejects an inverted connection pool', () => {
    expect(() =>
      loadEnvironment({ MONGODB_MIN_POOL_SIZE: '9', MONGODB_MAX_POOL_SIZE: '2' }),
    ).toThrow(/MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE/u);
  });

  it('rejects invalid MongoDB connection settings', () => {
    expect(() => loadEnvironment({ MONGODB_URI: 'https://database.example' })).toThrow(
      /MONGODB_URI must use mongodb/u,
    );
    expect(() => loadEnvironment({ MONGODB_DATABASE: 'splito/production' })).toThrow(
      /MONGODB_DATABASE/u,
    );
  });

  it('fails closed when production secrets or secure cookies are missing', () => {
    expect(() => loadEnvironment({ NODE_ENV: 'production' })).toThrow(/MONGODB_URI/u);
  });

  it('accepts an independently supplied production security configuration', () => {
    const config = loadEnvironment({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      MONGODB_URI: productionMongoUri,
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
        MONGODB_URI: productionMongoUri,
        SESSION_PEPPER: 's'.repeat(32),
        CSRF_SECRET: 'c'.repeat(32),
        OTP_PEPPER: 'o'.repeat(32),
        MFA_ENCRYPTION_KEY: 'a'.repeat(64),
        WEB_ORIGIN: 'https://app.splito.example',
      }),
    ).toThrow(/SMS_PROVIDER must be twilio in production/u);
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
        MONGODB_URI: productionMongoUri,
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
        MONGODB_URI: productionMongoUri,
        SESSION_PEPPER: 's'.repeat(32),
        CSRF_SECRET: 'c'.repeat(32),
        OTP_PEPPER: 'o'.repeat(32),
        MFA_ENCRYPTION_KEY: 'a'.repeat(64),
      }),
    ).toThrow(/WEB_ORIGIN must use HTTPS/u);
  });

  it('keeps production worker secrets limited to its MongoDB connection', () => {
    const config = loadWorkerEnvironment({
      NODE_ENV: 'production',
      MONGODB_URI: productionMongoUri,
    });
    expect(config.MONGODB_URI).toBe(productionMongoUri);
    expect(config.SESSION_PEPPER).toBeUndefined();
    expect(config.CSRF_SECRET).toBeUndefined();
    expect(config.OTP_PEPPER).toBeUndefined();
    expect(config.MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('requires a non-local MongoDB deployment for a production worker', () => {
    expect(() => loadWorkerEnvironment({ NODE_ENV: 'production' })).toThrow(
      /MONGODB_URI must point to a non-local deployment/u,
    );
    expect(() =>
      loadWorkerEnvironment({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://app-user:placeholder@localhost:27017/?replicaSet=rs0',
      }),
    ).toThrow(/MONGODB_URI must point to a non-local deployment/u);
  });
});
