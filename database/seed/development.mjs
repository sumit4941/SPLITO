import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  requiredEnv,
} from '../lib/oracle-env.mjs';

if (
  process.env.NODE_ENV !== 'development' ||
  process.env.SPLITO_ALLOW_DEVELOPMENT_SEED !== 'true'
) {
  throw new Error(
    'Refusing to seed unless NODE_ENV=development and SPLITO_ALLOW_DEVELOPMENT_SEED=true',
  );
}

const demoPassword = process.env.SPLITO_DEMO_PASSWORD ?? 'SplitoDemo!2026'; // gitleaks:allow
if (demoPassword.length < 12) {
  throw new Error('SPLITO_DEMO_PASSWORD must contain at least 12 characters');
}

function splitSeedSql(contents) {
  const sqlLines = contents
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:WHENEVER\b|SET\s+DEFINE\b|PROMPT\b)/iu.test(line));
  const sql = sqlLines.join('\n');
  const statements = [];
  let current = '';
  let quoted = false;
  let lineComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (!quoted && char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "'") {
      current += char;
      if (quoted && next === "'") {
        current += next;
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === ';') {
      const statement = current.trim();
      if (statement && statement.toUpperCase() !== 'COMMIT') statements.push(statement);
      current = '';
      continue;
    }
    current += char;
  }
  if (quoted) throw new Error('Unterminated quote in development.sql');
  return statements;
}

let argon2;
try {
  const module = await import('argon2');
  argon2 = module.default ?? module;
} catch (error) {
  throw new Error('Install workspace dependencies before running the development seeder', {
    cause: error,
  });
}

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let connection;
try {
  connection = await oracledb.getConnection({
    user: requiredEnv('SPLITO_MIGRATION_DB_USER'),
    password: requiredEnv('SPLITO_MIGRATION_DB_PASSWORD'),
    connectString: assertPdbConnectString(
      'SPLITO_MIGRATION_DB_CONNECT_STRING',
      requiredEnv('SPLITO_MIGRATION_DB_CONNECT_STRING'),
    ),
  });

  const existingResult = await connection.execute(
    `SELECT COUNT(*) AS USER_COUNT
       FROM SPLITO_USERS
      WHERE USER_ID IN (
        HEXTORAW('10000000000000000000000000000001'),
        HEXTORAW('10000000000000000000000000000002'),
        HEXTORAW('10000000000000000000000000000003')
      )`,
  );
  const existingCount = Number(existingResult.rows?.[0]?.USER_COUNT ?? 0);
  if (existingCount !== 0 && existingCount !== 3) {
    throw new Error('Partial demo identity data exists; inspect it before retrying the seed');
  }

  if (existingCount === 0) {
    const sqlPath = join(dirname(fileURLToPath(import.meta.url)), 'development.sql');
    const statements = splitSeedSql(await readFile(sqlPath, 'utf8'));
    for (const [index, statement] of statements.entries()) {
      try {
        await connection.execute(statement);
      } catch (error) {
        throw new Error(
          `Development seed statement ${index + 1} failed (${statement.slice(0, 80)}...)`,
          { cause: error },
        );
      }
    }
  }

  const resetPasswords = process.env.SPLITO_RESET_DEMO_PASSWORDS === 'true';
  const passwordStatus = await connection.execute(
    `SELECT COUNT(*) AS USER_COUNT, COUNT(PASSWORD_HASH) AS HASHED_USER_COUNT
       FROM SPLITO_USERS
      WHERE USER_ID IN (
        HEXTORAW('10000000000000000000000000000001'),
        HEXTORAW('10000000000000000000000000000002'),
        HEXTORAW('10000000000000000000000000000003')
      )`,
  );
  if (resetPasswords || Number(passwordStatus.rows?.[0]?.HASHED_USER_COUNT ?? 0) !== 3) {
    for (const suffix of ['01', '02', '03']) {
      const passwordHash = await argon2.hash(demoPassword, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
        hashLength: 32,
      });
      await connection.execute(
        `UPDATE SPLITO_USERS
            SET PASSWORD_HASH = :password_hash,
                UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP),
                SECURITY_VERSION = SECURITY_VERSION + 1
          WHERE USER_ID = HEXTORAW(:user_id_hex)`,
        {
          password_hash: passwordHash,
          user_id_hex: `100000000000000000000000000000${suffix}`,
        },
      );
    }
  }

  await connection.execute(
    `UPDATE SPLITO_USERS
        SET STATUS = 'ACTIVE',
            UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
      WHERE USER_ID IN (
        HEXTORAW('10000000000000000000000000000001'),
        HEXTORAW('10000000000000000000000000000002'),
        HEXTORAW('10000000000000000000000000000003')
      )
        AND PASSWORD_HASH IS NOT NULL
        AND STATUS = 'PENDING'`,
  );

  const mobileConflictResult = await connection.execute(
    `SELECT COUNT(*) AS CONFLICT_COUNT
       FROM SPLITO_USERS U
      WHERE (U.USER_ID = HEXTORAW('10000000000000000000000000000001')
             AND U.MOBILE_E164 IS NOT NULL AND U.MOBILE_E164 <> '+12025550101')
         OR (U.USER_ID = HEXTORAW('10000000000000000000000000000002')
             AND U.MOBILE_E164 IS NOT NULL AND U.MOBILE_E164 <> '+12025550102')
         OR (U.USER_ID = HEXTORAW('10000000000000000000000000000003')
             AND U.MOBILE_E164 IS NOT NULL AND U.MOBILE_E164 <> '+12025550103')
         OR (U.MOBILE_E164 = '+12025550101'
             AND U.USER_ID <> HEXTORAW('10000000000000000000000000000001'))
         OR (U.MOBILE_E164 = '+12025550102'
             AND U.USER_ID <> HEXTORAW('10000000000000000000000000000002'))
         OR (U.MOBILE_E164 = '+12025550103'
             AND U.USER_ID <> HEXTORAW('10000000000000000000000000000003'))`,
  );
  if (Number(mobileConflictResult.rows?.[0]?.CONFLICT_COUNT ?? 0) !== 0) {
    throw new Error('Reserved fictional demo mobile numbers conflict with existing identities');
  }

  for (const [suffix, mobileNumber] of [
    ['01', '+12025550101'],
    ['02', '+12025550102'],
    ['03', '+12025550103'],
  ]) {
    await connection.execute(
      `UPDATE SPLITO_USERS
          SET MOBILE_E164 = :mobile_number,
              MOBILE_VERIFIED_AT_UTC = COALESCE(
                MOBILE_VERIFIED_AT_UTC, SYS_EXTRACT_UTC(SYSTIMESTAMP)
              ),
              UPDATED_AT_UTC = SYS_EXTRACT_UTC(SYSTIMESTAMP)
        WHERE USER_ID = HEXTORAW(:user_id_hex)
          AND (MOBILE_E164 IS NULL OR MOBILE_E164 = :mobile_number)`,
      {
        mobile_number: mobileNumber,
        user_id_hex: `100000000000000000000000000000${suffix}`,
      },
    );
  }

  const readyResult = await connection.execute(
    `SELECT COUNT(*) AS READY_USER_COUNT
       FROM SPLITO_USERS
      WHERE (
        (USER_ID = HEXTORAW('10000000000000000000000000000001')
         AND MOBILE_E164 = '+12025550101') OR
        (USER_ID = HEXTORAW('10000000000000000000000000000002')
         AND MOBILE_E164 = '+12025550102') OR
        (USER_ID = HEXTORAW('10000000000000000000000000000003')
         AND MOBILE_E164 = '+12025550103')
      )
        AND MOBILE_VERIFIED_AT_UTC IS NOT NULL
        AND PASSWORD_HASH IS NOT NULL
        AND STATUS = 'ACTIVE'`,
  );
  if (Number(readyResult.rows?.[0]?.READY_USER_COUNT ?? 0) !== 3) {
    throw new Error(
      'Development users are not all active with runnable passwords and OTP-ready mobiles',
    );
  }

  await connection.commit();
  process.stdout.write(
    'Development seed ready: alice@splito.example, bob@splito.example, and ' +
      'casey@splito.example use the configured SPLITO_DEMO_PASSWORD; their fictional mobiles ' +
      'are +12025550101, +12025550102, and +12025550103.\n',
  );
} catch (error) {
  if (connection) await connection.rollback();
  throw error;
} finally {
  if (connection) await connection.close();
}
