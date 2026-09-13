# Private media storage

Oracle stores authorization, lifecycle, and integrity metadata; it does not
store user-uploaded image bytes. `SPLITO_ATTACHMENTS` remains the expense receipt
model. V005 adds `SPLITO_MEDIA_OBJECTS` for normalized profile avatars and group
images and binds the existing `SPLITO_USERS.AVATAR_KEY` and
`SPLITO_GROUPS.IMAGE_KEY` pointers back to an object owned by that same user or
group. Function-based unique indexes permit only one `ACTIVE` image per owner.

Runtime configuration defines `ATTACHMENT_STORAGE_PATH` and a default
`MAX_UPLOAD_BYTES` of 10 MB. The same private storage boundary can serve both
receipt and presentation media, but their authorization and content policies
remain separate. Receipt upload/OCR routes, malware scanning, and a production
object-storage adapter are not yet complete; a schema or mounted volume alone is
not production-readiness evidence.

## Development filesystem adapter

Use a directory that is outside the web root, accessible only to the API/worker
OS identity, and excluded from source control. In Compose it is the named volume
mounted at `/var/lib/splito/private`; the API is explicitly configured to use
that path and the image prepares it for the non-root `node` user. A replacement
bind mount must have an equivalent host ACL/UID mapping. Do not serve this
directory through nginx or map it to a public host directory.

Before enabling writes, an adapter must:

- generate opaque storage keys instead of trusting the original filename;
- stream to a temporary quarantine location while enforcing
  `MAX_UPLOAD_BYTES` and a bounded page count;
- inspect file signatures as well as declared media types, compute SHA-256, and
  reject archives, active content, malformed polyglots, and unsupported types;
- move only scanner-approved content to its final key and set `SCAN_STATUS` to
  `CLEAN`; failed or rejected content must never be downloadable;
- insert metadata and enqueue follow-up work transactionally where possible,
  with a compensating cleanup for orphaned objects; and
- use restrictive permissions, encrypted disks, tested backups, and monitored
  capacity/inode limits.

Every read must authenticate the caller and reauthorize access to the owning
expense. Never expose `STORAGE_KEY` as a durable bearer URL. Set
`Content-Disposition: attachment`, an allowlisted `Content-Type`,
`X-Content-Type-Options: nosniff`, and a conservative cache policy.

## Profile and group images

An image upload accepts exactly one multipart `file` part and at most
`MAX_UPLOAD_BYTES` source bytes. Initially allow JPEG, PNG, and WebP only. Reject
SVG, PDF, archives, animated images, or anything whose declared type, signature,
and successful decoder result do not agree. The decoder must enforce at most
16,777,216 decoded pixels before allocating an unbounded raster. Apply EXIF
orientation, strip location and other
unnecessary metadata, remove animation, and encode the stored result as
`image/webp`. V005 independently constrains the stored result to 10 MB, those
dimension limits, and a `RAW(32)` SHA-256 digest.

The current API buffers only the already bounded multipart file (10,000,000
bytes maximum) for decoding; it never accepts an unbounded body or uses the
supplied filename in a path. A future object-storage adapter should stream the
source into quarantine instead. The final `STORAGE_KEY` is a server-generated
relative opaque key without traversal segments or backslashes. The development
adapter writes the normalized WebP to a randomly named quarantine file, creates
the final key without overwrite permission, and resolves every filesystem path
beneath the configured root.

Profile writes act only on the authenticated user's row. Group writes require
an active, writable group plus an `OWNER` or `ADMIN` membership; archived groups
are read-only. Reads must reauthorize the requesting user against the subject:
self or an allowed shared relationship for an avatar, and current group
membership for a group image. A UUID or storage key is never authorization, and
an inaccessible group/image should follow the API's existence-concealing `404`
policy.

Replacement is a short Oracle transaction after content processing: lock the
owner, mark the previous media row `SUPERSEDED`, insert the new `ACTIVE` row,
change the owner pointer, update its resource timestamp/version, and record the
audit event. Media mutations do not currently emit an outbox event; add one in
the same transaction if a downstream invalidation or notification consumer is
introduced. If the database transaction fails, delete the new object;
an orphan sweep remains the backstop because filesystem/object-store changes
cannot join the Oracle transaction. Deleting an image clears the owner pointer
before soft-deleting its media row.

Serve image content through an authenticated API handler rather than a static
mount. Use the canonical `image/webp` type, `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`,
and a private conservative cache policy. The current nginx policy sets all
`/api/` responses to `no-store`, and the service worker deliberately excludes
API images. If conditional caching is introduced later, use `private, no-cache`
plus the SHA-256 ETag so every reuse still reaches the authorization handler;
never put private avatars or group images in the public immutable image cache.

On rejection or request abort, remove quarantine content immediately. Sweep
abandoned quarantine files after one hour. Purge superseded binary objects after
the configured recovery grace period, retry failed deletions, and retain only a
bounded metadata tombstone. Reconciliation must report both database rows whose
objects are missing and storage objects with no database row, and must never
delete the key referenced by a current user or group pointer.

## Production object storage

Create a private bucket/container per environment with public access blocked,
provider-managed or customer-managed encryption, versioning appropriate to the
retention policy, lifecycle cleanup, access logging, and narrowly scoped
workload identity. The API should mint short-lived downloads only after Oracle
authorization; storage credentials must not reach the browser or web image.

The local filesystem adapter is a development boundary. Production image writes
must fail closed until the private object-storage adapter, malware hook, image
decoder resource isolation, encryption, lifecycle rules, and authorization
tests are activated. Re-encoding reduces risk but is not a substitute for
malware scanning or operational review.

Exercise upload, scan, authorization, deletion, legal-hold, backup, restore, key
rotation, provider outage, and orphan-reconciliation paths in staging. Record
regional residency and processor terms. Activation remains blocked until those
controls and the missing application adapter/routes are implemented and tested.
