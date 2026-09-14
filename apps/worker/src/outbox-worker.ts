import { randomUUID } from 'node:crypto';
import type { Environment } from '@splito/config';
import type { Db, MongoClient } from 'mongodb';
import type { Logger } from 'pino';

export interface ClaimedOutboxEvent {
  id: string;
  idText: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
}

export type OutboxHandler = (event: ClaimedOutboxEvent) => Promise<void>;

interface OutboxDocument {
  _id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  status: 'PENDING' | 'LEASED' | 'RETRY' | 'PROCESSED' | 'DEAD';
  attempts: number;
  availableAt: Date;
  leasedUntil?: Date;
  leaseOwner?: string;
  lastError?: string;
  processedAt?: Date;
  createdAt: Date;
}

interface LeaseHeartbeat {
  leaseWasLost(): boolean;
  stop(): Promise<void>;
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
    private readonly client: MongoClient,
    private readonly database: Db,
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
    await this.#deadLetterExhaustedEvents();
    let processed = 0;
    while (!this.#stopping && processed < maximumEvents) {
      const event = await this.#claim();
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
    await this.client.close();
    this.logger.info({ workerId: this.#workerId }, 'outbox worker stopped');
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        await this.runOnce();
      } catch (error) {
        this.logger.error({ err: error }, 'outbox polling failed');
      }
      if (!this.#stopping) await this.#waitForNextPoll();
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
      this.#timer = setTimeout(complete, this.config.OUTBOX_POLL_MS);
    });
  }

  async #claim(): Promise<ClaimedOutboxEvent | undefined> {
    const now = new Date();
    const leasedUntil = new Date(now.getTime() + this.config.OUTBOX_LEASE_SECONDS * 1_000);
    const row = await this.database.collection<OutboxDocument>('outbox').findOneAndUpdate(
      {
        attempts: { $lt: this.config.OUTBOX_MAX_ATTEMPTS },
        $or: [
          {
            status: { $in: ['PENDING', 'RETRY'] },
            availableAt: { $lte: now },
            $or: [{ leasedUntil: { $exists: false } }, { leasedUntil: { $lt: now } }],
          },
          { status: 'LEASED', leasedUntil: { $lt: now } },
        ],
      },
      {
        $set: { status: 'LEASED', leaseOwner: this.#workerId, leasedUntil },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
    );
    if (!row) return undefined;
    if (!Number.isSafeInteger(row.attempts) || row.attempts < 1) {
      throw new Error('MongoDB returned an invalid outbox attempt count');
    }
    return {
      id: row._id,
      idText: row._id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      payload: row.payload,
      attempts: row.attempts,
    };
  }

  async #deadLetterExhaustedEvents(): Promise<void> {
    const now = new Date();
    await this.database.collection<OutboxDocument>('outbox').updateMany(
      {
        attempts: { $gte: this.config.OUTBOX_MAX_ATTEMPTS },
        $or: [
          { status: { $in: ['PENDING', 'RETRY'] }, availableAt: { $lte: now } },
          { status: 'LEASED', leasedUntil: { $lt: now } },
        ],
      },
      {
        $set: {
          status: 'DEAD',
          lastError: 'Maximum delivery attempts were exhausted before processing completed',
        },
        $unset: { leasedUntil: '', leaseOwner: '', processedAt: '' },
      },
    );
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
    const now = new Date();
    const result = await this.database.collection<OutboxDocument>('outbox').updateOne(
      {
        _id: event.id,
        status: 'LEASED',
        leaseOwner: this.#workerId,
        leasedUntil: { $gte: now },
      },
      { $set: { leasedUntil: new Date(now.getTime() + this.config.OUTBOX_LEASE_SECONDS * 1_000) } },
    );
    return result.modifiedCount === 1;
  }

  async #finish(
    event: ClaimedOutboxEvent,
    status: 'PROCESSED' | 'RETRY' | 'DEAD',
    error?: unknown,
  ): Promise<void> {
    const now = new Date();
    const lastError = error instanceof Error ? error.message.slice(0, 2_000) : undefined;
    const result = await this.database.collection<OutboxDocument>('outbox').updateOne(
      { _id: event.id, status: 'LEASED', leaseOwner: this.#workerId },
      {
        $set: {
          status,
          ...(status === 'PROCESSED' ? { processedAt: now } : {}),
          ...(status === 'RETRY'
            ? { availableAt: new Date(now.getTime() + Math.min(2 ** event.attempts, 300) * 1_000) }
            : {}),
          ...(lastError ? { lastError } : {}),
        },
        $unset: {
          leasedUntil: '',
          leaseOwner: '',
          ...(status !== 'PROCESSED' ? { processedAt: '' } : {}),
          ...(lastError ? {} : { lastError: '' }),
        },
      },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(`Outbox lease was lost before ${status.toLowerCase()} could be recorded`);
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
        aggregateId: event.aggregateId,
      },
      'development event sink (no external delivery configured)',
    );
    return Promise.resolve();
  };
}
