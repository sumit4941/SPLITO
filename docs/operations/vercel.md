# Vercel web deployment

SPLITO's React PWA is configured for Vercel. The current API, MongoDB database,
outbox worker, and private media implementation are not all suitable for the
same Vercel deployment, so the supported boundary is:

```text
Browser
  |-- / and application routes --> Vercel static PWA
  `-- /api/* --------------------> Vercel rewrite --> HTTPS API service
                                                       |-- MongoDB Atlas
                                                       `-- private object storage

Always-on worker -------------------------------------> MongoDB/outbox/providers
```

The external rewrite keeps every browser request on the visible web origin.
That is required by the current host-only session cookie and browser-readable
CSRF cookie design. Keep `VITE_API_BASE_URL` unset in Vercel.

## Before importing the Git repository

1. Deploy the API to durable container compute near the MongoDB Atlas cluster.
   The API origin must be reachable over HTTPS. Do not expose MongoDB directly to
   the browser or run migrations as part of a web build.
2. Configure production private object storage and scanning before enabling
   profile or group image uploads. The current filesystem adapter deliberately
   refuses production mode.
3. Implement and deploy real production outbox handlers on an always-on worker
   platform. The current development handler deliberately refuses production.
4. Create separate backend, database, and provider resources for previews, or
   leave preview API access disabled. Never connect pull-request previews to the
   production financial database.

## Vercel project settings

Import the repository at its root. The checked-in `vercel.ts` selects Vite,
runs `npm ci`, builds only `@splito/web`, publishes `apps/web/dist`, proxies API
traffic before the SPA fallback, and applies the web security/cache headers.
The root Node engine pins the build to Node 24.

`vercel.ts` uses Vercel's `deploymentEnv()` and `routes.rewrite()` helpers. This
keeps the rewrite destination present while marking `SPLITO_API_ORIGIN` for
deployment-time substitution; do not replace it with an early `process.env`
lookup in the route object.

Set this non-secret environment variable for each enabled Vercel environment:

```text
SPLITO_API_ORIGIN=https://api.example.com
```

It must be a canonical HTTPS origin only: no trailing slash, `/api`, `/api/v1`,
credentials, query, or fragment. The build fails closed when it is absent or
malformed. Do not set `VITE_API_BASE_URL`; `/api/v1` must remain a same-origin
browser path.

The API environment corresponding to the production web deployment must use:

```text
NODE_ENV=production
WEB_ORIGIN=https://app.example.com
COOKIE_SECURE=true
```

Leave `COOKIE_DOMAIN` unset. Supply the independent session, CSRF, OTP, and MFA
secrets, a least-privilege `MONGODB_URI`, and complete Twilio API-key plus
exactly one sender configuration through the backend platform's secret manager.
Set `TRUST_PROXY=true` only if that service can receive traffic solely through a
trusted proxy that overwrites forwarding headers.

Invitation links are generated from `WEB_ORIGIN`, so change it to the final
custom domain before the release smoke test. When database ingress uses an IP
access list, use a backend platform with controlled egress or an Atlas private endpoint.

## Verification and release

Run locally before pushing the release commit:

```powershell
npm ci
npm run verify
$env:SPLITO_API_ORIGIN = 'https://api.example.com'
npm run vercel:validate
npm run build:vercel
Remove-Item Env:SPLITO_API_ORIGIN
```

After Vercel deploys, test through the final web hostname rather than calling the
backend directly:

1. Refresh `/login`, `/dashboard`, `/groups`, and another nested client route to
   confirm the SPA fallback.
2. Request and verify an OTP, reload the page, perform a CSRF-protected mutation,
   log out, then confirm the prior session cannot be reused.
3. Verify first-login account creation, invitation fragment handling, registered
   member addition, and creator-only expense edits against staging resources.
4. Confirm `/api/*` responses are never cached and private images are not stored
   by the service worker or public CDN.
5. Exercise MongoDB cold start, pool exhaustion, primary failover, database outage, and rolling
   release behavior before increasing traffic.

Do not mark the whole product production-ready until the open provider, worker,
private-storage, recovery, and load gates in the main deployment guide are
closed. Vercel readiness here means the web/PWA delivery edge is configured and
safe to connect to a separately operated backend.
