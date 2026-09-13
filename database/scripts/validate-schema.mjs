import {
  assertPdbConnectString,
  configureOracleMode,
  loadOracleDb,
  requiredEnv,
} from '../lib/oracle-env.mjs';

const expectedTables = [
  'SPLITO_AUDIT_EVENTS',
  'SPLITO_BALANCE_PROJECTIONS',
  'SPLITO_CONTEXTS',
  'SPLITO_CONTEXT_MEMBERS',
  'SPLITO_CURRENCIES',
  'SPLITO_EXPENSES',
  'SPLITO_EXPENSE_PAYERS',
  'SPLITO_EXPENSE_REVISIONS',
  'SPLITO_EXPENSE_SHARES',
  'SPLITO_GROUPS',
  'SPLITO_IDEMPOTENCY_KEYS',
  'SPLITO_LEDGER_BATCHES',
  'SPLITO_LEDGER_POSTINGS',
  'SPLITO_MEDIA_OBJECTS',
  'SPLITO_MIGRATION_LOCK',
  'SPLITO_MOBILE_OTP_CHALLENGES',
  'SPLITO_MOBILE_OTP_THROTTLES',
  'SPLITO_OUTBOX',
  'SPLITO_PARTICIPANTS',
  'SPLITO_SCHEMA_MIGRATIONS',
  'SPLITO_SESSIONS',
  'SPLITO_SETTLEMENTS',
  'SPLITO_USERS',
];

const oracledb = await loadOracleDb();
configureOracleMode(oracledb);
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.NUMBER];

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
  connection.callTimeout = 15_000;

  const tablesResult = await connection.execute(`SELECT TABLE_NAME FROM USER_TABLES`);
  const actualTables = new Set((tablesResult.rows ?? []).map((row) => row.TABLE_NAME));
  const missingTables = expectedTables.filter((table) => !actualTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
  }
  const badPrefix = [...actualTables].filter((table) => !table.startsWith('SPLITO_'));
  if (badPrefix.length > 0) {
    throw new Error(`Tables without SPLITO_ prefix: ${badPrefix.join(', ')}`);
  }

  const otpColumnResult = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
      FROM USER_TAB_COLUMNS
      WHERE (TABLE_NAME = 'SPLITO_USERS'
             AND COLUMN_NAME IN ('EMAIL_NORMALIZED', 'MOBILE_E164', 'MOBILE_VERIFIED_AT_UTC'))
         OR (TABLE_NAME = 'SPLITO_MOBILE_OTP_CHALLENGES'
             AND COLUMN_NAME IN ('OTP_HASH', 'TERMINAL_AT_UTC'))`,
  );
  const otpColumns = new Map(
    (otpColumnResult.rows ?? []).map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]),
  );
  for (const column of [
    'SPLITO_USERS.EMAIL_NORMALIZED',
    'SPLITO_USERS.MOBILE_E164',
    'SPLITO_USERS.MOBILE_VERIFIED_AT_UTC',
    'SPLITO_MOBILE_OTP_CHALLENGES.OTP_HASH',
    'SPLITO_MOBILE_OTP_CHALLENGES.TERMINAL_AT_UTC',
  ]) {
    if (!otpColumns.has(column)) throw new Error(`Missing mobile-auth column: ${column}`);
  }
  const otpHashColumn = otpColumns.get('SPLITO_MOBILE_OTP_CHALLENGES.OTP_HASH');
  if (otpHashColumn.DATA_TYPE !== 'RAW' || Number(otpHashColumn.DATA_LENGTH) !== 32) {
    throw new Error('Mobile OTP material must be stored only as a RAW(32) keyed hash');
  }
  if (
    otpColumns.get('SPLITO_USERS.EMAIL_NORMALIZED').NULLABLE !== 'Y' ||
    otpColumns.get('SPLITO_USERS.MOBILE_E164').NULLABLE !== 'Y'
  ) {
    throw new Error(
      'Email and mobile identities must each remain optional for legacy compatibility',
    );
  }

  const authIndexResult = await connection.execute(
    `SELECT INDEX_NAME, UNIQUENESS, STATUS
       FROM USER_INDEXES
      WHERE INDEX_NAME IN ('SPLITO_UQ_PENDING_MOBILE_OTP', 'SPLITO_UQ_ONE_USER_SESSION')`,
  );
  const authIndexes = new Map((authIndexResult.rows ?? []).map((row) => [row.INDEX_NAME, row]));
  for (const indexName of ['SPLITO_UQ_PENDING_MOBILE_OTP', 'SPLITO_UQ_ONE_USER_SESSION']) {
    const index = authIndexes.get(indexName);
    if (!index || index.UNIQUENESS !== 'UNIQUE' || index.STATUS !== 'VALID') {
      throw new Error(`Missing or invalid mobile-auth invariant index: ${indexName}`);
    }
  }

  const authConstraintResult = await connection.execute(
    `SELECT CONSTRAINT_NAME
       FROM USER_CONSTRAINTS
      WHERE CONSTRAINT_NAME IN (
        'SPLITO_CK_USERS_MOBILE_VERIFIED', 'SPLITO_CK_USERS_IDENTITY',
        'SPLITO_CK_MOBILE_OTP_TERMINAL', 'SPLITO_CK_MOBILE_OTP_TIME'
      )
        AND STATUS = 'ENABLED'
        AND VALIDATED = 'VALIDATED'`,
  );
  const authConstraints = new Set(
    (authConstraintResult.rows ?? []).map((row) => row.CONSTRAINT_NAME),
  );
  for (const constraintName of [
    'SPLITO_CK_USERS_MOBILE_VERIFIED',
    'SPLITO_CK_USERS_IDENTITY',
    'SPLITO_CK_MOBILE_OTP_TERMINAL',
    'SPLITO_CK_MOBILE_OTP_TIME',
  ]) {
    if (!authConstraints.has(constraintName)) {
      throw new Error(`Missing mobile-auth invariant constraint: ${constraintName}`);
    }
  }

  const invitationColumnResult = await connection.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, CHAR_LENGTH, NULLABLE
       FROM USER_TAB_COLUMNS
      WHERE TABLE_NAME = 'SPLITO_INVITATIONS'
        AND COLUMN_NAME IN ('TOKEN_HASH', 'INVITEE_MOBILE_E164')`,
  );
  const invitationColumns = new Map(
    (invitationColumnResult.rows ?? []).map((row) => [row.COLUMN_NAME, row]),
  );
  const invitationTokenHash = invitationColumns.get('TOKEN_HASH');
  if (
    !invitationTokenHash ||
    invitationTokenHash.DATA_TYPE !== 'RAW' ||
    Number(invitationTokenHash.DATA_LENGTH) !== 32
  ) {
    throw new Error('Group invitation tokens must be stored only as a RAW(32) hash');
  }
  const invitationMobile = invitationColumns.get('INVITEE_MOBILE_E164');
  if (
    !invitationMobile ||
    invitationMobile.DATA_TYPE !== 'VARCHAR2' ||
    Number(invitationMobile.CHAR_LENGTH) !== 16 ||
    invitationMobile.NULLABLE !== 'Y'
  ) {
    throw new Error('SPLITO_INVITATIONS.INVITEE_MOBILE_E164 must be VARCHAR2(16 CHAR) nullable');
  }

  const invitationIndexResult = await connection.execute(
    `SELECT INDEX_NAME, TABLE_NAME, UNIQUENESS, STATUS
       FROM USER_INDEXES
      WHERE INDEX_NAME IN ('SPLITO_IX_INVITE_MOBILE', 'SPLITO_UQ_PENDING_GRP_MOBILE')`,
  );
  const invitationIndexes = new Map(
    (invitationIndexResult.rows ?? []).map((row) => [row.INDEX_NAME, row]),
  );
  for (const expected of [
    { name: 'SPLITO_IX_INVITE_MOBILE', uniqueness: 'NONUNIQUE' },
    { name: 'SPLITO_UQ_PENDING_GRP_MOBILE', uniqueness: 'UNIQUE' },
  ]) {
    const index = invitationIndexes.get(expected.name);
    if (
      !index ||
      index.TABLE_NAME !== 'SPLITO_INVITATIONS' ||
      index.UNIQUENESS !== expected.uniqueness ||
      index.STATUS !== 'VALID'
    ) {
      throw new Error(`Missing or invalid group-invitation index: ${expected.name}`);
    }
  }

  const invitationConstraintResult = await connection.execute(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, STATUS, VALIDATED
       FROM USER_CONSTRAINTS
      WHERE TABLE_NAME = 'SPLITO_INVITATIONS'
        AND CONSTRAINT_NAME IN (
          'SPLITO_CK_INVITE_TARGET', 'SPLITO_CK_INVITE_MOBILE',
          'SPLITO_CK_INVITE_GROUP_CTX'
        )`,
  );
  const invitationConstraints = new Map(
    (invitationConstraintResult.rows ?? []).map((row) => [row.CONSTRAINT_NAME, row]),
  );
  for (const constraintName of [
    'SPLITO_CK_INVITE_TARGET',
    'SPLITO_CK_INVITE_MOBILE',
    'SPLITO_CK_INVITE_GROUP_CTX',
  ]) {
    const constraint = invitationConstraints.get(constraintName);
    if (
      !constraint ||
      constraint.CONSTRAINT_TYPE !== 'C' ||
      constraint.STATUS !== 'ENABLED' ||
      constraint.VALIDATED !== 'VALIDATED'
    ) {
      throw new Error(`Missing or invalid group-invitation constraint: ${constraintName}`);
    }
  }

  const mediaColumnResult = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_PRECISION, DATA_SCALE,
            CHAR_LENGTH, NULLABLE
       FROM USER_TAB_COLUMNS
      WHERE (TABLE_NAME = 'SPLITO_MEDIA_OBJECTS'
             AND COLUMN_NAME IN (
               'MEDIA_ID', 'MEDIA_KIND', 'OWNER_USER_ID', 'OWNER_GROUP_ID',
               'UPLOADED_BY_PARTICIPANT_ID', 'STORAGE_PROVIDER', 'STORAGE_KEY',
               'MEDIA_TYPE', 'BYTE_SIZE', 'SHA256_HASH', 'WIDTH_PX', 'HEIGHT_PX',
               'STATUS', 'CREATED_AT_UTC', 'SUPERSEDED_AT_UTC', 'DELETED_AT_UTC'
             ))
         OR (TABLE_NAME = 'SPLITO_USERS' AND COLUMN_NAME = 'AVATAR_KEY')
         OR (TABLE_NAME = 'SPLITO_GROUPS' AND COLUMN_NAME = 'IMAGE_KEY')`,
  );
  const mediaColumns = new Map(
    (mediaColumnResult.rows ?? []).map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]),
  );
  for (const column of [
    'SPLITO_MEDIA_OBJECTS.MEDIA_ID',
    'SPLITO_MEDIA_OBJECTS.MEDIA_KIND',
    'SPLITO_MEDIA_OBJECTS.OWNER_USER_ID',
    'SPLITO_MEDIA_OBJECTS.OWNER_GROUP_ID',
    'SPLITO_MEDIA_OBJECTS.UPLOADED_BY_PARTICIPANT_ID',
    'SPLITO_MEDIA_OBJECTS.STORAGE_PROVIDER',
    'SPLITO_MEDIA_OBJECTS.STORAGE_KEY',
    'SPLITO_MEDIA_OBJECTS.MEDIA_TYPE',
    'SPLITO_MEDIA_OBJECTS.BYTE_SIZE',
    'SPLITO_MEDIA_OBJECTS.SHA256_HASH',
    'SPLITO_MEDIA_OBJECTS.WIDTH_PX',
    'SPLITO_MEDIA_OBJECTS.HEIGHT_PX',
    'SPLITO_MEDIA_OBJECTS.STATUS',
    'SPLITO_MEDIA_OBJECTS.CREATED_AT_UTC',
    'SPLITO_MEDIA_OBJECTS.SUPERSEDED_AT_UTC',
    'SPLITO_MEDIA_OBJECTS.DELETED_AT_UTC',
    'SPLITO_USERS.AVATAR_KEY',
    'SPLITO_GROUPS.IMAGE_KEY',
  ]) {
    if (!mediaColumns.has(column)) throw new Error(`Missing image-media column: ${column}`);
  }
  for (const column of [
    'SPLITO_MEDIA_OBJECTS.MEDIA_ID',
    'SPLITO_MEDIA_OBJECTS.OWNER_USER_ID',
    'SPLITO_MEDIA_OBJECTS.OWNER_GROUP_ID',
    'SPLITO_MEDIA_OBJECTS.UPLOADED_BY_PARTICIPANT_ID',
  ]) {
    const definition = mediaColumns.get(column);
    if (definition.DATA_TYPE !== 'RAW' || Number(definition.DATA_LENGTH) !== 16) {
      throw new Error(`${column} must be RAW(16)`);
    }
  }
  const mediaHashColumn = mediaColumns.get('SPLITO_MEDIA_OBJECTS.SHA256_HASH');
  if (mediaHashColumn.DATA_TYPE !== 'RAW' || Number(mediaHashColumn.DATA_LENGTH) !== 32) {
    throw new Error('SPLITO_MEDIA_OBJECTS.SHA256_HASH must be RAW(32)');
  }
  for (const column of [
    'SPLITO_MEDIA_OBJECTS.STORAGE_KEY',
    'SPLITO_USERS.AVATAR_KEY',
    'SPLITO_GROUPS.IMAGE_KEY',
  ]) {
    const definition = mediaColumns.get(column);
    if (definition.DATA_TYPE !== 'VARCHAR2' || Number(definition.CHAR_LENGTH) !== 512) {
      throw new Error(`${column} must be VARCHAR2(512 CHAR)`);
    }
  }

  const mediaIndexResult = await connection.execute(
    `SELECT INDEX_NAME, TABLE_NAME, UNIQUENESS, STATUS
       FROM USER_INDEXES
      WHERE INDEX_NAME IN ('SPLITO_UQ_MEDIA_ACTIVE_USER', 'SPLITO_UQ_MEDIA_ACTIVE_GROUP')`,
  );
  const mediaIndexes = new Map((mediaIndexResult.rows ?? []).map((row) => [row.INDEX_NAME, row]));
  for (const indexName of ['SPLITO_UQ_MEDIA_ACTIVE_USER', 'SPLITO_UQ_MEDIA_ACTIVE_GROUP']) {
    const index = mediaIndexes.get(indexName);
    if (
      !index ||
      index.TABLE_NAME !== 'SPLITO_MEDIA_OBJECTS' ||
      index.UNIQUENESS !== 'UNIQUE' ||
      index.STATUS !== 'VALID'
    ) {
      throw new Error(`Missing or invalid current-image invariant index: ${indexName}`);
    }
  }

  const mediaConstraintResult = await connection.execute(
    `SELECT C.CONSTRAINT_NAME, C.TABLE_NAME, C.CONSTRAINT_TYPE, C.R_CONSTRAINT_NAME,
            C.STATUS, C.VALIDATED,
            LISTAGG(CC.COLUMN_NAME, ',') WITHIN GROUP (ORDER BY CC.POSITION) AS COLUMN_NAMES
       FROM USER_CONSTRAINTS C
       JOIN USER_CONS_COLUMNS CC ON CC.CONSTRAINT_NAME = C.CONSTRAINT_NAME
      WHERE C.CONSTRAINT_NAME IN (
        'SPLITO_FK_USER_AVATAR_MEDIA', 'SPLITO_FK_GROUP_IMAGE_MEDIA',
        'SPLITO_CK_MEDIA_OWNER', 'SPLITO_CK_MEDIA_TYPE', 'SPLITO_CK_MEDIA_SIZE',
        'SPLITO_CK_MEDIA_DIMENSIONS', 'SPLITO_CK_MEDIA_STORAGE_KEY',
        'SPLITO_CK_MEDIA_STATUS', 'SPLITO_CK_MEDIA_STATUS_DATES'
      )
      GROUP BY C.CONSTRAINT_NAME, C.TABLE_NAME, C.CONSTRAINT_TYPE, C.R_CONSTRAINT_NAME,
               C.STATUS, C.VALIDATED`,
  );
  const mediaConstraints = new Map(
    (mediaConstraintResult.rows ?? []).map((row) => [row.CONSTRAINT_NAME, row]),
  );
  const expectedPointerConstraints = [
    {
      name: 'SPLITO_FK_USER_AVATAR_MEDIA',
      table: 'SPLITO_USERS',
      columns: 'USER_ID,AVATAR_KEY',
      referenced: 'SPLITO_UQ_MEDIA_USER_KEY',
    },
    {
      name: 'SPLITO_FK_GROUP_IMAGE_MEDIA',
      table: 'SPLITO_GROUPS',
      columns: 'GROUP_ID,IMAGE_KEY',
      referenced: 'SPLITO_UQ_MEDIA_GROUP_KEY',
    },
  ];
  for (const expected of expectedPointerConstraints) {
    const constraint = mediaConstraints.get(expected.name);
    if (
      !constraint ||
      constraint.TABLE_NAME !== expected.table ||
      constraint.CONSTRAINT_TYPE !== 'R' ||
      constraint.R_CONSTRAINT_NAME !== expected.referenced ||
      constraint.COLUMN_NAMES !== expected.columns ||
      constraint.STATUS !== 'ENABLED' ||
      constraint.VALIDATED !== 'VALIDATED'
    ) {
      throw new Error(`Missing or invalid image pointer constraint: ${expected.name}`);
    }
  }
  for (const constraintName of [
    'SPLITO_CK_MEDIA_OWNER',
    'SPLITO_CK_MEDIA_TYPE',
    'SPLITO_CK_MEDIA_SIZE',
    'SPLITO_CK_MEDIA_DIMENSIONS',
    'SPLITO_CK_MEDIA_STORAGE_KEY',
    'SPLITO_CK_MEDIA_STATUS',
    'SPLITO_CK_MEDIA_STATUS_DATES',
  ]) {
    const constraint = mediaConstraints.get(constraintName);
    if (
      !constraint ||
      constraint.CONSTRAINT_TYPE !== 'C' ||
      constraint.STATUS !== 'ENABLED' ||
      constraint.VALIDATED !== 'VALIDATED'
    ) {
      throw new Error(`Missing image-media invariant constraint: ${constraintName}`);
    }
  }

  const mediaGrantResult = await connection.execute(
    `SELECT PRIVILEGE
       FROM USER_TAB_PRIVS_MADE
      WHERE GRANTEE = 'SPLITO_APP'
        AND TABLE_NAME = 'SPLITO_MEDIA_OBJECTS'`,
  );
  const mediaGrants = new Set((mediaGrantResult.rows ?? []).map((row) => row.PRIVILEGE));
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
    if (!mediaGrants.has(privilege)) {
      throw new Error(`SPLITO_APP is missing ${privilege} on SPLITO_MEDIA_OBJECTS`);
    }
  }
  if (mediaGrants.has('DELETE')) {
    throw new Error('SPLITO_APP must soft-delete media objects instead of deleting their rows');
  }

  const invalidResult = await connection.execute(
    `SELECT OBJECT_NAME, OBJECT_TYPE
       FROM USER_OBJECTS
      WHERE STATUS <> 'VALID'
      ORDER BY OBJECT_TYPE, OBJECT_NAME`,
  );
  if ((invalidResult.rows ?? []).length > 0) {
    throw new Error(`Invalid schema objects: ${JSON.stringify(invalidResult.rows)}`);
  }

  const constraintResult = await connection.execute(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, STATUS, VALIDATED
       FROM USER_CONSTRAINTS
      WHERE (STATUS <> 'ENABLED' OR VALIDATED <> 'VALIDATED')
        AND TABLE_NAME LIKE 'SPLITO\\_%' ESCAPE '\\'`,
  );
  if ((constraintResult.rows ?? []).length > 0) {
    throw new Error(
      `Disabled or unvalidated constraints: ${JSON.stringify(constraintResult.rows)}`,
    );
  }

  const immutableGrantResult = await connection.execute(
    `SELECT TABLE_NAME, PRIVILEGE
       FROM USER_TAB_PRIVS_MADE
      WHERE GRANTEE = 'SPLITO_APP'
        AND PRIVILEGE IN ('UPDATE', 'DELETE')
        AND TABLE_NAME IN (
          'SPLITO_EXPENSE_REVISIONS', 'SPLITO_EXPENSE_PAYERS', 'SPLITO_EXPENSE_SHARES',
          'SPLITO_EXPENSE_ITEMS', 'SPLITO_ITEM_ALLOCATIONS', 'SPLITO_LEDGER_BATCHES',
          'SPLITO_LEDGER_POSTINGS', 'SPLITO_EXPENSE_OBLIGATIONS',
          'SPLITO_SETTLEMENT_REVISIONS', 'SPLITO_REFUND_RECIPIENTS',
          'SPLITO_REFUND_SHARES', 'SPLITO_AUDIT_EVENTS'
        )
      ORDER BY TABLE_NAME, PRIVILEGE`,
  );
  if ((immutableGrantResult.rows ?? []).length > 0) {
    throw new Error(
      `Runtime mutation grants found on immutable tables: ${JSON.stringify(immutableGrantResult.rows)}`,
    );
  }

  const publicSynonymResult = await connection.execute(
    `SELECT SYNONYM_NAME, TABLE_NAME
       FROM ALL_SYNONYMS
      WHERE OWNER = 'PUBLIC'
        AND TABLE_OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
        AND TABLE_NAME LIKE 'SPLITO\\_%' ESCAPE '\\'
      ORDER BY SYNONYM_NAME`,
  );
  if ((publicSynonymResult.rows ?? []).length > 0) {
    throw new Error(
      `Public synonyms found for SPLITO tables: ${JSON.stringify(publicSynonymResult.rows)}`,
    );
  }

  const moneyResult = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, DATA_PRECISION, DATA_SCALE
       FROM USER_TAB_COLUMNS
      WHERE TABLE_NAME LIKE 'SPLITO\\_%' ESCAPE '\\'
        AND (
          COLUMN_NAME LIKE '%\\_MINOR' ESCAPE '\\' OR
          COLUMN_NAME LIKE '%\\_MINOR\\_SIGNED' ESCAPE '\\'
        )
        AND (DATA_TYPE <> 'NUMBER' OR DATA_PRECISION <> 19 OR DATA_SCALE <> 0)`,
  );
  if ((moneyResult.rows ?? []).length > 0) {
    throw new Error(`Money columns not declared NUMBER(19,0): ${JSON.stringify(moneyResult.rows)}`);
  }

  const migrationResult = await connection.execute(
    `SELECT VERSION_NO, SCRIPT_NAME, CHECKSUM_SHA256
       FROM SPLITO_SCHEMA_MIGRATIONS
      WHERE SUCCESS_FLAG <> 'Y'
      ORDER BY VERSION_NO`,
  );
  if ((migrationResult.rows ?? []).length > 0) {
    throw new Error(`Failed/incomplete migrations: ${JSON.stringify(migrationResult.rows)}`);
  }

  const unbalancedResult = await connection.execute(
    `SELECT batch.BATCH_ID, SUM(posting.AMOUNT_MINOR_SIGNED) AS TOTAL_MINOR
       FROM SPLITO_LEDGER_BATCHES batch
       JOIN SPLITO_LEDGER_POSTINGS posting ON posting.BATCH_ID = batch.BATCH_ID
      GROUP BY batch.BATCH_ID
     HAVING SUM(posting.AMOUNT_MINOR_SIGNED) <> 0`,
  );
  if ((unbalancedResult.rows ?? []).length > 0) {
    throw new Error(`Unbalanced ledger batches: ${JSON.stringify(unbalancedResult.rows)}`);
  }

  process.stdout.write(
    `Schema validation passed (${actualTables.size} prefixed tables, ${expectedTables.length} critical tables checked).\n`,
  );
} finally {
  if (connection) await connection.close();
}
