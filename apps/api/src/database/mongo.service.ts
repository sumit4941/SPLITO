import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { Environment } from '@splito/config';
import { assertMongoRuntimeReady } from '../../../../database/runtime-readiness.mjs';
import {
  MongoClient,
  ReadPreference,
  type ClientSession,
  type Collection,
  type Db,
  type Document,
} from 'mongodb';
import { APP_CONFIG } from '../config/app-config.js';
import type { MongoCollectionName } from './mongo.collections.js';

export interface MongoUnitOfWork {
  readonly db: Db;
  readonly session?: ClientSession;
}

export interface MongoTransactionalUnitOfWork extends MongoUnitOfWork {
  readonly session: ClientSession;
}

/**
 * Requests a fresh session for the whole transaction. This is intentionally
 * narrower than retrying arbitrary duplicate-key errors: callers use it only
 * for a deterministic idempotency-slot upsert race.
 */
export class RetryableMongoTransactionError extends Error {
  constructor(readonly originalError: unknown) {
    super('Retry the MongoDB transaction in a fresh session');
    this.name = 'RetryableMongoTransactionError';
  }
}

@Injectable()
export class MongoService implements OnModuleInit, OnApplicationShutdown {
  #client: MongoClient | undefined;
  #database: Db | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: Environment) {}

  async onModuleInit(): Promise<void> {
    const client = new MongoClient(this.config.MONGODB_URI, {
      appName: 'splito-api',
      minPoolSize: this.config.MONGODB_MIN_POOL_SIZE,
      maxPoolSize: this.config.MONGODB_MAX_POOL_SIZE,
      connectTimeoutMS: this.config.MONGODB_CONNECT_TIMEOUT_MS,
      serverSelectionTimeoutMS: this.config.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: this.config.MONGODB_SOCKET_TIMEOUT_MS,
      promoteBuffers: true,
      retryReads: true,
      retryWrites: true,
    });

    try {
      await client.connect();
      const database = client.db(this.config.MONGODB_DATABASE);
      await database.command({ ping: 1 });
      await assertMongoRuntimeReady(database, 'api', { verifyManagedSchema: true });
      this.#client = client;
      this.#database = database;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const client = this.#client;
    this.#database = undefined;
    this.#client = undefined;
    if (client) await client.close();
  }

  withConnection<T>(operation: (work: MongoUnitOfWork) => Promise<T>): Promise<T> {
    return operation({ db: this.database });
  }

  /**
   * Runs database-only work in a retryable snapshot transaction. The MongoDB
   * driver may invoke `operation` more than once, so callers must keep SMS,
   * file/object storage, and all other external side effects outside it.
   */
  async withTransaction<T>(
    operation: (work: MongoTransactionalUnitOfWork) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const session = this.client.startSession();
      let completed = false;
      let value: T | undefined;
      try {
        await session.withTransaction(
          async () => {
            value = await operation({ db: this.database, session });
            completed = true;
            return value;
          },
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: ReadPreference.primary,
          },
        );
        if (!completed) throw new Error('MongoDB transaction ended without completing its work');
        return value as T;
      } catch (error) {
        if (error instanceof RetryableMongoTransactionError && attempt < maxAttempts) continue;
        if (error instanceof RetryableMongoTransactionError) throw error.originalError;
        throw error;
      } finally {
        await session.endSession();
      }
    }
    throw new Error('MongoDB transaction retry loop ended unexpectedly');
  }

  collection<T extends Document = Document>(name: MongoCollectionName): Collection<T> {
    return this.database.collection<T>(name);
  }

  async ping(): Promise<void> {
    await this.database.command({ ping: 1 });
    await assertMongoRuntimeReady(this.database, 'api');
  }

  private get client(): MongoClient {
    if (!this.#client) throw new Error('MongoDB client has not been initialized');
    return this.#client;
  }

  private get database(): Db {
    if (!this.#database) throw new Error('MongoDB database has not been initialized');
    return this.#database;
  }
}

export { COLLECTIONS, type MongoCollectionName } from './mongo.collections.js';
export {
  decimalToMinor,
  isMongoDuplicateKey,
  minorToDecimal,
  mongoOptions,
} from './mongo.helpers.js';
