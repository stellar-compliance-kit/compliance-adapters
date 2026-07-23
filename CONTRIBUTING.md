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

## Which package does my change belong in?

The three packages are split by **where in the compliance flow the code runs**, not by
technology. Each is an independent workspace and none imports another — if a change seems
to need code from a sibling, that is the signal to stop and open an issue rather than to
add the dependency.

| Package | Answers | Belongs here |
|---|---|---|
| **`sep10-auth`** | *Who is this?* | Establishing an authenticated Stellar address: building and verifying SEP-10 challenge transactions, and the Express middleware that resolves the signed-in address for downstream handlers. Anything wrapping `@stellar/stellar-sdk`'s `WebAuth` helpers. |
| **`sanctions-oracle`** | *Should this address be blocked?* | Checking addresses against a watchlist and pushing the result on-chain: the `SanctionsProvider` interface and its implementations, and the sync path that writes flagged addresses into a `denylist-gate` contract. Anything that **writes** to a contract. |
| **`horizon-listener`** | *What just happened on-chain?* | Consuming contract events off-chain: polling Soroban RPC, cursor and backoff handling, and re-emitting to a webhook. Anything that **reads** from a contract and fans out. |

A rule of thumb is the direction of data flow: `sep10-auth` is request-time and touches no
contract, `sanctions-oracle` writes **to** the chain, and `horizon-listener` reads **from**
it.

Two cases worth calling out:

- **Authorization is not authentication.** Deciding whether an authenticated address is
  *allowed* to do something is a compliance-primitives contract concern, not a
  `sep10-auth` one. `sep10-auth`'s job ends once the address is proven.
- **A new adapter is not a new package.** Supporting another watchlist data source means a
  new `SanctionsProvider` implementation inside `sanctions-oracle`. Prefer a new
  implementation of an existing interface over a new workspace.

### When a new package is warranted

Open an issue to discuss it first. A new workspace is usually only justified when the code
integrates a **different external system**, on its own release cadence, that would
otherwise force one of the three packages to take a dependency unrelated to its question
above.

Shared helpers needed by two packages are a better fit for a small internal package than
for duplication — but raise that as an issue before building it, since it changes the "no
package imports another" property described above.

Whatever you add, keep contract code out of this repo: reference `compliance-primitives`
as a dependency rather than vendoring it (see [Code style](#code-style)).

## Development workflow

1. Fork the repo and create a branch off `main`.
2. Make your change, keeping it scoped to the linked issue.
3. Add or update tests — PRs that touch behavior without test coverage will be asked to add it.
4. Run `npm run lint` and `npm test` locally before opening a PR.
5. Open a PR referencing the issue number (`Fixes #123`) and describe what you changed and why.

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
