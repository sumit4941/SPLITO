import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Environment } from '@splito/config';
import { argon2id, hash as argonHash, verify as argonVerify } from 'argon2';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/app-config.js';
import { isMongoDuplicateKey, MongoService } from '../database/mongo.service.js';
import { SmsDeliveryService } from '../sms/sms-delivery.service.js';
import {
  generateNumericOtp,
  generateOpaqueToken,
  hashesEqual,
  mobileOtpHash,
  secretHash,
  sha256,
} from './auth.crypto.js';
import { AuthRepository, rowToAuthenticatedUser } from './auth.repository.js';
import type {
  LoginInput,
  RegisterInput,
  RequestMobileOtpInput,
  VerifyMobileOtpInput,
} from './auth.schemas.js';
import type { AuthContext, NewSession } from './auth.types.js';

const PASSWORD_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MOBILE_OTP_POLICY = {
  ttlSeconds: 300,
  resendAfterSeconds: 60,
  rateWindowMinutes: 15,
  phoneRequestLimit: 5,
  ipRequestLimit: 20,
  maxAttempts: 5,
} as const;

@Injectable()
export class AuthService {
  readonly #sessionPepper: string;
  readonly #csrfSecret: string;
  readonly #otpPepper: string;

  constructor(
    private readonly repository: AuthRepository,
    private readonly mongo: MongoService,
    @Inject(APP_CONFIG) private readonly config: Environment,
    private readonly sms: SmsDeliveryService,
  ) {
    this.#sessionPepper =
      config.SESSION_PEPPER ?? 'development-only-session-pepper-must-be-replaced';
    this.#csrfSecret = config.CSRF_SECRET ?? 'development-only-csrf-secret-must-be-replaced';
    this.#otpPepper = config.OTP_PEPPER ?? 'development-only-otp-pepper-must-be-replaced';
  }

  async register(
    input: RegisterInput,
    requestId: string,
  ): Promise<{
    userId?: string;
    verificationRequired: true;
    developmentVerificationToken?: string;
  }> {
    const userId = randomUUID();
    const participantId = randomUUID();
    const verificationToken = generateOpaqueToken();
    const passwordHash = await argonHash(input.password, PASSWORD_OPTIONS);
    try {
      await this.mongo.withTransaction((work) =>
        this.repository.createPendingAccount(work, {
          ...input,
          userId,
          participantId,
          passwordHash,
          verificationTokenId: randomUUID(),
          verificationTokenHash: sha256(verificationToken),
          requestId,
          outboxId: randomUUID(),
          auditId: randomUUID(),
        }),
      );
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        // Registration responses deliberately avoid becoming a public account directory.
        return { verificationRequired: true };
      }
      throw error;
    }

    return {
      userId,
      verificationRequired: true,
      ...(this.config.NODE_ENV === 'development'
        ? { developmentVerificationToken: verificationToken }
        : {}),
    };
  }

  async verifyEmail(token: string): Promise<void> {
    const consumed = await this.mongo.withTransaction((work) =>
      this.repository.consumeVerificationToken(work, sha256(token)),
    );
    if (!consumed) {
      throw new ApiError(
        400,
        'INVALID_OR_EXPIRED_TOKEN',
        'The verification link is invalid or expired.',
      );
    }
  }

  async login(
    input: LoginInput,
    request: { readonly ip: string; readonly userAgent: string },
  ): Promise<NewSession> {
    const row = await this.repository.findLoginByEmail(input.email);
    if (!row?.PASSWORD_HASH) {
      await argonHash(input.password, PASSWORD_OPTIONS);
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const passwordMatches = await argonVerify(row.PASSWORD_HASH, input.password);
    if (!passwordMatches) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (row.STATUS !== 'ACTIVE') {
      throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'Verify the account before signing in.');
    }

    const sessionId = randomUUID();
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const csrfHash = secretHash(this.#csrfSecret, csrfToken);
    const expiresAt = new Date(Date.now() + this.config.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1_000);
    await this.mongo.withTransaction((work) =>
      this.repository.rotateSession(work, {
        sessionId,
        userId: row.USER_ID,
        tokenHash: secretHash(this.#sessionPepper, sessionToken),
        csrfHash,
        ...(input.deviceName ? { deviceName: input.deviceName } : {}),
        userAgent: request.userAgent,
        ipHash: this.ipAddressHash(request.ip),
        expiresAt,
      }),
    );

    return {
      auth: {
        sessionId,
        user: rowToAuthenticatedUser({
          ...row,
          VERSION_NO: String(Number(row.VERSION_NO) + 1),
        }),
        csrfHash,
      },
      sessionToken,
      csrfToken,
      expiresAt,
    };
  }

  async requestMobileOtp(
    input: RequestMobileOtpInput,
    request: { readonly id: string; readonly ip: string; readonly userAgent: string },
  ): Promise<{
    challengeId: string;
    maskedMobileNumber: string;
    expiresInSeconds: number;
    resendAfterSeconds: number;
    developmentOtp?: string;
  }> {
    if (this.config.NODE_ENV !== 'development') this.sms.assertAvailable('mobile_otp');

    const challengeId = randomUUID();
    const otp = generateNumericOtp();
    const ipHash = this.ipAddressHash(request.ip);
    let issueResult: Awaited<ReturnType<AuthRepository['issueMobileOtp']>>;
    try {
      issueResult = await this.mongo.withTransaction((work) =>
        this.repository.issueMobileOtp(work, {
          challengeId,
          mobileNumber: input.mobileNumber,
          otpHash: mobileOtpHash(this.#otpPepper, challengeId, input.mobileNumber, otp),
          phoneHash: secretHash(
            this.#otpPepper,
            `splito:mobile-otp:phone:v1:${input.mobileNumber}`,
          ),
          ipHash,
          requestId: request.id,
          userAgent: request.userAgent,
          deliveryMode: this.config.NODE_ENV === 'development' ? 'development_response' : 'twilio',
          auditId: randomUUID(),
          ttlSeconds: MOBILE_OTP_POLICY.ttlSeconds,
          cooldownSeconds: MOBILE_OTP_POLICY.resendAfterSeconds,
          windowMinutes: MOBILE_OTP_POLICY.rateWindowMinutes,
          phoneLimit: MOBILE_OTP_POLICY.phoneRequestLimit,
          ipLimit: MOBILE_OTP_POLICY.ipRequestLimit,
          maxAttempts: MOBILE_OTP_POLICY.maxAttempts,
        }),
      );
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        throw new ApiError(
          429,
          'OTP_RATE_LIMITED',
          'Wait before requesting another verification code.',
          undefined,
          { 'retry-after': String(MOBILE_OTP_POLICY.resendAfterSeconds) },
        );
      }
      throw error;
    }

    if (issueResult.outcome === 'rate_limited') {
      throw new ApiError(
        429,
        'OTP_RATE_LIMITED',
        issueResult.reason === 'cooldown'
          ? `Wait at least ${issueResult.retryAfterSeconds} seconds before requesting another code.`
          : 'The mobile or network request quota is exhausted. Try again after the rate window.',
        undefined,
        { 'retry-after': String(issueResult.retryAfterSeconds) },
      );
    }

    if (this.config.NODE_ENV !== 'development') {
      await this.sms.deliver({
        purpose: 'mobile_otp',
        mobileNumber: input.mobileNumber,
        body: `Your SPLITO verification code is ${otp}. It expires in 5 minutes. Never share this code.`,
      });
    }

    return {
      challengeId,
      maskedMobileNumber: maskMobileNumber(input.mobileNumber),
      expiresInSeconds: MOBILE_OTP_POLICY.ttlSeconds,
      resendAfterSeconds: MOBILE_OTP_POLICY.resendAfterSeconds,
      ...(this.config.NODE_ENV === 'development' ? { developmentOtp: otp } : {}),
    };
  }

  async verifyMobileOtp(
    input: VerifyMobileOtpInput,
    request: { readonly id: string; readonly ip: string; readonly userAgent: string },
  ): Promise<NewSession & { readonly isNewAccount: boolean }> {
    const sessionId = randomUUID();
    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const csrfHash = secretHash(this.#csrfSecret, csrfToken);
    const expiresAt = new Date(Date.now() + this.config.SESSION_ABSOLUTE_HOURS * 60 * 60 * 1_000);
    const result = await this.mongo.withTransaction(async (work) => {
      const challenge = await this.repository.lockMobileOtpChallenge(
        work,
        input.challengeId,
        input.mobileNumber,
      );
      if (!challenge || challenge.STATUS !== 'PENDING') return { outcome: 'invalid' } as const;
      if (
        challenge.EXPIRED_FLAG === 'Y' ||
        Number(challenge.ATTEMPT_COUNT) >= Number(challenge.MAX_ATTEMPTS)
      ) {
        await this.repository.expireMobileOtp(work, challenge.OTP_CHALLENGE_ID);
        return { outcome: 'invalid' } as const;
      }

      const expectedHash = mobileOtpHash(
        this.#otpPepper,
        input.challengeId,
        input.mobileNumber,
        input.otp,
      );
      if (!hashesEqual(challenge.OTP_HASH, expectedHash)) {
        await this.repository.recordFailedMobileOtpAttempt(work, challenge.OTP_CHALLENGE_ID);
        return { outcome: 'invalid' } as const;
      }

      return this.repository.authenticateMobileOtp(work, {
        challengeId: challenge.OTP_CHALLENGE_ID,
        mobileNumber: input.mobileNumber,
        newUserId: randomUUID(),
        newParticipantId: randomUUID(),
        displayName: 'Splito member',
        locale: input.locale,
        timezone: input.timezone,
        session: {
          sessionId,
          tokenHash: secretHash(this.#sessionPepper, sessionToken),
          csrfHash,
          ...(input.deviceName ? { deviceName: input.deviceName } : {}),
          userAgent: request.userAgent,
          ipHash: this.ipAddressHash(request.ip),
          expiresAt,
        },
        requestId: request.id,
        auditId: randomUUID(),
      });
    });

    if (result.outcome === 'invalid') {
      throw new ApiError(
        400,
        'INVALID_OR_EXPIRED_OTP',
        'The verification code is invalid or expired.',
      );
    }
    if (result.outcome === 'account_unavailable') {
      throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not available for sign-in.');
    }

    return {
      auth: { sessionId, user: result.user, csrfHash },
      sessionToken,
      csrfToken,
      expiresAt,
      isNewAccount: result.isNewAccount,
    };
  }

  authenticateSession(sessionToken: string): Promise<AuthContext | undefined> {
    return this.repository.findSession(
      secretHash(this.#sessionPepper, sessionToken),
      this.config.SESSION_IDLE_MINUTES,
    );
  }

  csrfHash(token: string): Buffer {
    return secretHash(this.#csrfSecret, token);
  }

  logout(sessionId: string): Promise<void> {
    return this.repository.revokeSession(sessionId);
  }

  private ipAddressHash(ip: string): Buffer {
    return secretHash(this.#sessionPepper, `splito:ip-address:v1:${ip}`);
  }
}

export function maskMobileNumber(mobileNumber: string): string {
  const visibleDigits = mobileNumber.slice(-4);
  return `+${'*'.repeat(Math.max(4, mobileNumber.length - 5))}${visibleDigits}`;
}
