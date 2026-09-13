import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import type { OracleService } from '../database/oracle.service.js';
import { AuthRepository } from './auth.repository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const challengeId = '44444444-4444-4444-8444-444444444444';
const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');

describe('Oracle-backed mobile authentication repository', () => {
  it('locks the user, revokes every prior session, then inserts the replacement', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ USER_ID: raw(userId) }] })
      .mockResolvedValueOnce({ rowsAffected: 2 })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    const repository = new AuthRepository({ execute } as unknown as OracleService);
    await repository.rotateSession({} as Connection, {
      sessionId,
      userId: raw(userId),
      tokenHash: Buffer.alloc(32, 1),
      csrfHash: Buffer.alloc(32, 2),
      userAgent: 'vitest',
      ipHash: Buffer.alloc(32, 3),
      expiresAt: new Date('2026-10-01T00:00:00Z'),
    });

    expect(String(execute.mock.calls[0]?.[1])).toContain('FOR UPDATE');
    expect(String(execute.mock.calls[1]?.[1])).toContain("REVOKED_REASON = 'SINGLE_ACTIVE_LOGIN'");
    expect(String(execute.mock.calls[2]?.[1])).toContain('INSERT INTO SPLITO_SESSIONS');
    expect(execute.mock.calls[1]?.[2]).toEqual({ userId: raw(userId) });
  });

  it('acquires PHONE then IP throttle locks before creating a challenge', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [{ REQUEST_COUNT: '0', WINDOW_EXPIRED_FLAG: 'N', COOLDOWN_FLAG: 'N' }],
      })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [{ REQUEST_COUNT: '0', WINDOW_EXPIRED_FLAG: 'N', COOLDOWN_FLAG: 'N' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    const repository = new AuthRepository({ execute } as unknown as OracleService);
    const result = await repository.issueMobileOtp({} as Connection, {
      challengeId,
      mobileNumber: '+12025550101',
      otpHash: Buffer.alloc(32, 1),
      phoneHash: Buffer.alloc(32, 2),
      ipHash: Buffer.alloc(32, 3),
      requestId: challengeId,
      userAgent: 'vitest',
      deliveryMode: 'development_response',
      auditId: userId,
      ttlSeconds: 300,
      cooldownSeconds: 60,
      windowMinutes: 15,
      phoneLimit: 5,
      ipLimit: 20,
      maxAttempts: 5,
    });

    expect(result).toEqual({ outcome: 'created' });
    expect(execute.mock.calls[0]?.[2]).toMatchObject({ scope: 'PHONE' });
    expect(execute.mock.calls[2]?.[2]).toMatchObject({ scope: 'IP' });
    expect(String(execute.mock.calls[4]?.[1])).toContain('FOR UPDATE');
    expect(String(execute.mock.calls[5]?.[1])).toContain('SPLITO_MOBILE_OTP_CHALLENGES');
    expect(String(execute.mock.calls[8]?.[1])).toContain('SPLITO_AUDIT_EVENTS');
  });

  it('provisions user, participant, preferences, consumes OTP, and rotates session in one call', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rows: [{ USER_ID: raw(userId) }] })
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 });
    const repository = new AuthRepository({ execute } as unknown as OracleService);
    const result = await repository.authenticateMobileOtp({} as Connection, {
      challengeId: raw(challengeId),
      mobileNumber: '+12025550101',
      newUserId: userId,
      newParticipantId: participantId,
      displayName: 'Splito member',
      locale: 'en-IN',
      timezone: 'Asia/Kolkata',
      session: {
        sessionId,
        tokenHash: Buffer.alloc(32, 1),
        csrfHash: Buffer.alloc(32, 2),
        userAgent: 'vitest',
        ipHash: Buffer.alloc(32, 3),
        expiresAt: new Date('2026-10-01T00:00:00Z'),
      },
      requestId: challengeId,
      auditId: sessionId,
    });

    expect(result).toMatchObject({
      outcome: 'authenticated',
      isNewAccount: true,
      user: { userId, participantId, mobileNumber: '+12025550101' },
    });
    expect(result.outcome === 'authenticated' && result.user).not.toHaveProperty('email');
    expect(String(execute.mock.calls[1]?.[1])).toContain("STATUS = 'VERIFIED'");
    expect(String(execute.mock.calls[2]?.[1])).toContain('MOBILE_VERIFIED_AT_UTC');
    expect(String(execute.mock.calls[3]?.[1])).toContain('SPLITO_PARTICIPANTS');
    expect(String(execute.mock.calls[4]?.[1])).toContain('SPLITO_USER_PREFERENCES');
    expect(String(execute.mock.calls[6]?.[1])).toContain('SPLITO_SESSIONS');
    expect(String(execute.mock.calls[7]?.[1])).toContain('INSERT INTO SPLITO_SESSIONS');
  });

  it('locks a challenge and atomically terminates the fifth failed attempt', async () => {
    const execute = vi.fn().mockResolvedValue({ rowsAffected: 1 });
    const repository = new AuthRepository({ execute } as unknown as OracleService);
    await repository.recordFailedMobileOtpAttempt({} as Connection, raw(challengeId));
    const sql = String(execute.mock.calls[0]?.[1]);
    expect(sql).toContain('ATTEMPT_COUNT = ATTEMPT_COUNT + 1');
    expect(sql).toContain("THEN 'LOCKED'");
    expect(sql).toContain('TERMINAL_AT_UTC');
  });

  it('does not authenticate a session revoked between lookup and last-seen update', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            SESSION_ID: raw(sessionId),
            CSRF_SECRET_HASH: Buffer.alloc(32, 1),
            USER_ID: raw(userId),
            PARTICIPANT_ID: raw(participantId),
            EMAIL_NORMALIZED: null,
            MOBILE_E164: '+12025550101',
            DISPLAY_NAME: 'Splito member',
            LOCALE_CODE: 'en-IN',
            TIMEZONE_NAME: 'Asia/Kolkata',
            DEFAULT_CURRENCY_CODE: 'INR',
            THEME: 'SYSTEM',
            REDUCED_MOTION_FLAG: 'N',
            VERSION_NO: '1',
          },
        ],
      })
      .mockResolvedValueOnce({ rowsAffected: 0 });
    const withConnection = vi.fn(async (operation: (connection: Connection) => Promise<unknown>) =>
      operation({} as Connection),
    );
    const repository = new AuthRepository({ execute, withConnection } as unknown as OracleService);

    await expect(repository.findSession(Buffer.alloc(32, 2), 60)).resolves.toBeUndefined();
    const touchSql = String(execute.mock.calls[1]?.[1]);
    expect(touchSql).toContain('REVOKED_AT_UTC IS NULL');
    expect(touchSql).toContain('EXPIRES_AT_UTC >');
    expect(touchSql).toContain('LAST_SEEN_AT_UTC >');
  });
});
