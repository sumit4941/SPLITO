# Windows local setup

These steps use PowerShell and the installed Oracle `FREEPDB1` service. `FREE`
is the container root and is intentionally rejected by the database scripts.
Run commands from the repository root.

## Prerequisites

- Node.js 24 LTS and the npm version recorded in `package.json`.
- Oracle AI Database 26ai with the listener running and `FREEPDB1` open
  read/write.
- A database administrator account that can create local users in `FREEPDB1`.

Check the listener before changing the database:

```powershell
node --version
npm --version
Test-NetConnection localhost -Port 1521
npm ci
```

Copy `.env.example` to the ignored `.env` for Compose. Direct Node database
scripts read the current process environment; they do not parse `.env`.

```powershell
Copy-Item .env.example .env
```

## Create the dedicated users

Generate distinct owner and runtime passwords in a password manager. To avoid
placing values in command history, read each one as a secure string and expose
the plaintext only to this PowerShell process:

```powershell
$adminSecret = Read-Host 'Oracle administrator password' -AsSecureString
$ownerSecret = Read-Host 'New SPLITO_OWNER password' -AsSecureString
$runtimeSecret = Read-Host 'New SPLITO_APP password' -AsSecureString

$env:SPLITO_ADMIN_DB_CONNECT_STRING = 'localhost:1521/FREEPDB1'
$env:SPLITO_ADMIN_DB_USER = 'SYSTEM'
$env:SPLITO_ADMIN_DB_PASSWORD = [Net.NetworkCredential]::new('', $adminSecret).Password
$env:SPLITO_MIGRATION_DB_USER = 'SPLITO_OWNER'
$env:SPLITO_MIGRATION_DB_PASSWORD = [Net.NetworkCredential]::new('', $ownerSecret).Password
$env:SPLITO_DB_USER = 'SPLITO_APP'
$env:SPLITO_DB_PASSWORD = [Net.NetworkCredential]::new('', $runtimeSecret).Password
node database/admin/bootstrap-users.mjs
Remove-Item Env:SPLITO_ADMIN_DB_PASSWORD
```

The bootstrap grants `CREATE SESSION` and `CREATE TABLE` only to `SPLITO_OWNER`,
and `CREATE SESSION` only to `SPLITO_APP`. It removes obsolete view,
procedure, trigger, and sequence creation grants from an explicitly repaired
owner. It does not grant `DBMS_LOCK`, create public synonyms, or give the runtime
account table-creation privileges.

If either fixed user already exists, the script stops. Use
`SPLITO_REPAIR_EXISTING_USERS=true` only after confirming this is a known partial
SPLITO bootstrap. The repair path rejects an owner with non-`SPLITO_` tables and
rejects any runtime-owned table, unexpected system privilege, or assigned role;
it restores the narrow grants and quotas but never changes an existing password.

## Migrate and verify

```powershell
$env:SPLITO_MIGRATION_DB_CONNECT_STRING = 'localhost:1521/FREEPDB1'
node database/scripts/migrate.mjs
node database/scripts/check-prefix.mjs
node database/scripts/validate-schema.mjs

$env:DATABASE_CONNECT_STRING = 'localhost:1521/FREEPDB1'
$env:DATABASE_USER = 'SPLITO_APP'
$env:DATABASE_OWNER_SCHEMA = 'SPLITO_OWNER'
$env:DATABASE_PASSWORD = [Net.NetworkCredential]::new('', $runtimeSecret).Password
node database/scripts/verify-connection.mjs
```

The runtime connection validates `DATABASE_OWNER_SCHEMA` and issues
`ALTER SESSION SET CURRENT_SCHEMA=SPLITO_OWNER`; grants alone do not make owner
tables resolve as unqualified names. API and worker use node-oracledb Thin mode;
`SPLITO_ORACLE_MODE` applies only to the database CLI scripts.

For synthetic demo data only:

```powershell
$env:NODE_ENV = 'development'
$env:SPLITO_ALLOW_DEVELOPMENT_SEED = 'true'
node database/seed/development.mjs
node database/scripts/reconcile.mjs
```

The seed assigns the reserved fictional numbers `+12025550101`,
`+12025550102`, and `+12025550103` to Alice, Bob, and Casey respectively. Never
enable the seed flag against a shared, staging, or production database. Start
the services with `npm run dev` after adding the remaining application secrets,
including an independent `OTP_PEPPER`, described by `.env.example`.

Open `/login`, request a code for a demo number, and use the `developmentOtp`
returned by the local-development API. Production never returns the code and
currently rejects OTP requests with `503` until an SMS adapter is configured.
Do not switch a deployed environment to development mode to bypass that guard.

## Browser tests

The reproducible default is Playwright's managed Chromium revision:

```powershell
npx playwright install chromium
npm run test:e2e
```

If the Playwright browser CDN is temporarily unavailable, a trusted installed
Chromium-compatible browser can be used for a local fallback:

```powershell
$env:PLAYWRIGHT_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_EXECUTABLE_PATH
```

Confirm the path on the machine and record the browser version with the test
evidence. This fallback does not replace the managed browser run in CI.

Clear secret-bearing environment variables and dispose secure-string variables
when finished:

```powershell
Remove-Item Env:SPLITO_MIGRATION_DB_PASSWORD, Env:SPLITO_DB_PASSWORD, Env:DATABASE_PASSWORD -ErrorAction SilentlyContinue
$adminSecret = $ownerSecret = $runtimeSecret = $null
```
