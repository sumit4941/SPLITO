import { randomBytes, randomUUID } from 'node:crypto';
import { loadWorkerEnvironment, type Environment } from '@splito/config';
import oracledb, { type Connection, type Pool } from 'oracledb';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ClaimedOutboxEvent, OutboxWorker } from './outbox-worker.js';

const databaseConfigured = Boolean(
  process.env.DATABASE_PASSWORD && process.env.SPLITO_MIGRATION_DB_PASSWORD,
);

describe.skipIf(!databaseConfigured)('Oracle outbox lease integration', () => {
  let config: Environment;
  let runtimePool: Pool;
  let ownerPool: Pool;
  let outboxId: Buffer;

  async function inOwnerSchema(pool: Pool): Promise<Connection> {
    const connection = await pool.getConnection();
    connection.callTimeout = config.DATABASE_CALL_TIMEOUT_MS;
    await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${config.DATABASE_OWNER_SCHEMA}`);
    return connection;
  }

  beforeAll(async () => {
    config = loadWorkerEnvironment();
    oracledb.fetchAsString = [oracledb.NUMBER];
    runtimePool = await oracledb.createPool({
      user: config.DATABASE_USER,
      password: config.DATABASE_PASSWORD,
      connectString: config.DATABASE_CONNECT_STRING,
      poolMin: 0,
      poolMax: 2,
      poolIncrement: 1,
      queueTimeout: config.DATABASE_QUEUE_TIMEOUT_MS,
    });
    ownerPool = await oracledb.createPool({
      user: process.env.SPLITO_MIGRATION_DB_USER ?? config.DATABASE_OWNER_SCHEMA,
      password: process.env.SPLITO_MIGRATION_DB_PASSWORD,
      connectString:
        process.env.SPLITO_MIGRATION_DB_CONNECT_STRING ?? config.DATABASE_CONNECT_STRING,
      poolMin: 0,
      poolMax: 1,
    });
    outboxId = randomBytes(16);
  });

  afterAll(async () => {
    if (!ownerPool) return;
    let connection: Connection | undefined;
    try {
      connection = await inOwnerSchema(ownerPool);
      await connection.execute(
        `DELETE FROM SPLITO_OUTBOX WHERE EVENT_TYPE LIKE 'WORKER_TEST_%'`,
        {},
        {
          autoCommit: true,
        },
      );
    } finally {
      if (connection) await connection.close();
      if (runtimePool) await runtimePool.close(0);
      await ownerPool.close(0);
    }
  });

  it('reclaims an expired lease, increments a string-fetched attempt, and records completion', async () => {
    const eventType = `WORKER_TEST_${randomUUID()}`;
    const aggregateId = randomBytes(16);
    let connection: Connection | undefined;
    try {
      connection = await inOwnerSchema(ownerPool);
      await connection.execute(
        `INSERT INTO SPLITO_OUTBOX
           (OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON,
            STATUS, AVAILABLE_AT_UTC, LEASED_UNTIL_UTC, LEASE_OWNER, ATTEMPTS, CREATED_AT_UTC)
         VALUES
           (:outboxId, :eventType, 'WORKER_TEST', :aggregateId, '{"integration":true}',
            'LEASED', TIMESTAMP '2000-01-01 00:00:00', TIMESTAMP '2000-01-01 00:00:01',
            'crashed-worker', 1, TIMESTAMP '2000-01-01 00:00:00')`,
        { outboxId, eventType, aggregateId },
        { autoCommit: true },
      );
    } finally {
      if (connection) await connection.close();
    }

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const worker = new OutboxWorker(runtimePool, config, logger);
    let observed: ClaimedOutboxEvent | undefined;
    worker.register(eventType, (event) => {
      observed = event;
      return Promise.resolve();
    });

    await expect(worker.runOnce(1)).resolves.toBe(1);
    expect(observed?.attempts).toBe(2);
    expect(observed?.payload).toEqual({ integration: true });

    try {
      connection = await inOwnerSchema(ownerPool);
      const result = await connection.execute<{
        STATUS: string;
        ATTEMPTS: string;
        LEASE_OWNER: string | null;
        LEASED_UNTIL_UTC: Date | null;
        PROCESSED_AT_UTC: Date | null;
      }>(
        `SELECT STATUS, ATTEMPTS, LEASE_OWNER, LEASED_UNTIL_UTC, PROCESSED_AT_UTC
           FROM SPLITO_OUTBOX
          WHERE OUTBOX_ID = :outboxId`,
        { outboxId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      expect(result.rows).toEqual([
        expect.objectContaining({
          STATUS: 'PROCESSED',
          ATTEMPTS: '2',
          LEASE_OWNER: null,
          LEASED_UNTIL_UTC: null,
          PROCESSED_AT_UTC: expect.any(Date),
        }),
      ]);
    } finally {
      if (connection) await connection.close();
    }
  });

  it('locks only the driver-bounded row so another worker can skip it', async () => {
    const firstId = randomBytes(16);
    const secondId = randomBytes(16);
    let ownerConnection: Connection | undefined;
    let firstWorkerConnection: Connection | undefined;
    let secondWorkerConnection: Connection | undefined;
    const claimSql = `SELECT OUTBOX_ID
                        FROM SPLITO_OUTBOX
                       WHERE STATUS = 'PENDING'
                         AND EVENT_TYPE LIKE 'WORKER_TEST_LOCK_%'
                       ORDER BY OUTBOX_ID
                       FOR UPDATE SKIP LOCKED`;
    try {
      ownerConnection = await inOwnerSchema(ownerPool);
      await ownerConnection.executeMany(
        `INSERT INTO SPLITO_OUTBOX
           (OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON)
         VALUES
           (:outboxId, :eventType, 'WORKER_TEST', :aggregateId, '{"integration":true}')`,
        [
          {
            outboxId: firstId,
            eventType: `WORKER_TEST_LOCK_${randomUUID()}`,
            aggregateId: randomBytes(16),
          },
          {
            outboxId: secondId,
            eventType: `WORKER_TEST_LOCK_${randomUUID()}`,
            aggregateId: randomBytes(16),
          },
        ],
        { autoCommit: true },
      );

      firstWorkerConnection = await inOwnerSchema(runtimePool);
      secondWorkerConnection = await inOwnerSchema(runtimePool);
      const firstResult = await firstWorkerConnection.execute<{ OUTBOX_ID: Buffer }>(
        claimSql,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: 1,
          fetchArraySize: 1,
          prefetchRows: 0,
        },
      );
      const secondResult = await secondWorkerConnection.execute<{ OUTBOX_ID: Buffer }>(
        claimSql,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: 1,
          fetchArraySize: 1,
          prefetchRows: 0,
        },
      );

      expect(firstResult.rows).toHaveLength(1);
      expect(secondResult.rows).toHaveLength(1);
      expect(
        firstResult.rows?.[0]?.OUTBOX_ID.equals(
          secondResult.rows?.[0]?.OUTBOX_ID ?? Buffer.alloc(0),
        ),
      ).toBe(false);
    } finally {
      if (firstWorkerConnection) {
        await firstWorkerConnection.rollback();
        await firstWorkerConnection.close();
      }
      if (secondWorkerConnection) {
        await secondWorkerConnection.rollback();
        await secondWorkerConnection.close();
      }
      if (ownerConnection) await ownerConnection.close();
    }
  });
});
