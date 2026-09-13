import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  oracleIdentifier,
  requiredEnv,
} from '../lib/oracle-env.mjs';

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

const connectString = assertPdbConnectString(
  'DATABASE_CONNECT_STRING',
  requiredEnv('DATABASE_CONNECT_STRING'),
);
const ownerSchema = oracleIdentifier('DATABASE_OWNER_SCHEMA', requiredEnv('DATABASE_OWNER_SCHEMA'));

let connection;
try {
  connection = await oracledb.getConnection({
    user: requiredEnv('DATABASE_USER'),
    password: requiredEnv('DATABASE_PASSWORD'),
    connectString,
  });
  connection.callTimeout = 5_000;
  await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${ownerSchema}`);

  const result = await connection.execute(
    `SELECT
       SYS_CONTEXT('USERENV', 'CON_NAME') AS CONTAINER_NAME,
       SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS SERVICE_NAME,
       SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS CURRENT_SCHEMA
     FROM DUAL`,
  );
  const row = result.rows?.[0];
  if (!row || row.CONTAINER_NAME === 'CDB$ROOT') {
    throw new Error('SPLITO runtime connection resolved to CDB$ROOT instead of an application PDB');
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ...row,
        DRIVER_MODE: oracledb.thin ? 'thin' : 'thick',
        SERVER_VERSION: connection.oracleServerVersionString,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (connection) await connection.close();
}
