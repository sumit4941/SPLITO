# Troubleshooting

## Oracle connection resolves to CDB$ROOT

Symptom: bootstrap/migration refuses the connection, or Oracle requests a common
`C##` user. Cause: the connect string uses service `FREE`. Change it to
`localhost:1521/FREEPDB1`; do not weaken the guard.

## ORA-01017 / ORA-28000

Confirm the secret source, user casing, PDB service, account lock/expiry, and
rotation timestamp. Do not print the password. Runtime uses `SPLITO_APP`; the
owner and DBA credentials must not be substituted to make an outage disappear.

## ORA-00942 from the runtime user

Confirm migrations completed, the object grant exists, and each new pool session
ran validated `ALTER SESSION SET CURRENT_SCHEMA = SPLITO_OWNER`. Do not solve
this with public synonyms or broad catalog/schema privileges.

## NJS/DPI client errors

API and worker support Thin mode and need no Oracle Client. If a database CLI is
explicitly run with `SPLITO_ORACLE_MODE=thick`, confirm 64-bit client/Node
architecture, supported Client 19+, Windows library directory, and process
restart. Return the CLI to Thin mode if the maintenance task does not require
Thick mode.

## Pool queue timeout or slow readiness

Check leaked connections, long transactions, database waits, replica count ×
pool max, and probe rate. Every checkout must close in `finally`. Do not simply
raise pool max without the DBA session budget and load evidence.

## Failed migration row

Stop and follow `migrations.md`. Oracle may have committed earlier DDL. Do not
delete the history row, edit the applied file, or promise rollback.

## Mobile OTP request returns 503

This is the intentional production behavior until a real SMS adapter is
configured. Do not report the OTP as sent, expose `developmentOtp`, or switch
production to development mode. Activate an adapter through the provider gate,
including credentials, E.164 regional support, timeout/failure behavior,
monitoring, privacy review, and acceptance tests.

## Mobile OTP is rejected or rate limited

A challenge expires after five minutes, is single-use, permits five failed
attempts, and has a 60-second resend interval. Requests are also throttled by
keyed phone and IP hashes. Start a new challenge after the allowed interval;
do not edit challenge/throttle rows or weaken limits to unblock one user. For a
development-only run, confirm `NODE_ENV=development` and a distinct
`OTP_PEPPER`, then use only the returned `developmentOtp`.

## Outbox rows remain PENDING/RETRY

Check worker health, oldest available age, leases, attempts, `LAST_ERROR`, and
provider health. Reclaim only expired leases. Preserve the same provider
idempotency/deduplication key. Move exhausted work to `DEAD`, alert, and use a
reviewed replay tool; never reset all rows blindly.

## Balance mismatch

Disable affected financial writes, identify unbalanced/missing batches, and run
reconciliation in report-only mode. Preserve journal history. Rebuild projection
tables from a consistent journal snapshot through the reviewed command; do not
hand-edit a participant balance.

## SQLcl fails with a Java class error

The inspected SQLcl installation currently fails during startup. SQL*Plus and
node-oracledb remain available, so SQLcl is not a prerequisite. Repair/reinstall
SQLcl and its bundled Java dependencies separately rather than changing the
Oracle database installation.
