# SPLITO MongoDB database

SPLITO uses MongoDB as its authoritative store. Financial workflows span
multiple collections, so every environment must use a replica set or sharded
cluster with transaction support. MongoDB Atlas satisfies this requirement; a
standalone local `mongod` does not.

## Layout

- `schema.mjs` is the canonical definition of the 24 application collections,
  JSON Schema validators, managed indexes, and reference currencies.
- `scripts/migrate.mjs` creates missing collections and indexes, loads immutable
  currency reference data, and records a checksum in `schemaMigrations`.
- `scripts/validate-schema.mjs` checks required collections, validators, index
  definitions, and the applied schema version.
- `scripts/verify-connection.mjs` performs a safe ping and reports topology
  metadata without printing the connection string.
- `seed/development.mjs` loads deterministic synthetic users, a group, one
  balanced expense, and projections for local development only.
- `scripts/reconcile.mjs` compares balance projections with the embedded ledger
  postings and can rebuild them transactionally.

## First-time setup

1. Create a production API database user backed by a custom role. Grant
   `find`/`insert` only on immutable revisions, ledger batches, idempotency
   receipts, and audit events; grant only the required read/write actions on
   mutable identity, group, expense head, projection, invitation, media,
   idempotency-slot, and outbox collections. Also allow it to read
   `schemaMigrations` and `currencies`, and grant the read-only `listCollections`
   and `listIndexes` metadata actions used by startup drift verification.
2. Create a separate worker database user that can read the schema marker and
   `find`/`update` only `outbox`, plus `listCollections`/`listIndexes` metadata
   actions for that collection. The built-in `readWrite` role is a local
   development convenience and cannot enforce immutable provenance.
3. Create a separately injected migration user with `readWrite` plus `dbAdmin`
   on only that database, or an equivalent custom role that includes collection
   creation, index creation, and `collMod`. Collection validators require the
   additional migration privilege.
4. Add the API/worker host to the Atlas project IP access list, or configure a
   private endpoint. The browser and Vercel static web project never connect to
   MongoDB directly.
5. Inject the migration credential as `MONGODB_URI`, run `npm run db:migrate`,
   `npm run db:verify`, and `npm run db:status`, then discard it from the job.
   Reserved characters in URI credentials must be percent-encoded.
6. Start API and worker processes with their distinct runtime `MONGODB_URI`
   values and the same `MONGODB_DATABASE`.
7. For development only, set `NODE_ENV=development` and
   `SPLITO_ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed`.

Never commit a real URI or password. If a credential appears in chat, logs, a
ticket, or source control, rotate it before deployment.
