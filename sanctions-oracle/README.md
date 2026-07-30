# sanctions-oracle

Off-chain adapter that checks a list of Stellar addresses against a
pluggable sanctions/watchlist data provider, then syncs any flagged
addresses into a Soroban `denylist-gate` contract instance (see
[compliance-primitives](https://github.com/stellar-compliance-kit/compliance-primitives))
by invoking its `add_to_denylist(address)` contract function.

> ---
> **WARNING: PLACEHOLDER MOCK DATA — DEVELOPMENT/TESTING ONLY**
>
> The `MockSanctionsProvider` shipped in this package (`src/mockProvider.ts`)
> is a placeholder mock for development and testing ONLY. It contains NO
> real sanctions data and must NEVER be used as a real compliance data
> source in production. See the root [README](../README.md) disclaimer
> section for the repo-wide version of this warning.
> ---

## What it does

- Defines a generic `SanctionsProvider` interface so any external
  sanctions/watchlist data source can be plugged into the sync flow.
- Ships one reference implementation, `MockSanctionsProvider`, backed by a
  small static in-file list — for local development and tests only.
- Provides `syncSanctionsToDenylist`, a function that checks a list of
  candidate addresses against a `SanctionsProvider` and, for any flagged
  addresses, calls `add_to_denylist(address)` on a Soroban `denylist-gate`
  contract instance via `@stellar/stellar-sdk`.
- The actual "submit a transaction" step is isolated behind an injectable
  `DenylistWriter` interface, so the sync logic can be unit tested with a
  fake writer, with no live network required.

This package does **not** implement real sanctions data fetching or a
provider registry — those are tracked as separate future issues.

Provider calls made during a sync (`provider.checkAddress`) are wrapped in
a retry-with-backoff helper (`withRetry`, see `src/retry.ts`): on failure
they retry with exponential backoff up to a configurable number of
attempts (`SyncOptions.retry`, default 3 attempts). If an address's
provider check still fails after exhausting all attempts, that address is
recorded in `SyncResult.failed` instead of aborting the whole sync run.

## The `SanctionsProvider` interface

```ts
export interface SanctionsProvider {
  checkAddress(address: string): Promise<{ flagged: boolean; source: string }>;
}
```

Implement this to plug in a real data source. For a detailed, copy-pasteable example of a REST-backed provider, see the `SanctionsProvider` JSDoc `@example` block in [`src/SanctionsProvider.ts`](./src/SanctionsProvider.ts) — it includes error handling and can serve as a template for integrating your own watchlist API.

A minimal implementation:

```ts
import { SanctionsProvider } from 'sanctions-oracle';

class MyProvider implements SanctionsProvider {
  async checkAddress(address: string) {
    const flagged = await myWatchlistApi.lookup(address);
    return { flagged: Boolean(flagged), source: 'my-watchlist-api' };
  }
}
```

Anything conforming to this interface — a REST client, a cache in front of
multiple upstream lists, a local CSV loader — can be passed to
`syncSanctionsToDenylist` in place of `MockSanctionsProvider`.

## Running the sync script

Once built (`npm run build`), the sync script is available as the
`sanctions-sync` CLI bin, or can be run directly with `node dist/sync.js`.

It reads a JSON file containing an array of candidate addresses to check
(in a real deployment this list might come from a chain scan or an
existing account list — the CLI takes it as a plain file for simplicity):

```json
[
  "GABC...",
  "GDEF..."
]
```

### Insomnia Collection

For a complete interactive reference of the sync script's CLI flags and
expected JSON input format, import [`insomnia_collection.json`](./insomnia_collection.json)
into [Insomnia](https://insomnia.rest/) or another API client. The collection includes:

- **Dry-run example** — Check addresses without submitting transactions
- **Live sync example** — Submit transactions to a Soroban contract
- **JSON schema documentation** — Expected addresses file format
- **CLI flags reference** — Complete parameter documentation

### Dry-run against testnet (no transactions submitted)

```sh
node dist/sync.js --addresses ./addresses.json --dry-run
```

This checks every address against the (mock) provider and logs each
planned `add_to_denylist(address)` call, without calling the writer at
all.

### Live sync

```sh
node dist/sync.js \
  --addresses ./addresses.json \
  --contract-id CABCDEF... \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --secret-key SABCDEF...
```

This builds, signs, and submits one `add_to_denylist` invocation per
flagged address using `@stellar/stellar-sdk`'s `Contract`,
`TransactionBuilder`, and `rpc.Server`.

## Troubleshooting

- **RPC url unreachable / request timeout** — verify `--rpc-url` is
  reachable from where you're running the script (e.g.
  `curl <rpc-url>`), and that you're not pointed at a local/private RPC
  endpoint from an environment that can't reach it.
- **Wrong network passphrase** — a `--network-passphrase` that doesn't
  match the network the RPC endpoint actually serves will cause
  transaction build or submission to fail (signature/hash mismatches,
  or the network rejecting the transaction). Double check you're using
  the testnet passphrase against a testnet RPC endpoint, and the
  pubnet/mainnet passphrase against a pubnet RPC endpoint.
- **Insufficient XLM balance for fees** — the account behind
  `--secret-key` needs enough XLM to cover the transaction fee (and to
  be funded/exist on the target network at all). Fund it via
  [friendbot](https://friendbot.stellar.org/) on testnet.
- **Contract not found** — a `--contract-id` that's misspelled, or that
  refers to a contract not deployed on the network your `--rpc-url`
  points at, will fail when the transaction is simulated/prepared.
  Double check the contract ID and that it's deployed on the same
  network you're targeting.

## Related

- Root repo [README](../README.md)
- [compliance-primitives](https://github.com/stellar-compliance-kit/compliance-primitives) —
  the Soroban contracts (including `denylist-gate`) this package talks to.
