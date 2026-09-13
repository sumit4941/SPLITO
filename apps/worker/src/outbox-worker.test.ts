import { loadWorkerEnvironment, type Environment } from '@splito/config';
import type { Connection, Pool } from 'oracledb';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDevelopmentHandler,
  type ClaimedOutboxEvent,
  OutboxWorker,
} from './outbox-worker.js';

function environment(overrides: NodeJS.ProcessEnv = {}): Environment {
  return loadWorkerEnvironment({ DATABASE_PASSWORD: 'worker-database-password', ...overrides });
}

function productionEnvironment(): Environment {
  return environment({
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    WEB_ORIGIN: 'https://app.splito.example',
  });
}

function loggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function connectionMock(...results: unknown[]): {
  connection: Connection;
  execute: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  return {
    connection: { callTimeout: 0, execute, commit, rollback, close } as unknown as Connection,
    execute,
    commit,
    rollback,
    close,
  };
}

function poolMock(...connections: Connection[]): {
  pool: Pool;
  getConnection: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const getConnection = vi.fn();
  for (const connection of connections) getConnection.mockResolvedValueOnce(connection);
  const close = vi.fn().mockResolvedValue(undefined);
  return { pool: { getConnection, close } as unknown as Pool, getConnection, close };
}

function outboxRow(attempts: string | number, payload: unknown = '{"kind":"example"}'): object {
  return {
    OUTBOX_ID: Buffer.alloc(16, 1),
    EVENT_TYPE: 'EXAMPLE_CREATED',
    AGGREGATE_TYPE: 'EXAMPLE',
    AGGREGATE_ID: Buffer.alloc(16, 2),
    PAYLOAD_JSON: payload,
    ATTEMPTS: attempts,
  };
}

describe('OutboxWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses to construct the development acknowledgement sink in production', () => {
    expect(() => createDevelopmentHandler(productionEnvironment(), loggerMock())).toThrow(
      /No production outbox delivery handlers are configured/u,
    );
  });

  it('requires a handler before its polling loop can start', () => {
    const { pool } = poolMock();
    const worker = new OutboxWorker(pool, environment(), loggerMock());
    expect(() => worker.start()).toThrow(/At least one outbox handler/u);
  });

  it('reclaims expired leases and parses attempt counts fetched as Oracle strings', async () => {
    const claim = connectionMock(undefined, { rows: [outboxRow('1')] }, { rowsAffected: 1 });
    const finish = connectionMock(undefined, { rowsAffected: 1 });
    const { pool } = poolMock(claim.connection, finish.connection);
    const worker = new OutboxWorker(pool, environment(), loggerMock());
    let observed: ClaimedOutboxEvent | undefined;
    worker.register('EXAMPLE_CREATED', (event) => {
      observed = event;
      return Promise.resolve();
    });

    await expect(worker.runOnce(1)).resolves.toBe(1);

    expect(observed?.attempts).toBe(2);
    const selectSql = claim.execute.mock.calls[1]?.[0] as string;
    expect(selectSql).toContain("STATUS = 'LEASED'");
    expect(selectSql).toContain('LEASED_UNTIL_UTC <');
    expect(claim.commit).toHaveBeenCalledOnce();
    expect(finish.execute).toHaveBeenCalledTimes(2);
  });

  it('fails closed instead of substituting an empty object for an unknown payload', async () => {
    const claim = connectionMock(
      undefined,
      { rows: [outboxRow('0', { unexpected: true })] },
      { rowsAffected: 1 },
    );
    const { pool } = poolMock(claim.connection);
    const worker = new OutboxWorker(pool, environment(), loggerMock());
    const handler = vi.fn().mockResolvedValue(undefined);
    worker.register('EXAMPLE_CREATED', handler);

    await expect(worker.runOnce(1)).rejects.toThrow(/Unsupported Oracle representation/u);
    expect(claim.rollback).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('waits for an in-flight dispatch before closing the Oracle pool', async () => {
    const claim = connectionMock(undefined, { rows: [outboxRow('0')] }, { rowsAffected: 1 });
    const finish = connectionMock(undefined, { rowsAffected: 1 });
    const { pool, close } = poolMock(claim.connection, finish.connection);
    const worker = new OutboxWorker(pool, environment(), loggerMock());
    let releaseHandler: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolveStarted) => {
      worker.register(
        'EXAMPLE_CREATED',
        () =>
          new Promise<void>((resolveHandler) => {
            releaseHandler = resolveHandler;
            resolveStarted();
          }),
      );
    });

    worker.start();
    await handlerStarted;
    const stopping = worker.stop();
    expect(close).not.toHaveBeenCalled();
    releaseHandler?.();
    await stopping;

    expect(finish.execute).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it('renews the lease while a long-running handler is in flight', async () => {
    vi.useFakeTimers();
    const claim = connectionMock(undefined, { rows: [outboxRow('0')] }, { rowsAffected: 1 });
    const renewal = connectionMock(undefined, { rowsAffected: 1 });
    const finish = connectionMock(undefined, { rowsAffected: 1 });
    const { pool } = poolMock(claim.connection, renewal.connection, finish.connection);
    const worker = new OutboxWorker(pool, environment({ OUTBOX_LEASE_SECONDS: '5' }), loggerMock());
    let releaseHandler: (() => void) | undefined;
    let notifyStarted: (() => void) | undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    worker.register(
      'EXAMPLE_CREATED',
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve;
          notifyStarted?.();
        }),
    );

    const running = worker.runOnce(1);
    await handlerStarted;
    await vi.advanceTimersByTimeAsync(2_500);

    expect(renewal.execute).toHaveBeenCalledTimes(2);
    expect(renewal.execute.mock.calls[1]?.[0]).toContain('LEASED_UNTIL_UTC >=');
    releaseHandler?.();
    await running;
    expect(finish.execute).toHaveBeenCalledTimes(2);
  });
});
