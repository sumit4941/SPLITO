# Performance workload

`k6/ordinary-financial.js` is the reproducible baseline for ordinary API
operations. It uses real cookie authentication and MongoDB-backed routes with this
mix: 25% group list, 25% group detail, 25% expense list, 20% deterministic split
preview, and 5% committed expense creation. OCR and external provider latency are
excluded by design.

Run only against an isolated performance database because the write slice creates
auditable financial history:

```powershell
$env:SPLITO_BASE_URL = 'http://127.0.0.1:3000'
$env:SPLITO_LOAD_EMAIL = 'alice@splito.example'
$env:SPLITO_LOAD_PASSWORD = 'SplitoDemo!2026'
k6 run performance/k6/ordinary-financial.js
```

Defaults are 20 constant virtual users for 5 minutes with 150–500 ms think time.
The gate is p95 below 500 ms and HTTP/check failures below 1% for tagged ordinary
operations. Login is measured separately and does not dilute that percentile.

For a publishable run, start from a recorded synthetic snapshot with at least 100
users, 20 groups, 50 participants in the largest group, 50,000 expenses, 150,000
postings, and a 30-day outbox history. Record exact application and database versions,
host CPU/RAM/storage, database patch/parameters, pool sizes, replica counts,
network placement, dataset counts, k6 version/options, warm-up, raw summary, and
observed MongoDB/pool saturation. Repeat at least three times after warm-up and
report the median plus worst p95.

The script writes `performance/results/latest-summary.json`; result files are
evidence artifacts, not source fixtures. Do not claim the target passed unless a
result tied to the release commit and environment is reviewed.
