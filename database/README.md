# SPLITO Oracle database

SPLITO uses Oracle as its only authoritative relational store. The local Oracle
26ai installation exposes both `FREE` (the container database root) and
`FREEPDB1` (the writable pluggable database). Application schemas belong in
`FREEPDB1`; do not point the app or migration runner at `FREE`.

All application-owned tables are deliberately named with the `SPLITO_` prefix.
The prefix check in `scripts/check-prefix.mjs` fails when a table in the
dedicated owner schema violates that rule.

## Layout

- `admin/bootstrap-users.mjs` creates the dedicated owner/migration and runtime
  users. It is the only script that needs a database administrator credential.
- `migrations/` contains immutable, ordered, forward-only migrations.
- V005 keeps profile/group image bytes in private storage while Oracle enforces
  owner-bound metadata, current-image uniqueness, and validated user/group
  storage-key pointers in `SPLITO_MEDIA_OBJECTS`.
- `scripts/migrate.mjs` checks SHA-256 checksums and atomically claims/renews a
  durable owner-token lease in `SPLITO_MIGRATION_LOCK` before executing DDL.
- `scripts/verify-connection.mjs` verifies the server, PDB, driver mode, and
  important compatibility settings without changing the database.
- `seed/development.sql` is synthetic development data and is never run by the
  migration runner.

## First-time setup

1. Copy `.env.example` to an ignored `.env` and generate new passwords. Never
   use the administrator password as an application password.
2. Set `SPLITO_ADMIN_DB_CONNECT_STRING=localhost:1521/FREEPDB1`, the temporary
   admin variables, owner variables, and bootstrap runtime-user variables.
3. Run `npm run db:bootstrap` once, then remove the admin password from both
   `.env` and the process environment.
4. Run `npm run db:migrate` with the owner credentials.
5. Configure the application-facing `DATABASE_*` variables, including
   `DATABASE_OWNER_SCHEMA=SPLITO_OWNER`. Run `npm run db:check-prefix` and
   `npm run db:status` with owner credentials, then `npm run db:verify` with
   runtime credentials.
6. For development only, set `NODE_ENV=development` and
   `SPLITO_ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed`. The raw SQL
   is an internal deterministic fixture and must not be executed directly,
   because the wrapper adds runnable Argon2id credentials before committing.

The demo accounts are `alice@splito.example`, `bob@splito.example`, and
`casey@splito.example`. Their default development-only password is
`SplitoDemo!2026` unless `SPLITO_DEMO_PASSWORD` is set. The guarded seeder hashes
it independently with Argon2id; no plaintext or fake hash is stored in Oracle.

The Node scripts dynamically import the official `oracledb` package from the
workspace. Thin mode is the default and needs no Oracle Client installation.
See `docs/operations/oracle.md` and `docs/operations/migrations.md` for Windows,
TLS, least-privilege, backup, and failed-migration procedures.
