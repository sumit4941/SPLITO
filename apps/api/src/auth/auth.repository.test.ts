import { describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, type MongoService, type MongoUnitOfWork } from '../database/mongo.service.js';
import { AuthRepository } from './auth.repository.js';

const userId = '11111111-1111-4111-8111-111111111111';
const participantId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const challengeId = '44444444-4444-4444-8444-444444444444';

function createWork(collections: Record<string, unknown>): MongoUnitOfWork {
  return {
    db: { collection: vi.fn((name: string) => collections[name]) },
  } as unknown as MongoUnitOfWork;
}

describe('Mongo-backed mobile authentication repository', () => {
  it('serializes on the user and atomically replaces its single session slot', async () => {
    const users = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }) };
    const sessions = {
      replaceOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const repository = new AuthRepository({} as MongoService);

    await repository.rotateSession(
      createWork({ [COLLECTIONS.users]: users, [COLLECTIONS.sessions]: sessions }),
      {
        sessionId,
        userId,
        tokenHash: Buffer.alloc(32, 1),
        csrfHash: Buffer.alloc(32, 2),
        userAgent: 'vitest',
        ipHash: Buffer.alloc(32, 3),
        expiresAt: new Date('2026-10-01T00:00:00Z'),
      },
    );

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: userId, status: 'ACTIVE' },
      expect.objectContaining({ $inc: { authFence: 1 } }),
      expect.anything(),
    );
    expect(sessions.replaceOne).toHaveBeenCalledWith(
      { _id: userId },
      expect.objectContaining({ sessionId, userId, active: true }),
      expect.objectContaining({ upsert: true }),
    );
    expect(users.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.replaceOne.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('touches PHONE then IP throttles before creating a challenge', async () => {
    const challenges = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const throttles = { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const auditEvents = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new AuthRepository({} as MongoService);
    const lockThrottle = vi.spyOn(repository, 'lockMobileOtpThrottle').mockResolvedValue({
      REQUEST_COUNT: '0',
      WINDOW_EXPIRED_FLAG: 'N',
      COOLDOWN_FLAG: 'N',
      WINDOW_RETRY_SECONDS: '900',
    });

    await expect(
      repository.issueMobileOtp(
        createWork({
          [COLLECTIONS.mobileOtpChallenges]: challenges,
          [COLLECTIONS.mobileOtpThrottles]: throttles,
          [COLLECTIONS.auditEvents]: auditEvents,
        }),
        {
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
        },
      ),
    ).resolves.toEqual({ outcome: 'created' });

    expect(lockThrottle.mock.calls.map((call) => call[1].scope)).toEqual(['PHONE', 'IP']);
    expect(challenges.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: challengeId,
        challengeId,
        status: 'PENDING',
        attemptCount: 0,
        maxAttempts: 5,
        otpHash: Buffer.alloc(32, 1),
        purgeAt: expect.any(Date),
      }),
      expect.anything(),
    );
    expect(throttles.updateOne).toHaveBeenCalledTimes(2);
    expect(auditEvents.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        actionKey: 'auth.mobile_otp.request',
        metadata: { deliveryMode: 'development_response' },
      }),
      expect.anything(),
    );
  });

  it('rotates an existing phone OTP slot in place with a new public challenge ID', async () => {
    const slotId = '55555555-5555-4555-8555-555555555555';
    const challenges = {
      findOne: vi.fn().mockResolvedValue({
        _id: slotId,
        challengeId: '66666666-6666-4666-8666-666666666666',
        mobileE164: '+12025550101',
        purpose: 'LOGIN',
        status: 'PENDING',
      }),
      replaceOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn(),
    };
    const throttles = { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const auditEvents = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new AuthRepository({} as MongoService);
    vi.spyOn(repository, 'lockMobileOtpThrottle').mockResolvedValue({
      REQUEST_COUNT: '0',
      WINDOW_EXPIRED_FLAG: 'N',
      COOLDOWN_FLAG: 'N',
      WINDOW_RETRY_SECONDS: '900',
    });

    await repository.issueMobileOtp(
      createWork({
        [COLLECTIONS.mobileOtpChallenges]: challenges,
        [COLLECTIONS.mobileOtpThrottles]: throttles,
        [COLLECTIONS.auditEvents]: auditEvents,
      }),
      {
        challengeId,
        mobileNumber: '+12025550101',
        otpHash: Buffer.alloc(32, 4),
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
      },
    );

    expect(challenges.replaceOne).toHaveBeenCalledWith(
      { _id: slotId },
      expect.objectContaining({
        _id: slotId,
        challengeId,
        status: 'PENDING',
        attemptCount: 0,
        otpHash: Buffer.alloc(32, 4),
        purgeAt: expect.any(Date),
      }),
      expect.anything(),
    );
    expect(challenges.insertOne).not.toHaveBeenCalled();
  });

  it('provisions the first-login account and creates its sole active session', async () => {
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const challenges = { updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const participants = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const preferences = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const sessions = {
      replaceOne: vi
        .fn()
        .mockResolvedValue({ matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }),
    };
    const auditEvents = { insertOne: vi.fn().mockResolvedValue({ acknowledged: true }) };
    const repository = new AuthRepository({} as MongoService);

    const result = await repository.authenticateMobileOtp(
      createWork({
        [COLLECTIONS.users]: users,
        [COLLECTIONS.mobileOtpChallenges]: challenges,
        [COLLECTIONS.participants]: participants,
        [COLLECTIONS.userPreferences]: preferences,
        [COLLECTIONS.sessions]: sessions,
        [COLLECTIONS.auditEvents]: auditEvents,
      }),
      {
        challengeId,
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
      },
    );

    expect(result).toMatchObject({
      outcome: 'authenticated',
      isNewAccount: true,
      user: { userId, participantId, mobileNumber: '+12025550101', version: '2' },
    });
    expect(challenges.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ challengeId, status: 'PENDING' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'VERIFIED' }) }),
      expect.anything(),
    );
    expect(users.insertOne).toHaveBeenCalledOnce();
    expect(participants.insertOne).toHaveBeenCalledOnce();
    expect(preferences.insertOne).toHaveBeenCalledOnce();
    expect(sessions.replaceOne).toHaveBeenCalledWith(
      { _id: userId },
      expect.objectContaining({ sessionId, userId, active: true }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('atomically terminates the final failed OTP attempt', async () => {
    const challenges = {
      findOne: vi.fn().mockResolvedValue({
        _id: challengeId,
        challengeId,
        status: 'PENDING',
        attemptCount: 4,
        maxAttempts: 5,
      }),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = new AuthRepository({} as MongoService);
    await repository.recordFailedMobileOtpAttempt(
      createWork({ [COLLECTIONS.mobileOtpChallenges]: challenges }),
      challengeId,
    );

    expect(challenges.updateOne).toHaveBeenCalledWith(
      { challengeId, status: 'PENDING', attemptCount: 4 },
      {
        $set: expect.objectContaining({
          attemptCount: 5,
          status: 'LOCKED',
          terminalAt: expect.any(Date),
        }),
      },
      expect.anything(),
    );
  });

  it('does not authenticate a session revoked between lookup and last-seen update', async () => {
    const sessions = {
      findOne: vi.fn().mockResolvedValue({
        _id: userId,
        sessionId,
        userId,
        csrfSecretHash: Buffer.alloc(32, 1),
        active: true,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        lastSeenAt: new Date(),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
    };
    const work = createWork({ [COLLECTIONS.sessions]: sessions });
    const mongo = {
      withConnection: vi.fn(async (operation: (value: MongoUnitOfWork) => Promise<unknown>) =>
        operation(work),
      ),
    };
    const repository = new AuthRepository(mongo as unknown as MongoService);

    await expect(repository.findSession(Buffer.alloc(32, 2), 60)).resolves.toBeUndefined();
    expect(sessions.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: userId,
        sessionId,
        sessionTokenHash: Buffer.alloc(32, 2),
        active: true,
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('keeps a matched session valid when the last-seen timestamp is unchanged', async () => {
    const sessions = {
      findOne: vi.fn().mockResolvedValue({
        _id: userId,
        sessionId,
        userId,
        csrfSecretHash: Buffer.alloc(32, 1),
        active: true,
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        lastSeenAt: new Date(),
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 0 }),
    };
    const users = {
      findOne: vi.fn().mockResolvedValue({
        _id: userId,
        mobileE164: '+12025550101',
        displayName: 'Splito member',
        localeCode: 'en-IN',
        timezoneName: 'Asia/Kolkata',
        defaultCurrencyCode: 'INR',
        theme: 'SYSTEM',
        reducedMotion: false,
        status: 'ACTIVE',
        authFence: 2,
      }),
    };
    const participants = {
      findOne: vi.fn().mockResolvedValue({
        _id: participantId,
        userId,
        kind: 'USER',
        displayName: 'Splito member',
      }),
    };
    const work = createWork({
      [COLLECTIONS.sessions]: sessions,
      [COLLECTIONS.users]: users,
      [COLLECTIONS.participants]: participants,
    });
    const mongo = {
      withConnection: vi.fn(async (operation: (value: MongoUnitOfWork) => Promise<unknown>) =>
        operation(work),
      ),
    };
    const repository = new AuthRepository(mongo as unknown as MongoService);

    await expect(repository.findSession(Buffer.alloc(32, 2), 60)).resolves.toMatchObject({
      sessionId,
      user: { userId, participantId },
    });
  });
});
