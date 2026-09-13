import { randomUUID } from 'node:crypto';
import type { Environment } from '@splito/config';
import oracledb, { type Connection, type Pool } from 'oracledb';
import type { Logger } from 'pino';

export interface ClaimedOutboxEvent {
  id: Buffer;
  idText: string;
  eventType: string;
  aggregateType: string;
  aggregateId: Buffer;
  payload: unknown;
  attempts: number;
}

export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

interface LeaseHeartbeat {
  leaseWasLost(): boolean;
  stop(): Promise<void>;
}

function rawUuidToString(value: Buffer): string {
  const hex = value.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function uuidToRaw(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', ''), 'hex');
}

async function readLob(value: unknown): Promise<string> {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (!value || typeof value !== 'object' || !('getData' in value)) {
    throw new Error('Unsupported Oracle representation for an outbox JSON payload');
  }
  return (value as { getData(): Promise<string> }).getData();
}

function parseAttemptCount(value: string | number): number {
  const attempts = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    throw new Error('Oracle returned an invalid outbox attempt count');
  }
  return attempts;
}

export class OutboxWorker {
  readonly #workerId = randomUUID();
  readonly #handlers = new Map<string, OutboxHandler>();
  #timer: NodeJS.Timeout | undefined;
  #wakePoll: (() => void) | undefined;
  #loopPromise: Promise<void> | undefined;
  #stopPromise: Promise<void> | undefined;
  #stopping = false;

  constructor(
    private readonly pool: Pool,
    private readonly config: Environment,
    private readonly logger: Logger,
  ) {}

  register(eventType: string, handler: OutboxHandler): void {
    if (this.#handlers.has(eventType)) throw new Error(`Duplicate outbox handler: ${eventType}`);
    this.#handlers.set(eventType, handler);
  }

  start(): void {
    if (this.#loopPromise) throw new Error('Outbox worker has already been started');
    if (this.#handlers.size === 0)
      throw new Error('At least one outbox handler must be registered');
    this.logger.info({ workerId: this.#workerId }, 'outbox worker started');
    this.#loopPromise = this.#runLoop();
  }

  stop(): Promise<void> {
    this.#stopPromise ??= this.#stop();
    return this.#stopPromise;
  }

  async runOnce(maximumEvents = 10): Promise<number> {
    if (!Number.isInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 100) {
      throw new Error('maximumEvents must be an integer between 1 and 100');
    }

    let processed = 0;
    while (!this.#stopping && processed < maximumEvents) {
      // Claim immediately before dispatch. Leasing a large batch and processing it
      // serially can let later leases expire before their handlers even start.
      const [event] = await this.#claim(1);
      if (!event) break;
      await this.#dispatch(event);
      processed += 1;
    }
    return processed;
  }

  async #stop(): Promise<void> {
    this.#stopping = true;
    this.#wakePoll?.();
    if (this.#loopPromise) await this.#loopPromise;
    await this.pool.close(10);
    this.logger.info({ workerId: this.#workerId }, 'outbox worker stopped');
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error({ err: error }, 'outbox polling failed');
      }
      if (!this.#stopping) {
        await this.#waitForNextPoll();
      }
    }
  }

  async #waitForNextPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      let completed = false;
      const complete = (): void => {
        if (completed) return;
        completed = true;
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#wakePoll = undefined;
        resolve();
      };
      this.#wakePoll = complete;
      // Keep this timer referenced: it is the worker daemon's scheduler.
      this.#timer = setTimeout(complete, this.config.OUTBOX_POLL_MS);
    });
  }

  async #claim(limit: number): Promise<ClaimedOutboxEvent[]> {
    let connection: Connection | undefined;
    try {
      connection = await this.pool.getConnection();
      connection.callTimeout = this.config.DATABASE_CALL_TIMEOUT_MS;
      await connection.execute(
        `ALTER SESSION SET CURRENT_SCHEMA = ${this.config.DATABASE_OWNER_SCHEMA}`,
      );
      const result = await connection.execute<{
        OUTBOX_ID: Buffer;
        EVENT_TYPE: string;
        AGGREGATE_TYPE: string;
        AGGREGATE_ID: Buffer;
        PAYLOAD_JSON: unknown;
        ATTEMPTS: string | number;
      }>(
        `SELECT OUTBOX_ID, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_ID, PAYLOAD_JSON, ATTEMPTS
           FROM SPLITO_OUTBOX
          WHERE (
                  (STATUS IN ('PENDING', 'RETRY')
                   AND AVAILABLE_AT_UTC <= SYS_EXTRACT_UTC(SYSTIMESTAMP)
                   AND (LEASED_UNTIL_UTC IS NULL OR LEASED_UNTIL_UTC < SYS_EXTRACT_UTC(SYSTIMESTAMP)))
               OR (STATUS = 'LEASED'
                   AND LEASED_UNTIL_UTC < SYS_EXTRACT_UTC(SYSTIMESTAMP))
                )
          ORDER BY CREATED_AT_UTC, OUTBOX_ID
          FOR UPDATE SKIP LOCKED`,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          // Oracle rejects a row-limiting clause combined with FOR UPDATE
          // (ORA-02014). Bound both driver limits so only the requested base
          // table rows are fetched and locked by this transaction. Prefetch
          // must be disabled or execute() can lock rows beyond maxRows.
          maxRows: limit,
          fetchArraySize: limit,
          prefetchRows: 0,
        },
      );

      const claimed: ClaimedOutboxEvent[] = [];
      for (const row of result.rows ?? []) {
        await connection.execute(
          `UPDATE SPLITO_OUTBOX
              SET STATUS = 'LEASED',
                  LEASE_OWNER = :workerId,
                  LEASED_UNTIL_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(:leaseSeconds, 'SECOND'),
                  ATTEMPTS = ATTEMPTS + 1
            WHERE OUTBOX_ID = :outboxId`,
          {
            workerId: this.#workerId,
            leaseSeconds: this.config.OUTBOX_LEASE_SECONDS,
            outboxId: row.OUTBOX_ID,
          },
        );
        const payloadText = await readLob(row.PAYLOAD_JSON);
        const previousAttempts = parseAttemptCount(row.ATTEMPTS);
        claimed.push({
          id: row.OUTBOX_ID,
          idText: rawUuidToString(row.OUTBOX_ID),
          eventType: row.EVENT_TYPE,
          aggregateType: row.AGGREGATE_TYPE,
          aggregateId: row.AGGREGATE_ID,
          payload: JSON.parse(payloadText) as unknown,
          attempts: previousAttempts + 1,
        });
      }
      await connection.commit();
      return claimed;
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) await connection.close();
    }
  }

  async #dispatch(event: ClaimedOutboxEvent): Promise<void> {
    const handler = this.#handlers.get(event.eventType) ?? this.#handlers.get('*');
    const heartbeat = this.#startLeaseHeartbeat(event);
    let failed = false;
    let dispatchError: unknown;
    try {
      if (!handler) throw new Error(`No handler registered for ${event.eventType}`);
      await handler(event);
    } catch (error) {
      failed = true;
      dispatchError = error;
    }
    await heartbeat.stop();

    if (heartbeat.leaseWasLost()) {
      this.logger.error(
        { outboxId: event.idText, eventType: event.eventType },
        'outbox lease was lost during dispatch; outcome was not acknowledged',
      );
      return;
    }

    if (failed) {
      const dead = event.attempts >= this.config.OUTBOX_MAX_ATTEMPTS;
      await this.#finish(event, dead ? 'DEAD' : 'RETRY', dispatchError);
      this.logger[dead ? 'error' : 'warn'](
        {
          err: dispatchError,
          outboxId: event.idText,
          eventType: event.eventType,
          attempts: event.attempts,
        },
        dead ? 'outbox event moved to dead letter state' : 'outbox event scheduled for retry',
      );
      return;
    }

    await this.#finish(event, 'PROCESSED');
    this.logger.info(
      { outboxId: event.idText, eventType: event.eventType },
      'outbox event processed',
    );
  }

  #startLeaseHeartbeat(event: ClaimedOutboxEvent): LeaseHeartbeat {
    const intervalMilliseconds = Math.max(
      1_000,
      Math.floor((this.config.OUTBOX_LEASE_SECONDS * 1_000) / 2),
    );
    let stopped = false;
    let lost = false;
    let timer: NodeJS.Timeout | undefined;
    let pendingRenewal: Promise<void> | undefined;

    const schedule = (): void => {
      if (stopped || lost) return;
      timer = setTimeout(() => {
        timer = undefined;
        pendingRenewal = this.#renewLease(event)
          .then((renewed) => {
            if (!renewed) {
              lost = true;
              this.logger.error(
                { outboxId: event.idText, eventType: event.eventType },
                'outbox lease expired or changed owner during dispatch',
              );
            }
          })
          .catch((error: unknown) => {
            lost = true;
            this.logger.error(
              { err: error, outboxId: event.idText, eventType: event.eventType },
              'outbox lease renewal failed during dispatch',
            );
          })
          .finally(() => {
            pendingRenewal = undefined;
            schedule();
          });
      }, intervalMilliseconds);
    };

    schedule();
    return {
      leaseWasLost: () => lost,
      stop: async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (pendingRenewal) await pendingRenewal;
      },
    };
  }

  async #renewLease(event: ClaimedOutboxEvent): Promise<boolean> {
    let connection: Connection | undefined;
    try {
      connection = await this.pool.getConnection();
      connection.callTimeout = this.config.DATABASE_CALL_TIMEOUT_MS;
      await connection.execute(
        `ALTER SESSION SET CURRENT_SCHEMA = ${this.config.DATABASE_OWNER_SCHEMA}`,
      );
      const result = await connection.execute(
        `UPDATE SPLITO_OUTBOX
            SET LEASED_UNTIL_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(:leaseSeconds, 'SECOND')
          WHERE OUTBOX_ID = :outboxId
            AND STATUS = 'LEASED'
            AND LEASE_OWNER = :workerId
            AND LEASED_UNTIL_UTC >= SYS_EXTRACT_UTC(SYSTIMESTAMP)`,
        {
          leaseSeconds: this.config.OUTBOX_LEASE_SECONDS,
          outboxId: event.id,
          workerId: this.#workerId,
        },
        { autoCommit: true },
      );
      return result.rowsAffected === 1;
    } finally {
      if (connection) await connection.close();
    }
  }

  async #finish(
    event: ClaimedOutboxEvent,
    status: 'PROCESSED' | 'RETRY' | 'DEAD',
    error?: unknown,
  ): Promise<void> {
    let connection: Connection | undefined;
    try {
      connection = await this.pool.getConnection();
      connection.callTimeout = this.config.DATABASE_CALL_TIMEOUT_MS;
      await connection.execute(
        `ALTER SESSION SET CURRENT_SCHEMA = ${this.config.DATABASE_OWNER_SCHEMA}`,
      );
      const message = error instanceof Error ? error.message.slice(0, 2_000) : null;
      const result = await connection.execute(
        `UPDATE SPLITO_OUTBOX
            SET STATUS = :status,
                PROCESSED_AT_UTC = CASE WHEN :status = 'PROCESSED' THEN SYS_EXTRACT_UTC(SYSTIMESTAMP) ELSE NULL END,
                AVAILABLE_AT_UTC = CASE
                  WHEN :status = 'RETRY'
                  THEN SYS_EXTRACT_UTC(SYSTIMESTAMP) + NUMTODSINTERVAL(LEAST(POWER(2, ATTEMPTS), 300), 'SECOND')
                  ELSE AVAILABLE_AT_UTC
                END,
                LEASED_UNTIL_UTC = NULL,
                LEASE_OWNER = NULL,
                LAST_ERROR = :lastError
          WHERE OUTBOX_ID = :outboxId
            AND STATUS = 'LEASED'
            AND LEASE_OWNER = :workerId`,
        {
          status,
          lastError: message,
          outboxId: event.id,
          workerId: this.#workerId,
        },
        { autoCommit: true },
      );
      if (result.rowsAffected !== 1) {
        throw new Error(`Outbox lease was lost before ${status.toLowerCase()} could be recorded`);
      }
    } finally {
      if (connection) await connection.close();
    }
  }
}

export function createDevelopmentHandler(config: Environment, logger: Logger): OutboxHandler {
  if (config.NODE_ENV === 'production') {
    throw new Error(
      'No production outbox delivery handlers are configured; refusing to use the development log sink',
    );
  }

  return (event) => {
    logger.info(
      {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId ? rawUuidToString(event.aggregateId) : undefined,
      },
      'development event sink (no external delivery configured)',
    );
    return Promise.resolve();
  };
}

export { uuidToRaw };
