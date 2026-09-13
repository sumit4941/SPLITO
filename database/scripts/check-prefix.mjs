import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  requiredEnv,
} from '../lib/oracle-env.mjs';

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
  const result = await connection.execute(
    `SELECT TABLE_NAME
       FROM USER_TABLES
      WHERE TABLE_NAME NOT LIKE 'SPLITO\\_%' ESCAPE '\\'
      ORDER BY TABLE_NAME`,
  );
  if ((result.rows ?? []).length > 0) {
    throw new Error(
      `Non-compliant tables found: ${result.rows.map((row) => row.TABLE_NAME).join(', ')}`,
    );
  }
  process.stdout.write('All owner-schema tables use the SPLITO_ prefix.\n');
} finally {
  if (connection) await connection.close();
}
