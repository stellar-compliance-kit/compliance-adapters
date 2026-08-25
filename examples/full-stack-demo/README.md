# Full-stack Demo

This example app demonstrates an end-to-end integration of the three monorepo packages:

- `sep10-auth` protects a private Express route with SEP-10 bearer token verification
- `horizon-listener` watches Soroban RPC contract events and forwards them to a webhook
- `sanctions-oracle` syncs flagged addresses using a mock provider in dry-run mode

## Run the demo

From the repository root:

```bash
npm install
npm run build --workspaces --if-present
npm start --workspace=examples/full-stack-demo
```

The app listens on `http://localhost:3000` and exposes:

- `GET /public`
- `GET /private`
- `GET /sync`
- `GET /challenge`

## Configuration

Use environment variables to customize runtime values:

- `SERVER_SECRET_KEY` — Stellar secret key used to sign SEP-10 challenges in `/challenge`. Falls back to an ephemeral random keypair (regenerated on every restart) if unset — fine for a single local run, not for anything shared.
- `SERVER_ACCOUNT_ID` — must match `SERVER_SECRET_KEY`'s public key; defaults to that public key when omitted
- `RPC_URL`
- `CONTRACT_ID`
- `START_LEDGER`
- `WEBHOOK_URL`
- `NETWORK_PASSPHRASE`
- `HOME_DOMAIN`
- `WEB_AUTH_DOMAIN`
