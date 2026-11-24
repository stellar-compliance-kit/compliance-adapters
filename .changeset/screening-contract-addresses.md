---
'sanctions-oracle': minor
'shared': minor
---

Screening now accepts Soroban contract addresses (`C...`) end to end, in
addition to account addresses (`G...`). Added `isValidContractAddress` and
`isValidScreeningAddress` shared helpers and updated sync validation, CSV
watchlist loading and the CLI normalization path.
