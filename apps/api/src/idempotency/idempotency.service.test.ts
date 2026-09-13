import type { Connection } from 'oracledb';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJsonHash } from '../common/canonical-json.js';
import type { OracleService } from '../database/oracle.service.js';
import { IdempotencyService } from './idempotency.service.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';
const storedId = '33333333-3333-4333-8333-333333333333';
const raw = (value: string) => Buffer.from(value.replaceAll('-', ''), 'hex');

describe('Oracle-backed idempotency outcomes', () => {
  it("claims a fresh scoped key inside the caller's transaction", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rowsAffected: 1 });
    const service = new IdempotencyService({ execute } as unknown as OracleService);
    const claim = await service.claim({} as Connection, {
      actorParticipantId: actorId,
      operation: 'expense.create',
      key: 'retry-key-123',
      requestBody: { amountMinor: '100' },
    });
    expect(claim.replay).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0]?.[1])).toContain('SPLITO_IDEMPOTENCY_KEYS');
    expect(execute.mock.calls[0]?.[2]).toMatchObject({
      actorId: raw(actorId),
      operation: 'expense.create',
    });
  });

  it('replays the atomically stored response for the same payload', async () => {
    const requestBody = { amountMinor: '100', currency: 'INR' };
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ errorNum: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            IDEMPOTENCY_KEY_ID: raw(storedId),
            REQUEST_HASH: canonicalJsonHash(requestBody),
            STATUS: 'COMPLETED',
            HTTP_STATUS: '201',
            RESPONSE_BODY_JSON: {
              getData: () =>
                Promise.resolve(JSON.stringify({ id: resourceId, amountMinor: '100' })),
            },
            RESOURCE_ID: raw(resourceId),
            EXPIRED_FLAG: 'N',
          },
        ],
      });
    const service = new IdempotencyService({ execute } as unknown as OracleService);
    const claim = await service.claim<{ id: string; amountMinor: string }>({} as Connection, {
      actorParticipantId: actorId,
      operation: 'expense.create',
      key: 'retry-key-123',
      requestBody,
    });
    expect(claim).toEqual({
      id: storedId,
      replay: {
        status: 201,
        body: { id: resourceId, amountMinor: '100' },
        resourceId,
      },
    });
  });

  it('rejects reuse of a scoped key with a different payload', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ errorNum: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            IDEMPOTENCY_KEY_ID: raw(storedId),
            REQUEST_HASH: canonicalJsonHash({ amountMinor: '100' }),
            STATUS: 'COMPLETED',
            HTTP_STATUS: '201',
            RESPONSE_BODY_JSON: '{}',
            RESOURCE_ID: null,
            EXPIRED_FLAG: 'N',
          },
        ],
      });
    const service = new IdempotencyService({ execute } as unknown as OracleService);
    await expect(
      service.claim({} as Connection, {
        actorParticipantId: actorId,
        operation: 'expense.create',
        key: 'retry-key-123',
        requestBody: { amountMinor: '101' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  });

  it('stores only a completed JSON outcome and resource link', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rowsAffected: 1 });
    const service = new IdempotencyService({ execute } as unknown as OracleService);
    await service.complete({} as Connection, {
      id: storedId,
      httpStatus: 201,
      responseBody: { id: resourceId, amountMinor: '100' },
      resourceId,
    });
    const binds = execute.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(binds).toMatchObject({
      httpStatus: 201,
      resourceId: raw(resourceId),
      id: raw(storedId),
    });
    expect(binds.responseBody).toMatchObject({
      val: JSON.stringify({ id: resourceId, amountMinor: '100' }),
    });
  });
});
