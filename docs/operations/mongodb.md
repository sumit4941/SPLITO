# MongoDB Atlas setup and operations

SPLITO's API and worker use the official Node.js MongoDB driver. MongoDB is not
accessed from the browser or from the Vercel static-web build.

## Required connection details

Configure the runtime URI on the backend API and worker hosts:

```text
MONGODB_URI=mongodb+srv://<db-user>:<percent-encoded-password>@<cluster-host>/?retryWrites=true&w=majority&appName=Splito
MONGODB_DATABASE=splito
```

The URI is a secret. Do not add it to Vercel's frontend project, logs, source
control, screenshots, or support tickets. If it has been disclosed, rotate the
database user's password before using it. Characters such as `@`, `#`, `/`, `?`,
`:`, and `%` in a URI username or password must be percent-encoded.

Optional bounded client settings are:

```text
MONGODB_MIN_POOL_SIZE=1
MONGODB_MAX_POOL_SIZE=10
MONGODB_CONNECT_TIMEOUT_MS=10000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
MONGODB_SOCKET_TIMEOUT_MS=30000
```

## Atlas prerequisites

1. Create an API database user backed by a collection-scoped custom role. Grant
   `find`/`insert` only for immutable expense/settlement revisions, ledger
   batches, idempotency receipts, and audit events; grant only the actions the
   API needs on mutable heads, projections, identity, groups, invitations,
   media, idempotency slots, and outbox. Allow reads of `schemaMigrations` and
   `currencies` for readiness, plus the read-only `listCollections` and
   `listIndexes` metadata actions required for startup schema-drift checks.
2. Create a different worker database user that can read `schemaMigrations` and
   `find`/`update` only `outbox`, plus `listCollections` and `listIndexes` for
   its startup drift check. Do not share the API credential with it.
3. Create a separate migration database user with `readWrite` plus `dbAdmin` on
   only that database, or an equivalent Atlas custom role granting data access,
   collection/index creation, and `collMod`. Validator installation needs
   `collMod`; never give the broader migration identity to the running API or
   worker.
4. Add the backend and worker egress addresses to the Atlas project IP access
   list. Prefer a `/32`, private endpoint, or peering over `0.0.0.0/0`.
5. Use an Atlas replica set or sharded cluster. SPLITO relies on multi-document
   transactions for login/account creation, expenses, journals, projections,
   settlements, invitations, audit events, and outbox writes.
6. Keep TLS certificate validation enabled. `mongodb+srv://` Atlas connections
   use TLS; do not add options that disable certificate or hostname validation.
7. Place the backend near the Atlas cluster and keep the total pool budget below
   the deployment's connection limit.

The built-in `readWrite` role is convenient for local development but permits
updates and deletes on immutable collections. It is not the production API or
worker role described above.

## Initial schema

Inject the migration user's URI only into a trusted deployment job or one-off
backend container, then run:

```bash
npm run db:migrate
npm run db:verify
npm run db:status
```

The setup is idempotent. It creates 24 application collections, their partial,
unique, compound, and TTL indexes, and six currency documents. TTL deletion is
asynchronous, so application queries still enforce expiry themselves.

After `db:status` succeeds, remove the migration credential and start services
with the separate runtime URI.

MongoDB does not provide relational foreign keys. SPLITO therefore validates
cross-collection ownership and membership inside the same transaction, while
unique indexes enforce identities, one active session, active memberships,
pending OTPs/invitations, projections, and idempotency scopes. Transactional
owner references identify the current profile and group media objects.

## Monitoring

Monitor server-selection failures, connection-pool wait time, transaction
retries/aborts, replication lag, page faults, slow queries, index usage, TTL
backlog, outbox lease age, and dead-letter growth. Readiness performs a database
ping; liveness remains independent of MongoDB.

## References

- [Connect to an Atlas deployment](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)
- [Atlas IP access lists](https://www.mongodb.com/docs/atlas/security/ip-access-list/)
- [Connection string options](https://www.mongodb.com/docs/manual/reference/connection-string-options/)
- [Node.js driver transactions](https://www.mongodb.com/docs/drivers/node/current/fundamentals/transactions/)
- [MongoDB built-in database roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/)
- [Atlas custom database roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/)
