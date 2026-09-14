# Local Windows runbook

The simplest Windows setup uses the hosted MongoDB Atlas deployment for both
local API development and the deployed backend. The database must be a replica
set because SPLITO uses multi-document transactions.

## Prerequisites

- Node.js 24 and npm 11
- A MongoDB Atlas database user scoped to the SPLITO database
- Your current public IP in the Atlas project IP access list

## Configure

Copy `.env.example` to the ignored `.env`. Set a newly generated Atlas URI; do
not reuse a password that has appeared in chat, logs, or source control.

```powershell
$env:MONGODB_URI = 'mongodb+srv://<db-user>:<percent-encoded-password>@<cluster-host>/?retryWrites=true&w=majority&appName=Splito'
$env:MONGODB_DATABASE = 'splito'
```

Also generate independent values for `SESSION_PEPPER`, `CSRF_SECRET`,
`OTP_PEPPER`, and `MFA_ENCRYPTION_KEY`. Local development can use
`COOKIE_SECURE=false`, `SMS_PROVIDER=disabled`, and
`WEB_ORIGIN=http://localhost:5173`.

## Install and initialize

```powershell
npm ci
npm run db:migrate
npm run db:verify
npm run db:status
```

To load synthetic local data:

```powershell
$env:NODE_ENV = 'development'
$env:SPLITO_ALLOW_DEVELOPMENT_SEED = 'true'
npm run db:seed
npm run db:reconcile
```

Start all services with `npm run dev`, or run the API, web app, and worker in
separate terminals with `npm run dev:api`, `npm run dev:web`, and
`npm run dev:worker`.

The local web URL is `http://localhost:5173`; the API listens on
`http://localhost:3000`. Remove temporary process secrets after the session:

```powershell
Remove-Item Env:MONGODB_URI, Env:SESSION_PEPPER, Env:CSRF_SECRET, Env:OTP_PEPPER, Env:MFA_ENCRYPTION_KEY -ErrorAction SilentlyContinue
```

For a fully local database used by the host-run Node processes, start the
loopback-only single-node replica set:

```powershell
docker compose --profile local-db up -d mongo mongo-init
docker compose ps
```

Keep the default `mongodb://127.0.0.1:27017/?replicaSet=rs0` URI. The
`mongo-init` helper exits after idempotently initializing the replica set. A
standalone `mongod` can answer reads and writes but cannot run SPLITO's required
financial transactions. Containerized API/worker deployments should use Atlas
or another external replica set rather than this host-oriented profile.
