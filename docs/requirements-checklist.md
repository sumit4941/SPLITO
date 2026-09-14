# Requirements checklist

Legend: **Done** means the repository implementation exists; **Partial** means a
meaningful slice exists but acceptance criteria remain; **Open** means not
implemented or not verified; **External** requires production infrastructure or
credentials. A code-complete row is not proof that a deployment exercise passed.

| Area                                         | Status                                 | Evidence / next gate                                                                                                    |
| -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TypeScript monorepo                          | Done                                   | `apps/*`, `packages/*`, exact manifests, and lockfile                                                                   |
| MongoDB runtime configuration                | Done                                   | Validated URI/database/pool/timeout settings shared by API and worker; production rejects local defaults                |
| Transaction-capable topology                 | Done in tooling / unverified on target | Verification rejects standalone MongoDB and executes a harmless transaction; run against the selected Atlas deployment  |
| Collection model                             | Done                                   | 24 lower-camel application collections, JSON Schema validators, managed indexes, and `schemaMigrations` record          |
| Forward migration                            | Done foundation                        | Idempotent collection/index/reference-data setup with checksum; exercise forward recovery on an isolated target         |
| Money/allocation engine                      | Done foundation                        | BigInt domain rules, 19-digit bound, BSON Decimal128 repository boundary, example/property suites                       |
| First-login mobile account                   | Partial                                | API/UI and focused repository tests exist; run replica-set smoke, multi-device race, expiry/replay, and real SMS tests  |
| One active login per number                  | Partial                                | Stable per-user session slot plus unique session/token IDs; concurrent integration and operational monitoring remain    |
| Registered-member add/invite                 | Partial                                | Registered account add and phone-bound unknown-number invitation/acceptance exist; carrier and race evidence remain     |
| Groups/permissions                           | Partial                                | Create/list/detail and core role checks exist; removal, transfer, archive, and full negative authorization suite remain |
| Expense creator permissions                  | Partial                                | Active members read and original active creator edits; MongoDB transaction/race smoke remains                           |
| Journal/projections/reconciliation           | Partial                                | Embedded balanced batches and report/rebuild tool exist; full replica-set failure/rebuild evidence remains              |
| Manual settlement                            | Partial                                | Preview/create exists; history, reversal, and broader transaction tests remain                                          |
| Profile and group images                     | Partial / External                     | Upload/change/remove and authorized reads exist; production storage, scanning, cleanup, and race evidence remain        |
| Outbox worker                                | Partial                                | MongoDB lease integration test and worker foundation exist; production handlers and alerting remain                     |
| OpenAPI/generated client                     | Partial                                | Checked-in OpenAPI and typed client are used by the web app; route coverage gate remains                                |
| Safe client errors                           | Partial                                | Error mapping and generic UI fallbacks exist; automated leakage/failure-injection audit remains                         |
| Vercel web deployment                        | Done foundation                        | Static web build and backend-origin rewrite validation exist; API/worker must run on a separate long-running host       |
| Backend containers                           | Done foundation                        | API/worker images and external-Atlas Compose configuration exist; runtime smoke remains                                 |
| MongoDB replica-set CI                       | Done in workflow                       | Workflow provisions a single-node replica set and runs schema/worker checks; successful run must be recorded            |
| Backup/restore                               | Operational document / Open evidence   | Atlas and self-managed procedures documented; an actual restore exercise is required                                    |
| Security baseline                            | Partial                                | Threat model, ASVS map, safe secret templates, CI scanning; production review remains                                   |
| Accessibility/themes/motion                  | Partial                                | Accessible login/theme/motion foundations and browser tests exist; remaining screens/table alternatives need audit      |
| Performance p95 below 500 ms                 | Open                                   | Reproducible workload and threshold defined; no valid MongoDB-backed result recorded                                    |
| Demo fixtures                                | Done foundation                        | Guarded synthetic accounts/group/expense seed with post-write shape assertions; development only                        |
| Recurrence, OCR, FX, import/export, SSE, MFA | Open/External                          | Planned behavior is documented; complete authoritative workflows are not claimed                                        |

The application reaches production completion only after the real UI/API flows,
MongoDB integration and financial/permission/browser suites, deployment,
backup/restore, security review, and performance run are executed in a
production-like environment. That evidence is not claimed here.
