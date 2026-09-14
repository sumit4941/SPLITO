# Feature coverage matrix

Status reflects code and checked-in tests, not a live production claim.
**Implemented** means the primary repository workflow exists. **Partial** means a
usable slice exists but important lifecycle or verification work remains.
**Planned** means no complete authoritative workflow is present. **External**
requires provider or production infrastructure.

| Area                        | SPLITO behavior                                                                                                   | Status and remaining gate                                                                                                              | External requirement                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mobile accounts             | Six-digit OTP, create account on first verified login, one active session per number                              | Implemented in API/UI and repository tests; replica-set integration, concurrent-device, recovery, and production abuse evidence remain | SMS sender/account and regional approval             |
| Legacy email/password       | Registration, email verification, and password login retained as an API compatibility path                        | Partial; provider delivery and complete recovery lifecycle remain                                                                      | Email provider                                       |
| Profile avatar              | User can upload, replace, view, and delete a private normalized image                                             | Implemented code and focused tests; production storage/scanning is external                                                            | Private object storage and malware/decoder isolation |
| Groups                      | Create/list/detail with owner/admin/member roles and a private group image                                        | Partial; core paths exist, while full role transfer, removal, archive, and race coverage remains                                       | Production image storage/scanning                    |
| Add by mobile               | Add an active registered account; otherwise send a registration/join invitation and do not add a roster entry yet | Implemented code and focused tests; real carrier delivery and race/integration evidence remain                                         | SMS provider                                         |
| Expense visibility and edit | Every active member can read; only the original active creator can edit their posted entry                        | Implemented code and focused tests; MongoDB transaction/race integration evidence remains                                              | None                                                 |
| Split methods               | Equal, exact, percentage, shares, and adjustments with deterministic largest-remainder allocation                 | Implemented domain foundation and property tests; itemized receipt reconciliation remains planned                                      | None                                                 |
| Journal and balances        | Immutable revisions, balanced embedded postings, reversal/replacement batches, net and bilateral projections      | Implemented repository path and reconciliation tool; full replica-set failure/race/rebuild evidence remains                            | MongoDB replica set or Atlas                         |
| Manual settlement           | Explicit participant assertion with preview and posted settlement                                                 | Partial; preview/create exist, while history, reversal, and broader integration coverage remain                                        | None                                                 |
| Outbox worker               | Lease, heartbeat, retry, completion, and dead-letter state                                                        | Implemented foundation and MongoDB integration test; production handlers/monitoring remain                                             | Provider-specific handlers                           |
| Idempotency                 | Actor/operation/request binding and stored mutation outcome                                                       | Implemented foundation; expiry/history policy and concurrency evidence must remain consistent with ledger references                   | None                                                 |
| Offline/PWA                 | Installable PWA and local cache/draft foundation                                                                  | Partial; dependency ordering, conflict UX, account revocation, and financial queue tests remain                                        | Browser capability varies                            |
| Search and analytics        | UI foundations and expense filter indexes                                                                         | Partial; authoritative permission-filtered search/analytics routes are incomplete                                                      | FX provider only for converted estimates             |
| OCR/itemization             | Reviewed private receipt/OCR workflow                                                                             | Planned                                                                                                                                | Private object storage, scanner, OCR service/runtime |
| Recurrence                  | Timezone-aware independent expense occurrences                                                                    | Planned                                                                                                                                | None                                                 |
| FX/conversion               | Currency-isolated journals and explicit conversion records                                                        | Planned beyond isolation rules                                                                                                         | Optional FX data source                              |
| Import/export               | Preview, validation, duplicate handling, reversal, and private export                                             | Planned                                                                                                                                | Optional bank-feed provider                          |
| SSE/notifications           | Minimal authenticated invalidations after commit                                                                  | Planned beyond outbox events                                                                                                           | Email/push credentials for those channels            |
| Passkeys/MFA                | Phishing-resistant second factor and reviewed recovery                                                            | Planned                                                                                                                                | Origin/key-management operations                     |

## Design choices

- One context model provides the authorization and transaction boundary for
  group, direct, and personal financial data.
- Immutable expense revisions embed their payer/share/obligation snapshot;
  immutable ledger batches embed their postings.
- Deterministic expense-level obligations are separate from optional balance
  simplification.
- A MongoDB-backed durable outbox avoids a mandatory Redis dependency.
- Runtime configuration, deployment migration, collection validators, and
  managed indexes are explicit and independently verifiable.

## Explicit non-claims

Static pages, validators, unit tests, and configured adapter boundaries do not
prove production readiness. Development OTP output and in-memory invitation
capture are not carrier-delivery evidence. The MongoDB migration must pass the
replica-set CI workflow and target-environment migration, verification,
reconciliation, API smoke, and restore exercises before release. Live SMS,
payments, OCR, email, bank feeds, production backup/restore, ASVS verification,
and measured performance remain unavailable until their stated evidence and
credentials exist.
