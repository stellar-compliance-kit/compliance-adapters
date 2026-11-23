/**
 * sep10-auth: Next.js route handler / edge runtime example
 *
 * This example shows how to use the sep10-auth client helpers inside a
 * Next.js App Router route handler (`app/api/sep10/route.ts`).
 *
 * It is written to run on both the Node.js runtime and the Edge runtime.
 *
 * -------------------------------------------------------------------------
 * Crypto APIs available at the edge
 * -------------------------------------------------------------------------
 * The Edge runtime is based on the Web Platform, NOT Node.js. In practice:
 *
 *   Available at the edge:
 *     - `crypto.getRandomValues` (Web Crypto)
 *     - `crypto.subtle` (Web Crypto: digest, sign, verify, importKey, ...)
 *     - `TextEncoder` / `TextDecoder`
 *     - `atob` / `btoa`
 *     - `fetch`, `Request`, `Response`, `Headers`, `URL`
 *
 *   NOT available at the edge:
 *     - The Node.js `crypto` module (`import crypto from "node:crypto"`)
 *     - `Buffer` (use `Uint8Array` / `TextEncoder` instead)
 *     - `node:fs`, `node:path`, and other Node built-ins
 *
 * sep10-auth's client helpers rely only on Web Crypto + `fetch`, so they work
 * unchanged on the edge. If you need Node-only crypto (e.g. a custom signer
 * that uses `node:crypto`), keep that route on the Node.js runtime by
 * exporting `export const runtime = "nodejs"` instead.
 *
 * -------------------------------------------------------------------------
 * Runtime selection
 * -------------------------------------------------------------------------
 * Uncomment the line below to force the Edge runtime. Omit it (or set it to
 * "nodejs") to run on the Node.js runtime.
 */
// export const runtime = "edge";

import {
  buildChallenge,
  submitChallenge,
  type Sep10ClientOptions,
} from "@stellar/sep10-auth";

/**
 * Shared client options. `serverSigningKey` / `homeDomain` come from env vars
 * so the same handler works in dev and production.
 */
const clientOptions: Sep10ClientOptions = {
  homeDomain: process.env.SEP10_HOME_DOMAIN ?? "example.com",
  serverSigningKey: process.env.SEP10_SERVER_SIGNING_KEY ?? "",
  networkPassphrase:
    process.env.STELLAR_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015",
};

/**
 * GET /api/sep10
 *
 * Builds a SEP-10 challenge transaction for the requesting account and
 * returns it as XDR. The wallet signs this XDR and POSTs it back.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const account = searchParams.get("account");

  if (!account) {
    return Response.json(
      { error: "missing required query param: account" },
      { status: 400 },
    );
  }

  try {
    const challenge = await buildChallenge(clientOptions, { account });

    return Response.json({ transaction: challenge.transaction });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "failed to build challenge" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/sep10
 *
 * Accepts the signed challenge XDR from the wallet, verifies it, and returns
 * the resulting session token.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { transaction?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.transaction) {
    return Response.json(
      { error: "missing required field: transaction" },
      { status: 400 },
    );
  }

  try {
    const session = await submitChallenge(clientOptions, {
      transaction: body.transaction,
    });

    return Response.json({ token: session.token });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "failed to verify challenge" },
      { status: 401 },
    );
  }
}
