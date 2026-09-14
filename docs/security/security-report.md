# Security verification report

Date: 2026-09-14

Scope: repository controls during the MongoDB migration, not a deployed
production environment or a security certification.

## Controls present in the repository

- Environment templates contain placeholders only, `.env` files are ignored,
  and connection helpers do not print MongoDB URIs or embedded credentials.
- Production API and worker configuration requires an explicit non-local
  `MONGODB_URI`. The browser bundle has no database configuration and connects
  only to the API origin.
- MongoDB collection validators constrain critical identity, binary hash, date,
  money, status, and durable-workflow fields. Managed unique and TTL indexes
  protect phone identities, session/OTP slots, token hashes, membership keys,
  idempotency scopes, and expiry cleanup.
- Financial writes use MongoDB transactions, `Decimal128` minor units, immutable
  revisions, embedded balanced postings, optimistic versions, context mutation
  fences, idempotency records, audit events, and outbox events.
- OTPs and bearer tokens are stored as keyed hashes or digests. Phone/IP abuse
  keys and session/IP hashes use BSON binary values rather than plaintext
  lookup values.
- Mobile login uses one stable session slot per user and replaces it when login
  succeeds. First login creates the account and financial participant in the
  same transaction.
- Image metadata and SHA-256 integrity values are stored in MongoDB while image
  bytes remain in private storage. Application authorization is required before
  bytes are served.
- API errors are mapped to user-safe messages; internal driver errors, query
  details, stack traces, and connection information are not intended for client
  responses.
- Application containers run non-root and read-only with explicit writable
  volumes/tmpfs and `no-new-privileges`.
- CI definitions include locked dependency installation, static verification,
  security scanning, container checks, and a MongoDB replica-set integration
  workflow.

These are implementation observations. A successful migration, full test suite,
and production controls still require execution in the target environment.

## Required validation before release

- Run `db:migrate`, `db:verify`, and `db:status` against the intended Atlas
  database with a least-privilege migration identity, then run API and worker
  integration tests against an isolated replica-set database.
- Exercise first and returning OTP login, wrong-code/expiry/replay behavior,
  concurrent multi-device login, old-cookie invalidation, logout, and distributed
  throttle behavior.
- Exercise group invitation creation/acceptance races and verify that an unknown
  mobile never appears as a member before registered, phone-bound acceptance.
- Exercise expense create/edit races, creator-only mutation, active-member read
  access, balanced reversal/replacement batches, idempotent retry, and projection
  reconciliation/rebuild.
- Complete object-level authorization, mass-assignment, CSRF, cookie lifetime,
  and error/log leakage tests across all routes.
- Activate and test a real SMS provider, sender policy, rate limiting, failure
  handling, monitoring, and recovery. SMS OTP alone remains exposed to phishing,
  SIM-swap, and carrier compromise.
- Use private production image storage with malware/decoder isolation,
  upload-abort cleanup, durable deletion retry, orphan reconciliation, and
  encrypted transport/storage.
- Validate TLS, Atlas IP access or private networking, database user roles,
  secret-manager rotation, audit access, backup restoration, disaster recovery,
  and retention/erasure jobs in a production-like environment.
- Run dependency and container vulnerability review on the release date and
  complete a requirement-by-requirement ASVS Level 2 assessment.

## Credential incident rule

A database password shared in chat, logs, tickets, screenshots, or source must be
treated as compromised. Rotate or delete that database user credential, update
the backend secret manager, and invalidate cached deployments before using the
environment. Never copy the exposed value into `.env.example`, documentation,
commits, CI logs, or Vercel client environment variables.

## Release position

Do not describe the repository as fully secure or production-certified. Release
requires the validation above, a production-like MongoDB integration run,
tested restore evidence, deployment-specific monitoring, and explicit risk
acceptance for remaining findings.
