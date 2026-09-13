import { Injectable } from '@nestjs/common';
import oracledb, { type Connection } from 'oracledb';
import { OracleService } from '../database/oracle.service.js';
import { rawToUuid, uuidToRaw } from '../database/uuid.js';
import { participantAvatarUrl } from '../media/media.types.js';
import type { RegisterInput } from './auth.schemas.js';
import type { AuthContext, AuthenticatedUser } from './auth.types.js';

export interface LoginRow {
  USER_ID: Buffer;
  PARTICIPANT_ID: Buffer;
  EMAIL_NORMALIZED: string | null;
  MOBILE_E164: string | null;
  PASSWORD_HASH: string | null;
  DISPLAY_NAME: string;
  LOCALE_CODE: string;
  TIMEZONE_NAME: string;
  DEFAULT_CURRENCY_CODE: string;
  THEME: 'LIGHT' | 'DARK' | 'SYSTEM';
  REDUCED_MOTION_FLAG: 'Y' | 'N';
  AVATAR_MEDIA_ID: Buffer | null;
  STATUS: string;
  VERSION_NO: string;
}

interface SessionRow extends Omit<LoginRow, 'PASSWORD_HASH' | 'STATUS'> {
  SESSION_ID: Buffer;
  CSRF_SECRET_HASH: Buffer;
}

export interface SessionValues {
  readonly sessionId: string;
  readonly userId: Buffer;
  readonly tokenHash: Buffer;
  readonly csrfHash: Buffer;
  readonly deviceName?: string;
  readonly userAgent: string;
  readonly ipHash: Buffer;
  readonly expiresAt: Date;
}

export interface MobileOtpChallengeRow {
  OTP_CHALLENGE_ID: Buffer;
  MOBILE_E164: string;
  OTP_HASH: Buffer;
  STATUS: 'PENDING' | 'VERIFIED' | 'EXPIRED' | 'LOCKED' | 'SUPERSEDED';
  ATTEMPT_COUNT: string;
  MAX_ATTEMPTS: string;
  EXPIRED_FLAG: 'Y' | 'N';
}

interface PendingMobileOtpRow {
  OTP_CHALLENGE_ID: Buffer;
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

function oracleErrorNumber(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'errorNum' in error
    ? Number(error.errorNum)
    : undefined;
}

export function rowToAuthenticatedUser(
  row: Omit<LoginRow, 'PASSWORD_HASH' | 'STATUS'>,
): AuthenticatedUser {
  const participantId = rawToUuid(row.PARTICIPANT_ID);
  return {
    id: participantId,
    userId: rawToUuid(row.USER_ID),
    participantId,
    ...(row.EMAIL_NORMALIZED ? { email: row.EMAIL_NORMALIZED } : {}),
    ...(row.MOBILE_E164 ? { mobileNumber: row.MOBILE_E164 } : {}),
    displayName: row.DISPLAY_NAME,
    ...(row.AVATAR_MEDIA_ID
      ? { avatarUrl: participantAvatarUrl(participantId, rawToUuid(row.AVATAR_MEDIA_ID)) }
      : {}),
    locale: row.LOCALE_CODE,
    timezone: row.TIMEZONE_NAME,
    defaultCurrency: row.DEFAULT_CURRENCY_CODE.trim(),
    theme: row.THEME.toLowerCase() as AuthenticatedUser['theme'],
    reducedMotion: row.REDUCED_MOTION_FLAG === 'Y',
    version: row.VERSION_NO,
  };
}

@Injectable()
export class AuthRepository {
  constructor(private readonly oracle: OracleService) {}

  async createPendingAccount(
    connection: Connection,
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
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_USERS (
         USER_ID, EMAIL_NORMALIZED, PASSWORD_HASH, DISPLAY_NAME, LOCALE_CODE,
         TIMEZONE_NAME, DEFAULT_CURRENCY_CODE, STATUS
       ) VALUES (
         :userId, :email, :passwordHash, :displayName, :localeCode,
         :timezoneName, :currencyCode, 'PENDING'
       )`,
      {
        userId: uuidToRaw(values.userId),
        email: values.email,
        passwordHash: values.passwordHash,
        displayName: values.displayName,
        localeCode: values.locale,
        timezoneName: values.timezone,
        currencyCode: values.defaultCurrency,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_PARTICIPANTS (
         PARTICIPANT_ID, USER_ID, KIND, DISPLAY_NAME
       ) VALUES (:participantId, :userId, 'USER', :displayName)`,
      {
        participantId: uuidToRaw(values.participantId),
        userId: uuidToRaw(values.userId),
        displayName: values.displayName,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_USER_PREFERENCES (USER_ID) VALUES (:userId)`,
      { userId: uuidToRaw(values.userId) },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUTH_TOKENS (
         TOKEN_ID, USER_ID, TOKEN_TYPE, TOKEN_HASH, EXPIRES_AT_UTC
       ) VALUES (
         :tokenId, :userId, 'EMAIL_VERIFY', :tokenHash,
         SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(24, 'HOUR')
       )`,
      {
        tokenId: uuidToRaw(values.verificationTokenId),
        userId: uuidToRaw(values.userId),
        tokenHash: values.verificationTokenHash,
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_OUTBOX (
         OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON
       ) VALUES (
         :outboxId, 'identity.email_verification_requested', 'USER', :userId, :payload
       )`,
      {
        outboxId: uuidToRaw(values.outboxId),
        userId: uuidToRaw(values.userId),
        payload: {
          val: JSON.stringify({ userId: values.userId, email: values.email }),
          type: oracledb.CLOB,
        },
      },
    );
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, REQUEST_ID, METADATA_JSON
       ) VALUES (
         :auditId, :participantId, :userId, 'account.register',
         'USER', :userId, :requestId, '{}'
       )`,
      {
        auditId: uuidToRaw(values.auditId),
        participantId: uuidToRaw(values.participantId),
        userId: uuidToRaw(values.userId),
        requestId: values.requestId,
      },
    );
  }

  async consumeVerificationToken(connection: Connection, tokenHash: Buffer): Promise<boolean> {
    const result = await this.oracle.execute<{ TOKEN_ID: Buffer; USER_ID: Buffer }>(
      connection,
      `SELECT TOKEN_ID, USER_ID
         FROM SPLITO_AUTH_TOKENS
        WHERE TOKEN_TYPE = 'EMAIL_VERIFY'
          AND TOKEN_HASH = :tokenHash
          AND CONSUMED_AT_UTC IS NULL
          AND EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
        FOR UPDATE`,
      { tokenHash },
    );
    const row = result.rows?.[0];
    if (!row) return false;

    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_AUTH_TOKENS
          SET CONSUMED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE TOKEN_ID = :tokenId`,
      { tokenId: row.TOKEN_ID },
    );
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_USERS
          SET STATUS = 'ACTIVE',
              EMAIL_VERIFIED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              SECURITY_VERSION = SECURITY_VERSION + 1
        WHERE USER_ID = :userId
          AND STATUS = 'PENDING'`,
      { userId: row.USER_ID },
    );
    return true;
  }

  async findLoginByEmail(email: string): Promise<LoginRow | undefined> {
    return this.oracle.withConnection(async (connection) => {
      const result = await this.oracle.execute<LoginRow>(
        connection,
        `SELECT U.USER_ID, P.PARTICIPANT_ID, U.EMAIL_NORMALIZED, U.MOBILE_E164, U.PASSWORD_HASH,
                U.DISPLAY_NAME, U.LOCALE_CODE, U.TIMEZONE_NAME, U.DEFAULT_CURRENCY_CODE,
                U.THEME, U.REDUCED_MOTION_FLAG, U.STATUS,
                AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID,
                TO_CHAR(U.SECURITY_VERSION) AS VERSION_NO
           FROM SPLITO_USERS U
           JOIN SPLITO_PARTICIPANTS P ON P.USER_ID = U.USER_ID AND P.KIND = 'USER'
           LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
             ON AVATAR.OWNER_USER_ID = U.USER_ID
            AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
            AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
            AND AVATAR.STATUS = 'ACTIVE'
          WHERE U.EMAIL_NORMALIZED = :email`,
        { email },
      );
      return result.rows?.[0];
    });
  }

  async issueMobileOtp(
    connection: Connection,
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
    const phoneThrottle = await this.lockMobileOtpThrottle(connection, {
      scope: 'PHONE',
      key: values.phoneHash,
      windowMinutes: values.windowMinutes,
      cooldownSeconds: values.cooldownSeconds,
    });
    const ipThrottle = await this.lockMobileOtpThrottle(connection, {
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
      const retrySeconds = Math.max(
        Number(phoneThrottle.REQUEST_COUNT) >= values.phoneLimit
          ? Number(phoneThrottle.WINDOW_RETRY_SECONDS)
          : 1,
        Number(ipThrottle.REQUEST_COUNT) >= values.ipLimit
          ? Number(ipThrottle.WINDOW_RETRY_SECONDS)
          : 1,
      );
      return {
        outcome: 'rate_limited',
        reason: 'quota',
        retryAfterSeconds: retrySeconds,
      };
    }

    const pendingResult = await this.oracle.execute<PendingMobileOtpRow>(
      connection,
      `SELECT OTP_CHALLENGE_ID,
              CASE WHEN EXPIRES_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 'Y' ELSE 'N' END
                AS EXPIRED_FLAG
         FROM SPLITO_MOBILE_OTP_CHALLENGES
        WHERE MOBILE_E164 = :mobileNumber
          AND PURPOSE = 'LOGIN'
          AND STATUS = 'PENDING'
        FOR UPDATE`,
      { mobileNumber: values.mobileNumber },
    );
    const pending = pendingResult.rows?.[0];
    if (pending) {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_MOBILE_OTP_CHALLENGES
            SET STATUS = :status,
                TERMINAL_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE OTP_CHALLENGE_ID = :challengeId
            AND STATUS = 'PENDING'`,
        {
          status: pending.EXPIRED_FLAG === 'Y' ? 'EXPIRED' : 'SUPERSEDED',
          challengeId: pending.OTP_CHALLENGE_ID,
        },
      );
    }

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_MOBILE_OTP_CHALLENGES (
         OTP_CHALLENGE_ID, MOBILE_E164, OTP_HASH, REQUEST_IP_HASH,
         MAX_ATTEMPTS, EXPIRES_AT_UTC
       ) VALUES (
         :challengeId, :mobileNumber, :otpHash, :ipHash,
         :maxAttempts, SYS_EXTRACT_UTC(SYSTIMESTAMP)
           + NUMTODSINTERVAL(:ttlSeconds, 'SECOND')
       )`,
      {
        challengeId: uuidToRaw(values.challengeId),
        mobileNumber: values.mobileNumber,
        otpHash: values.otpHash,
        ipHash: values.ipHash,
        maxAttempts: values.maxAttempts,
        ttlSeconds: values.ttlSeconds,
      },
    );
    for (const throttle of [
      { scope: 'PHONE', key: values.phoneHash },
      { scope: 'IP', key: values.ipHash },
    ] as const) {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_MOBILE_OTP_THROTTLES
            SET REQUEST_COUNT = REQUEST_COUNT + 1,
                LAST_ISSUED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE THROTTLE_SCOPE = :scope
            AND THROTTLE_KEY = :throttleKey`,
        { scope: throttle.scope, throttleKey: throttle.key },
      );
    }
    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTION_KEY, RESOURCE_TYPE, RESOURCE_ID, REQUEST_ID,
         IP_ADDRESS_HASH, USER_AGENT_SUMMARY, METADATA_JSON
       ) VALUES (
         :auditId, 'auth.mobile_otp.request', 'MOBILE_OTP', :challengeId, :requestId,
         :ipHash, :userAgent, :metadata
       )`,
      {
        auditId: uuidToRaw(values.auditId),
        challengeId: uuidToRaw(values.challengeId),
        requestId: values.requestId,
        ipHash: values.ipHash,
        userAgent: values.userAgent.slice(0, 500),
        metadata: JSON.stringify({ deliveryMode: values.deliveryMode }),
      },
    );
    return { outcome: 'created' };
  }

  async lockMobileOtpThrottle(
    connection: Connection,
    values: {
      readonly scope: 'PHONE' | 'IP';
      readonly key: Buffer;
      readonly windowMinutes: number;
      readonly cooldownSeconds: number;
    },
  ): Promise<MobileOtpThrottleRow> {
    try {
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_MOBILE_OTP_THROTTLES (
           THROTTLE_SCOPE, THROTTLE_KEY
         ) VALUES (
           :scope, :throttleKey
         )`,
        { scope: values.scope, throttleKey: values.key },
      );
    } catch (error) {
      if (oracleErrorNumber(error) !== 1) throw error;
    }

    const result = await this.oracle.execute<MobileOtpThrottleRow>(
      connection,
      `SELECT TO_CHAR(REQUEST_COUNT) AS REQUEST_COUNT,
              CASE WHEN WINDOW_STARTED_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP)
                   - NUMTODSINTERVAL(:windowMinutes, 'MINUTE') THEN 'Y' ELSE 'N' END
                AS WINDOW_EXPIRED_FLAG,
              CASE WHEN LAST_ISSUED_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
                   - NUMTODSINTERVAL(:cooldownSeconds, 'SECOND') THEN 'Y' ELSE 'N' END
                AS COOLDOWN_FLAG,
              TO_CHAR(GREATEST(
                1,
                CEIL((
                  CAST(WINDOW_STARTED_AT_UTC AS DATE) + (:windowMinutes / 1440)
                  - CAST(SYS_EXTRACT_UTC(SYSTIMESTAMP) AS DATE)
                ) * 86400)
              )) AS WINDOW_RETRY_SECONDS
         FROM SPLITO_MOBILE_OTP_THROTTLES
        WHERE THROTTLE_SCOPE = :scope
          AND THROTTLE_KEY = :throttleKey
        FOR UPDATE`,
      {
        scope: values.scope,
        throttleKey: values.key,
        windowMinutes: values.windowMinutes,
        cooldownSeconds: values.cooldownSeconds,
      },
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('OTP throttle row could not be locked');
    if (row.WINDOW_EXPIRED_FLAG === 'N') return row;

    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MOBILE_OTP_THROTTLES
          SET WINDOW_STARTED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              REQUEST_COUNT = 0,
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE THROTTLE_SCOPE = :scope
          AND THROTTLE_KEY = :throttleKey`,
      { scope: values.scope, throttleKey: values.key },
    );
    return {
      REQUEST_COUNT: '0',
      WINDOW_EXPIRED_FLAG: 'N',
      COOLDOWN_FLAG: row.COOLDOWN_FLAG,
      WINDOW_RETRY_SECONDS: String(values.windowMinutes * 60),
    };
  }

  async lockMobileOtpChallenge(
    connection: Connection,
    challengeId: string,
    mobileNumber: string,
  ): Promise<MobileOtpChallengeRow | undefined> {
    const result = await this.oracle.execute<MobileOtpChallengeRow>(
      connection,
      `SELECT OTP_CHALLENGE_ID, MOBILE_E164, OTP_HASH, STATUS,
              TO_CHAR(ATTEMPT_COUNT) AS ATTEMPT_COUNT,
              TO_CHAR(MAX_ATTEMPTS) AS MAX_ATTEMPTS,
              CASE WHEN EXPIRES_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP) THEN 'Y' ELSE 'N' END
                AS EXPIRED_FLAG
         FROM SPLITO_MOBILE_OTP_CHALLENGES
        WHERE OTP_CHALLENGE_ID = :challengeId
          AND MOBILE_E164 = :mobileNumber
        FOR UPDATE`,
      { challengeId: uuidToRaw(challengeId), mobileNumber },
    );
    return result.rows?.[0];
  }

  async expireMobileOtp(connection: Connection, challengeId: Buffer): Promise<void> {
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MOBILE_OTP_CHALLENGES
          SET STATUS = 'EXPIRED',
              TERMINAL_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE OTP_CHALLENGE_ID = :challengeId
          AND STATUS = 'PENDING'`,
      { challengeId },
    );
  }

  async recordFailedMobileOtpAttempt(connection: Connection, challengeId: Buffer): Promise<void> {
    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MOBILE_OTP_CHALLENGES
          SET ATTEMPT_COUNT = ATTEMPT_COUNT + 1,
              LAST_ATTEMPT_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              STATUS = CASE
                WHEN ATTEMPT_COUNT + 1 >= MAX_ATTEMPTS THEN 'LOCKED'
                ELSE 'PENDING'
              END,
              TERMINAL_AT_UTC = CASE
                WHEN ATTEMPT_COUNT + 1 >= MAX_ATTEMPTS
                  THEN SYS_EXTRACT_UTC(SYSTIMESTAMP)
                ELSE NULL
              END
        WHERE OTP_CHALLENGE_ID = :challengeId
          AND STATUS = 'PENDING'`,
      { challengeId },
    );
  }

  async authenticateMobileOtp(
    connection: Connection,
    values: {
      readonly challengeId: Buffer;
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
    const existingResult = await this.oracle.execute<LoginRow>(
      connection,
      `SELECT U.USER_ID, P.PARTICIPANT_ID, U.EMAIL_NORMALIZED, U.MOBILE_E164, U.PASSWORD_HASH,
              U.DISPLAY_NAME, U.LOCALE_CODE, U.TIMEZONE_NAME, U.DEFAULT_CURRENCY_CODE,
              U.THEME, U.REDUCED_MOTION_FLAG, U.STATUS,
              AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID,
              TO_CHAR(U.SECURITY_VERSION) AS VERSION_NO
         FROM SPLITO_USERS U
         JOIN SPLITO_PARTICIPANTS P ON P.USER_ID = U.USER_ID AND P.KIND = 'USER'
         LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
           ON AVATAR.OWNER_USER_ID = U.USER_ID
          AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
          AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
          AND AVATAR.STATUS = 'ACTIVE'
        WHERE U.MOBILE_E164 = :mobileNumber
        FOR UPDATE OF U.STATUS`,
      { mobileNumber: values.mobileNumber },
    );
    let account = existingResult.rows?.[0];
    const isNewAccount = !account;

    if (account && account.STATUS !== 'ACTIVE' && account.STATUS !== 'PENDING') {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_MOBILE_OTP_CHALLENGES
            SET STATUS = 'SUPERSEDED',
                TERMINAL_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE OTP_CHALLENGE_ID = :challengeId
            AND STATUS = 'PENDING'`,
        { challengeId: values.challengeId },
      );
      return { outcome: 'account_unavailable' };
    }

    const consumeResult = await this.oracle.execute(
      connection,
      `UPDATE SPLITO_MOBILE_OTP_CHALLENGES
          SET STATUS = 'VERIFIED',
              CONSUMED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              LAST_ATTEMPT_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              TERMINAL_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE OTP_CHALLENGE_ID = :challengeId
          AND STATUS = 'PENDING'
          AND EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)`,
      { challengeId: values.challengeId },
    );
    if (consumeResult.rowsAffected !== 1) {
      await this.expireMobileOtp(connection, values.challengeId);
      return { outcome: 'invalid' };
    }

    if (!account) {
      const userId = uuidToRaw(values.newUserId);
      const participantId = uuidToRaw(values.newParticipantId);
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_USERS (
           USER_ID, MOBILE_E164, MOBILE_VERIFIED_AT_UTC, DISPLAY_NAME,
           LOCALE_CODE, TIMEZONE_NAME, STATUS
         ) VALUES (
           :userId, :mobileNumber, SYS_EXTRACT_UTC(SYSTIMESTAMP), :displayName,
           :localeCode, :timezoneName, 'ACTIVE'
         )`,
        {
          userId,
          mobileNumber: values.mobileNumber,
          displayName: values.displayName,
          localeCode: values.locale,
          timezoneName: values.timezone,
        },
      );
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_PARTICIPANTS (
           PARTICIPANT_ID, USER_ID, KIND, DISPLAY_NAME
         ) VALUES (
           :participantId, :userId, 'USER', :displayName
         )`,
        { participantId, userId, displayName: values.displayName },
      );
      await this.oracle.execute(
        connection,
        `INSERT INTO SPLITO_USER_PREFERENCES (USER_ID) VALUES (:userId)`,
        { userId },
      );
      account = {
        USER_ID: userId,
        PARTICIPANT_ID: participantId,
        EMAIL_NORMALIZED: null,
        MOBILE_E164: values.mobileNumber,
        PASSWORD_HASH: null,
        DISPLAY_NAME: values.displayName,
        LOCALE_CODE: values.locale,
        TIMEZONE_NAME: values.timezone,
        DEFAULT_CURRENCY_CODE: 'INR',
        THEME: 'SYSTEM',
        REDUCED_MOTION_FLAG: 'N',
        AVATAR_MEDIA_ID: null,
        STATUS: 'ACTIVE',
        VERSION_NO: '1',
      };
    } else if (account.STATUS === 'PENDING') {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_USERS
            SET STATUS = 'ACTIVE',
                MOBILE_VERIFIED_AT_UTC = COALESCE(
                  MOBILE_VERIFIED_AT_UTC, SYS_EXTRACT_UTC(SYSTIMESTAMP)
                ),
                UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                SECURITY_VERSION = SECURITY_VERSION + 1
          WHERE USER_ID = :userId`,
        { userId: account.USER_ID },
      );
      account = {
        ...account,
        STATUS: 'ACTIVE',
        VERSION_NO: String(Number(account.VERSION_NO) + 1),
      };
    } else {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_USERS
            SET MOBILE_VERIFIED_AT_UTC = COALESCE(
                  MOBILE_VERIFIED_AT_UTC, SYS_EXTRACT_UTC(SYSTIMESTAMP)
                ),
                UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE USER_ID = :userId`,
        { userId: account.USER_ID },
      );
    }

    await this.rotateSession(connection, { ...values.session, userId: account.USER_ID });

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_AUDIT_EVENTS (
         AUDIT_EVENT_ID, ACTOR_PARTICIPANT_ID, ACTOR_USER_ID, ACTION_KEY,
         RESOURCE_TYPE, RESOURCE_ID, REQUEST_ID, IP_ADDRESS_HASH,
         USER_AGENT_SUMMARY, METADATA_JSON
       ) VALUES (
         :auditId, :participantId, :userId, :actionKey,
         'USER', :userId, :requestId, :ipHash, :userAgent, :metadata
       )`,
      {
        auditId: uuidToRaw(values.auditId),
        participantId: account.PARTICIPANT_ID,
        userId: account.USER_ID,
        actionKey: isNewAccount ? 'account.mobile_register' : 'auth.mobile_login',
        requestId: values.requestId,
        ipHash: values.session.ipHash,
        userAgent: values.session.userAgent.slice(0, 500),
        metadata: JSON.stringify({ authenticationMethod: 'mobile_otp', isNewAccount }),
      },
    );

    return {
      outcome: 'authenticated',
      isNewAccount,
      user: rowToAuthenticatedUser(account),
    };
  }

  async rotateSession(connection: Connection, values: SessionValues): Promise<void> {
    const lockResult = await this.oracle.execute<{ USER_ID: Buffer }>(
      connection,
      `SELECT USER_ID
         FROM SPLITO_USERS
        WHERE USER_ID = :userId
          AND STATUS = 'ACTIVE'
        FOR UPDATE`,
      { userId: values.userId },
    );
    if (!lockResult.rows?.[0]) throw new Error('Session account no longer exists');

    await this.oracle.execute(
      connection,
      `UPDATE SPLITO_SESSIONS
          SET REVOKED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              REVOKED_REASON = 'SINGLE_ACTIVE_LOGIN'
        WHERE USER_ID = :userId
          AND REVOKED_AT_UTC IS NULL`,
      { userId: values.userId },
    );

    await this.oracle.execute(
      connection,
      `INSERT INTO SPLITO_SESSIONS (
         SESSION_ID, USER_ID, SESSION_TOKEN_HASH, CSRF_SECRET_HASH, DEVICE_NAME,
         USER_AGENT_SUMMARY, IP_ADDRESS_HASH, EXPIRES_AT_UTC
       ) VALUES (
         :sessionId, :userId, :tokenHash, :csrfHash, :deviceName,
         :userAgent, :ipHash, :expiresAt
       )`,
      {
        sessionId: uuidToRaw(values.sessionId),
        userId: values.userId,
        tokenHash: values.tokenHash,
        csrfHash: values.csrfHash,
        deviceName: values.deviceName ?? null,
        userAgent: values.userAgent.slice(0, 500),
        ipHash: values.ipHash,
        expiresAt: values.expiresAt,
      },
    );
  }

  async findSession(tokenHash: Buffer, idleMinutes: number): Promise<AuthContext | undefined> {
    return this.oracle.withConnection(async (connection) => {
      const result = await this.oracle.execute<SessionRow>(
        connection,
        `SELECT S.SESSION_ID, S.CSRF_SECRET_HASH, U.USER_ID, P.PARTICIPANT_ID,
                U.EMAIL_NORMALIZED, U.MOBILE_E164, U.DISPLAY_NAME, U.LOCALE_CODE, U.TIMEZONE_NAME,
                U.DEFAULT_CURRENCY_CODE, U.THEME, U.REDUCED_MOTION_FLAG,
                AVATAR.MEDIA_ID AS AVATAR_MEDIA_ID,
                TO_CHAR(U.SECURITY_VERSION) AS VERSION_NO
           FROM SPLITO_SESSIONS S
           JOIN SPLITO_USERS U ON U.USER_ID = S.USER_ID
           JOIN SPLITO_PARTICIPANTS P ON P.USER_ID = U.USER_ID AND P.KIND = 'USER'
           LEFT JOIN SPLITO_MEDIA_OBJECTS AVATAR
             ON AVATAR.OWNER_USER_ID = U.USER_ID
            AND AVATAR.STORAGE_KEY = U.AVATAR_KEY
            AND AVATAR.MEDIA_KIND = 'USER_AVATAR'
            AND AVATAR.STATUS = 'ACTIVE'
          WHERE S.SESSION_TOKEN_HASH = :tokenHash
            AND S.REVOKED_AT_UTC IS NULL
            AND S.EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
            AND S.LAST_SEEN_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
                - NUMTODSINTERVAL(:idleMinutes, 'MINUTE')
            AND U.STATUS = 'ACTIVE'`,
        { tokenHash, idleMinutes },
      );
      const row = result.rows?.[0];
      if (!row) return undefined;
      const touchResult = await this.oracle.execute(
        connection,
        `UPDATE SPLITO_SESSIONS
            SET LAST_SEEN_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
          WHERE SESSION_ID = :sessionId
            AND REVOKED_AT_UTC IS NULL
            AND EXPIRES_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
            AND LAST_SEEN_AT_UTC > SYS_EXTRACT_UTC(SYSTIMESTAMP)
                - NUMTODSINTERVAL(:idleMinutes, 'MINUTE')
            AND EXISTS (
              SELECT 1
                FROM SPLITO_USERS U
               WHERE U.USER_ID = SPLITO_SESSIONS.USER_ID
                 AND U.STATUS = 'ACTIVE'
            )`,
        { sessionId: row.SESSION_ID, idleMinutes },
        { autoCommit: true },
      );
      if (touchResult.rowsAffected !== 1) return undefined;
      return {
        sessionId: rawToUuid(row.SESSION_ID),
        csrfHash: row.CSRF_SECRET_HASH,
        user: rowToAuthenticatedUser(row),
      };
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.oracle.withConnection(async (connection) => {
      await this.oracle.execute(
        connection,
        `UPDATE SPLITO_SESSIONS
            SET REVOKED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                REVOKED_REASON = 'USER_LOGOUT'
          WHERE SESSION_ID = :sessionId
            AND REVOKED_AT_UTC IS NULL`,
        { sessionId: uuidToRaw(sessionId) },
        { autoCommit: true },
      );
    });
  }
}
