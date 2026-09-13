import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  optionalEnv,
  oracleIdentifier,
  requiredEnv,
} from '../lib/oracle-env.mjs';

const ownerUser = oracleIdentifier(
  'SPLITO_MIGRATION_DB_USER',
  optionalEnv('SPLITO_MIGRATION_DB_USER', 'SPLITO_OWNER'),
);
const runtimeUser = oracleIdentifier('SPLITO_DB_USER', optionalEnv('SPLITO_DB_USER', 'SPLITO_APP'));
const tablespace = oracleIdentifier(
  'SPLITO_DB_TABLESPACE',
  optionalEnv('SPLITO_DB_TABLESPACE', 'USERS'),
);
const quota = optionalEnv('SPLITO_DB_QUOTA', '1G').toUpperCase();

if (!/^(?:UNLIMITED|[1-9]\d*(?:K|M|G|T|P)?)$/u.test(quota)) {
  throw new Error('SPLITO_DB_QUOTA must be UNLIMITED or a positive Oracle size such as 1G');
}
if (ownerUser === runtimeUser) {
  throw new Error('Migration/owner and runtime database users must be different');
}
if (ownerUser !== 'SPLITO_OWNER' || runtimeUser !== 'SPLITO_APP') {
  throw new Error(
    'The versioned migrations currently target SPLITO_OWNER and grant to SPLITO_APP; ' +
      'do not override those user names.',
  );
}

const ownerPassword = requiredEnv('SPLITO_MIGRATION_DB_PASSWORD');
const runtimePassword = requiredEnv('SPLITO_DB_PASSWORD');
const adminPassword = requiredEnv('SPLITO_ADMIN_DB_PASSWORD');
for (const [name, password] of [
  ['SPLITO_MIGRATION_DB_PASSWORD', ownerPassword],
  ['SPLITO_DB_PASSWORD', runtimePassword],
]) {
  if (password.length < 12) {
    throw new Error(`${name} must contain at least 12 characters`);
  }
}
if (new Set([adminPassword, ownerPassword, runtimePassword]).size !== 3) {
  throw new Error('Administrator, owner, and runtime passwords must be independent');
}
const adminConnectString = assertPdbConnectString(
  'SPLITO_ADMIN_DB_CONNECT_STRING',
  requiredEnv('SPLITO_ADMIN_DB_CONNECT_STRING'),
);

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let connection;
try {
  connection = await oracledb.getConnection({
    user: requiredEnv('SPLITO_ADMIN_DB_USER'),
    password: adminPassword,
    connectString: adminConnectString,
  });

  const containerResult = await connection.execute(
    `SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS CONTAINER_NAME FROM DUAL`,
  );
  const containerName = containerResult.rows?.[0]?.CONTAINER_NAME;
  if (!containerName || containerName === 'CDB$ROOT') {
    throw new Error('Refusing to create SPLITO users in CDB$ROOT; connect to FREEPDB1');
  }

  const existingResult = await connection.execute(
    `SELECT USERNAME FROM DBA_USERS WHERE USERNAME IN (:owner_user, :runtime_user)`,
    { owner_user: ownerUser, runtime_user: runtimeUser },
  );
  const existing = new Set((existingResult.rows ?? []).map((row) => row.USERNAME));
  if (existing.size > 0 && process.env.SPLITO_REPAIR_EXISTING_USERS !== 'true') {
    throw new Error(
      `Existing dedicated users found: ${[...existing].join(', ')}. Refusing to change their ` +
        'privileges or quotas unless SPLITO_REPAIR_EXISTING_USERS=true is explicitly set.',
    );
  }
  if (existing.size > 0) {
    const ownedTablesResult = await connection.execute(
      `SELECT OWNER, TABLE_NAME
         FROM DBA_TABLES
        WHERE OWNER IN (:owner_user, :runtime_user)
          AND (OWNER = :runtime_user_again OR TABLE_NAME NOT LIKE 'SPLITO\\_%' ESCAPE '\\')
        ORDER BY OWNER, TABLE_NAME`,
      {
        owner_user: ownerUser,
        runtime_user: runtimeUser,
        runtime_user_again: runtimeUser,
      },
    );
    if ((ownedTablesResult.rows ?? []).length > 0) {
      throw new Error(
        `Existing users own unexpected tables; refusing repair: ${JSON.stringify(ownedTablesResult.rows)}`,
      );
    }

    const privilegesResult = await connection.execute(
      `SELECT GRANTEE, PRIVILEGE
         FROM DBA_SYS_PRIVS
        WHERE GRANTEE IN (:owner_user, :runtime_user)
        ORDER BY GRANTEE, PRIVILEGE`,
      { owner_user: ownerUser, runtime_user: runtimeUser },
    );
    const permittedPrivileges = new Map([
      [
        ownerUser,
        new Set([
          'CREATE PROCEDURE',
          'CREATE SEQUENCE',
          'CREATE SESSION',
          'CREATE TABLE',
          'CREATE TRIGGER',
          'CREATE VIEW',
        ]),
      ],
      [runtimeUser, new Set(['CREATE SESSION'])],
    ]);
    const unexpectedPrivileges = (privilegesResult.rows ?? []).filter(
      (row) => !permittedPrivileges.get(row.GRANTEE)?.has(row.PRIVILEGE),
    );
    if (unexpectedPrivileges.length > 0) {
      throw new Error(
        `Existing users have unexpected system privileges; refusing repair: ${JSON.stringify(unexpectedPrivileges)}`,
      );
    }

    const rolesResult = await connection.execute(
      `SELECT GRANTEE, GRANTED_ROLE
         FROM DBA_ROLE_PRIVS
        WHERE GRANTEE IN (:owner_user, :runtime_user)
        ORDER BY GRANTEE, GRANTED_ROLE`,
      { owner_user: ownerUser, runtime_user: runtimeUser },
    );
    if ((rolesResult.rows ?? []).length > 0) {
      throw new Error(
        `Existing users have roles; refusing repair: ${JSON.stringify(rolesResult.rows)}`,
      );
    }
  }

  if (!existing.has(ownerUser)) {
    await connection.execute(
      `BEGIN
         EXECUTE IMMEDIATE
           'CREATE USER ${ownerUser} IDENTIFIED BY ' || DBMS_ASSERT.ENQUOTE_NAME(:user_password, FALSE) ||
           ' DEFAULT TABLESPACE ${tablespace} TEMPORARY TABLESPACE TEMP QUOTA ${quota} ON ${tablespace}';
       END;`,
      { user_password: ownerPassword },
    );
  }
  if (!existing.has(runtimeUser)) {
    await connection.execute(
      `BEGIN
         EXECUTE IMMEDIATE
           'CREATE USER ${runtimeUser} IDENTIFIED BY ' || DBMS_ASSERT.ENQUOTE_NAME(:user_password, FALSE) ||
           ' DEFAULT TABLESPACE ${tablespace} TEMPORARY TABLESPACE TEMP QUOTA 0 ON ${tablespace}';
       END;`,
      { user_password: runtimePassword },
    );
  }

  for (const statement of [
    `GRANT CREATE SESSION, CREATE TABLE TO ${ownerUser}`,
    `GRANT CREATE SESSION TO ${runtimeUser}`,
    `ALTER USER ${ownerUser} QUOTA ${quota} ON ${tablespace}`,
    `ALTER USER ${runtimeUser} QUOTA 0 ON ${tablespace}`,
  ]) {
    await connection.execute(statement);
  }

  const obsoleteOwnerPrivileges = [
    'CREATE PROCEDURE',
    'CREATE SEQUENCE',
    'CREATE TRIGGER',
    'CREATE VIEW',
  ];
  const obsoleteResult = await connection.execute(
    `SELECT PRIVILEGE
       FROM DBA_SYS_PRIVS
      WHERE GRANTEE = :owner_user
        AND PRIVILEGE IN ('CREATE PROCEDURE', 'CREATE SEQUENCE', 'CREATE TRIGGER', 'CREATE VIEW')`,
    { owner_user: ownerUser },
  );
  const grantedObsoletePrivileges = new Set(
    (obsoleteResult.rows ?? []).map((row) => row.PRIVILEGE),
  );
  for (const privilege of obsoleteOwnerPrivileges) {
    if (grantedObsoletePrivileges.has(privilege)) {
      await connection.execute(`REVOKE ${privilege} FROM ${ownerUser}`);
    }
  }
  await connection.commit();

  process.stdout.write(
    `Created or repaired grants for ${ownerUser} (schema owner/migrator) and ` +
      `${runtimeUser} (runtime) in ${containerName}. Existing passwords were not changed.\n`,
  );
} catch (error) {
  if (connection) await connection.rollback();
  throw error;
} finally {
  if (connection) await connection.close();
}
