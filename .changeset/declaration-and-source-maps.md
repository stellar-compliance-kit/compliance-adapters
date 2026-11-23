---
'@compliance-adapters/backoff': patch
'@compliance-adapters/logger': patch
'@compliance-adapters/shared': patch
'@compliance-adapters/tracing-types': patch
'@compliance-adapters/metrics': patch
'@compliance-adapters/tracing': patch
'sep10-auth': patch
'sanctions-oracle': patch
'horizon-listener': patch
---

Emit declaration maps (`declarationMap`) alongside the existing source maps and
ship `src` in each package's published `files`, so editor go-to-definition opens
the TypeScript source and stack traces (with `--enable-source-maps`) map to TS.
