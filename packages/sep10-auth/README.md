# @stellar/sep10-auth

SEP-10 (Stellar Web Authentication) client helpers for building and signing
challenge transactions.

## Install

```sh
npm install @stellar/sep10-auth
```

## Usage

```ts
import { buildChallenge, signChallenge } from "@stellar/sep10-auth";

const challenge = await buildChallenge({
  serverKey: "G...",
  clientAccount: "G...",
  homeDomain: "example.com",
  webAuthDomain: "example.com",
  networkPassphrase: "Test SDF Network ; September 2015",
});

const signed = signChallenge(challenge, keypair);
```

## Next.js route handler example

SEP-10 works well inside a Next.js App Router route handler. The helpers are
pure and do not depend on Node-only APIs, so they can run in the default Node
runtime or the edge runtime.

```ts
// app/api/sep10/challenge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildChallenge, signChallenge } from "@stellar/sep10-auth";
import { Keypair } from "@stellar/stellar-sdk";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { clientAccount } = await req.json();

  const serverKeypair = Keypair.fromSecret(process.env.SEP10_SERVER_SECRET!);

  const challenge = await buildChallenge({
    serverKey: serverKeypair.publicKey(),
    clientAccount,
    homeDomain: "example.com",
    webAuthDomain: "example.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  });

  const signed = signChallenge(challenge, serverKeypair);

  return NextResponse.json({ transaction: signed.toXDR() });
}
```

### Crypto APIs at the edge

The edge runtime exposes the standard Web Crypto API (`globalThis.crypto`,
`crypto.subtle`, `crypto.getRandomValues`) and `TextEncoder`/`TextDecoder`.
The SEP-10 helpers rely only on these primitives, so they work unchanged at
the edge.

Limitations to keep in mind:

- Node's `crypto` module (`createHash`, `randomBytes`, etc.) is **not**
  available. Use `crypto.subtle` / `crypto.getRandomValues` instead.
- `Buffer` is not available; use `Uint8Array` and `TextEncoder`.
- Long-running or CPU-heavy signing should stay in the Node runtime; edge
  functions have tight execution time limits.
- Secrets must come from environment variables available to the edge runtime
  (e.g. `process.env`), never from the filesystem.
