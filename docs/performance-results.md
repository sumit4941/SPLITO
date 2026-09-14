# Performance results

Status: **not measured**.

The target is p95 below 500 ms for ordinary financial API operations under the
baseline in `../performance/README.md`, excluding OCR and external-provider
latency. No valid MongoDB-backed baseline run has been executed or attached for
this repository state, so no latency, throughput, or capacity claim is made.

## Result template

| Field                                 | Value                              |
| ------------------------------------- | ---------------------------------- |
| Application commit/image digest       | Not recorded                       |
| MongoDB version/topology              | Not recorded for a performance run |
| App/DB hardware and network           | Not recorded                       |
| Dataset row counts/snapshot           | Not recorded                       |
| API/worker replicas and pool settings | Not recorded                       |
| k6 version, VUs, duration             | Not executed                       |
| Throughput                            | Not measured                       |
| Ordinary operation p50/p95/p99        | Not measured                       |
| Error/check rate                      | Not measured                       |
| Pool/MongoDB bottleneck observations  | Not measured                       |
| Conclusion/limitations                | Pending a reproducible run         |

Populate this file only from the saved raw summary and monitoring evidence. Keep
OCR/provider measurements in separate scenarios so their latency cannot distort
or excuse the ordinary-operation target.
