# SPLITO

SPLITO is an API-first expense-sharing application for groups, friends, and
households. It combines a React PWA, NestJS/Fastify API, deterministic
integer-money domain logic, MongoDB-backed journal, and durable outbox worker in
one TypeScript monorepo.

The implemented vertical slice includes mobile OTP login with first-login
account creation and one active session, groups and phone-bound invitations,
shared expense visibility with creator-only editing, balances, settlements, and
private profile/group images. Production SMS, object storage/scanning, outbox
delivery handlers, recovery evidence, and measured load results retain explicit
release gates in the documentation.

## Prerequisites

- Node.js 24 LTS and npm 11.6+
- MongoDB Atlas or another replica set/sharded cluster with transaction support
- Separate API and worker database users. Production uses collection-scoped
  custom roles; the built-in `readWrite` role is acceptable only for local
  development because it cannot enforce immutable journal/provenance records.
  Both runtime roles also need read-only `listCollections`/`listIndexes`
  metadata actions for fail-closed startup schema verification.
- A separately injected migration user with `readWrite` plus `dbAdmin` on only
  that database (or an equivalent custom role including `collMod`)
- The API and worker egress addresses allowed by Atlas network access

MongoDB never connects directly to the browser or Vercel static web project.

## MongoDB connection

Copy `.env.example` to the ignored `.env` and set:

```text
MONGODB_URI=mongodb+srv://<db-user>:<percent-encoded-password>@<cluster-host>/?retryWrites=true&w=majority&appName=Splito
MONGODB_DATABASE=splito
```

The URI is a backend secret. Percent-encode reserved password characters. If a
credential has appeared in chat, logs, or source control, rotate it before use.
Also generate independent `SESSION_PEPPER`, `CSRF_SECRET`, `OTP_PEPPER`, and
`MFA_ENCRYPTION_KEY` values.

For `db:migrate`, temporarily inject the migration user's URI. Start the API
with its API URI and the worker with a different worker URI; do not store the
migration credential in either runtime environment.

## Local setup

```powershell
npm ci
npm run db:migrate
npm run db:verify
npm run db:status
npm run dev
```

The optional local Compose profile exposes a loopback-only replica set to Node
processes running on the host:

```powershell
docker compose --profile local-db up -d mongo mongo-init
```

Keep the default local `MONGODB_URI` from `.env.example` for that profile.

To load deterministic synthetic users, a group, and a balanced expense, set
`NODE_ENV=development` and `SPLITO_ALLOW_DEVELOPMENT_SEED=true`, then run:

```powershell
npm run db:seed
npm run db:reconcile
```

Open `http://localhost:5173/login` and sign in with a mobile number and OTP. In
development only, the OTP is returned for testing. Production requires the
validated Twilio configuration and never exposes the code or invitation token.

The first verified login for a new E.164 number creates its user, participant,
and preferences in one MongoDB transaction. A stable session slot and unique
indexes ensure one active login per user. Group invitations are hash-only at
rest and bound to the verified phone number. Every active group member can view
expenses; only the active member who created an expense can edit it.

Profile and group images are normalized to private WebP objects outside the web
root. Production uploads remain disabled until the private object-storage and
scanning controls in
[private-storage.md](docs/operations/private-storage.md) are activated.

## Verification

```powershell
npm run verify
npm audit --audit-level=moderate
npm run db:migrate
npm run db:status
npm run db:reconcile
npm run smoke:api
npm run smoke:group-invitations
npm run test:integration --workspace @splito/worker
```

The MongoDB integration workflow starts a fresh single-node replica set, applies
the schema twice to prove idempotency, checks managed indexes, seeds and
reconciles the journal, and exercises worker lease behavior. Browser, dependency,
secret-scan, CodeQL, and container workflows live under `.github/workflows/`.

For container builds, production MongoDB remains external:

```powershell
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d api web
```

The worker profile remains opt-in because its development log sink refuses to
run in production until real delivery handlers are configured.

## Vercel web deployment

Vercel builds only the React PWA. Set only
`SPLITO_API_ORIGIN=https://<backend-host>` in the Vercel project. Deploy the API
and worker separately with their MongoDB and provider secrets; never put
`MONGODB_URI` in the frontend project.

See [the Vercel runbook](docs/operations/vercel.md) for the supported topology.

## Documentation

- [Architecture](docs/architecture.md)
- [API contract](docs/api.md) and [OpenAPI](docs/openapi.json)
- [MongoDB operations](docs/operations/mongodb.md),
  [schema changes](docs/operations/migrations.md), and
  [backup/restore](docs/operations/backup-restore.md)
- [Database model](docs/erd.md) and [financial rules](docs/financial-rules.md)
- [Threat model](docs/security/threat-model.md) and
  [security status](docs/security/security-report.md)
- [Feature coverage](docs/feature-coverage-matrix.md) and
  [requirements status](docs/requirements-checklist.md)
