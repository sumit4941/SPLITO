# Deployment guide

The provided images package API, worker, and static web services. Oracle remains
external; `compose.yaml` intentionally does not start or replace the installed
database.

## Build and release

1. Run the complete CI and Oracle integration workflow on the release commit.
2. Resolve high/critical dependency and container findings or record narrow,
   expiring risk acceptance. Generate an SBOM and sign immutable image digests in
   the delivery platform.
3. Back up and validate recovery, then apply migrations as a separate one-shot
   release action using only the owner credential.
4. Deploy the API with only `SPLITO_APP` and the static web image without
   database/provider secrets. Deploy a worker image only after real production
   handlers are registered; the current development log sink deliberately
   refuses to start in production.
5. Run readiness, API/UI smoke, authorization, and financial reconciliation
   checks. Monitor before increasing traffic.

Local image smoke build:

```powershell
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d api web
docker compose ps
```

The worker service is behind the `worker` Compose profile. In development, that
explicit opt-in uses a log-only acknowledgement sink; never point it at shared
data. In production the sink refuses to start. The supplied worker image and
lease machinery are a foundation, not an enabled production consumer; after
real handlers and their acceptance tests exist, enable the profile as part of a
reviewed release.

Compose binds web/API to loopback. A production ingress must provide HTTPS,
request/body/time limits, forwarded-header normalization, HSTS, and the public
hostname. The web container proxies `/api/` to the API so the browser remains
same-origin. Set `SPLITO_WEB_ORIGIN` to the exact external origin. Compose enables
`TRUST_PROXY` because nginx overwrites forwarding headers; outside Compose,
enable it only when traffic can arrive solely from a trusted normalizing proxy.
Prefer the default host-only cookie; add `COOKIE_DOMAIN` through a reviewed
deployment overlay only if a cross-subdomain requirement justifies its wider
scope. The example `.env` uses development mode and loopback HTTP for local image
smoke tests; every deployed environment must set `NODE_ENV=production`, an HTTPS
origin, and `COOKIE_SECURE=true`, which are also enforced by runtime validation.

## Required secret/config separation

- API: runtime database password, independent session and OTP peppers, CSRF
  secret, MFA envelope-encryption key reference, and only the adapter secrets
  it uses.
- Worker: runtime database password plus only its polling/logging configuration
  and activated adapter secrets. It does not receive browser-authentication or
  bootstrap/migration secrets.
- Migration job: owner password only; no session/provider secrets.
- Bootstrap job: temporary DBA password plus new user secrets; remove immediately
  after use.
- Web image: no secrets. Vite values are public by construction.

Prefer workload identity and a platform secret manager. Mount/inject secrets at
runtime, prevent them from appearing in image layers, Compose files, shell
history, crash reports, metrics, or logs, and document rotation. Rotate the
shared administrator credential before non-local use.

Compose uses `.env` only for variable interpolation and explicitly allowlists
each service environment. It never bulk-injects that file: administrator and
owner variables therefore cannot leak into the API or worker merely because an
operator used them during setup. Keep the bootstrap outside regular deployment;
the one-shot migration profile receives only its `SPLITO_MIGRATION_*` values.

## Storage/providers

`ATTACHMENT_STORAGE_PATH` and the mounted private volume back the development
filesystem boundary used by normalized profile and group images. Expense
receipt upload/OCR remains incomplete. Production requires a private
object-storage adapter, server-side encryption, blocked public access,
short-lived authorized downloads, lifecycle policies, and malware scanning; the
filesystem image adapter must fail closed in production. The app must
reauthorize the owning user/group or expense on every retrieval; storage keys
are never durable bearer access.

Manual settlement is available without an external provider. Manual FX is the
intended provider-free baseline, but its transaction/API/UI are not implemented.
SMS, email, OCR, live FX, payment, UPI, or bank adapters stay visibly disabled
until credentials, regional availability/licensing, signed webhook details,
sandbox tests, privacy terms, timeout/retry policy, and operational ownership
exist. Production mobile-OTP requests currently return `503` until an SMS
adapter is configured; never turn on a success response that does not deliver.
The direct `developmentOtp` response is permitted only with development runtime
guards and is not a production delivery mechanism. A QR/deep-link launch never
proves payment.

Use the detailed [private-storage](private-storage.md) and
[provider-activation](providers.md) gates before enabling either boundary.

## Scaling

API replicas are stateless. Multiply `DATABASE_POOL_MAX` by all API and worker
replicas and keep the result inside the DBA-approved connection budget. Workers
coordinate through Oracle leases; keep clocks synchronized and leases longer
than expected transaction work but shorter than alerting thresholds. Drain API
requests and worker leases during shutdown. Autoscale on sustained latency,
queue depth, and pool pressure—not CPU alone.

Docker was not installed on the inspected Windows host, so no local image or
Compose runtime smoke test was performed. The container CI workflow validates
the Compose model, builds all three images, checks compiled entry points, and
parses the nginx configuration when it runs; retain that release output as
evidence. No production deployment or provider activation was performed as part
of this repository delivery.
