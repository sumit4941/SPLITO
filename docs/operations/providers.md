# Optional provider setup

SPLITO's authoritative ledger does not depend on an external provider. Manual
settlement is the current safe baseline. Manual FX is the intended
provider-free baseline, but its transaction/API/UI are not implemented. SMS,
email, OCR, live FX, payments, UPI/bank launch helpers, and telemetry are disabled
until an adapter is explicitly implemented, configured, and accepted for the
deployment region. `FX_PROVIDER` currently validates `manual`, `ecb`, or
`sandbox`; that enum is a configuration contract, not evidence that any FX
adapter or conversion workflow is operational.

## Activation gate

For each provider, record and review:

1. Product owner, operational owner, supported countries/currencies, licensing,
   data residency, subprocessors, retention, and deletion commitments.
2. A dedicated sandbox and production account, separate least-privilege
   credentials in the platform secret manager, rotation procedure, egress
   allowlist, and cost/rate limits.
3. Bounded connect/request timeouts, retryable status codes, exponential backoff
   with jitter, a circuit breaker, and a dead-letter/operator recovery path.
4. Stable internal idempotency keys and durable provider identifiers. A timeout
   or duplicate callback must not duplicate a financial effect.
5. Signed webhooks over HTTPS, timestamp/replay-window verification, raw-body
   signature checking before parsing, durable receipt uniqueness, and secret
   rotation overlap.
6. Redacted structured logs, metrics and alerts, sandbox contract tests,
   degraded-mode UI, incident runbook, and an explicit disable switch.

## Provider-specific boundaries

- Mobile OTP returns `developmentOtp` only in local development. Production
  currently returns `503` from the request endpoint until an SMS adapter is
  configured; no queued or delivered message is implied. An activated adapter
  must accept normalized E.164 destinations, keep plaintext codes out of
  database/log/metric payloads, bound provider calls, expose delivery failures,
  and preserve the five-minute expiry, 60-second resend, five-attempt cap, and
  phone/IP throttles. SMS is restricted and phishable, so add reviewed recovery
  and passkey MFA rather than presenting it as phishing-resistant.
- OCR output is untrusted suggestion data. Scan the source first, validate and
  bound returned JSON, show confidence/provenance, and require a human to confirm
  all financial fields before posting.
- Live FX quotes record the provider, quoted time, exact decimal rate, expiry,
  and rounding policy. Display conversion is an estimate; a posted conversion
  is a balanced financial document.
- Payment/UPI/bank deep links only initiate a user action. They never prove that
  money moved. Confirm from a verified callback or require a clearly labelled
  manual settlement assertion.
- Email delivery is at-least-once. Messages must carry no sensitive financial
  details beyond the approved template and must respect verification,
  preferences, unsubscribe rules, and address-suppression events.
- Telemetry exporters must exclude credentials, cookies, tokens, request bodies,
  attachment content, and unnecessary personal/financial fields.

No production provider, including SMS delivery, was activated or
acceptance-tested by this repository delivery. Update the feature matrix and
security report only after implementation and evidence exist.
