# Troubleshooting

## MongoDB authentication fails

Confirm that `MONGODB_URI` contains a current database-user credential, not an
Atlas website account. Percent-encode reserved characters in URI credentials,
verify the API or worker custom role has its documented collection actions, and
rotate any credential that has appeared in chat or logs. Local development may
use database-scoped `readWrite`; never print the URI while debugging.

## Server selection or DNS timeout

For `mongodb+srv://`, confirm the Atlas cluster is running and the backend can
resolve SRV records. Add the API/worker egress address to the Atlas project IP
access list and allow outbound MongoDB traffic. Check TLS inspection and DNS
before increasing `MONGODB_SERVER_SELECTION_TIMEOUT_MS`.

## Transactions are not supported

SPLITO requires a replica set or sharded cluster. A standalone local `mongod`
cannot atomically commit financial writes across collections. Initialize a
single-node replica set for local use or connect to Atlas; do not disable the
transaction boundary.

## Duplicate-key error after index setup

Identify the named index and inspect the conflicting records. The managed unique
and partial indexes enforce mobile/email identity, the stable session and OTP
slots, pending invitations, active memberships, projections, and idempotency
scopes. Repair the data through an audited forward operation; do not drop the
index to unblock a deployment.

## Pool timeout or slow readiness

Check leaked sessions, long transactions, server-selection time, replica count ×
`MONGODB_MAX_POOL_SIZE`, Atlas connection limits, and probe rate. End every
client session in `finally`. Do not raise pool size without connection-budget
and load evidence.

## Schema validation fails

Stop rollout and compare `database/schema.mjs` with the runtime index manifest.
Run `npm run db:migrate` and then `npm run db:status`. Never edit an applied
checksum or silently replace a uniqueness rule.

## Mobile OTP request returns 503

This is intentional in production until a real SMS adapter is configured. Do
not expose `developmentOtp` or switch production to development mode. Configure
Twilio credentials, sender, destination regions, spend/fraud limits, timeout
behavior, monitoring, and acceptance tests.

## Mobile OTP is rejected or rate limited

A challenge expires after five minutes, is single-use, permits five failed
attempts, and has a 60-second resend interval. Requests are also throttled by
keyed phone and IP hashes. Start a new challenge after the allowed interval; do
not edit challenge/throttle documents or weaken limits for one user.

## Outbox documents remain PENDING/RETRY

Check worker health, oldest available age, leases, attempts, `lastError`, and
provider health. Reclaim only expired leases and preserve provider idempotency
keys. Alert on `DEAD`; never reset the whole collection blindly.

## Balance mismatch

Disable affected financial writes, identify empty/unbalanced ledger batches,
and run `npm run db:reconcile` in report mode. Preserve the journal. Set
`SPLITO_RECONCILE_REBUILD=true` only in a reviewed maintenance window to rebuild
balance projections transactionally.
