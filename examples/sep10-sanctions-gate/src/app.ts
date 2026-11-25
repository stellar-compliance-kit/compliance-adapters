/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * sep10-sanctions-gate — example Express app
 *
 * Demonstrates composing two compliance-adapters packages on a single route:
 *
 *   1. SEP-10 authentication (sep10-auth)
 *      The request must carry a valid SEP-10 challenge response as a Bearer
 *      token.  createSep10Middleware verifies the signed XDR and, on success,
 *      attaches the verified Stellar address to `req.stellarAddress`.
 *      → unauthenticated or invalid token: 401
 *
 *   2. Sanctions check (sanctions-oracle)
 *      The verified address is looked up against a SanctionsProvider.  The
 *      example wires in MockSanctionsProvider (development/test only — never
 *      use the mock in production; integrate a real licensed data source).
 *      → flagged address: 403
 *      → clean address: 200
 *
 * The two steps are intentionally separate middleware functions so either can
 * be swapped out without touching the other.
 */

import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { createSep10Middleware, VerifyChallengeOptions } from 'sep10-auth';
import { SanctionsProvider, MockSanctionsProvider } from 'sanctions-oracle';

// ── Pre-submission payment screening ────────────────────────────────────────
// Before a payment is built and signed, both the sender and the recipient must
// clear two independent checks:
//
//   1. Sanctions screening — the address must not appear on a sanctions /
//      watchlist as reported by the configured SanctionsProvider.
//   2. On-chain denylist — the address must not be present in the denylist
//      contract deployed on Stellar (queried via a minimal read-only client).
//
// Only when both addresses pass both checks is a transaction built.  Any
// failure produces a structured rejection so callers can surface a precise
// reason without ever submitting the payment.

/** Minimal read-only view of the on-chain denylist contract. */
export interface DenylistClient {
  /** Resolve to true when `address` is present in the on-chain denylist. */
  isDenylisted(address: string): Promise<boolean>;
}

/** Inputs required to screen and (optionally) build a payment. */
export interface ScreenPaymentParams {
  /** Stellar address of the payment sender. */
  sender: string;
  /** Stellar address of the payment recipient. */
  recipient: string;
  /** Amount to send, in stroops (or any caller-defined unit). */
  amount: string;
  /** Asset identifier, e.g. "native" or "USDC:GISSUER...". */
  asset: string;
}

/** Structured outcome of pre-submission screening. */
export type ScreenPaymentResult =
  | {
      allowed: true;
      /** The transaction envelope, ready to be signed and submitted. */
      transaction: {
        sender: string;
        recipient: string;
        amount: string;
        asset: string;
      };
    }
  | {
      allowed: false;
      /** Machine-readable rejection code. */
      code: 'SANCTIONS_FLAGGED' | 'DENYLISTED';
      /** Which party triggered the rejection. */
      party: 'sender' | 'recipient';
      /** Human-readable explanation. */
      reason: string;
    };

/**
 * Screen a payment against the sanctions provider and the on-chain denylist.
 *
 * Both the sender and the recipient are checked.  The transaction is only
 * built when every check passes; otherwise a structured rejection is returned
 * and no transaction is produced.
 */
export async function screenPayment(
  params: ScreenPaymentParams,
  provider: SanctionsProvider,
  denylist: DenylistClient,
): Promise<ScreenPaymentResult> {
  const parties: Array<{ party: 'sender' | 'recipient'; address: string }> = [
    { party: 'sender', address: params.sender },
    { party: 'recipient', address: params.recipient },
  ];

  for (const { party, address } of parties) {
    // 1. Sanctions screening.
    const sanctions = await provider.checkAddress(address);
    if (sanctions.flagged) {
      return {
        allowed: false,
        code: 'SANCTIONS_FLAGGED',
        party,
        reason: `${party} address is on a sanctions watchlist`,
      };
    }

    // 2. On-chain denylist.
    const denied = await denylist.isDenylisted(address);
    if (denied) {
      return {
        allowed: false,
        code: 'DENYLISTED',
        party,
        reason: `${party} address is on the on-chain denylist`,
      };
    }
  }

  // Both parties cleared both checks — build the transaction.
  return {
    allowed: true,
    transaction: {
      sender: params.sender,
      recipient: params.recipient,
      amount: params.amount,
      asset: params.asset,
    },
  };
}

export interface GatedAppOptions {
  /** Options forwarded verbatim to createSep10Middleware / verifyChallenge. */
  sep10: VerifyChallengeOptions;
  /**
   * Sanctions provider to use.  Defaults to MockSanctionsProvider when omitted.
   * Swap this for a real provider before using in production.
   */
  sanctionsProvider?: SanctionsProvider;
}

/**
 * Build and return the Express application.
 *
 * Keeping app construction separate from server startup (listen) makes the
 * app trivially testable with supertest without binding to a port.
 */
export function createApp(options: GatedAppOptions): express.Application {
  const app = express();

  // Parse JSON request bodies so downstream handlers can read req.body if needed.
  app.use(express.json());

  // ── Step 1: SEP-10 authentication middleware ──────────────────────────────
  // Validates the `Authorization: Bearer <signed-challenge-XDR>` header and,
  // on success, sets `req.stellarAddress` to the verified Stellar G... address.
  // On failure it responds with 401 and short-circuits the chain — the
  // sanctions check below never runs.
  const sep10Middleware: RequestHandler = createSep10Middleware(options.sep10);

  // ── Step 2: Sanctions check middleware ───────────────────────────────────
  // Runs after SEP-10 has already validated identity, so `req.stellarAddress`
  // is guaranteed to be set here.  We keep this as a named factory so callers
  // can inject any SanctionsProvider implementation (real or mock).
  const provider: SanctionsProvider = options.sanctionsProvider ?? new MockSanctionsProvider();

  const sanctionsMiddleware: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // req.stellarAddress is set by sep10Middleware which runs first; the type
    // augmentation in sep10-auth declares it as `string | undefined` so we
    // guard with a non-null assertion — if we reached this point it is set.
    const address = req.stellarAddress!;

    const result = await provider.checkAddress(address);

    if (result.flagged) {
      // The address appears on a sanctions / watchlist.  Return 403 with
      // enough detail for the caller to know why they were blocked, but
      // without leaking which specific list flagged them.
      res.status(403).json({
        error: 'forbidden',
        reason: 'address is on a sanctions watchlist',
      });
      return;
    }

    // Address is clean — pass control to the route handler.
    next();
  };

  // ── Health-check route ───────────────────────────────────────────────────
  // Unauthenticated liveness probe for container orchestrators and load
  // balancer health checks.  Must be registered before the SEP-10 middleware
  // so it is never accidentally gated behind auth.
  app.get('/health', (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  });

  // ── Gated route ──────────────────────────────────────────────────────────
  // Apply both middleware in order: auth first, sanctions second.
  // Only requests that clear both checks reach the handler.
  app.get(
    '/gated',
    sep10Middleware,
    sanctionsMiddleware,
    (_req: Request, res: Response): void => {
      res.status(200).json({
        message: 'Access granted',
        address: _req.stellarAddress,
      });
    },
  );

  return app;
}
