import { loadEnvironment } from '@splito/config';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../common/api-error.js';
import type { MongoService, MongoUnitOfWork } from '../database/mongo.service.js';
import type { SmsDeliveryService } from '../sms/sms-delivery.service.js';
import { mobileOtpHash } from './auth.crypto.js';
import type { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

const challengeId = '11111111-1111-4111-8111-111111111111';
const mobileNumber = '+12025550101';
const otpPepper = 'o'.repeat(32);

function createHarness(
  repositoryOverrides: Record<string, unknown> = {},
  production = false,
  smsOverrides: Record<string, unknown> = {},
) {
  const repository = {
    issueMobileOtp: vi.fn(),
    lockMobileOtpChallenge: vi.fn(),
    expireMobileOtp: vi.fn(),
    recordFailedMobileOtpAttempt: vi.fn(),
    authenticateMobileOtp: vi.fn(),
    ...repositoryOverrides,
  };
  const mongo = {
    withTransaction: vi.fn(async (operation: (work: MongoUnitOfWork) => Promise<unknown>) =>
      operation({} as MongoUnitOfWork),
    ),
  };
  const developmentConfig = loadEnvironment({
    CSRF_SECRET: 'c'.repeat(32),
    OTP_PEPPER: otpPepper,
    SESSION_PEPPER: 's'.repeat(32),
  });
  const config = production
    ? ({ ...developmentConfig, NODE_ENV: 'production' } as const)
    : developmentConfig;
  const sms = {
    assertAvailable: vi.fn(() => {
      if (production) {
        throw new ApiError(
          503,
          'OTP_DELIVERY_NOT_CONFIGURED',
          'Mobile OTP delivery is unavailable.',
        );
      }
    }),
    deliver: vi.fn(),
    ...smsOverrides,
  };
  return {
    repository,
    mongo,
    sms,
    service: new AuthService(
      repository as unknown as AuthRepository,
      mongo as unknown as MongoService,
      config,
      sms as unknown as SmsDeliveryService,
    ),
  };
}

describe('mobile OTP authentication service', () => {
  it('returns the OTP only in development while persisting only its keyed hash', async () => {
    const issueMobileOtp = vi.fn().mockResolvedValue({ outcome: 'created' });
    const { service } = createHarness({ issueMobileOtp });
    const result = await service.requestMobileOtp(
      { mobileNumber },
      { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(result).toMatchObject({
      maskedMobileNumber: '+*******0101',
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
    const developmentOtp = result.developmentOtp;
    expect(developmentOtp).toMatch(/^[0-9]{6}$/u);
    if (!developmentOtp) throw new Error('Development OTP was not disclosed');
    const persisted = issueMobileOtp.mock.calls[0]?.[1];
    expect(persisted.otpHash).toEqual(
      mobileOtpHash(otpPepper, result.challengeId, mobileNumber, developmentOtp),
    );
    expect(persisted).not.toHaveProperty('otp');
  });

  it('fails honestly outside development until an SMS provider exists', async () => {
    const { repository, service } = createHarness({}, true);
    await expect(
      service.requestMobileOtp(
        { mobileNumber },
        { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
      ),
    ).rejects.toMatchObject({ code: 'OTP_DELIVERY_NOT_CONFIGURED', status: 503 });
    expect(repository.issueMobileOtp).not.toHaveBeenCalled();
  });

  it('commits a production challenge before sending the OTP through the provider', async () => {
    const issueMobileOtp = vi.fn().mockResolvedValue({ outcome: 'created' });
    const deliver = vi.fn().mockResolvedValue({
      mode: 'twilio',
      providerMessageId: `SM${'4'.repeat(32)}`,
      providerStatus: 'queued',
    });
    const { service } = createHarness({ issueMobileOtp }, true, {
      assertAvailable: vi.fn(),
      deliver,
    });

    const result = await service.requestMobileOtp(
      { mobileNumber },
      { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(result).not.toHaveProperty('developmentOtp');
    const persisted = issueMobileOtp.mock.calls[0]?.[1];
    expect(persisted.deliveryMode).toBe('twilio');
    expect(persisted).not.toHaveProperty('otp');
    const delivered = deliver.mock.calls[0]?.[0];
    expect(delivered).toMatchObject({ purpose: 'mobile_otp', mobileNumber });
    const otp = String(delivered.body).match(/\b[0-9]{6}\b/u)?.[0];
    expect(otp).toMatch(/^[0-9]{6}$/u);
    if (!otp) throw new Error('Provider message did not contain an OTP');
    expect(persisted.otpHash).toEqual(
      mobileOtpHash(otpPepper, result.challengeId, mobileNumber, otp),
    );
    expect(issueMobileOtp.mock.invocationCallOrder[0]).toBeLessThan(
      deliver.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('returns the full rate-window retry for quota exhaustion', async () => {
    const issueMobileOtp = vi.fn().mockResolvedValue({
      outcome: 'rate_limited',
      reason: 'quota',
      retryAfterSeconds: 900,
    });
    const { service } = createHarness({ issueMobileOtp });
    await expect(
      service.requestMobileOtp(
        { mobileNumber },
        { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
      ),
    ).rejects.toMatchObject({
      code: 'OTP_RATE_LIMITED',
      status: 429,
      responseHeaders: { 'retry-after': '900' },
    });
  });

  it('commits a failed attempt and returns a generic invalid-or-expired error', async () => {
    const recordFailedMobileOtpAttempt = vi.fn().mockResolvedValue(undefined);
    const lockMobileOtpChallenge = vi.fn().mockResolvedValue({
      OTP_CHALLENGE_ID: challengeId,
      MOBILE_E164: mobileNumber,
      OTP_HASH: mobileOtpHash(otpPepper, challengeId, mobileNumber, '654321'),
      STATUS: 'PENDING',
      ATTEMPT_COUNT: '0',
      MAX_ATTEMPTS: '5',
      EXPIRED_FLAG: 'N',
    });
    const { repository, service } = createHarness({
      lockMobileOtpChallenge,
      recordFailedMobileOtpAttempt,
    });

    await expect(
      service.verifyMobileOtp(
        {
          challengeId,
          mobileNumber,
          otp: '000000',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
        },
        { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_OTP', status: 400 });
    expect(recordFailedMobileOtpAttempt).toHaveBeenCalledOnce();
    expect(repository.authenticateMobileOtp).not.toHaveBeenCalled();
  });

  it('persists expiry before returning the same generic verification error', async () => {
    const expireMobileOtp = vi.fn().mockResolvedValue(undefined);
    const lockMobileOtpChallenge = vi.fn().mockResolvedValue({
      OTP_CHALLENGE_ID: challengeId,
      MOBILE_E164: mobileNumber,
      OTP_HASH: mobileOtpHash(otpPepper, challengeId, mobileNumber, '654321'),
      STATUS: 'PENDING',
      ATTEMPT_COUNT: '0',
      MAX_ATTEMPTS: '5',
      EXPIRED_FLAG: 'Y',
    });
    const { repository, service } = createHarness({
      lockMobileOtpChallenge,
      expireMobileOtp,
    });
    await expect(
      service.verifyMobileOtp(
        {
          challengeId,
          mobileNumber,
          otp: '654321',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
        },
        { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_OTP', status: 400 });
    expect(expireMobileOtp).toHaveBeenCalledOnce();
    expect(repository.authenticateMobileOtp).not.toHaveBeenCalled();
  });

  it('rejects a replayed challenge without creating another session', async () => {
    const lockMobileOtpChallenge = vi.fn().mockResolvedValue({
      OTP_CHALLENGE_ID: challengeId,
      MOBILE_E164: mobileNumber,
      OTP_HASH: mobileOtpHash(otpPepper, challengeId, mobileNumber, '654321'),
      STATUS: 'VERIFIED',
      ATTEMPT_COUNT: '0',
      MAX_ATTEMPTS: '5',
      EXPIRED_FLAG: 'N',
    });
    const { repository, service } = createHarness({ lockMobileOtpChallenge });
    await expect(
      service.verifyMobileOtp(
        {
          challengeId,
          mobileNumber,
          otp: '654321',
          locale: 'en-IN',
          timezone: 'Asia/Kolkata',
        },
        { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OR_EXPIRED_OTP', status: 400 });
    expect(repository.recordFailedMobileOtpAttempt).not.toHaveBeenCalled();
    expect(repository.authenticateMobileOtp).not.toHaveBeenCalled();
  });

  it('returns a newly provisioned authenticated session after a correct code', async () => {
    const otp = '654321';
    const user = {
      id: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      participantId: '22222222-2222-4222-8222-222222222222',
      mobileNumber,
      displayName: 'Splito member',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      defaultCurrency: 'INR',
      theme: 'system',
      reducedMotion: false,
      version: '1',
    } as const;
    const lockMobileOtpChallenge = vi.fn().mockResolvedValue({
      OTP_CHALLENGE_ID: challengeId,
      MOBILE_E164: mobileNumber,
      OTP_HASH: mobileOtpHash(otpPepper, challengeId, mobileNumber, otp),
      STATUS: 'PENDING',
      ATTEMPT_COUNT: '0',
      MAX_ATTEMPTS: '5',
      EXPIRED_FLAG: 'N',
    });
    const authenticateMobileOtp = vi
      .fn()
      .mockResolvedValue({ outcome: 'authenticated', isNewAccount: true, user });
    const { service } = createHarness({ lockMobileOtpChallenge, authenticateMobileOtp });

    const session = await service.verifyMobileOtp(
      { challengeId, mobileNumber, otp, locale: 'en-IN', timezone: 'Asia/Kolkata' },
      { id: challengeId, ip: '127.0.0.1', userAgent: 'vitest' },
    );
    expect(session.auth.user).toEqual(user);
    expect(session.isNewAccount).toBe(true);
    expect(session.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(session.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(authenticateMobileOtp.mock.calls[0]?.[1].session).not.toHaveProperty('userId');
  });
});
