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

## Configuration

Copy the root [`.env.example`](../.env.example) to `.env` at the repo root and
fill in the `SEP10_*` variables before running the package locally:

| Variable | Description |
|---|---|
| `SEP10_SERVER_SECRET` | Secret key of the server-side SEP-10 signing keypair |
| `SEP10_SERVER_PUBLIC_KEY` | Corresponding public key (used as `serverAccountId`) |
| `SEP10_HOME_DOMAIN` | Home domain embedded in challenge transactions |
| `SEP10_WEB_AUTH_DOMAIN` | Web-auth domain (often the same as `SEP10_HOME_DOMAIN`) |
| `SEP10_TIMEOUT_SECONDS` | Challenge lifetime in seconds (default `300`) |

See the comments in `.env.example` for allowed values and testnet guidance.

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

To support the SEP-10 client domain flow (where a wallet's client-domain
server co-signs the challenge), pass `clientDomain` along with the
`clientSigningKey` published on `<clientDomain>/.well-known/stellar.toml`
(this package does not fetch stellar.toml itself, so resolve the key
yourself):

```ts
const challenge = generateChallenge(clientAddress, serverKeypair, {
  homeDomain: 'example.com',
  webAuthDomain: 'auth.example.com',
  clientDomain: 'wallet.example',
  clientSigningKey: 'GABC...', // from wallet.example/.well-known/stellar.toml
});
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
  // result.clientDomain is set if the challenge used the client domain flow
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

> **`trust proxy` required behind a reverse proxy or load balancer**: the
> default key generator keys on `req.ip`, which only reflects the real
> client IP when Express's `app.set('trust proxy', ...)` is configured
> correctly for your deployment. Without it, every request appears to
> come from the proxy's IP, collapsing the rate limit to a single shared
> bucket for all clients. See the
> [Express `trust proxy` docs](https://expressjs.com/en/guide/behind-proxies.html)
> and set it to match your infrastructure (e.g. the number of trusted
> hops, or `true` only if you fully control the proxy).

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

Because there's no session token, a challenge can't be revoked before its
`timeoutSeconds` elapses unless you supply a `revocationStore`. An in-memory
reference implementation is included:

```ts
import { createSep10Middleware, InMemoryRevocationStore } from 'sep10-auth';

const revocationStore = new InMemoryRevocationStore();

app.use(
  '/compliance',
  createSep10Middleware({
    serverAccountId: serverKeypair.publicKey(),
    homeDomains: 'example.com',
    webAuthDomain: 'auth.example.com',
    revocationStore,
  })
);

// elsewhere, to cut off access immediately:
revocationStore.revoke(someAddress);
```

Implement the `RevocationStore` interface yourself to back it with Redis, a
database, etc.

sep10-auth has no built-in logging (and its lint config forbids `console.*`
calls), so pass a `logger` implementing the `Logger` interface (`debug` /
`info` / `warn` / `error`) if you want visibility into verification and
revocation failures:

```ts
createSep10Middleware({
  serverAccountId: serverKeypair.publicKey(),
  homeDomains: 'example.com',
  webAuthDomain: 'auth.example.com',
  logger: console,
});
```

## Example Walkthrough

Below is a step-by-step walkthrough showing how a client requests a SEP-10 challenge, signs it, and passes it to an Express endpoint protected with `createSep10Middleware`.

### 1. Request a Challenge
The client requests a SEP-10 challenge transaction from the auth server:

```sh
curl -X GET "https://auth.example.com/auth?account=G...&home_domain=example.com"
```

Example JSON response from server:
```json
{
  "transaction": "AAAAAgAAAAA...",
  "network_passphrase": "Test SDF Network ; July 2015"
}
```

### 2. Sign Challenge Client-Side (Conceptual)
The client signs the returned `transaction` XDR using their Stellar wallet keypair (e.g., Freighter or `@stellar/stellar-sdk`):

```ts
import { Keypair, Transaction } from '@stellar/stellar-sdk';

const tx = new Transaction(challengeXDR, networkPassphrase);
tx.sign(clientKeypair);
const signedXDR = tx.toXDR();
```

### 3. Send Request to Protected Endpoint
The client passes the signed XDR as a Bearer token in the `Authorization` header:

```sh
curl -X GET https://example.com/compliance/status \
  -H "Authorization: Bearer AAAAAgAAAAA..."
```

#### Expected Success Response (`200 OK`)
```json
{
  "address": "G..."
}
```

#### Expected Error Response (`401 Unauthorized`)
If the challenge is unsigned, expired, or invalid:
```json
{
  "error": "unauthorized",
  "reason": "Transaction has expired"
}
```

## Replay Risk & Performance Tradeoffs

`createSep10Middleware` provides a simplified reference implementation that re-verifies the raw signed challenge transaction XDR on every incoming request via `Authorization: Bearer <base64-xdr>`. Consumers should note the following tradeoffs when using this pattern:

- **Replay Risk**: Because the middleware re-verifies the raw signed transaction XDR directly, any bearer token (signed XDR) intercepted in transit remains valid for authentication until its timebounds expire (by default 300 seconds). Without a server-side session store, token revocation, or single-use nonce tracking, an attacker possessing the signed XDR can replay it across multiple requests during the validity window.
- **Performance Overhead**: Verifying cryptographic signatures (via `WebAuth.verifyChallengeTxSigners`) and parsing XDR on every HTTP request incurs non-trivial CPU overhead compared to verifying a lightweight, symmetric-key session token or JWT.
- **Production Recommendation**: For production services, applications should use SEP-10 challenge verification once to authenticate the client, and upon successful verification, issue a short-lived session JWT or auth token for subsequent API requests.

See [`examples/express-app`](./examples/express-app) for a small runnable
Express app wiring together the full challenge/verify roundtrip.

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
