# SPLITO

SPLITO is an API-first expense-sharing foundation for groups, friends, and
households. It combines a React PWA, a NestJS/Fastify API, deterministic
integer-money domain logic, an Oracle-backed journal, and a durable outbox
worker in one TypeScript monorepo.

This repository implements a tested vertical slice and broad schema/UI
foundations. It is not yet a production-complete replacement for every feature
in the product brief. Production outbox delivery, several lifecycle workflows,
provider integrations, restore evidence, and measured load results remain open;
see the [feature coverage matrix](docs/feature-coverage-matrix.md) and
[requirements checklist](docs/requirements-checklist.md).

## Prerequisites

- Node.js 24 LTS (CI and images use `24.21.0`) and npm 11.6+
- Oracle AI Database 26ai with a writable application PDB
- For the inspected local Oracle Free installation, use
  `localhost:1521/FREEPDB1`; never create application users in `FREE`/`CDB$ROOT`

## Local setup

1. Copy `.env.example` to the ignored `.env` and generate independent database,
   session, CSRF, OTP-pepper, and MFA secrets. Do not reuse an administrator
   password or reuse one secret for another purpose.
2. Install exactly the locked dependency graph:

   ```powershell
   npm ci
   ```

3. Create the dedicated schema-owner and runtime users, then immediately remove
   the administrator credential from `.env` and the process environment:

   ```powershell
   npm run db:bootstrap
   ```

4. Apply and validate the forward-only migrations:

   ```powershell
   npm run db:migrate
   npm run db:check-prefix
   npm run db:status
   npm run db:verify
   ```

5. Optionally load synthetic demo data. This command is deliberately rejected
   unless `.env` contains `NODE_ENV=development` and
   `SPLITO_ALLOW_DEVELOPMENT_SEED=true`:

   ```powershell
   npm run db:seed
   npm run db:reconcile
   ```

6. Start the API, web application, and development-only worker:

   ```powershell
   npm run dev
   ```

Open `/login`, the only public application screen, and sign in with a mobile
number followed by the six-digit OTP. The seeded fictional numbers are:

- Alice: `+12025550101`
- Bob: `+12025550102`
- Casey: `+12025550103`

In local development, the request response includes `developmentOtp` so the
flow is testable without an SMS provider. This value is development-only.
Outside development, OTP and group-invitation delivery use the validated Twilio
adapter and never expose a code or join token in an API response. Production
configuration fails closed unless the provider credentials and exactly one
sender option are complete; provider failures are reported rather than claiming
that a message was sent.

The first verified login for an unseen E.164 number creates its user,
participant, and preferences in the same Oracle transaction. Each successful
login revokes any previous unrevoked session for that account before issuing a
new opaque cookie, and a database unique index enforces the one-active-login
rule. The seeded emails and the development-only password
`SplitoDemo!2026` remain for legacy API compatibility; the web login does not
expose that flow. Never run the seeder or use development credentials in
production.

SMS OTP is susceptible to phishing, SIM-swap, and mobile-network attacks. Treat
it as a restricted authenticator and add a stronger recovery path and passkey
MFA before production use.

From a group's **People** tab, an active owner or administrator can add a mobile
number. A registered, verified account becomes an active member immediately. An
unknown number instead receives a seven-day SMS link whose token is bound to
that exact verified number and permits one membership transition, with a safe
same-account retry. The recipient signs in or creates an
account through the existing OTP flow, reviews the invitation at `/join`, and
must explicitly accept before becoming a member or appearing in expense splits.
Only managers see masked pending invitations; raw tokens are hash-only at rest
and travel in the URL fragment so they are not sent in ordinary HTTP request
targets. Development captures and returns the join URL for deterministic local
testing without contacting a real phone.

Every active group member can list and open the group's posted expenses. Each
response names the creator and carries an authoritative `canEdit` flag. Only the
active member who originally created a posted expense can edit it—even an owner
or administrator cannot edit another member's entry. An edit requires
`If-Match` and `Idempotency-Key`, appends an immutable revision, exactly reverses
the prior journal effect in its original currency, and posts the replacement in
its selected currency.

After login, open **View profile** from the account chip to add, change, or
remove the signed-in person's picture. Group owners and administrators can do
the same for a group from its detail page. Local development accepts one JPEG,
PNG, or WebP file up to 10 MB, removes metadata, and stores a normalized private
WebP outside the web root. Authenticated reads are reauthorized on every request.
Production media remains disabled until the private object-storage, scanning,
isolation, and cleanup controls in
[`docs/operations/private-storage.md`](docs/operations/private-storage.md) are
activated.

Oracle objects are owned by `SPLITO_OWNER`; API and worker connections use
`SPLITO_APP` and explicitly set `DATABASE_OWNER_SCHEMA=SPLITO_OWNER` on each
session. Every application table begins with `SPLITO_`. No public synonyms or
SYS package grants are required.

## Verification

```powershell
npm run verify
npm audit --audit-level=moderate
```

`verify` runs formatting, lint, all workspace type checks, the unit/property
suite with global and critical financial/outbox/idempotency coverage gates, and
all production builds. With the seeded Oracle database and API running, exercise
the real persistence path too:

```powershell
npm run smoke:api
npm run smoke:group-invitations
npm run test:integration --workspace @splito/worker
```

Local verification recorded on 2026-09-13 passed the complete `verify` pipeline
(32 test files, 189 tests, coverage gates, and all production builds), the
10-file/42-test web suite, the 42-file/210-test API suite, the 2-case Oracle
worker integration suite, and both
live Oracle-backed API smoke flows. An idempotent migration rerun reported V001
through V006 applied, and prefix/schema validation observed 55 `SPLITO_` tables,
including all 23 critical tables. The browser suite passed all 13 applicable
desktop/mobile checks with 7 intentional viewport-specific skips when run
against the installed Chrome fallback. The live smoke covered first-login
account creation, returning-number login, wrong-code and replay denial,
prior-session invalidation, logout revocation, registered-member addition,
phone-bound invitation acceptance, shared expense visibility, and creator-only
versioned edits. It also verifies that raw routes, HTTP diagnostics, exception
text, and request IDs never reach error screens. Twilio request construction is
mocked in tests; no real carrier SMS is claimed without deployment credentials.

The live authenticated media lifecycle also passed upload, replacement, private
WebP delivery, UI propagation, removal, and stale-URL denial for both profile and
group pictures using a 2.4 MB PNG source.

Playwright normally manages its pinned Chromium build:

```powershell
npx playwright install chromium
npm run test:e2e
```

If that browser download is unavailable and a trusted Chromium-compatible
browser is already installed, set `PLAYWRIGHT_EXECUTABLE_PATH` to its executable
for a local fallback run. Record the browser version because this fallback is
less reproducible than Playwright's managed revision.

The Oracle integration workflow bootstraps fresh least-privilege users, applies
and reruns all migrations on an immutable Oracle 26ai Free image, checks schema
prefixes and invariants, seeds/reconciles synthetic journal data, and exercises
worker lease concurrency. Browser tests and security workflows are defined
under `.github/workflows/`.

For container smoke testing, Oracle remains external:

```powershell
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d api web
```

The worker Compose profile is disabled by default because the current log-only
handler intentionally refuses production mode.

## Vercel web deployment

The React PWA is ready to deploy from the repository root to Vercel. The
checked-in configuration builds only the web workspace, provides client-route
fallbacks, preserves the existing browser security headers, and proxies
same-origin `/api/*` requests to the HTTPS origin in `SPLITO_API_ORIGIN`.

The Oracle-backed API, private media, and always-on outbox worker retain their
documented production gates; they are not silently converted into unsuitable
ephemeral functions. Follow the [Vercel deployment runbook](docs/operations/vercel.md)
for the exact topology, environment settings, and release checks.

## Documentation

- [Architecture](docs/architecture.md)
- [API contract](docs/api.md) and [checked-in OpenAPI](docs/openapi.json)
- [Database/ERD](docs/erd.md) and [financial rules](docs/financial-rules.md)
- [Oracle operations](docs/operations/oracle.md),
  [migrations/recovery](docs/operations/migrations.md), and
  [deployment](docs/operations/deployment.md), including the
  [Vercel web runbook](docs/operations/vercel.md)
- [Threat model](docs/security/threat-model.md) and
  [security verification status](docs/security/security-report.md)
- [Dependency decisions](docs/dependency-decisions.md) and
  [performance status](docs/performance-results.md)
