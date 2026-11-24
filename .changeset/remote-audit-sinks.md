---
'sanctions-oracle': minor
---

Added pluggable remote audit sinks: `createS3AuditLogger`,
`createGcsAuditLogger` and `combineAuditLoggers`. Every audit event becomes an
immutable JSON object in S3/GCS under `prefix/YYYY/MM/DD/`, so audit logs survive
ephemeral containers. Cloud SDKs load lazily and clients are injectable for
mock-based tests. Wired the CLI flags `--audit-s3`, `--audit-gcs` and the
previously inert `--audit-log` to the live denylist writer for both additions
and removals.
