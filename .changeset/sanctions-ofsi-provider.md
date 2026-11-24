---
'sanctions-oracle': minor
---

Add `OfsiSanctionsProvider` for the UK OFSI consolidated list. It loads a CSV
snapshot, maps Stellar G... addresses found in the export to OFSI entries and
reports the OFSI source (optionally qualified with a source column such as the
Group ID) in check results.
