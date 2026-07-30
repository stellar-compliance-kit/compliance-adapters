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

## Local / testnet walkthrough

This section walks through everything needed to run a live (non-dry-run) sync against a local or public Soroban testnet: funding an account, deploying the `denylist-gate` contract, and obtaining the `--rpc-url`, `--contract-id`, and `--secret-key` values the CLI requires.

### Prerequisites

- [Node.js ≥ 20](https://nodejs.org/)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) — install with:
  ```sh
  cargo install --locked stellar-cli --features opt
  ```
  Or via the pre-built binaries on the [releases page](https://github.com/stellar/stellar-cli/releases).
- (Optional) [Docker](https://www.docker.com/) — only needed if you want a fully local network instead of the public testnet.

### Option A — Public Stellar testnet (quickest)

The Stellar Development Foundation runs a free, public Soroban-compatible testnet. No local Docker setup required.

```
RPC URL:            https://soroban-testnet.stellar.org
Network passphrase: Test SDF Network ; September 2015
```

#### 1. Generate a funded account

```sh
# Generate a new keypair
stellar keys generate --global alice --network testnet

# Print the secret key (keep this safe — treat it like a password)
stellar keys show alice

# The public key / address
stellar keys address alice
```

Friendbot automatically funds any newly generated testnet keypair when you use `--network testnet` with the Stellar CLI. If you created the keypair another way, fund it manually:

```sh
curl "https://friendbot.stellar.org/?addr=$(stellar keys address alice)"
```

Verify the account exists and has a balance:

```sh
stellar account balances --account-id $(stellar keys address alice) --network testnet
```

#### 2. Deploy the `denylist-gate` contract

> The `denylist-gate` Soroban contract lives in the [compliance-primitives](https://github.com/stellar-compliance-kit/compliance-primitives) repo. Clone it and build the `.wasm` first:
>
> ```sh
> git clone https://github.com/stellar-compliance-kit/compliance-primitives
> cd compliance-primitives
> cargo build --release --target wasm32-unknown-unknown
> ```
>
> The compiled artifact will be at something like
> `target/wasm32-unknown-unknown/release/denylist_gate.wasm`.

Deploy the contract to testnet and capture the contract ID:

```sh
CONTRACT_ID=$(stellar contract deploy \
  --wasm path/to/denylist_gate.wasm \
  --source alice \
  --network testnet)

echo "Contract ID: $CONTRACT_ID"
```

The CLI prints the contract ID (a `C…` address). Keep it — this is your `--contract-id` value.

#### 3. Build the CLI

From inside the `sanctions-oracle` package:

```sh
npm install
npm run build
```

#### 4. Prepare an addresses file

Create a JSON file containing the Stellar addresses you want to check:

```json
["GABC...", "GDEF..."]
```

```sh
echo '["GABC...","GDEF..."]' > addresses.json
```

#### 5. Run a live sync

```sh
node dist/sync.js \
  --addresses ./addresses.json \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --contract-id "$CONTRACT_ID" \
  --secret-key "$(stellar keys show alice)"
```

The CLI submits one `add_to_denylist(address)` transaction per flagged address and prints a JSON summary, for example:

```json
{
  "checked": 2,
  "flagged": ["GABC..."],
  "written": ["GABC..."],
  "dryRun": false
}
```

---

### Option B — Fully local network (no public testnet)

Use `stellar network start` (backed by Docker) to run an isolated local environment:

```sh
# Start a local Stellar/Soroban node (runs in the background)
stellar network start local

# The local RPC endpoint and passphrase
#   RPC URL:            http://localhost:8000/soroban/rpc
#   Network passphrase: Standalone Network ; February 2017
```

Generate and fund a local account:

```sh
stellar keys generate --global alice --network local

# Friendbot for the local network
curl "http://localhost:8000/friendbot?addr=$(stellar keys address alice)"
```

Deploy and run exactly as in Option A, substituting:

```sh
--rpc-url http://localhost:8000/soroban/rpc \
--network-passphrase "Standalone Network ; February 2017"
```

Stop the local node when done:

```sh
stellar network stop local
```

---

### Quick-reference: values at a glance

| Flag | Public testnet | Local network |
|---|---|---|
| `--rpc-url` | `https://soroban-testnet.stellar.org` | `http://localhost:8000/soroban/rpc` |
| `--network-passphrase` | `Test SDF Network ; September 2015` | `Standalone Network ; February 2017` |
| `--contract-id` | output of `stellar contract deploy …` | output of `stellar contract deploy …` |
| `--secret-key` | output of `stellar keys show <name>` | output of `stellar keys show <name>` |

---

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
