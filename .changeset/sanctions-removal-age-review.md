---
'sanctions-oracle': minor
---

Add safeguards to opt-in delisting: `SyncOptions.minRemovalAgeDays` and the CLI
`--min-removal-age-days` hold cleared denylist entries that are too young (or
whose `addedAt` age is unknown/invalid) in a new `SyncResult.removalReviewQueue`
instead of removing them. Snapshots may now contain `{ address, addedAt }`
objects alongside plain address strings.
