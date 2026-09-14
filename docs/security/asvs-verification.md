# ASVS 5.0 Level 2 verification map

Status meanings: **Implemented** has code/config evidence; **Partial** has a
foundation but lacks complete route/test evidence; **Planned** has no sufficient
implementation; **Operational** requires a deployment-owner control. Passing a
build is not equivalent to ASVS verification.

| Area                           | Status          | Evidence and remaining verification                                                                                                                                                                                                                               |
| ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 encoding and sanitization   | Partial         | Plain-text comments, React rendering, CSP; test every reflected/stored value and export encoding                                                                                                                                                                  |
| V2 validation/business logic   | Partial         | Zod/domain validation and MongoDB collection validators; controller allowlist and authorization coverage audit pending                                                                                                                                            |
| V3 web frontend security       | Partial         | CSP and PWA boundaries documented; browser cache, DOM injection, framing, and service-worker tests pending                                                                                                                                                        |
| V4 API/web service             | Partial         | Versioned conventions, bounded pagination requirement, Fastify-native plugins; complete OpenAPI/negative tests pending                                                                                                                                            |
| V5 files/resources             | Partial         | V005 owner-bound profile/group media plus bounded JPEG/PNG/WebP decoding, metadata-stripping normalization, private storage, integrity, lifecycle, and authorization tests; production object storage, scanning, isolation, and orphan reconciliation remain open |
| V6 authentication              | Partial         | Mobile OTP API/UI has HMAC-at-rest, expiry, attempts, resend and phone/IP controls; unit/live smoke covers wrong-code/replay behavior, while production SMS, recovery, passkey/TOTP, and production-scale abuse verification remain open                          |
| V7 session management          | Partial         | Hashed opaque sessions, revoke-before-create behavior, and the DB uniqueness invariant exist; live API smoke proves old-cookie invalidation, while dedicated cookie/CSRF/expiry browser evidence remains open                                                     |
| V8 authorization               | Planned/partial | Context/member model exists; prove object-level checks on every route, nested file, search, export, and SSE path                                                                                                                                                  |
| V9 self-contained tokens       | Not applicable  | Browser authentication uses opaque server-side sessions; any future signed provider token needs separate review                                                                                                                                                   |
| V10 OAuth/OIDC                 | Not implemented | No OAuth/OIDC provider is claimed                                                                                                                                                                                                                                 |
| V11 cryptography               | Partial         | Standard randomness and independent OTP/session/MFA secret configuration exist; key lifecycle/rotation and randomness evidence remain open                                                                                                                        |
| V12 secure communication       | Operational     | HTTPS ingress and TLS-protected MongoDB connections are deployment requirements; local HTTP is development-only                                                                                                                                                   |
| V13 configuration              | Partial         | Strict env schema, production-required secrets, non-root/read-only containers; hardening test pending                                                                                                                                                             |
| V14 data protection            | Partial         | Least-privilege schema and private storage design; production encryption, retention jobs, support access require operations                                                                                                                                       |
| V15 secure coding/architecture | Partial         | Typed repository filters, strict input schemas, threat model, CodeQL; complete review pending                                                                                                                                                                     |
| V16 logging/error handling     | Partial         | Structured/redacted logging foundation and audit schema; PII/error leakage tests pending                                                                                                                                                                          |
| V17 WebRTC                     | Not applicable  | SPLITO has no WebRTC feature                                                                                                                                                                                                                                      |

## Release gate

Before calling a production release ASVS L2 verified, record the exact ASVS
requirement IDs in a controlled checklist, link each applicable item to a test or
operational evidence artifact, record justified non-applicability, resolve or
accept each finding through named risk ownership, and retain the CI/test output
for the released commit. That assessment has not yet occurred.

References:

- [OWASP ASVS project](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP ASVS releases](https://github.com/OWASP/ASVS/releases)
