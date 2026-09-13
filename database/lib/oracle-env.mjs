const identifierPattern = /^[A-Z][A-Z0-9_$#]{0,127}$/u;

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function positiveIntegerEnv(name, fallback, { min = 1, max = 2_147_483_647 } = {}) {
  const raw = optionalEnv(name, String(fallback));
  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function oracleIdentifier(name, value) {
  const normalized = value.trim().toUpperCase();
  if (!identifierPattern.test(normalized)) {
    throw new Error(`${name} is not a safe Oracle identifier`);
  }
  return normalized;
}

export function assertPdbConnectString(name, connectString) {
  const normalized = connectString.toUpperCase();
  if (/(^|[/:])FREE(?:\?|$)/u.test(normalized) && !normalized.includes('FREEPDB1')) {
    throw new Error(
      `${name} points to the FREE CDB root. Use the FREEPDB1 service for SPLITO schemas.`,
    );
  }
  return connectString;
}

export async function loadOracleDb() {
  try {
    const module = await import('oracledb');
    return module.default ?? module;
  } catch (error) {
    throw new Error(
      'The official oracledb package is not installed. Install workspace dependencies first.',
      { cause: error },
    );
  }
}

export function configureOracleMode(oracledb) {
  const mode = optionalEnv('SPLITO_ORACLE_MODE', 'thin').toLowerCase();
  if (mode === 'thin') return;
  if (mode !== 'thick') {
    throw new Error('SPLITO_ORACLE_MODE must be either thin or thick');
  }
  const libDir =
    process.platform === 'win32' ? process.env.SPLITO_ORACLE_CLIENT_LIB_DIR : undefined;
  oracledb.initOracleClient(libDir ? { libDir } : undefined);
}

export async function closeQuietly(resource) {
  if (!resource) return;
  try {
    await resource.close();
  } catch {
    // Preserve the original error path. Callers should log cleanup failures separately.
  }
}
