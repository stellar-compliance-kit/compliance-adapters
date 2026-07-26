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

This package does **not** implement real sanctions data fetching, retry
logic, or a provider registry — those are tracked as separate future
issues.

## The `SanctionsProvider` interface

```ts
export interface SanctionsProvider {
  checkAddress(address: string): Promise<{ flagged: boolean; source: string }>;
}
```

Implement this to plug in a real data source:

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
- **Sequence number errors (`tx_bad_seq` or similar)** — the error
  message typically includes `bad sequence` or an HTTP 400 with
  `transaction failed` during `sendTransaction`. This happens when the
  source account's sequence number in the transaction doesn't match what
  the network expects. Common causes:
  - The source account is being used by another process or script
    simultaneously (e.g. another sync run, a bot, or a manual wallet
    transaction), causing sequence numbers to drift.
  - A previous transaction from the same account hasn't been fully
    ingested by the network yet before the next one is submitted.

  **Fix:** ensure only one instance of the sync script runs against a
  given source account at a time. If you need to run concurrent syncs,
  use separate source accounts. If you're submitting many transactions
  in a loop (one per flagged address), add a small delay between
  submissions or poll `server.getTransaction(hash)` and wait for
  `status === 'SUCCESS'` before submitting the next one.
- **Rate limiting from the RPC endpoint (HTTP 429 or `ECONNRESET`)** —
  public RPC endpoints (including `https://soroban-testnet.stellar.org`)
  often enforce rate limits. Symptoms include:
  - `HTTP 429 Too Many Requests` responses.
  - Connection resets (`ECONNRESET`, `socket hang up`) mid-sync when
    submitting many transactions in quick succession.
  - Requests hanging or timing out after a batch of successful calls.

  **Fix:** first run a `--dry-run` to confirm that address checking
  works independently of submission throughput issues. Then add a
  delay between transaction submissions (e.g. 1–2 seconds) to stay
  within rate limits. For production workloads, consider using a
  dedicated RPC provider with higher rate limits, or self-hosting an
  RPC node.
- **Clock skew causing transaction submission failures** — if the local
  machine's clock is significantly out of sync with the Stellar network,
  transactions may be rejected because their time bounds don't align
  with the current ledger close time. The error may appear as a generic
  `sendTransaction` failure or a `transaction failed` status with no
  obvious explanation in the result codes.

  **Fix:** synchronize your system clock with NTP. On most Linux
  systems: `sudo ntpdate -u pool.ntp.org` or `sudo timedatectl
  set-ntp true`. On macOS, ensure "Set date and time automatically" is
  enabled in System Settings. A clock drift of more than 30 seconds is
  likely to cause issues.

## Related

- Root repo [README](../README.md)
- [compliance-primitives](https://github.com/stellar-compliance-kit/compliance-primitives) —
  the Soroban contracts (including `denylist-gate`) this package talks to.
