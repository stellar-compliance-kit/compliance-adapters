---
"@stellar/horizon-listener": minor
---

Add an optional HTTP health server for container orchestrator probes. When enabled via configuration, the listener exposes `GET /healthz` (returns 200 while the process is up) and `GET /readyz` (returns 200 only when listener lag is under a configurable threshold, otherwise a non-2xx status). The server is disabled by default and starts/stops with the listener lifecycle.
