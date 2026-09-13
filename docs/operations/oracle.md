# Oracle 26ai setup and operations

## Inspected local environment

Read-only inspection on 2026-09-12 found:

| Item         | Observed value                                          | Decision                                                                |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Database     | Oracle AI Database 26ai Free `23.26.0.0.0`              | Supported production database family                                    |
| `COMPATIBLE` | `23.6.0`                                                | Native JSON is available, but baseline uses validated CLOB JSON         |
| CDB service  | `FREE`                                                  | Do not use for SPLITO application users                                 |
| PDB service  | `FREEPDB1`, open read/write                             | Use `localhost:1521/FREEPDB1`                                           |
| Listener     | TCP 1521, running                                       | Development connectivity available                                      |
| Driver mode  | node-oracledb Thin by default                           | No Oracle Client dependency                                             |
| SQL*Plus     | Available                                               | Suitable for DBA inspection and seed loading                            |
| SQLcl        | Present but failed to start due to a missing Java class | Not required; repair separately if desired                              |
| Node.js      | `24.13.0` installed                                     | Supported Node 24 LTS line; update to selected 24.21.0 patch for parity |

The earlier V001-V003 migration and synthetic-seed run is retained as historical
evidence: it reported 52 prefixed tables, valid checked
constraints/objects/history, and no unbalanced journal batch. On 2026-09-12,
V004 added `SPLITO_MOBILE_OTP_CHALLENGES` and
`SPLITO_MOBILE_OTP_THROTTLES`; V005 then added `SPLITO_MEDIA_OBJECTS` and its
ownership/current-image invariants, and an idempotent rerun reported every
migration applied. Prefix/schema validation observed 55 `SPLITO_` tables,
including all 23 critical tables. The repeated report-only reconciliation found
three expected and three actual participant projections with zero differences.
This is development connectivity evidence, not production backup/load evidence.
The worker's local Oracle integration suite also passed two lease cases:
expired-lease recovery and concurrent `SKIP LOCKED` row isolation.

Oracle Free creates `FREE` as the container database and automatically opens
`FREEPDB1`. A local OS-authenticated `sqlplus / as sysdba` session starts in
`CDB$ROOT`; explicitly switch to `FREEPDB1` for local DBA work. Remote app
connections should select the PDB in their connect string instead.

## Accounts and least privilege

- `SYSTEM` or another delegated DBA is used only by the one-time bootstrap. It
  is never a runtime or migration account.
- `SPLITO_OWNER` owns schema objects and has only `CREATE SESSION` plus
  `CREATE TABLE`; table ownership supplies the index/alter/object-grant rights
  used by current migrations. Migration exclusion uses its own prefixed lease
  table and needs no SYS package grant. Keep its secret out of API and worker
  deployments.
- `SPLITO_APP` has `CREATE SESSION` and migration-issued privileges on required
  objects. It has no DDL privilege, quota, or mutation privileges on immutable
  financial history.

Use a secret manager or a temporary process environment to provide the bootstrap
variables in `.env.example`. Run:

```powershell
node database/admin/bootstrap-users.mjs
node database/scripts/migrate.mjs
node database/scripts/check-prefix.mjs
node database/scripts/validate-schema.mjs
node database/scripts/reconcile.mjs
```

The bootstrap refuses CDB root, never rotates an existing password, and validates
all interpolated identifiers/quota. If either fixed user already exists it stops
unless an operator explicitly sets `SPLITO_REPAIR_EXISTING_USERS=true`; repair
also refuses an owner with non-`SPLITO_` tables or a runtime user that owns any
table, and refuses unexpected system privileges or roles. With that inspected
opt-in it resumes a partial bootstrap, removes obsolete create privileges, and
reapplies the narrow grants/quotas. Because Oracle DDL auto-commits, inspect its
output rather than assuming rollback removed a partially created user.

The supplied administrator password was intentionally not copied into any file.
Because it was shared in task context, rotate it before exposing the listener or
using the database beyond local development.

## Runtime pool contract

Create one bounded homogeneous pool per API/worker process. Defaults are min 1,
max 8, increment 1, queue timeout 5 seconds, and call timeout 15 seconds. Size
`poolMax × process replicas` below the PDB session budget and reserve connections
for migrations/operations. Fail fast when the queue is full rather than allowing
unbounded memory growth.

Every newly created pooled session must execute a callback equivalent to:

```sql
ALTER SESSION SET CURRENT_SCHEMA = SPLITO_OWNER
```

`DATABASE_OWNER_SCHEMA` must first match the deployment-only uppercase Oracle
identifier allowlist. Never accept it from a request and never create public
synonyms. Set `connection.callTimeout` before application queries. Every checkout
uses `try/catch/finally`, explicitly commits or rolls back, and closes the
connection in `finally`.

Set `oracledb.fetchAsString = [oracledb.NUMBER]` globally or use per-column fetch
type handlers. Validate the decimal string before constructing `BigInt`. Bind
all request data; SQL identifiers come only from static code or the validated
owner schema. Use `fetchArraySize`/`prefetchRows` appropriate to bounded pages,
never unbounded result sets.

Thin mode supports direct connections to Oracle 12.1 and later and is compatible
with this 26ai database. API and worker intentionally support Thin mode only
because no verified Thick-only requirement exists. `SPLITO_ORACLE_MODE` controls
the database CLI scripts; set it to `thick` only for a documented maintenance
task and, on Windows, also set the 64-bit client library directory. All
connections in a process use the same mode.

References:

- [node-oracledb installation and database support](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html)
- [node-oracledb pool and call timeouts](https://node-oracledb.readthedocs.io/en/latest/user_guide/connection_handling.html)
- [Oracle Free Windows startup and FREEPDB1](https://docs.oracle.com/en/database/oracle/oracle-database/26/xeinw/starting-and-stopping-oracle-database-xe.html)

## TLS and database controls

Development loopback TCP is acceptable only on the developer machine. Production
uses TCPS with hostname validation and a wallet/trust configuration appropriate
to the chosen Oracle hosting model. Restrict listener/firewall ingress to
application networks. Do not set permissive certificate matching.

Configure database encryption and encrypted backups with the DBA according to
edition/licensing and hosting capabilities. Set profile limits for failed logins,
idle time, and resource use without breaking pool behavior. Enable database
auditing for account/privilege changes and combine it with application audit
events. Runtime is not granted catalog-wide read access.

## Health and maintenance

Liveness proves the process event loop responds and must not depend on Oracle.
Readiness checks a short pool acquisition and `SELECT 1 FROM DUAL` with a tight
timeout, but must be rate-limited/cached to avoid probe storms. Report only a
generic unavailable state publicly.

Monitor active/queued pool connections, queue rejections, Oracle wait classes,
slow-query fingerprints without bind values, outbox age/dead rows, tablespace
growth, failed logins, backup age, and invalid schema objects. Revalidate query
plans and pool limits against the performance workload after schema/data growth.

`reconcile.mjs` is report-only by default and exits non-zero on a mismatch. An
explicit maintenance rebuild sets `SPLITO_RECONCILE_REBUILD=true`; it locks the
journal/projection tables, refuses empty or unbalanced batches, replaces net
projections atomically, verifies them against the journal, and rolls back on any
difference. Drain financial writers first and capture its report.
