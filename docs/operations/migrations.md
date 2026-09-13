# Migration runbook

Migrations are immutable `database/migrations/VNNN__description.sql` files.
`database/scripts/migrate.mjs` stores SHA-256, actor, duration, and outcome in
`SPLITO_SCHEMA_MIGRATIONS`.

The current V001-V005 set defines 55 prefixed tables. V004 adds mobile OTP
challenge/throttle tables, optional mobile identity columns, and the unique
one-unrevoked-session index. V005 adds ownership-aware profile/group image
metadata, validates the existing user/group image pointers with composite
foreign keys, and permits only one active image per owner. As with every Oracle
DDL migration, that count is a repository definition until the target
environment's migration history and schema validators record successful
application.

Local evidence recorded on 2026-09-12 shows V001-V005 applied to the inspected
`FREEPDB1` schema, followed by an idempotent no-op rerun. Prefix and schema
validation observed 55 `SPLITO_` tables and accepted all 23 critical tables,
including the image-pointer foreign keys and current-image unique indexes. This
local result does not replace migration and validation evidence for each
deployed environment.

## Locking and ordering

The runner connects as `SPLITO_OWNER` to `FREEPDB1`, creates its two prefixed
infrastructure tables if absent, and atomically claims the single
`SPLITO_MIGRATION_LOCK` row with a random 128-bit owner token and bounded lease.
Singleton-row initialization safely tolerates two first-ever runners racing. The
runner commits its claim so Oracle's implicit DDL commits cannot release it,
renews before every statement, and releases only when the token still matches. A
crashed runner can be replaced only after lease expiry. The lease must exceed
the configured per-call timeout by more than 60 seconds, limiting stale takeover
while a timed statement is still active.

Never run two different migration mechanisms against the same schema. The runner
sorts numeric versions, rejects duplicate versions, verifies old checksums, and
refuses to continue past an unsuccessful history row.

## Release procedure

1. Review DDL, expected locks, space, backfill cost, and compatibility on a
   production-sized clone.
2. Confirm a recent validated backup and named restore owner. Record the restore
   point/SCN where policy supports it.
3. Stop or drain writers if the migration cannot be safely online. Workers must
   also be paused for incompatible changes.
4. Inject only the migration credential and connect string; verify it resolves
   to the intended PDB/schema.
5. Run `node database/scripts/migrate.mjs` once.
6. Run prefix/schema validation, application smoke tests, and report-only
   `node database/scripts/reconcile.mjs`.
7. Deploy compatible application processes, restore workers, and monitor errors,
   locks, query latency, and outbox age.

Schema changes follow expand/migrate/contract across releases when rolling
deployment compatibility is required. Do not drop/rename a live column in the
same release that changes all consumers.

## Oracle DDL failure and forward recovery

Oracle commits before and after DDL. A migration containing several statements
can therefore fail after earlier statements are durable. The runner records the
version as unsuccessful and stops; it never advertises transactional rollback of
schema DDL.

On failure:

1. Stop new deployments and preserve logs/error text without secrets.
2. Compare `USER_OBJECTS`, `USER_TAB_COLUMNS`, constraints, and the migration
   script to identify exactly which statements committed.
3. Decide with the DBA whether to restore the pre-migration backup or write and
   review an explicit forward-repair script. Never delete the history row merely
   to force a retry.
4. After repair makes the intended schema exact, update the failed history row
   only through a peer-reviewed DBA change, including evidence/checksum, or
   restore and rerun from a clean pre-migration state.
5. Execute schema validation and financial reconciliation before reopening.

Applied migration files are never edited. Correct an applied design with a new
higher version. DDL destructive to data requires an export/backup, explicit
retention approval, and a rehearsed recovery path.
