---
"horizon-listener": minor
---

Add the `listener_lag_ledgers` gauge (ledgers behind the chain head) with a stable, prefix-independent name, keep `<prefix>_ledger_lag` as a deprecated alias, and document Prometheus alerting examples for listener lag.
