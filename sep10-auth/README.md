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

## Scope

This package only implements the SEP-10 building blocks (challenge
generation, verification, and a thin middleware). It does not collect the
user's signature itself — clients are responsible for signing the challenge
with their own wallet (e.g. [Freighter](https://www.freighter.app/) or
another Stellar wallet) and sending the signed XDR back.

See the [repo root README](../README.md) for how this package fits into the
rest of `compliance-adapters`, and
[`compliance-primitives`](https://github.com/stellar-compliance-kit/compliance-primitives)
for the on-chain contracts (`allowlist-token`, `denylist-gate`,
`jurisdiction-flag`) this auth step feeds into.
