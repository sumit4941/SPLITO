# Threat model

Baseline: [OWASP ASVS 5.0 Level 2](https://owasp.org/www-project-application-security-verification-standard/).
This model covers the API, PWA/offline store, MongoDB, worker, private storage,
and optional providers. It must be reviewed for each material data flow change.

## Assets and trust boundaries

Highest-value assets are password verifiers and recovery material, mobile OTP
verifiers/pepper and abuse-throttle state, opaque sessions, MFA secrets,
verified identity links, private receipt contents, membership/authorization
state, immutable financial revisions and journal, provider credentials/webhooks,
exports, audit evidence, encryption keys, and database/backup credentials.

Trust boundaries exist between browser and API; ingress and application;
API/worker and MongoDB; app and private storage; worker and external providers;
connected and disconnected clients; runtime and migration/admin credentials;
and production operators/support staff and participant data.

Administrators do not receive a default UI for browsing private expenses.
Break-glass support access must be time-bound, case-linked, least-privilege, and
audited.

## Threats and controls

| Threat                                       | Required prevention/detection                                                                                                                                     | Current evidence                                                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing and password guessing    | Argon2id, generic responses, IP/account-aware throttles, MFA, alerting                                                                                            | Argon2 dependency/config foundation; complete auth tests pending                                                                                                                                                              |
| Mobile OTP interception, guessing, or replay | Six random digits, keyed HMAC at rest, five-minute/one-time challenge, five-attempt cap, 60-second resend, phone/IP throttles, no production fallback without SMS | Unit/live smoke cover attempt and replay controls; provider and production-scale abuse testing remain open                                                                                                                    |
| Session theft/fixation                       | 256-bit opaque token, HMAC/peppered digest at rest, Secure/HttpOnly/SameSite cookie, rotation, idle/absolute expiry, prior-session revoke and DB uniqueness       | Live API smoke proves prior-cookie invalidation; dedicated browser abuse and load-race evidence remain open                                                                                                                   |
| Password-reset/invite replay                 | Random token, only digest stored, purpose/subject binding, expiry, single atomic consume, generic response                                                        | Unique token hashes and consume timestamps in schema; route tests pending                                                                                                                                                     |
| Guest-account takeover                       | Claim only through verified possession; never match display name or typed email alone                                                                             | Participant/claim model exists; workflow tests pending                                                                                                                                                                        |
| BOLA/IDOR                                    | Context membership predicate in every object and nested-resource query; conceal existence when appropriate                                                        | Architecture rule; comprehensive negative route tests pending                                                                                                                                                                 |
| Role or mass-assignment escalation           | Strict request schemas and explicit writable field maps; last-owner and role-transition transaction checks                                                        | API convention documented; full controller coverage pending                                                                                                                                                                   |
| Financial tampering/rounding                 | Decimal strings/BigInt, BSON Decimal128, deterministic allocation, server recomputation, balanced journal, immutable revisions, reconciliation                    | Domain and schema foundations; MongoDB transaction tests pending                                                                                                                                                              |
| Duplicate/replayed mutation                  | Actor+operation+key uniqueness, request digest match, outcome written in same transaction                                                                         | `idempotencyKeys`; integration race tests pending                                                                                                                                                                             |
| Concurrent lost update                       | `If-Match`, context mutation fences, versioned update filters, stale simplification rejection                                                                     | Collection validators and API rule; concurrency tests pending                                                                                                                                                                 |
| Query/operator injection                     | Typed repository filters, strict request schemas, no client-controlled operators or collection names                                                              | Repository query audit and negative fuzz tests required                                                                                                                                                                       |
| Stored/reflected XSS                         | React escaping, comments plain text, sanitized filenames, restrictive CSP, no raw receipt HTML                                                                    | Nginx CSP and plain-text model; dynamic UI audit pending                                                                                                                                                                      |
| CSRF/CORS abuse                              | Origin allowlist, session-bound CSRF token on unsafe methods, SameSite cookie, no wildcard credentials                                                            | Config/API rule and login browser coverage exist; dedicated CSRF/CORS abuse tests remain pending                                                                                                                              |
| Malicious upload/image or OCR bomb           | Signature plus decoder validation, byte/page/time/pixel limits, random private key, metadata stripping/WebP rewrite, malware hook, isolated processing            | Local profile/group processing tests cover type mismatch, malformed/empty/oversized/animated input, pixel bounds, and normalization; scanner/OCR isolation and production object storage are not activated                    |
| Cross-tenant avatar/group image access       | Owner-bound pointers, self or relationship-aware avatar reads, active group-member reads, owner/admin group writes, authorization on every content response       | V005 ownership/current-pointer constraints and focused repository/service tests cover relationship/member predicates, role denial, reauthorization under lock, and stale-version denial; broader live revocation races remain |
| SSRF                                         | No URL-based receipt ingestion; provider base URLs deployment-controlled; block redirects/private destinations where fetch is required                            | Design rule; provider implementation review pending                                                                                                                                                                           |
| Payment/webhook forgery                      | Raw-body signature, timestamp window, constant-time comparison, provider event uniqueness, authoritative status lookup where available                            | Receipt uniqueness/schema; live provider disabled and verification pending                                                                                                                                                    |
| CSV injection and participant misbinding     | Escape formula prefixes on export, strict locale parsing, preview, explicit participant confirmation, duplicate fingerprint                                       | Schema flags/batches; workflow implementation pending                                                                                                                                                                         |
| Offline data disclosure/stale authorization  | Opt-in cache, per-account database, logout purge, minimal encrypted-at-rest expectations, permissions rechecked at sync                                           | Client foundation; disconnected revocation limitation remains                                                                                                                                                                 |
| Outbox/job double effect                     | Lease, deduplication key, bounded retries, provider idempotency, dead-letter visibility                                                                           | Durable collection and worker foundation; failure injection pending                                                                                                                                                           |
| Log/error leakage                            | Structured redaction, request IDs, production-safe errors, no query filters/provider bodies/PII                                                                   | Pino redaction foundation; automated log-content test pending                                                                                                                                                                 |
| Database privilege abuse                     | Database-scoped Atlas users, separate migration/runtime roles, TLS, IP access list or private endpoint                                                            | Deployment-specific Atlas role and network review required                                                                                                                                                                    |
| Secret/supply-chain compromise               | Ignored env, secret manager injection, lockfile, dependency review/audit, CodeQL, secret scanning, image scanning/signing                                         | CI definitions exist; repository hosting features must be enabled                                                                                                                                                             |
| Resource exhaustion                          | Request/upload limits, bounded pool/queue/call timeout, rate limits, cursor caps, worker retry caps                                                               | Config/schema bounds; measured saturation test pending                                                                                                                                                                        |

## Abuse cases that must remain in the test suite

- Enumerate registered phone numbers or emails through OTP, registration,
  reset, friends, search, or invitations.
- Guess or replay a mobile OTP after five failures, expiry, successful use, or a
  replacement challenge; bypass phone/IP throttles or the 60-second resend gate.
- Continue using an old cookie after a second successful login for the same
  number.
- Access an expense, receipt, export, SSE stream, or search count after removal
  from its context.
- Remove the last owner or a participant with a non-zero balance in any currency.
- Move an expense while authorized in only one of the two contexts.
- Reuse an idempotency key with a changed body or submit simultaneous keys for
  the same stale version.
- Confirm payment from a redirect, QR/deep-link launch, screenshot, unsigned
  callback, old timestamp, or repeated provider event.
- Claim a guest by changing display name/email without verification.
- Upload a polyglot, decompression bomb, oversized PDF, path-like filename, or
  receipt URL.
- Replace another user's avatar, replace a group image as a normal/former
  member, read a group image after removal, or bind an image key owned by a
  different user/group.
- Import formula-prefixed cells or silently map a similarly named participant.
- Submit an offline mutation after session or membership revocation.

## Residual risks

A disconnected device can retain previously cached data until it reconnects or
the user clears storage; remote revocation cannot erase it instantly. Manual
settlements are participant assertions, not bank evidence. Optional local file
storage depends on host-volume security and is not a substitute for production
object-storage controls. Greedy simplification preserves balances but is not
mathematically minimal. Provider and OCR security remains unverified until real
sandbox credentials, contracts, signature schemes, and processing boundaries
are configured.

SMS possession is a restricted, phishable authenticator: SIM swaps, recycled
numbers, malicious apps, and mobile-network/operator compromise remain outside
the application's complete control. Production must pair it with a reviewed
recovery process and progressively offer phishing-resistant passkey MFA. The
current absence of an SMS adapter is fail-closed: production OTP requests return
`503` and no delivery is claimed.
