---
'sanctions-oracle': minor
---

Added a `sanctions_oracle_provider_last_success_timestamp_seconds{provider="..."}`
gauge. `ProviderRegistry` accepts an optional metrics registry and records a
successful fetch per provider; failures never advance the timestamp. Includes
a documented Prometheus stale-data alert example.
