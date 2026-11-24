---
'sanctions-oracle': minor
---

Dry-run fee estimates are now summed from a per-write estimate for every
pending address instead of multiplying the first estimate. The plan output
includes `feeEstimate.perWriteFeesStroops` alongside the total in stroops/XLM.
