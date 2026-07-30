# sep10-auth

Verifies a user's authenticated Stellar address via [SEP-10 Web
Authentication](https://stellar.org/protocol/sep-10) before compliance checks
(allowlist, denylist, jurisdiction flags) run elsewhere in the stack. It wraps
`@stellar/stellar-sdk`'s `WebAuth` helpers to build a challenge transaction,
verify a signed challenge, and expose an Express middleware that resolves the
signed-in Stellar address for downstream handlers.

## Install

```sh
npm install
```

(This package is part of the `compliance-adapters` npm workspace; run install
from the repo root.)

## API

### `generateChallenge(clientAddress, serverKeypair, options?)`

Builds a SEP-10 challenge transaction for a client to sign.

```ts
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { generateChallenge } from 'sep10-auth';

const serverKeypair = Keypair.fromSecret(process.env.SEP10_SERVER_SECRET!);

const challenge = generateChallenge(clientAddress, serverKeypair, {
  homeDomain: 'example.com',
  webAuthDomain: 'auth.example.com',
  networkPassphrase: Networks.PUBLIC,
  timeoutSeconds: 300,
});

// send challenge.transactionXDR to the client to sign
```

### `verifyChallenge(signedTransactionXDR, options)`

Verifies a client-signed challenge transaction and returns the authenticated
address.

```ts
import { verifyChallenge } from 'sep10-auth';

const result = verifyChallenge(signedXDR, {
  serverAccountId: serverKeypair.publicKey(),
  homeDomains: 'example.com',
  webAuthDomain: 'auth.example.com',
});

if (result.valid) {
  // result.address is the authenticated Stellar account ID
} else {
  // result.error describes why verification failed
}
```

### `createSep10Middleware(options)`

An Express middleware factory. Expects the signed challenge transaction XDR on
each request as `Authorization: Bearer <base64-xdr>`, and sets
`req.stellarAddress` on success.

```ts
import express from 'express';
import { createSep10Middleware } from 'sep10-auth';

const app = express();

app.use(
  '/compliance',
  createSep10Middleware({
    serverAccountId: serverKeypair.publicKey(),
    homeDomains: 'example.com',
    webAuthDomain: 'auth.example.com',
  })
);

app.get('/compliance/status', (req, res) => {
  res.json({ address: req.stellarAddress });
});
```

This is a reference pattern: it re-verifies the raw challenge transaction on
every request. A production deployment would typically verify once and issue
a short-lived session token instead — that's out of scope for this package.

### `rateLimiter(options?)`

An Express middleware factory that rate-limits incoming requests using a
sliding-window in-memory counter. Useful for protecting the challenge
generation endpoint (or any other endpoint) from being hammered by a single
client.

```ts
import express from 'express';
import { rateLimiter } from 'sep10-auth';

const app = express();

app.use(
  '/api/challenge',
  rateLimiter({ windowMs: 30_000, maxRequests: 10 })
);

app.post('/api/challenge', (req, res) => {
  // ... generate and return the challenge ...
});
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `windowMs` | `60000` (1 minute) | The time window in milliseconds during which requests are counted. |
| `maxRequests` | `100` | The maximum number of requests allowed within the window. |
| `keyGenerator` | `(req) => req.ip` | A function returning a unique key for each client (defaults to the request IP). |

When the limit is exceeded the middleware responds with **429** and a JSON body:

```json
{ "error": "rate_limit_exceeded", "retryAfter": 15 }
```

The `Retry-After` header is also set to the number of seconds the client should
wait before retrying.

> **Note**: The in-memory store is process-local and not shared across
> instances. For multi-process or multi-region deployments, replace this
> middleware with a Redis-backed limiter such as `express-rate-limit`.

## Scope

This package only implements the SEP-10 building blocks (challenge
generation, verification, thin middleware, and rate limiting). It does not
collect the user's signature itself — clients are responsible for signing
the challenge with their own wallet (e.g. [Freighter](https://www.freighter.app/)
or another Stellar wallet) and sending the signed XDR back.

See the [repo root README](../README.md) for how this package fits into the
rest of `compliance-adapters`, and
[`compliance-primitives`](https://github.com/stellar-compliance-kit/compliance-primitives)
for the on-chain contracts (`allowlist-token`, `denylist-gate`,
`jurisdiction-flag`) this auth step feeds into.
