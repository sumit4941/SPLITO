import { MongoClient } from 'mongodb';

const MONGODB_URI_PATTERN = /^mongodb(?:\+srv)?:\/\//u;
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,63}$/u;

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function boundedIntegerEnv(name, fallback, minimum, maximum) {
  const raw = optionalEnv(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function loadMongoEnvironment() {
  const uri = optionalEnv('MONGODB_URI', 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  if (!MONGODB_URI_PATTERN.test(uri)) {
    throw new Error('MONGODB_URI must use mongodb:// or mongodb+srv://');
  }

  const databaseName = optionalEnv('MONGODB_DATABASE', 'splito');
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('MONGODB_DATABASE must contain only letters, numbers, underscores, or hyphens');
  }

  const minPoolSize = boundedIntegerEnv('MONGODB_MIN_POOL_SIZE', 1, 0, 20);
  const maxPoolSize = boundedIntegerEnv('MONGODB_MAX_POOL_SIZE', 10, 1, 100);
  if (minPoolSize > maxPoolSize) {
    throw new Error('MONGODB_MIN_POOL_SIZE cannot exceed MONGODB_MAX_POOL_SIZE');
  }

  return {
    uri,
    databaseName,
    options: {
      appName: 'splito-database-tooling',
      minPoolSize,
      maxPoolSize,
      connectTimeoutMS: boundedIntegerEnv('MONGODB_CONNECT_TIMEOUT_MS', 10_000, 100, 120_000),
      serverSelectionTimeoutMS: boundedIntegerEnv(
        'MONGODB_SERVER_SELECTION_TIMEOUT_MS',
        10_000,
        100,
        120_000,
      ),
      socketTimeoutMS: boundedIntegerEnv('MONGODB_SOCKET_TIMEOUT_MS', 30_000, 0, 300_000),
      retryReads: true,
      retryWrites: true,
    },
  };
}

export async function connectMongo() {
  const config = loadMongoEnvironment();
  const client = new MongoClient(config.uri, config.options);
  try {
    await client.connect();
    const database = client.db(config.databaseName);
    await database.command({ ping: 1 });
    return { client, database, config };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw new Error('Could not connect to MongoDB with the configured deployment settings', {
      cause: error,
    });
  }
}
