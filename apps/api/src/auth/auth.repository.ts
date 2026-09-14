import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  COLLECTIONS,
  MongoService,
  mongoOptions,
  type MongoUnitOfWork,
} from '../database/mongo.service.js';
import { participantAvatarUrl } from '../media/media.types.js';
import type { RegisterInput } from './auth.schemas.js';
import type { AuthContext, AuthenticatedUser } from './auth.types.js';

type AccountStatus = 'PENDING' | 'ACTIVE' | 'LOCKED' | 'DELETION_PENDING' | 'ANONYMIZED';
const OTP_CHALLENGE_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

interface UserDocument {
  _id: string;
  emailNormalized?: string;
  mobileE164?: string;
  passwordHash?: string;
  displayName: string;
  localeCode: string;
  timezoneName: string;
  defaultCurrencyCode: string;
  theme: 'LIGHT' | 'DARK' | 'SYSTEM';
  reducedMotion: boolean;
  status: AccountStatus;
  authFence: number;
  avatarKey?: string;
  emailVerifiedAt?: Date;
  mobileVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ParticipantDocument {
  _id: string;
  userId?: string;
  kind: 'USER' | 'GUEST';
  displayName: string;
  status: 'ACTIVE' | 'MERGED' | 'DELETED';
  createdAt: Date;
  updatedAt: Date;
}

interface MediaDocument {
  _id: string;
  ownerUserId?: string;
  storageKey: string;
  mediaKind: 'USER_AVATAR' | 'GROUP_IMAGE';
  status: 'ACTIVE' | 'SUPERSEDED' | 'DELETED';
}

interface AuthTokenDocument {
  _id: string;
  userId: string;
  tokenType: 'EMAIL_VERIFY' | 'PASSWORD_RESET';
  tokenHash: Buffer;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

interface SessionDocument {
  _id: string;
  sessionId: string;
  userId: string;
  sessionTokenHash: Buffer;
  csrfSecretHash: Buffer;
  deviceName?: string;
  userAgentSummary: string;
  ipAddressHash: Buffer;
  expiresAt: Date;
  lastSeenAt: Date;
  active: boolean;
  revokedAt?: Date;
  revokedReason?: 'SINGLE_ACTIVE_LOGIN' | 'USER_LOGOUT';
  createdAt: Date;
  updatedAt: Date;
}

interface MobileOtpChallengeDocument {
  _id: string;
  challengeId: string;
  mobileE164: string;
  purpose: 'LOGIN';
  otpHash: Buffer;
  requestIpHash: Buffer;
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'LOCKED' | 'SUPERSEDED';
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  purgeAt: Date;
  lastAttemptAt?: Date;
  consumedAt?: Date;
  terminalAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface MobileOtpThrottleDocument {
  _id: string;
  scope: 'PHONE' | 'IP';
  throttleKey: Buffer;
  requestCount: number;
  windowStartedAt: Date;
  lastIssuedAt?: Date;
  purgeAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginRow {
  USER_ID: string;
  PARTICIPANT_ID: string;
  EMAIL_NORMALIZED: string | null;
  MOBILE_E164: string | null;
  PASSWORD_HASH: string | null;
  DISPLAY_NAME: string;
  LOCALE_CODE: string;
  TIMEZONE_NAME: string;
  DEFAULT_CURRENCY_CODE: string;
  THEME: 'LIGHT' | 'DARK' | 'SYSTEM';
  REDUCED_MOTION_FLAG: 'Y' | 'N';
  AVATAR_MEDIA_ID: string | null;
  STATUS: AccountStatus;
  VERSION_NO: string;
}

export interface SessionValues {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly csrfHash: Buffer;
  readonly deviceName?: string;
  readonly userAgent: string;
  readonly ipHash: Buffer;
  readonly expiresAt: Date;
}

export interface MobileOtpChallengeRow {
  OTP_CHALLENGE_ID: string;
  MOBILE_E164: string;
  OTP_HASH: Buffer;
  STATUS: MobileOtpChallengeDocument['status'];
  ATTEMPT_COUNT: string;
  MAX_ATTEMPTS: string;
  EXPIRED_FLAG: 'Y' | 'N';
}

interface MobileOtpThrottleRow {
  REQUEST_COUNT: string;
  WINDOW_EXPIRED_FLAG: 'Y' | 'N';
  COOLDOWN_FLAG: 'Y' | 'N';
  WINDOW_RETRY_SECONDS: string;
}

export type MobileOtpIssueResult =
  | { readonly outcome: 'created' }
  | {
      readonly outcome: 'rate_limited';
      readonly reason: 'cooldown' | 'quota';
      readonly retryAfterSeconds: number;
    };

export type MobileOtpAuthenticationResult =
  | {
      readonly outcome: 'authenticated';
      readonly isNewAccount: boolean;
      readonly user: AuthenticatedUser;
    }
  | { readonly outcome: 'account_unavailable' }
  | { readonly outcome: 'invalid' };

export function rowToAuthenticatedUser(
  row: Omit<LoginRow, 'PASSWORD_HASH' | 'STATUS'>,
): AuthenticatedUser {
  const participantId = row.PARTICIPANT_ID;
  return {
    id: participantId,
    userId: row.USER_ID,
    participantId,
    ...(row.EMAIL_NORMALIZED ? { email: row.EMAIL_NORMALIZED } : {}),
    ...(row.MOBILE_E164 ? { mobileNumber: row.MOBILE_E164 } : {}),
    displayName: row.DISPLAY_NAME,
    ...(row.AVATAR_MEDIA_ID
      ? { avatarUrl: participantAvatarUrl(participantId, row.AVATAR_MEDIA_ID) }
      : {}),
    locale: row.LOCALE_CODE,
    timezone: row.TIMEZONE_NAME,
    defaultCurrency: row.DEFAULT_CURRENCY_CODE,
    theme: row.THEME.toLowerCase() as AuthenticatedUser['theme'],
    reducedMotion: row.REDUCED_MOTION_FLAG === 'Y',
    version: row.VERSION_NO,
  };
}

@Injectable()
export class AuthRepository {
  constructor(private readonly mongo: MongoService) {}

  async createPendingAccount(
    work: MongoUnitOfWork,
    values: RegisterInput & {
      readonly userId: string;
      readonly participantId: string;
      readonly passwordHash: string;
      readonly verificationTokenId: string;
      readonly verificationTokenHash: Buffer;
      readonly requestId: string;
      readonly outboxId: string;
      readonly auditId: string;
    },
  ): Promise<void> {
    const now = new Date();
    const options = mongoOptions(work);
    const userId = values.userId.toLowerCase();
    const participantId = values.participantId.toLowerCase();
    await work.db.collection<UserDocument>(COLLECTIONS.users).insertOne(
      {
        _id: userId,
        emailNormalized: values.email,
        passwordHash: values.passwordHash,
        displayName: values.displayName,
        localeCode: values.locale,
        timezoneName: values.timezone,
        defaultCurrencyCode: values.defaultCurrency,
        theme: 'SYSTEM',
        reducedMotion: false,
        status: 'PENDING',
        authFence: 1,
        createdAt: now,
        updatedAt: now,
      },
      options,
    );
    await work.db.collection<ParticipantDocument>(COLLECTIONS.participants).insertOne(
      {
        _id: participantId,
        userId,
        kind: 'USER',
        displayName: values.displayName,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      },
      options,
    );
    await work.db
      .collection<{ _id: string; userId: string; createdAt: Date; updatedAt: Date }>(
        COLLECTIONS.userPreferences,
      )
      .insertOne({ _id: userId, userId, createdAt: now, updatedAt: now }, options);
    await work.db.collection<AuthTokenDocument>(COLLECTIONS.authTokens).insertOne(
      {
        _id: values.verificationTokenId.toLowerCase(),
        userId,
        tokenType: 'EMAIL_VERIFY',
        tokenHash: Buffer.from(values.verificationTokenHash),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        createdAt: now,
      },
      options,
    );
    await work.db
      .collection<{ _id: string } & Record<string, unknown>>(COLLECTIONS.outbox)
      .insertOne(
        {
          _id: values.outboxId.toLowerCase(),
          eventType: 'identity.email_verification_requested',
          aggregateType: 'USER',
          aggregateId: userId,
          payload: { userId, email: values.email },
          status: 'PENDING',
          availableAt: now,
          attempts: 0,
          createdAt: now,
        },
        options,
      );
    await work.db
      .collection<{ _id: string } & Record<string, unknown>>(COLLECTIONS.auditEvents)
      .insertOne(
        {
          _id: values.auditId.toLowerCase(),
          actorParticipantId: participantId,
          actorUserId: userId,
          actionKey: 'account.register',
          resourceType: 'USER',
          resourceId: userId,
          requestId: values.requestId,
          metadata: {},
          createdAt: now,
        },
        options,
      );
  }

  async consumeVerificationToken(work: MongoUnitOfWork, tokenHash: Buffer): Promise<boolean> {
    const now = new Date();
    const options = mongoOptions(work);
    const token = await work.db
      .collection<AuthTokenDocument>(COLLECTIONS.authTokens)
      .findOneAndUpdate(
        {
          tokenType: 'EMAIL_VERIFY',
          tokenHash,
          consumedAt: { $exists: false },
          expiresAt: { $gt: now },
        },
        { $set: { consumedAt: now } },
        { ...options, returnDocument: 'before' },
      );
    if (!token) return false;
    await work.db.collection<UserDocument>(COLLECTIONS.users).updateOne(
      { _id: token.userId, status: 'PENDING' },
      {
        $set: {
          status: 'ACTIVE',
          emailVerifiedAt: now,
          updatedAt: now,
        },
        $inc: { authFence: 1 },
      },
      options,
    );
    return true;
  }

  async findLoginByEmail(email: string): Promise<LoginRow | undefined> {
    return this.mongo.withConnection(async (work) => {
      const user = await work.db
        .collection<UserDocument>(COLLECTIONS.users)
        .findOne({ emailNormalized: email }, mongoOptions(work));
      return user ? this.loginRow(work, user) : undefined;
    });
  }

  async issueMobileOtp(
    work: MongoUnitOfWork,
    values: {
      readonly challengeId: string;
      readonly mobileNumber: string;
      readonly otpHash: Buffer;
      readonly phoneHash: Buffer;
      readonly ipHash: Buffer;
      readonly requestId: string;
      readonly userAgent: string;
      readonly deliveryMode: 'development_response' | 'twilio';
      readonly auditId: string;
      readonly ttlSeconds: number;
      readonly cooldownSeconds: number;
      readonly windowMinutes: number;
      readonly phoneLimit: number;
      readonly ipLimit: number;
      readonly maxAttempts: number;
    },
  ): Promise<MobileOtpIssueResult> {
    const phoneThrottle = await this.lockMobileOtpThrottle(work, {
      scope: 'PHONE',
      key: values.phoneHash,
      windowMinutes: values.windowMinutes,
      cooldownSeconds: values.cooldownSeconds,
    });
    const ipThrottle = await this.lockMobileOtpThrottle(work, {
      scope: 'IP',
      key: values.ipHash,
      windowMinutes: values.windowMinutes,
      cooldownSeconds: values.cooldownSeconds,
    });
    if (phoneThrottle.COOLDOWN_FLAG === 'Y') {
      return {
        outcome: 'rate_limited',
        reason: 'cooldown',
        retryAfterSeconds: values.cooldownSeconds,
      };
    }
    if (
      Number(phoneThrottle.REQUEST_COUNT) >= values.phoneLimit ||
      Number(ipThrottle.REQUEST_COUNT) >= values.ipLimit
    ) {
      return {
        outcome: 'rate_limited',
        reason: 'quota',
        retryAfterSeconds: Math.max(
          Number(phoneThrottle.REQUEST_COUNT) >= values.phoneLimit
            ? Number(phoneThrottle.WINDOW_RETRY_SECONDS)
            : 1,
          Number(ipThrottle.REQUEST_COUNT) >= values.ipLimit
            ? Number(ipThrottle.WINDOW_RETRY_SECONDS)
            : 1,
        ),
      };
    }

    const now = new Date();
    const options = mongoOptions(work);
    const challenges = work.db.collection<MobileOtpChallengeDocument>(
      COLLECTIONS.mobileOtpChallenges,
    );
    const slot = await challenges.findOne(
      { mobileE164: values.mobileNumber, purpose: 'LOGIN' },
      options,
    );
    const challenge: MobileOtpChallengeDocument = {
      _id: slot?._id ?? values.challengeId.toLowerCase(),
      challengeId: values.challengeId.toLowerCase(),
      mobileE164: values.mobileNumber,
      purpose: 'LOGIN',
      otpHash: Buffer.from(values.otpHash),
      requestIpHash: Buffer.from(values.ipHash),
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: values.maxAttempts,
      expiresAt: new Date(now.getTime() + values.ttlSeconds * 1_000),
      purgeAt: new Date(now.getTime() + OTP_CHALLENGE_RETENTION_MILLISECONDS),
      createdAt: now,
      updatedAt: now,
    };
    if (slot) {
      const replaced = await challenges.replaceOne({ _id: slot._id }, challenge, options);
      if (replaced.modifiedCount !== 1) throw new Error('OTP challenge slot was not replaced');
    } else {
      await challenges.insertOne(challenge, options);
    }
    const throttles = work.db.collection<MobileOtpThrottleDocument>(COLLECTIONS.mobileOtpThrottles);
    for (const throttle of [
      { scope: 'PHONE' as const, key: values.phoneHash },
      { scope: 'IP' as const, key: values.ipHash },
    ]) {
      await throttles.updateOne(
        { scope: throttle.scope, throttleKey: throttle.key },
        {
          $inc: { requestCount: 1 },
          $set: { lastIssuedAt: now, updatedAt: now },
        },
        options,
      );
    }
    await work.db
      .collection<{ _id: string } & Record<string, unknown>>(COLLECTIONS.auditEvents)
      .insertOne(
        {
          _id: values.auditId.toLowerCase(),
          actionKey: 'auth.mobile_otp.request',
          resourceType: 'MOBILE_OTP',
          resourceId: values.challengeId.toLowerCase(),
          requestId: values.requestId,
          ipAddressHash: Buffer.from(values.ipHash),
          userAgentSummary: values.userAgent.slice(0, 500),
          metadata: { deliveryMode: values.deliveryMode },
          createdAt: now,
        },
        options,
      );
    return { outcome: 'created' };
  }

  async lockMobileOtpThrottle(
    work: MongoUnitOfWork,
    values: {
      readonly scope: 'PHONE' | 'IP';
      readonly key: Buffer;
      readonly windowMinutes: number;
      readonly cooldownSeconds: number;
    },
  ): Promise<MobileOtpThrottleRow> {
    const now = new Date();
    const options = mongoOptions(work);
    const collection = work.db.collection<MobileOtpThrottleDocument>(
      COLLECTIONS.mobileOtpThrottles,
    );
    await collection.updateOne(
      { scope: values.scope, throttleKey: values.key },
      {
        $setOnInsert: {
          _id: randomUUID(),
          scope: values.scope,
          throttleKey: Buffer.from(values.key),
          requestCount: 0,
          windowStartedAt: now,
          purgeAt: new Date(now.getTime() + values.windowMinutes * 60 * 1_000),
          createdAt: now,
          updatedAt: now,
        },
      },
      { ...options, upsert: true },
    );
    let throttle = await collection.findOne(
      { scope: values.scope, throttleKey: values.key },
      options,
    );
    if (!throttle) throw new Error('OTP throttle could not be loaded');
    const windowMilliseconds = values.windowMinutes * 60 * 1_000;
    const windowExpired = throttle.windowStartedAt.getTime() <= now.getTime() - windowMilliseconds;
    const cooldown = Boolean(
      throttle.lastIssuedAt &&
      throttle.lastIssuedAt.getTime() > now.getTime() - values.cooldownSeconds * 1_000,
    );
    if (windowExpired) {
      await collection.updateOne(
        { _id: throttle._id },
        {
          $set: {
            windowStartedAt: now,
            requestCount: 0,
            purgeAt: new Date(now.getTime() + windowMilliseconds),
            updatedAt: now,
          },
        },
        options,
      );
      throttle = {
        ...throttle,
        windowStartedAt: now,
        requestCount: 0,
        purgeAt: new Date(now.getTime() + windowMilliseconds),
        updatedAt: now,
      };
    }
    const retrySeconds = Math.max(
      1,
      Math.ceil((throttle.windowStartedAt.getTime() + windowMilliseconds - now.getTime()) / 1_000),
    );
    return {
      REQUEST_COUNT: String(throttle.requestCount),
      WINDOW_EXPIRED_FLAG: 'N',
      COOLDOWN_FLAG: cooldown ? 'Y' : 'N',
      WINDOW_RETRY_SECONDS: String(retrySeconds),
    };
  }

  async lockMobileOtpChallenge(
    work: MongoUnitOfWork,
    challengeId: string,
    mobileNumber: string,
  ): Promise<MobileOtpChallengeRow | undefined> {
    const challenge = await work.db
      .collection<MobileOtpChallengeDocument>(COLLECTIONS.mobileOtpChallenges)
      .findOne(
        { challengeId: challengeId.toLowerCase(), mobileE164: mobileNumber },
        mongoOptions(work),
      );
    return challenge
      ? {
          OTP_CHALLENGE_ID: challenge.challengeId,
          MOBILE_E164: challenge.mobileE164,
          OTP_HASH: challenge.otpHash,
          STATUS: challenge.status,
          ATTEMPT_COUNT: String(challenge.attemptCount),
          MAX_ATTEMPTS: String(challenge.maxAttempts),
          EXPIRED_FLAG: challenge.expiresAt <= new Date() ? 'Y' : 'N',
        }
      : undefined;
  }

  async expireMobileOtp(work: MongoUnitOfWork, challengeId: string): Promise<void> {
    const now = new Date();
    await work.db
      .collection<MobileOtpChallengeDocument>(COLLECTIONS.mobileOtpChallenges)
      .updateOne(
        { challengeId: challengeId.toLowerCase(), status: 'PENDING' },
        { $set: { status: 'EXPIRED', terminalAt: now, updatedAt: now } },
        mongoOptions(work),
      );
  }

  async recordFailedMobileOtpAttempt(work: MongoUnitOfWork, challengeId: string): Promise<void> {
    const options = mongoOptions(work);
    const challenges = work.db.collection<MobileOtpChallengeDocument>(
      COLLECTIONS.mobileOtpChallenges,
    );
    const challenge = await challenges.findOne(
      { challengeId: challengeId.toLowerCase(), status: 'PENDING' },
      options,
    );
    if (!challenge) return;
    const attemptCount = challenge.attemptCount + 1;
    const locked = attemptCount >= challenge.maxAttempts;
    const now = new Date();
    await challenges.updateOne(
      {
        challengeId: challengeId.toLowerCase(),
        status: 'PENDING',
        attemptCount: challenge.attemptCount,
      },
      {
        $set: {
          attemptCount,
          lastAttemptAt: now,
          status: locked ? 'LOCKED' : 'PENDING',
          updatedAt: now,
          ...(locked ? { terminalAt: now } : {}),
        },
      },
      options,
    );
  }

  async authenticateMobileOtp(
    work: MongoUnitOfWork,
    values: {
      readonly challengeId: string;
      readonly mobileNumber: string;
      readonly newUserId: string;
      readonly newParticipantId: string;
      readonly displayName: string;
      readonly locale: string;
      readonly timezone: string;
      readonly session: Omit<SessionValues, 'userId'>;
      readonly requestId: string;
      readonly auditId: string;
    },
  ): Promise<MobileOtpAuthenticationResult> {
    const options = mongoOptions(work);
    const users = work.db.collection<UserDocument>(COLLECTIONS.users);
    let user = await users.findOne({ mobileE164: values.mobileNumber }, options);
    const isNewAccount = !user;
    if (user && user.status !== 'ACTIVE' && user.status !== 'PENDING') {
      const now = new Date();
      await work.db
        .collection<MobileOtpChallengeDocument>(COLLECTIONS.mobileOtpChallenges)
        .updateOne(
          { challengeId: values.challengeId.toLowerCase(), status: 'PENDING' },
          { $set: { status: 'SUPERSEDED', terminalAt: now, updatedAt: now } },
          options,
        );
      return { outcome: 'account_unavailable' };
    }

    const now = new Date();
    const consumed = await work.db
      .collection<MobileOtpChallengeDocument>(COLLECTIONS.mobileOtpChallenges)
      .updateOne(
        {
          challengeId: values.challengeId.toLowerCase(),
          status: 'PENDING',
          expiresAt: { $gt: now },
        },
        {
          $set: {
            status: 'VERIFIED',
            consumedAt: now,
            lastAttemptAt: now,
            terminalAt: now,
            updatedAt: now,
          },
        },
        options,
      );
    if (consumed.modifiedCount !== 1) {
      await this.expireMobileOtp(work, values.challengeId);
      return { outcome: 'invalid' };
    }

    let participant: ParticipantDocument | null;
    if (!user) {
      const userId = values.newUserId.toLowerCase();
      const participantId = values.newParticipantId.toLowerCase();
      user = {
        _id: userId,
        mobileE164: values.mobileNumber,
        mobileVerifiedAt: now,
        displayName: values.displayName,
        localeCode: values.locale,
        timezoneName: values.timezone,
        defaultCurrencyCode: 'INR',
        theme: 'SYSTEM',
        reducedMotion: false,
        status: 'ACTIVE',
        authFence: 1,
        createdAt: now,
        updatedAt: now,
      };
      participant = {
        _id: participantId,
        userId,
        kind: 'USER',
        displayName: values.displayName,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      };
      await users.insertOne(user, options);
      await work.db
        .collection<ParticipantDocument>(COLLECTIONS.participants)
        .insertOne(participant, options);
      await work.db
        .collection<{ _id: string; userId: string; createdAt: Date; updatedAt: Date }>(
          COLLECTIONS.userPreferences,
        )
        .insertOne({ _id: userId, userId, createdAt: now, updatedAt: now }, options);
    } else {
      const activate = user.status === 'PENDING';
      const userUpdate = await users.findOneAndUpdate(
        { _id: user._id, status: { $in: ['PENDING', 'ACTIVE'] } },
        {
          $set: {
            status: 'ACTIVE',
            mobileVerifiedAt: user.mobileVerifiedAt ?? now,
            updatedAt: now,
          },
          ...(activate ? { $inc: { authFence: 1 } } : {}),
        },
        { ...options, returnDocument: 'after' },
      );
      if (!userUpdate) return { outcome: 'account_unavailable' };
      user = userUpdate;
      participant = await work.db
        .collection<ParticipantDocument>(COLLECTIONS.participants)
        .findOne({ userId: user._id, kind: 'USER' }, options);
      if (!participant) throw new Error('Authenticated account has no financial participant');
    }

    await this.rotateSession(work, { ...values.session, userId: user._id });
    user = { ...user, authFence: user.authFence + 1 };
    await work.db
      .collection<{ _id: string } & Record<string, unknown>>(COLLECTIONS.auditEvents)
      .insertOne(
        {
          _id: values.auditId.toLowerCase(),
          actorParticipantId: participant._id,
          actorUserId: user._id,
          actionKey: isNewAccount ? 'account.mobile_register' : 'auth.mobile_login',
          resourceType: 'USER',
          resourceId: user._id,
          requestId: values.requestId,
          ipAddressHash: Buffer.from(values.session.ipHash),
          userAgentSummary: values.session.userAgent.slice(0, 500),
          metadata: { authenticationMethod: 'mobile_otp', isNewAccount },
          createdAt: now,
        },
        options,
      );
    const row = await this.loginRow(work, user, participant);
    if (!row) {
      throw new Error('Authenticated user was not found after mobile verification.');
    }
    return {
      outcome: 'authenticated',
      isNewAccount,
      user: rowToAuthenticatedUser(row),
    };
  }

  async rotateSession(work: MongoUnitOfWork, values: SessionValues): Promise<void> {
    const options = mongoOptions(work);
    const now = new Date();
    const user = await work.db
      .collection<UserDocument>(COLLECTIONS.users)
      .updateOne(
        { _id: values.userId, status: 'ACTIVE' },
        { $inc: { authFence: 1 }, $set: { updatedAt: now } },
        options,
      );
    if (user.matchedCount !== 1) throw new Error('Session account no longer exists');
    const sessions = work.db.collection<SessionDocument>(COLLECTIONS.sessions);
    await sessions.replaceOne(
      { _id: values.userId },
      {
        sessionId: values.sessionId.toLowerCase(),
        userId: values.userId,
        sessionTokenHash: Buffer.from(values.tokenHash),
        csrfSecretHash: Buffer.from(values.csrfHash),
        ...(values.deviceName ? { deviceName: values.deviceName } : {}),
        userAgentSummary: values.userAgent.slice(0, 500),
        ipAddressHash: Buffer.from(values.ipHash),
        expiresAt: values.expiresAt,
        lastSeenAt: now,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      { ...options, upsert: true },
    );
  }

  async findSession(tokenHash: Buffer, idleMinutes: number): Promise<AuthContext | undefined> {
    return this.mongo.withConnection(async (work) => {
      const options = mongoOptions(work);
      const now = new Date();
      const idleCutoff = new Date(now.getTime() - idleMinutes * 60 * 1_000);
      const sessions = work.db.collection<SessionDocument>(COLLECTIONS.sessions);
      const session = await sessions.findOne(
        {
          sessionTokenHash: tokenHash,
          active: true,
          expiresAt: { $gt: now },
          lastSeenAt: { $gt: idleCutoff },
        },
        options,
      );
      if (!session) return undefined;
      const touched = await sessions.updateOne(
        {
          _id: session._id,
          sessionId: session.sessionId,
          sessionTokenHash: tokenHash,
          active: true,
          expiresAt: { $gt: now },
          lastSeenAt: { $gt: idleCutoff },
        },
        { $set: { lastSeenAt: now, updatedAt: now } },
        options,
      );
      if (touched.matchedCount !== 1) return undefined;
      const user = await work.db
        .collection<UserDocument>(COLLECTIONS.users)
        .findOne({ _id: session.userId, status: 'ACTIVE' }, options);
      if (!user) return undefined;
      const row = await this.loginRow(work, user);
      if (!row) return undefined;
      return {
        sessionId: session.sessionId,
        csrfHash: session.csrfSecretHash,
        user: rowToAuthenticatedUser(row),
      };
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.mongo.withConnection(async (work) => {
      const now = new Date();
      await work.db.collection<SessionDocument>(COLLECTIONS.sessions).updateOne(
        { sessionId: sessionId.toLowerCase(), active: true },
        {
          $set: {
            active: false,
            revokedAt: now,
            revokedReason: 'USER_LOGOUT',
            updatedAt: now,
          },
        },
        mongoOptions(work),
      );
    });
  }

  private async loginRow(
    work: MongoUnitOfWork,
    user: UserDocument,
    knownParticipant?: ParticipantDocument,
  ): Promise<LoginRow | undefined> {
    const options = mongoOptions(work);
    const participant =
      knownParticipant ??
      (await work.db
        .collection<ParticipantDocument>(COLLECTIONS.participants)
        .findOne({ userId: user._id, kind: 'USER' }, options));
    if (!participant) return undefined;
    const avatar = user.avatarKey
      ? await work.db.collection<MediaDocument>(COLLECTIONS.mediaObjects).findOne(
          {
            ownerUserId: user._id,
            storageKey: user.avatarKey,
            mediaKind: 'USER_AVATAR',
            status: 'ACTIVE',
          },
          options,
        )
      : undefined;
    return {
      USER_ID: user._id,
      PARTICIPANT_ID: participant._id,
      EMAIL_NORMALIZED: user.emailNormalized ?? null,
      MOBILE_E164: user.mobileE164 ?? null,
      PASSWORD_HASH: user.passwordHash ?? null,
      DISPLAY_NAME: user.displayName,
      LOCALE_CODE: user.localeCode,
      TIMEZONE_NAME: user.timezoneName,
      DEFAULT_CURRENCY_CODE: user.defaultCurrencyCode,
      THEME: user.theme,
      REDUCED_MOTION_FLAG: user.reducedMotion ? 'Y' : 'N',
      AVATAR_MEDIA_ID: avatar?._id ?? null,
      STATUS: user.status,
      VERSION_NO: String(user.authFence),
    };
  }
}
