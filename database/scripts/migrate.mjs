import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  positiveIntegerEnv,
  requiredEnv,
} from '../lib/oracle-env.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, '..', 'migrations');

function checksum(contents) {
  return createHash('sha256').update(contents, 'utf8').digest('hex');
}

// Migration files intentionally contain SQL DDL/DML only, not SQL*Plus commands
// or PL/SQL blocks. This scanner therefore only needs to avoid semicolons inside
// quoted strings and comments.
function splitSql(contents) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    const next = contents[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        current += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (!inSingleQuote && char === '-' && next === '-') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (!inSingleQuote && char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (char === "'") {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (!inSingleQuote && char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += char;
  }

  if (inSingleQuote || inBlockComment) {
    throw new Error('Migration contains an unterminated quote or block comment');
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

async function createInfrastructure(connection) {
  const ddl = [
    `CREATE TABLE SPLITO_SCHEMA_MIGRATIONS (
       VERSION_NO NUMBER(10,0) NOT NULL,
       DESCRIPTION VARCHAR2(200 CHAR) NOT NULL,
       SCRIPT_NAME VARCHAR2(255 CHAR) NOT NULL,
       CHECKSUM_SHA256 CHAR(64 CHAR) NOT NULL,
       INSTALLED_BY VARCHAR2(128 CHAR) NOT NULL,
       STARTED_AT_UTC TIMESTAMP(6) DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP) NOT NULL,
       INSTALLED_AT_UTC TIMESTAMP(6),
       EXECUTION_MS NUMBER(12,0),
       SUCCESS_FLAG CHAR(1 CHAR) DEFAULT 'N' NOT NULL,
       ERROR_MESSAGE VARCHAR2(4000 CHAR),
       CONSTRAINT SPLITO_PK_SCHEMA_MIGRATIONS PRIMARY KEY (VERSION_NO),
       CONSTRAINT SPLITO_CK_SCHEMA_MIG_SUCCESS CHECK (SUCCESS_FLAG IN ('Y', 'N'))
     )`,
    `CREATE TABLE SPLITO_MIGRATION_LOCK (
       LOCK_ID NUMBER(1,0) NOT NULL,
       LOCK_TOKEN RAW(16),
       LEASE_OWNER VARCHAR2(255 CHAR),
       LEASED_UNTIL_UTC TIMESTAMP(6),
       ACQUIRED_AT_UTC TIMESTAMP(6),
       HEARTBEAT_AT_UTC TIMESTAMP(6),
       CONSTRAINT SPLITO_PK_MIGRATION_LOCK PRIMARY KEY (LOCK_ID),
       CONSTRAINT SPLITO_CK_MIGRATION_LOCK_ID CHECK (LOCK_ID = 1)
     )`,
  ];

  for (const statement of ddl) {
    try {
      await connection.execute(statement);
    } catch (error) {
      if (error?.errorNum !== 955) throw error;
    }
  }
  try {
    await connection.execute(
      `MERGE INTO SPLITO_MIGRATION_LOCK target
       USING (SELECT 1 AS LOCK_ID FROM DUAL) source
          ON (target.LOCK_ID = source.LOCK_ID)
       WHEN NOT MATCHED THEN INSERT (LOCK_ID) VALUES (source.LOCK_ID)`,
    );
    await connection.commit();
  } catch (error) {
    // Two first-ever runners can both observe an empty lock table. Oracle may
    // report the losing MERGE as a unique-key race after the winner commits.
    await connection.rollback();
    if (error?.errorNum !== 1) throw error;
  }
  const lockRowResult = await connection.execute(
    `SELECT COUNT(*) AS LOCK_ROW_COUNT FROM SPLITO_MIGRATION_LOCK WHERE LOCK_ID = 1`,
  );
  if (Number(lockRowResult.rows?.[0]?.LOCK_ROW_COUNT ?? 0) !== 1) {
    throw new Error('Migration lock infrastructure does not contain its singleton row');
  }
}

async function acquireMigrationLease(connection, actor, timeoutSeconds, leaseSeconds) {
  const lockToken = randomBytes(16);
  const deadline = Date.now() + timeoutSeconds * 1_000;

  do {
    const result = await connection.execute(
      `UPDATE SPLITO_MIGRATION_LOCK
          SET LOCK_TOKEN = :lock_token,
              LEASE_OWNER = :lease_owner,
              LEASED_UNTIL_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP) +
                NUMTODSINTERVAL(:lease_seconds, 'SECOND'),
              ACQUIRED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
              HEARTBEAT_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE LOCK_ID = 1
          AND (LOCK_TOKEN IS NULL OR LEASED_UNTIL_UTC < SYS_EXTRACT_UTC(SYSTIMESTAMP))`,
      { lock_token: lockToken, lease_owner: actor, lease_seconds: leaseSeconds },
    );
    await connection.commit();
    if (result.rowsAffected === 1) return lockToken;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);

  throw new Error(`Could not acquire the Oracle migration lease within ${timeoutSeconds} seconds`);
}

async function renewMigrationLease(connection, lockToken, leaseSeconds) {
  const result = await connection.execute(
    `UPDATE SPLITO_MIGRATION_LOCK
        SET LEASED_UNTIL_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP) +
              NUMTODSINTERVAL(:lease_seconds, 'SECOND'),
            HEARTBEAT_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
      WHERE LOCK_ID = 1
        AND LOCK_TOKEN = :lock_token
        AND LEASED_UNTIL_UTC >= SYS_EXTRACT_UTC(SYSTIMESTAMP)`,
    { lease_seconds: leaseSeconds, lock_token: lockToken },
  );
  await connection.commit();
  if (result.rowsAffected !== 1) {
    throw new Error('The migration lease expired or was taken by another runner');
  }
}

async function releaseMigrationLease(connection, lockToken) {
  if (!lockToken) return;
  try {
    await connection.execute(
      `UPDATE SPLITO_MIGRATION_LOCK
          SET LOCK_TOKEN = NULL,
              LEASE_OWNER = NULL,
              LEASED_UNTIL_UTC = NULL,
              HEARTBEAT_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE LOCK_ID = 1 AND LOCK_TOKEN = :lock_token`,
      { lock_token: lockToken },
    );
    await connection.commit();
  } catch {
    // A crashed runner cannot release; the bounded lease permits stale takeover.
  }
}

async function discoverMigrations() {
  const filenames = await readdir(migrationsDirectory);
  const migrations = [];
  for (const filename of filenames) {
    const match = /^V(\d+)__([a-z0-9_]+)\.sql$/u.exec(filename);
    if (!match) continue;
    const contents = await readFile(join(migrationsDirectory, filename), 'utf8');
    migrations.push({
      version: Number(match[1]),
      description: match[2].replaceAll('_', ' '),
      filename,
      contents,
      checksum: checksum(contents),
      statements: splitSql(contents),
    });
  }
  migrations.sort((left, right) => left.version - right.version);
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(`Duplicate migration version ${migrations[index].version}`);
    }
  }
  return migrations;
}

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const connectString = assertPdbConnectString(
  'SPLITO_MIGRATION_DB_CONNECT_STRING',
  requiredEnv('SPLITO_MIGRATION_DB_CONNECT_STRING'),
);
const lockTimeoutSeconds = positiveIntegerEnv('SPLITO_MIGRATION_LOCK_TIMEOUT_SECONDS', 60, {
  min: 1,
  max: 600,
});
const migrationCallTimeoutMs = positiveIntegerEnv('SPLITO_MIGRATION_CALL_TIMEOUT_MS', 120_000, {
  min: 1_000,
  max: 900_000,
});
const leaseSeconds = positiveIntegerEnv('SPLITO_MIGRATION_LEASE_SECONDS', 600, {
  min: 120,
  max: 3_600,
});
if (leaseSeconds * 1_000 <= migrationCallTimeoutMs + 60_000) {
  throw new Error(
    'SPLITO_MIGRATION_LEASE_SECONDS must exceed the migration call timeout by more than 60 seconds',
  );
}

let connection;
let lockToken;
try {
  connection = await oracledb.getConnection({
    user: requiredEnv('SPLITO_MIGRATION_DB_USER'),
    password: requiredEnv('SPLITO_MIGRATION_DB_PASSWORD'),
    connectString,
  });
  connection.callTimeout = migrationCallTimeoutMs;

  const containerResult = await connection.execute(
    `SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS CONTAINER_NAME FROM DUAL`,
  );
  if (containerResult.rows?.[0]?.CONTAINER_NAME === 'CDB$ROOT') {
    throw new Error('Refusing to migrate CDB$ROOT; use the FREEPDB1 service');
  }

  await createInfrastructure(connection);
  const actor = `${process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'unknown-host'}:${process.pid}`;
  lockToken = await acquireMigrationLease(connection, actor, lockTimeoutSeconds, leaseSeconds);

  const historyResult = await connection.execute(
    `SELECT VERSION_NO, CHECKSUM_SHA256, SUCCESS_FLAG, ERROR_MESSAGE
       FROM SPLITO_SCHEMA_MIGRATIONS
      ORDER BY VERSION_NO`,
  );
  const history = new Map((historyResult.rows ?? []).map((row) => [Number(row.VERSION_NO), row]));
  const failed = [...history.entries()].find(([, row]) => row.SUCCESS_FLAG !== 'Y');
  if (failed) {
    throw new Error(
      `Migration V${failed[0]} is recorded as failed. Inspect the schema and follow the ` +
        'forward-recovery procedure in docs/operations/migrations.md before continuing.',
    );
  }

  for (const migration of await discoverMigrations()) {
    await renewMigrationLease(connection, lockToken, leaseSeconds);
    const prior = history.get(migration.version);
    if (prior) {
      if (prior.CHECKSUM_SHA256.trim() !== migration.checksum) {
        throw new Error(`Checksum mismatch for applied migration ${migration.filename}`);
      }
      process.stdout.write(`Already applied ${migration.filename}\n`);
      continue;
    }

    const startedAt = performance.now();
    await connection.execute(
      `INSERT INTO SPLITO_SCHEMA_MIGRATIONS (
         VERSION_NO, DESCRIPTION, SCRIPT_NAME, CHECKSUM_SHA256, INSTALLED_BY, SUCCESS_FLAG
       ) VALUES (
         :version_no, :description, :script_name, :checksum_sha256, :installed_by, 'N'
       )`,
      {
        version_no: migration.version,
        description: migration.description,
        script_name: migration.filename,
        checksum_sha256: migration.checksum,
        installed_by: actor,
      },
    );
    await connection.commit();

    try {
      for (const statement of migration.statements) {
        await renewMigrationLease(connection, lockToken, leaseSeconds);
        await connection.execute(statement);
      }
      const executionMs = Math.round(performance.now() - startedAt);
      await connection.execute(
        `UPDATE SPLITO_SCHEMA_MIGRATIONS
            SET SUCCESS_FLAG = 'Y',
                INSTALLED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                EXECUTION_MS = :execution_ms,
                ERROR_MESSAGE = NULL
          WHERE VERSION_NO = :version_no`,
        { execution_ms: executionMs, version_no: migration.version },
      );
      await connection.commit();
      process.stdout.write(`Applied ${migration.filename} (${executionMs} ms)\n`);
    } catch (error) {
      await connection.rollback();
      const executionMs = Math.round(performance.now() - startedAt);
      const message = String(error?.message ?? error).slice(0, 4000);
      await connection.execute(
        `UPDATE SPLITO_SCHEMA_MIGRATIONS
            SET SUCCESS_FLAG = 'N',
                EXECUTION_MS = :execution_ms,
                ERROR_MESSAGE = :error_message
          WHERE VERSION_NO = :version_no`,
        { execution_ms: executionMs, error_message: message, version_no: migration.version },
      );
      await connection.commit();
      throw new Error(
        `${migration.filename} failed after Oracle may have committed earlier DDL statements: ${message}`,
        { cause: error },
      );
    }
  }
} finally {
  if (connection) {
    await releaseMigrationLease(connection, lockToken);
    await connection.close();
  }
}
