# MongoDB schema changes

`npm run db:migrate` applies SPLITO's MongoDB collection and index manifest and
records its SHA-256 checksum in `schemaMigrations`. Re-running the same version
is an idempotent no-op after indexes have been confirmed.

Run it with a separately injected database-scoped migration user holding
`readWrite` plus `dbAdmin`, or an equivalent custom role with collection/index
creation and `collMod`. Production API and worker processes use separate custom
roles; built-in `readWrite` cannot enforce immutable journal/provenance data.

The current baseline creates 24 application collections. Expense revisions
embed payers, shares, and obligations; ledger batches embed their postings.
This keeps each immutable financial unit together while balance and bilateral
projections remain independent, rebuildable collections.

## Change policy

- Never edit a schema definition already applied to a shared environment.
- Add a forward version for new collections, indexes, validators, or backfills.
- Build new indexes before switching query paths and inspect their resource cost
  on production-shaped data.
- Use expand/migrate/contract for field renames: tolerate both shapes, backfill,
  switch writers/readers, then remove the old field in a later release.
- Run data backfills in bounded, resumable batches with explicit progress and
  idempotency.
- Do not assume collection/index operations and data changes share one atomic
  transaction.

Before deployment, run:

```bash
npm run db:migrate
npm run db:migrate
npm run db:status
npm run db:reconcile
```

The second migration run proves idempotency. Test changes on a fresh replica set
and on a copy of production-shaped data. Back up the target and record the
cluster, database, release commit, schema version, and restore point before any
destructive or long-running change.

If a migration fails, stop rollout, retain its logs without credentials, inspect
the actual collections and indexes, and add a forward repair. Do not silently
drop a uniqueness constraint or bypass a checksum to force deployment.
