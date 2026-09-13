# API contract conventions

All business endpoints live below `/api/v1`; health probes are also versioned.
The browser uses this API and never Oracle. Runtime OpenAPI is exposed at
`/api/openapi.json`. The checked-in `docs/openapi.json` and
`packages/api-client` contain the generated contract and the web-facing
`openapi-fetch` wrapper. The artifact represents only the implemented route
slice, and CI does not yet prove regeneration is clean or that every intended
endpoint has schema coverage. This document defines common rules that every
controller must follow.

## Common wire types

```json
{
  "id": "018f2f2a-4d8e-7a11-8fb2-ef4d68f00a31",
  "currency": "INR",
  "amountMinor": "12345",
  "version": "7",
  "createdAt": "2026-09-12T05:45:12.123456Z"
}
```

IDs are canonical lowercase UUID strings. Money and resource versions are
decimal strings so JavaScript cannot lose precision. Dates are `YYYY-MM-DD`,
instants are RFC 3339 UTC, and IANA timezone names accompany wall-clock business
intent.

Errors are never ad-hoc strings:

```json
{
  "error": {
    "code": "RESOURCE_VERSION_MISMATCH",
    "message": "This expense changed. Refresh before applying your edit.",
    "fieldErrors": [],
    "requestId": "01J7B6M4..."
  }
}
```

Production errors omit stack traces, SQL, credentials, internal IDs not already
authorized, and provider payloads.

## Mutation requirements

- Validate JSON with strict schemas and writable-field allowlists; reject unknown
  fields where ambiguity would be unsafe.
- Reauthorize top-level and nested resources on every operation.
- Require `If-Match` for edits and return `412` on version mismatch.
- Require `Idempotency-Key` for retryable financial mutations. Scope the hashed
  key to actor plus operation; the same key and different request hash returns
  `409`. Persist the response in the financial transaction.
- Return `201` for creation, `200` for a representation, `204` only when no body
  is useful, `400` for malformed syntax, `401` unauthenticated, `403` known but
  unauthorized, `404` when existence must not leak, `409` state/idempotency
  conflict, `412` stale version, `422` valid syntax with invalid financial rules,
  and `429` with `Retry-After` for limits.
- Bound bodies, uploads, page sizes, query cost, external calls, and total request
  time.

Lists use a stable sort tuple and `nextCursor`. The current token is
shape-validated base64url JSON, not an integrity-protected credential, and is
never trusted for authorization. Authorization predicates are part of the SQL
query, not post-filtering; counts, suggestions, and snippets cannot include
inaccessible records.

## Endpoint families

The intended contract families are authentication/MFA/sessions; current user and
privacy; friends/invitations; groups/membership/defaults; expenses/revisions/
refunds/comments/disputes; balances and simplification; settlements and payment
attempts; recurrence; attachments/OCR; import/export; currencies/rates/
conversions; analytics/search; notifications; offline sync/SSE; provider
webhooks; and liveness/readiness.

Presence in this list is not a completeness claim. See
`feature-coverage-matrix.md` for implemented status and generated OpenAPI for
routes that actually exist.

The current vertical slice implements mobile-OTP request/verification,
login/logout/session and `GET /me`; legacy registration, email-token consumption,
and password login APIs; authenticated profile/group image upload, removal, and
retrieval; group list/create/detail plus registered-member add and phone-bound
group invitations; expense split-preview/create/detail, creator-only replacement,
and group expense list; personal/group balances; manual settlement
preview/create; and liveness/readiness. Void/restore/move/refund and broader
membership lifecycle operations, stronger recovery/MFA, and the other endpoint
families above remain incomplete.

## Group membership by mobile number

`POST /api/v1/groups/{groupId}/members` accepts the strict body
`{ "mobileNumber": "..." }`. It requires an authenticated session, the
session-bound CSRF token, an active owner or administrator membership, and a
writable group. The route is limited to 10 attempts per minute per API-observed
IP. Mobile input is normalized to E.164 before lookup.

- A verified, active registered account is activated as a `member` and returns
  `201` with `outcome: "member_added"`. Repeating the operation for an existing
  active member returns that member without creating a duplicate membership.
- An unknown number returns `202` with `outcome: "invitation_sent"`, a masked
  destination, pending status, and seven-day expiry only after the invitation
  transaction commits and the configured delivery path accepts the message.
  Development additionally returns `developmentJoinUrl`; deployed environments
  never do.
- An existing but inactive or unverified account returns `409`. A missing or
  inaccessible group is concealed as `404`; a normal member receives `403`.
  SMS unavailability and provider rejection are reported as `503` and `502`
  respectively, never as a false delivery success.

Unknown invitees are not inserted into `SPLITO_PARTICIPANTS` or the group roster.
The stored invitation contains the normalized destination and a SHA-256 token
digest, not the bearer token. The join URL uses `/join#invite=<token>` so the
token fragment is not sent in the initial HTTP request. Issuing a replacement
for the same pending group/number rotates the digest and expiry; at most one
pending row can exist for that pair and the resend count is bounded.

After OTP registration or sign-in, the invited account uses:

- `POST /api/v1/group-invitations/preview` with `{ "token": "..." }`. It
  requires a session but makes no state change.
- `POST /api/v1/group-invitations/accept` with the same strict token body. It
  also requires CSRF and atomically activates the membership and consumes the
  pending state.

Both operations bind the token to the authenticated account's verified mobile
number, an active group, and an inviter who is still an active owner or
administrator. Invalid, wrong-account, expired, or revoked invitations all use
the generic `404 GROUP_INVITATION_NOT_FOUND`. Acceptance has one state
transition; a retry by the same bound account safely returns its existing active
membership instead of inserting another row. Group detail returns live pending
invitations only to owners/administrators and exposes only masked destinations;
ordinary members receive an empty `pendingInvitations` list.

## Shared expense reads and creator-only edits

Every active group member can list the group's expenses and read an authorized
expense detail. Expense representations include `createdBy` and `canEdit` so the
client need not infer edit permission from payer, beneficiary, or group role.
`canEdit` is true only when the current caller created the posted expense, still
has active membership, and the context is active. Owner or administrator status
does not override creator ownership.

`PUT /api/v1/expenses/{expenseId}` replaces the current document using the full
`ExpenseMutationRequest`. It requires a session, CSRF token,
`Idempotency-Key`, and an `If-Match` containing one positive decimal version
(quoted or unquoted). A successful update returns `200`, the incremented
representation and `ETag`; a safe replay returns the stored result and
`Idempotency-Replayed: true`. A fresh stale version returns `412`, reuse of a key
with a different request returns `409`, and non-creators receive a concealed
`404` because the update lock query includes creator ownership and active
membership. Editing cannot move an expense to another group.

The update appends a revision and a balanced reversal/replacement journal in one
Oracle transaction; it never rewrites the previous revision or postings. All
active members see the new current representation after commit, but edit
permission remains with the original creator.

## Private profile and group images

- `PUT /api/v1/me/avatar` replaces the authenticated user's avatar.
- `DELETE /api/v1/me/avatar` clears it.
- `GET /api/v1/participants/{participantId}/avatar?v={mediaId}` returns an
  authorized normalized avatar.
- `PUT /api/v1/groups/{groupId}/image` and `DELETE` at the same path require an
  active owner or administrator and a writable group.
- `GET /api/v1/groups/{groupId}/image?v={mediaId}` requires active membership.

Writes use a cookie-authenticated, CSRF-protected `multipart/form-data` request
with exactly one `file` part. JPEG, PNG, and WebP sources are accepted up to the
configured 10 MB ceiling, decoded under bounded pixel limits, stripped of
unnecessary metadata, and stored as WebP. Mutation responses return a versioned
API URL, never an internal `STORAGE_KEY`. Content responses are authorized on
every request, use `image/webp` plus `nosniff`, and stay out of public/service
worker caches. Production upload remains unavailable until its private object
storage and malware-scanning boundary is activated.

## Authentication and browser transport

`/login` is the only public application entry screen. Its primary authentication
sequence is:

1. `POST /api/v1/auth/mobile/request-otp` with a mobile number. The API
   normalizes and validates E.164, applies per-phone and per-IP throttles,
   supersedes an earlier pending challenge for the same number, and creates a
   six-digit challenge.
2. `POST /api/v1/auth/mobile/verify-otp` with the challenge, mobile number, and
   code. A code is one-time, expires after five minutes, allows at most five
   failed attempts, and cannot be resent for 60 seconds.

Only a keyed HMAC of the code is persisted; the OTP pepper is independent of
the session and CSRF secrets. Responses are designed not to disclose whether a
number already has an account. On the first successful verification of an
unseen E.164 number, creation of the user, participant, and preferences is
atomic. Every successful verification revokes the user's prior unrevoked
session before creating the replacement; Oracle also has a function-based
unique index permitting only one unrevoked session per user. Because mobile
numbers are unique identities, that enforces one active login per number.

In development, the request response may include `developmentOtp` for local
testability. Production never returns the plaintext code. OTP and group-invite
messages share the configuration-gated Twilio adapter; production configuration
fails closed unless the adapter credentials and exactly one sender mode are
valid. Provider failure returns an error rather than fabricating delivery. The
adapter has unit tests with a mocked HTTP boundary, but no real carrier delivery
or provider acceptance test is claimed. Legacy email/password endpoints may
remain available to API clients, but they are not exposed by the primary web
login.

The session cookie contains an opaque random token whose digest is stored in
Oracle. It is `HttpOnly`, `Secure` in production, narrowly scoped, and uses the
documented `SameSite` policy. State-changing cookie-authenticated requests also
send a CSRF token bound to the session. Authentication tokens never enter
`localStorage`.

SMS OTP is a restricted, phishable authenticator rather than a strong phishing-
resistant factor. A production identity roadmap must add reviewed account
recovery and passkey-based MFA instead of treating SMS possession as sufficient
for every risk level.

When SSE is implemented, streams must be authenticated, heartbeat-bounded, and
reauthorize periodically and after membership/session invalidations. Events
must carry minimal invalidation metadata and normally ask the client to refetch
an authorized resource. No SSE endpoint exists in the current route slice.
