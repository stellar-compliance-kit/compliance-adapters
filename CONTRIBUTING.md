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

## Branch protection (recommended)

The repository intends to enforce the following branch protection rules on `main` to ensure
stability and code review quality. These settings should be configured in the repository settings
by an admin; this document provides the single source of truth and rationale for maintainers.

- **Require pull request reviews before merging**: At least one approving review is required for all PRs. For
  security-sensitive or cross-package changes, request two reviewers.
- **Require status checks to pass before merging**: Enforce `npm run lint` and the test suite across workspaces.
  The exact status check names depend on CI configuration; ensure the CI publishes checks for lint and tests.
- **Dismiss stale pull request approvals when new commits are pushed**: Ensures reviewers re-check updated code.
- **Require branches to be up to date before merging**: Require PR branches to include the latest `main` to avoid
  merging with stale code.
- **Restrict who can push to `main`**: Only allow repository administrators to push directly; all changes should
  go through pull requests.

If you are an admin setting these rules, the above provides the intended configuration. If you are a contributor
and your PR is blocked by branch protection, follow the PR checks and request reviewers as described above.

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
