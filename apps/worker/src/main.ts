import { loadWorkerEnvironment } from '@splito/config';
import { MongoClient } from 'mongodb';
import pino from 'pino';
import { assertMongoRuntimeReady } from '../../../database/runtime-readiness.mjs';
import { createDevelopmentHandler, OutboxWorker } from './outbox-worker.js';

const config = loadWorkerEnvironment();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'MONGODB_URI',
      '*.password',
      '*.token',
      '*.secret',
      '*.uri',
      '*.connectionString',
    ],
    censor: '[REDACTED]',
  },
});

// This handler intentionally acknowledges events without external delivery and
// therefore must be rejected before connecting in production.
const developmentHandler = createDevelopmentHandler(config, logger);
const client = new MongoClient(config.MONGODB_URI, {
  appName: 'splito-worker',
  minPoolSize: config.MONGODB_MIN_POOL_SIZE,
  maxPoolSize: config.MONGODB_MAX_POOL_SIZE,
  connectTimeoutMS: config.MONGODB_CONNECT_TIMEOUT_MS,
  serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
  socketTimeoutMS: config.MONGODB_SOCKET_TIMEOUT_MS,
  retryReads: true,
  retryWrites: true,
});

let database;
try {
  await client.connect();
  database = client.db(config.MONGODB_DATABASE);
  await database.command({ ping: 1 });
  await assertMongoRuntimeReady(database, 'worker', { verifyManagedSchema: true });
} catch (error) {
  await client.close().catch(() => undefined);
  throw error;
}

const worker = new OutboxWorker(client, database, config, logger);
worker.register('*', developmentHandler);
worker.start();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutdown requested');
  await worker.stop();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
