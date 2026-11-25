# Full-stack Demo

This example app demonstrates an end-to-end integration of the three monorepo packages:

- `sep10-auth` protects a private Express route with SEP-10 bearer token verification
- `horizon-listener` watches Soroban RPC contract events and forwards them to a webhook
- `sanctions-oracle` syncs flagged addresses using a mock provider in dry-run mode

## Full compliance flow

The demo models the compliance path a regulated service would follow before letting a
payment through:

1. **SEP-10 login** — the client requests a challenge (`GET /auth?account=G…`), signs it with
   the account's keypair, and exchanges it for a bearer token (`POST /auth`). The token is
   required on every protected route below.
2. **Sanctions sync** — before authorizing a payment, the service refreshes its sanctions
   registry (`POST /sanctions/sync` with the counterparties involved) and checks the
   recipient (`GET /sanctions/check?address=G…`). A flagged address must be rejected.
3. **Denylist-checked payment** — the payment is submitted to the `denylist-gate` contract,
   which re-checks the recipient on-chain. If the address is not on the denylist the
   transfer proceeds; otherwise the contract rejects it.
4. **Horizon notifications** — `horizon-listener` watches the `denylist-gate` contract events
   and forwards each one to `WEBHOOK_URL` (or logs it to stdout when unset), so downstream
   systems are notified of denylist updates and blocked payments.

### Walkthrough

With the server running (see below) and `DENYLIST_CONTRACT_ID` set:

```bash
# 1. SEP-10 login: fetch a challenge, sign it client-side, then verify.
curl "http://localhost:3000/auth?account=$ACCOUNT"
curl -X POST http://localhost:3000/auth -H 'Content-Type: application/json' \
  -d '{"transaction":"<signed challenge XDR>"}'
# → { "token": "…", "address": "G…" }

# 2. Sanctions sync and recipient check (bearer token from step 1).
curl -X POST http://localhost:3000/sanctions/sync \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"addresses":["G…"]}'
curl "http://localhost:3000/sanctions/check?address=G…" -H "Authorization: Bearer $TOKEN"

# 3. Submit the payment to the denylist-gate contract (rejected if flagged).

# 4. Start the listener so contract events reach the webhook.
curl -X POST http://localhost:3000/admin/listener/start -H "X-Admin-Token: $ADMIN_TOKEN"
```

Listener notifications are delivered as `POST` requests to `WEBHOOK_URL`; when it is unset
they are written to stdout, which is the easiest way to observe the flow locally.

## Run the demo

From the repository root:

```bash
npm install
npm run build --workspaces --if-present
npm start --workspace=examples/full-stack-demo
```

The app listens on `http://localhost:3000` and exposes:

- `GET  /health`                   — liveness check; returns `{ status: 'ok', serverPublicKey }`.
- `GET  /auth?account=G…`          — issue a SEP-10 challenge for the given Stellar address.
- `POST /auth`                     — verify a signed SEP-10 challenge and return the authenticated address.
- `POST /auth/revoke`              — revoke a previously-issued token (logout).
- `GET  /sanctions/check?address=` — check a single Stellar address against the provider registry.
- `POST /sanctions/sync`           — trigger a full sanctions sync run; body: `{ addresses: string[], dryRun?: boolean }`.
- `POST /admin/listener/start`     — start the Horizon event listener (requires `X-Admin-Token` header).
- `POST /admin/listener/stop`      — stop the Horizon event listener (requires `X-Admin-Token` header).
- `GET  /metrics`                  — Prometheus metrics in text exposition format.

## Configuration

Use environment variables to customize runtime values:

- `PORT` — HTTP port the server listens on (default: `3001`).
- `HOME_DOMAIN` — SEP-10 home domain included in challenges (default: `localhost:<PORT>`).
- `SERVER_SECRET` — Stellar secret key (`S…`) used to sign SEP-10 challenges. Falls back to an ephemeral random keypair (regenerated on every restart) if unset — fine for a single local run, not for anything shared.
- `NETWORK_PASSPHRASE` — Stellar network passphrase (default: testnet passphrase).
- `CSV_SANCTIONS_PATH` — Path to a CSV watchlist file. When set, a `CsvSanctionsProvider` is prepended to the provider registry ahead of the mock provider.
- `DENYLIST_CONTRACT_ID` — Deployed `denylist-gate` contract ID. Required to enable the live RPC denylist writer and the Horizon event listener.
- `SOROBAN_RPC_URL` — Soroban RPC endpoint (default: `https://soroban-testnet.stellar.org`).
- `WEBHOOK_URL` — Webhook target URL for `horizon-listener` events. When unset, events are logged to stdout instead.
- `HORIZON_START_LEDGER` — Starting ledger for Horizon event polling.
- `ADMIN_TOKEN` — Shared secret required in the `X-Admin-Token` header for `POST /admin/listener/start` and `/admin/listener/stop`. When unset, all `/admin/*` routes return `503` (fail closed). Admin routes are also IP rate-limited.

To exercise the full compliance flow, set at minimum `DENYLIST_CONTRACT_ID`, `ADMIN_TOKEN`
and (optionally) `WEBHOOK_URL`; `CSV_SANCTIONS_PATH` lets you drive the sanctions check from
a real watchlist instead of the mock provider.

## Hardening features not wired into this demo

This demo intentionally stays minimal, but each package it wires together has grown additional
hardening features that a production deployment would typically layer on top:

- **`sep10-auth`** — a `rateLimiter` middleware for throttling challenge/verify requests, and a
  `RevocationStore` for invalidating previously-issued sessions.
- **`sanctions-oracle`** — a `ProviderRegistry` for falling back across multiple sanctions data
  sources, a `CsvSanctionsProvider` for loading watchlists from a CSV file instead of the mock
  provider, and metrics/tracing instrumentation around sync runs.
- **`horizon-listener`** — matching metrics/tracing instrumentation around event polling and
  webhook delivery.

See each package's own README for usage details.
