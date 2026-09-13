import { loadWorkerEnvironment } from '@splito/config';
import oracledb from 'oracledb';
import pino from 'pino';
import { createDevelopmentHandler, OutboxWorker } from './outbox-worker.js';

const config = loadWorkerEnvironment();
if (!config.DATABASE_PASSWORD) {
  throw new Error('DATABASE_PASSWORD is required to run the worker');
}

oracledb.fetchAsString = [oracledb.NUMBER];
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['password', 'DATABASE_PASSWORD', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]',
  },
});

// This handler intentionally acknowledges events without external delivery and
// therefore must be rejected before opening a database pool in production.
const developmentHandler = createDevelopmentHandler(config, logger);

const pool = await oracledb.createPool({
  user: config.DATABASE_USER,
  password: config.DATABASE_PASSWORD,
  connectString: config.DATABASE_CONNECT_STRING,
  poolMin: config.DATABASE_POOL_MIN,
  poolMax: config.DATABASE_POOL_MAX,
  poolIncrement: config.DATABASE_POOL_INCREMENT,
  queueTimeout: config.DATABASE_QUEUE_TIMEOUT_MS,
  stmtCacheSize: 40,
});

const worker = new OutboxWorker(pool, config, logger);
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
