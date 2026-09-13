import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  oracleIdentifier,
  positiveIntegerEnv,
  requiredEnv,
} from '../lib/oracle-env.mjs';

const rebuildRaw = (process.env.SPLITO_RECONCILE_REBUILD ?? 'false').trim().toLowerCase();
if (!['true', 'false'].includes(rebuildRaw)) {
  throw new Error('SPLITO_RECONCILE_REBUILD must be true or false');
}
const rebuild = rebuildRaw === 'true';
const lockWaitSeconds = positiveIntegerEnv('SPLITO_RECONCILE_LOCK_WAIT_SECONDS', 30, {
  min: 1,
  max: 300,
});

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const ownerSchema = oracleIdentifier('DATABASE_OWNER_SCHEMA', requiredEnv('DATABASE_OWNER_SCHEMA'));

function projectionKey(row) {
  return `${row.CONTEXT_ID_HEX}:${row.PARTICIPANT_ID_HEX}:${row.CURRENCY_CODE.trim()}`;
}

function toProjectionMap(rows) {
  return new Map(
    rows.map((row) => [
      projectionKey(row),
      {
        contextIdHex: row.CONTEXT_ID_HEX,
        participantIdHex: row.PARTICIPANT_ID_HEX,
        currency: row.CURRENCY_CODE.trim(),
        netMinor: BigInt(row.NET_MINOR_SIGNED),
      },
    ]),
  );
}

function differences(expected, actual) {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  return [...keys].sort().flatMap((key) => {
    const wanted = expected.get(key);
    const found = actual.get(key);
    if (wanted?.netMinor === found?.netMinor) return [];
    const identity = wanted ?? found;
    return [
      {
        contextIdHex: identity.contextIdHex,
        participantIdHex: identity.participantIdHex,
        currency: identity.currency,
        expectedMinor: wanted?.netMinor.toString() ?? '0',
        actualMinor: found?.netMinor.toString() ?? '0',
      },
    ];
  });
}

async function loadExpected(connection) {
  const result = await connection.execute(
    `SELECT RAWTOHEX(B.CONTEXT_ID) AS CONTEXT_ID_HEX,
            RAWTOHEX(P.PARTICIPANT_ID) AS PARTICIPANT_ID_HEX,
            B.CURRENCY_CODE,
            SUM(P.AMOUNT_MINOR_SIGNED) AS NET_MINOR_SIGNED
       FROM SPLITO_LEDGER_BATCHES B
       JOIN SPLITO_LEDGER_POSTINGS P ON P.BATCH_ID = B.BATCH_ID
      GROUP BY B.CONTEXT_ID, P.PARTICIPANT_ID, B.CURRENCY_CODE
     HAVING SUM(P.AMOUNT_MINOR_SIGNED) <> 0
      ORDER BY B.CONTEXT_ID, P.PARTICIPANT_ID, B.CURRENCY_CODE`,
  );
  return toProjectionMap(result.rows ?? []);
}

async function loadActual(connection) {
  const result = await connection.execute(
    `SELECT RAWTOHEX(CONTEXT_ID) AS CONTEXT_ID_HEX,
            RAWTOHEX(PARTICIPANT_ID) AS PARTICIPANT_ID_HEX,
            CURRENCY_CODE,
            NET_MINOR_SIGNED
       FROM SPLITO_BALANCE_PROJECTIONS
      WHERE NET_MINOR_SIGNED <> 0
      ORDER BY CONTEXT_ID, PARTICIPANT_ID, CURRENCY_CODE`,
  );
  return toProjectionMap(result.rows ?? []);
}

let connection;
try {
  connection = await oracledb.getConnection({
    user: requiredEnv('DATABASE_USER'),
    password: requiredEnv('DATABASE_PASSWORD'),
    connectString: assertPdbConnectString(
      'DATABASE_CONNECT_STRING',
      requiredEnv('DATABASE_CONNECT_STRING'),
    ),
  });
  connection.callTimeout = positiveIntegerEnv('DATABASE_CALL_TIMEOUT_MS', 120_000, {
    min: 1_000,
    max: 900_000,
  });
  await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${ownerSchema}`);

  if (rebuild) {
    // Acquiring the journal lock first waits for existing financial transactions;
    // it then prevents new journal writes until the projection replacement commits.
    await connection.execute(
      `LOCK TABLE SPLITO_LEDGER_BATCHES IN SHARE MODE WAIT ${lockWaitSeconds}`,
    );
    await connection.execute(
      `LOCK TABLE SPLITO_LEDGER_POSTINGS IN SHARE MODE WAIT ${lockWaitSeconds}`,
    );
    await connection.execute(
      `LOCK TABLE SPLITO_BALANCE_PROJECTIONS IN EXCLUSIVE MODE WAIT ${lockWaitSeconds}`,
    );
  } else {
    await connection.execute('SET TRANSACTION READ ONLY');
  }

  const invalidResult = await connection.execute(
    `SELECT RAWTOHEX(B.BATCH_ID) AS BATCH_ID_HEX,
            COUNT(P.POSTING_ID) AS POSTING_COUNT,
            NVL(SUM(P.AMOUNT_MINOR_SIGNED), 0) AS POSTING_SUM
       FROM SPLITO_LEDGER_BATCHES B
       LEFT JOIN SPLITO_LEDGER_POSTINGS P ON P.BATCH_ID = B.BATCH_ID
      GROUP BY B.BATCH_ID
     HAVING COUNT(P.POSTING_ID) < 2 OR NVL(SUM(P.AMOUNT_MINOR_SIGNED), 0) <> 0
      ORDER BY B.BATCH_ID`,
  );
  const invalidBatches = (invalidResult.rows ?? []).map((row) => ({
    batchIdHex: row.BATCH_ID_HEX,
    postingCount: row.POSTING_COUNT,
    postingSum: row.POSTING_SUM,
  }));
  if (invalidBatches.length > 0) {
    throw new Error(
      `Journal contains ${invalidBatches.length} empty or unbalanced batch(es); refusing projection rebuild`,
      { cause: invalidBatches },
    );
  }

  const expected = await loadExpected(connection);
  const before = await loadActual(connection);
  const differencesBefore = differences(expected, before);

  if (rebuild) {
    await connection.execute('DELETE FROM SPLITO_BALANCE_PROJECTIONS');
    await connection.execute(
      `INSERT INTO SPLITO_BALANCE_PROJECTIONS (
         CONTEXT_ID, PARTICIPANT_ID, CURRENCY_CODE, NET_MINOR_SIGNED,
         PROJECTION_VERSION, UPDATED_AT_UTC
       )
       SELECT B.CONTEXT_ID, P.PARTICIPANT_ID, B.CURRENCY_CODE,
              SUM(P.AMOUNT_MINOR_SIGNED), COUNT(DISTINCT B.BATCH_ID),
              SYS_EXTRACT_UTC(SYSTIMESTAMP)
         FROM SPLITO_LEDGER_BATCHES B
         JOIN SPLITO_LEDGER_POSTINGS P ON P.BATCH_ID = B.BATCH_ID
        GROUP BY B.CONTEXT_ID, P.PARTICIPANT_ID, B.CURRENCY_CODE
       HAVING SUM(P.AMOUNT_MINOR_SIGNED) <> 0`,
    );
    const after = await loadActual(connection);
    const differencesAfter = differences(expected, after);
    if (differencesAfter.length > 0) {
      await connection.rollback();
      throw new Error(
        'Projection rebuild did not reproduce the journal; changes were rolled back',
        {
          cause: differencesAfter,
        },
      );
    }
    await connection.commit();
  } else {
    await connection.commit();
  }

  const report = {
    mode: rebuild ? 'rebuild' : 'report',
    balancedJournalBatches: true,
    expectedProjectionRows: expected.size,
    actualProjectionRowsBefore: before.size,
    differencesBefore,
    rebuilt: rebuild,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!rebuild && differencesBefore.length > 0) process.exitCode = 2;
} catch (error) {
  if (connection) await connection.rollback();
  throw error;
} finally {
  if (connection) await connection.close();
}
