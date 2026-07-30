# SEP-10 Express example

A minimal, runnable Express app showing the full SEP-10 challenge/verify
roundtrip using this package: `generateChallenge` on a `/challenge` route,
and `createSep10Middleware` protecting a `/protected` route.

## Run it

From the `sep10-auth` package directory:

```sh
npx ts-node examples/express-app/server.ts
```

This starts a server on `http://localhost:3000` and prints the demo server's
Stellar public key. The server keypair is generated fresh on each run (see
the comment in `server.ts`) — this is a demo, not a deployment pattern.

## Try the roundtrip

1. Request a challenge for a client address:

   ```sh
   curl "http://localhost:3000/challenge?address=<CLIENT_PUBLIC_KEY>"
   ```

   Returns `{ transaction, network_passphrase }`.

2. Sign `transaction` with the client's keypair (e.g. via
   `Transaction.addSignature` / `Keypair.sign`, or a wallet like
   [Freighter](https://www.freighter.app/)) to produce a signed XDR.

3. Call the protected route with the signed XDR as a bearer token:

   ```sh
   curl -H "Authorization: Bearer <SIGNED_XDR>" http://localhost:3000/protected
   ```

   Returns `{ address }` — the authenticated Stellar account ID — on success,
   or a `401` with an error reason if the signature or challenge is invalid.
