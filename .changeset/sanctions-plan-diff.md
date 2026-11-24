---
'sanctions-oracle': minor
---

Add `--plan` mode to the CLI. It performs a read-only run and prints every
planned add/remove with the provider source, including removals derived from
`--denylist-snapshot`. `--plan --json` emits the same diff as a machine-readable
`plan.adds` / `plan.removes` field on the result, also available programmatically
via `SyncOptions.plan` and `SyncResult.plan`.
