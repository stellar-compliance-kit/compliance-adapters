/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { RequestHandler } from 'express';
import { verifyChallenge, VerifyChallengeOptions } from './verify';

declare global {
  namespace Express {
    interface Request {
      stellarAddress?: string;
    }
  }
}

// Reference pattern only: expects the raw signed SEP-10 challenge XDR on every
// request via `Authorization: Bearer <base64-xdr>`. A production app would
// typically verify once and issue a short-lived session JWT instead of
// re-verifying the challenge transaction on every request; that is out of
// scope for this package.
export function createSep10Middleware(options: VerifyChallengeOptions): RequestHandler {
  return (req, res, next) => {
    const authHeader = req.header('Authorization') ?? '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      res.status(401).json({ error: 'unauthorized', reason: 'missing bearer token' });
      return;
    }

    const result = verifyChallenge(token, options);

    if (!result.valid) {
      res.status(401).json({ error: 'unauthorized', reason: result.error });
      return;
    }

    req.stellarAddress = result.address;
    next();
  };
}
