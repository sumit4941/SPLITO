# Data retention and account deletion

Retention is configurable by jurisdiction and deployment policy; the following
defaults are product decisions, not legal advice.

| Data                                 | Default policy                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Expired verification/reset tokens    | TTL-purge asynchronously at their expiry; consumed tokens remain unusable while awaiting expiry      |
| Terminal mobile OTP challenges       | TTL-purge no later than 30 days after issuance; never retain plaintext OTPs                          |
| Mobile OTP throttle keys             | TTL-purge after the active abuse-control window; extend the deadline when the window is reset        |
| Revoked/expired sessions             | TTL-purge asynchronously at absolute expiry; revocation makes a retained slot immediately unusable   |
| Completed idempotency responses      | TTL-purge the 24-hour replay slot; retain a response-free permanent receipt for journal provenance   |
| Processed outbox rows                | Retain 30 days; dead rows 180 days or through incident resolution                                    |
| Provider webhook receipts            | Retain event ID/hash/status 180 days; do not store raw sensitive payload by default                  |
| Application audit events             | Retain at least 2 years by default, adjusted for policy and local law                                |
| Failed imports and unclaimed exports | Purge source/output after 7 days; successful export download expires within 24 hours                 |
| OCR intermediate output              | Purge 30 days after confirmation or earlier when the receipt is deleted                              |
| Rejected/abandoned image quarantine  | Remove immediately on handled failure; sweep incomplete files older than 1 hour                      |
| Superseded profile/group image bytes | Purge after the configured recovery grace period; retain a minimal soft-delete tombstone for 30 days |
| Financial journal/revisions          | Retain as shared records; anonymize deleted identity instead of breaking other participants’ history |

An account deletion request immediately revokes sessions, disables new activity,
and schedules export/erasure. After any required cooling-off period, remove or
anonymize profile name, email, mobile number, avatar, device, preference,
MFA/recovery material, provider identifiers, and private unattached data. Clear
`users.avatarKey` before soft-deleting its media document and schedule the
private binary for deletion. A group image belongs to the shared group, not to
its uploader, so deleting the uploader's account does not silently remove it;
group replacement/deletion follows the group's own authorization and retention
workflow. Replace identity presentation in necessary shared records with a
stable “Deleted participant” label while
preserving participant IDs, allocations, revisions, journal, settlements, and
audit facts needed by other participants and fraud/accounting policy.

Deletion never merges a guest or another account, never destroys another
participant’s financial history, and is blocked/held only by a documented legal
or abuse-investigation basis. Every deletion/anonymization step is auditable and
retry-safe. Retention jobs and legal review are not yet implemented; this file
defines the required behavior.
