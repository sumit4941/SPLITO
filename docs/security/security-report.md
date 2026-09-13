# Security verification report

Date: 2026-09-12

Scope: repository foundation, not a deployed production environment.

## Verified by inspection and local execution

- No supplied Oracle password is present in committed templates or source.
- `.env` variants are ignored while `.env.example` contains blank secret fields.
- Runtime and migration database identities are separate; the runtime has no
  schema-creation privilege and no update/delete grant on revision/journal rows.
- All user-controlled SQL values are required to use binds. The only interpolated
  runtime identifier is `DATABASE_OWNER_SCHEMA`, constrained to an uppercase
  Oracle identifier and controlled by deployment.
- Schema constraints bound monetary values, status sets, JSON validity, pair
  ordering, and critical uniqueness/idempotency dimensions.
- V004 defines keyed-HMAC mobile OTP challenges, keyed phone/IP throttles, a
  unique E.164 identity, and a database unique index allowing one unrevoked
  session per user. V005 adds owner-bound WebP metadata, composite avatar/group
  pointer foreign keys, and one-active-image indexes without placing image bytes
  in Oracle. Together the migrations define 55 prefixed tables.
- The earlier V001-V003 local Oracle 26ai result is retained as historical
  evidence: it covered 52 prefixed tables. On 2026-09-12 V004 applied, its
  idempotent rerun reported all migrations already applied, and prefix/schema
  validation observed 54 prefixed tables including all 22 critical tables. V005
  subsequently applied in 133 ms, its no-op rerun reported all migrations
  applied, and the expanded validator observed 55 prefixed tables including all
  23 critical tables and both current-image indexes/pointer foreign keys. The
  repeated seeded reconciliation remained balanced with three expected/actual
  projection rows and zero differences.
- The complete local `verify` pipeline passed 20 test files and 123 tests plus
  every production build. The Oracle worker integration suite passed both lease
  cases, and the dependency audit reported no vulnerabilities at the configured
  moderate threshold.
- The live Oracle-backed API smoke passed first-login account creation,
  returning-number login, wrong-code and replay denial, prior-session
  invalidation, the financial workflow, and logout revocation. The login browser
  suite passed 9 checks with 5 intentional viewport-specific skips.
- An authenticated browser-session media lifecycle accepted 2.4 MB PNG profile
  and group images, served normalized private WebP responses with versioned URLs
  and defensive headers, propagated changes across the header, profile,
  dashboard, group list, and group detail views, and denied replaced/deleted URLs.
- Docker application processes are non-root/read-only with `no-new-privileges`;
  writable paths are explicit volumes/tmpfs.
- CI definitions include locked install, formatting, lint, types, tests/build,
  production dependency audit, Oracle migration/schema checks, container builds
  and config validation, CodeQL, dependency review, secret scan, and automated
  update proposals.

## Not yet verified

- Full API object-level authorization and mass-assignment tests.
- Dedicated browser-level CSRF, cookie-expiry, and recovery abuse scenarios.
- Distributed OTP throttle bypass, concurrent multi-device login races under
  load, and expiry behavior through a real SMS delivery provider. Local unit and
  API smoke evidence covers attempt limits, replay denial, and old-cookie
  invalidation, but is not production abuse evidence.
- Production SMS delivery, sender configuration, failure handling, and abuse
  monitoring; production currently fails OTP requests with `503` until an
  adapter is configured.
- Phishing-resistant passkey MFA and a reviewed recovery process; SMS OTP alone
  remains a restricted authenticator.
- Production malware scanning and decoder/OCR process isolation, upload-abort
  cleanup, durable failed-deletion retry, and orphan reconciliation. The local
  profile/group pipeline has bounded decoder/type checks, metadata-stripping
  tests, owner/member authorization queries, integrity checks, and V005 database
  invariants, but that is not production object-storage evidence.
- Production outbox handlers; the development acknowledgement sink is guarded
  from production and the worker Compose profile remains disabled by default.
- Webhook signature and timestamp validation with an actual provider sandbox.
- Production TLS/TCPS, secret manager, database encryption, encrypted private
  storage, image signing/scanning, WAF/rate-limit tuning, and audited support
  access.
- Backup restoration, disaster recovery objectives, retention erasure jobs, and
  incident exercises on a production-like environment.
- Load/DoS behavior and log/error PII leakage under failure injection.
- A requirement-by-requirement ASVS L2 assessment.

## Release blockers

Do not describe the current repository as “fully secure” or production-certified.
A production release requires completion of the items above, a production-like
Oracle-backed integration run, dependency/container vulnerability review on the
release date, tested restore evidence, and risk acceptance for remaining
findings.
