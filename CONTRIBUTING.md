# Contributing to compliance-adapters

Thanks for your interest in contributing! This repo is the off-chain integration layer for the
[compliance-primitives](https://github.com/stellar-compliance-kit/compliance-primitives) Soroban
contracts, and it's intentionally structured to have lots of small, well-scoped issues — a good
entry point if you're comfortable with TypeScript/Node but don't (yet) know Soroban internals.

## Drips Wave Stellar Program

This repo participates in the [Drips Wave](https://www.drips.network/) Stellar Program. Issues
are labeled by complexity so you can pick work that matches your available time and experience:

- `complexity: trivial` — small, self-contained, usually a few lines or a single test. Also
  tagged `good first issue`.
- `complexity: medium` — a feature or integration that touches one package meaningfully.
- `complexity: high` — cross-package design work, new abstractions, or security-sensitive changes.

Check open issues for the current bounty/reward status under the Drips Wave program before
starting work, and comment on an issue to claim it so we don't get duplicate PRs.

## Getting started

```bash
git clone https://github.com/stellar-compliance-kit/compliance-adapters.git
cd compliance-adapters
npm install
npm test
```

Each package under the repo root (`sep10-auth/`, `sanctions-oracle/`, `horizon-listener/`) is an
independent npm workspace with its own `package.json`, `README.md`, and test suite. Run a single
package's tests with:

```bash
npm test --workspace=sep10-auth
```

## Development workflow

1. Fork the repo and create a branch off `main`.
2. Make your change, keeping it scoped to the linked issue.
3. Add or update tests — PRs that touch behavior without test coverage will be asked to add it.
4. Run `npm run lint` and `npm test` locally before opening a PR.
5. Open a PR referencing the issue number (`Fixes #123`) and describe what you changed and why.

## Package boundaries

This is a monorepo of three independent npm workspaces, each covering a distinct stage of the
compliance flow. When adding new functionality, use these boundaries to decide which package it
belongs in — or whether it warrants a new one.

- **`sep10-auth`** — Authenticates a Stellar address *before* any compliance check runs. Covers
  building and verifying [SEP-10 Web Authentication](https://stellar.org/protocol/sep-10)
  challenge transactions, plus a thin Express middleware that resolves the signed-in address for
  downstream handlers. It does not decide whether an address is compliant, and it does not collect
  signatures itself (that's the client wallet's job) — it only proves which address is making the
  request.

- **`sanctions-oracle`** — Decides whether an *already-authenticated* address is compliant, by
  checking it against a pluggable sanctions/watchlist data source (the `SanctionsProvider`
  interface) and syncing flagged addresses into a Soroban `denylist-gate` contract instance. New
  watchlist data sources, sync/retry logic, or provider registries belong here. It does not
  authenticate addresses (that's `sep10-auth`) and does not consume on-chain events (that's
  `horizon-listener`).

- **`horizon-listener`** — Reacts to on-chain state *after* the fact, by polling Soroban RPC for
  `denylist-gate` and `allowlist-token` contract events and re-emitting them (e.g. to a webhook).
  New event sources, delivery targets (queues, other webhooks), or backoff/retry strategies for
  consuming contract events belong here. It does not write to contracts or make compliance
  decisions — it only observes and forwards events other packages (or the contracts themselves)
  produced.

A rough mental model: `sep10-auth` answers "who is this?", `sanctions-oracle` answers "should this
address be blocked, and does the chain know that yet?", and `horizon-listener` answers "what just
changed on-chain?". If a change doesn't fit any of the three questions above, it likely warrants a
new package rather than being bolted onto an existing one — open an issue to discuss first.

## Code style

- TypeScript, Node 20+. Formatting is enforced by Prettier/ESLint (`npm run lint`).
- Prefer small, focused functions and explicit types on exported APIs.
- Don't vendor `compliance-primitives` contract code here — reference it as a dependency/link.

## Reporting bugs / requesting features

Use the issue templates under **New Issue** — one for bug reports, one for feature requests.

## Security

Please do not open a public issue for suspected security vulnerabilities in the sanctions-oracle
sync path, SEP-10 verification logic, or webhook handling. See [SECURITY.md](./SECURITY.md) (once
published) or contact the maintainers directly.
