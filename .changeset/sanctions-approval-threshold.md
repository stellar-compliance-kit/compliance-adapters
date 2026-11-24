---
'sanctions-oracle': minor
---

Add an approval threshold for large syncs: `SyncOptions.maxAutoWrites` and CLI
`--approval-threshold <n>` pause a live run before submitting any writes when
adds + removals exceed the limit. The result reports `approvalRequired`, and
the CLI exits with the new `EXIT_CODE_APPROVAL_REQUIRED` (4).
