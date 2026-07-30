import { RequestHandler } from 'express';
import { verifyChallenge, VerifyChallengeOptions } from './verify';
import { RevocationStore } from './revocation';
import { Logger } from './logger';

declare global {
  namespace Express {
    interface Request {
      stellarAddress?: string;
    }
  }
}

export interface Sep10MiddlewareOptions extends VerifyChallengeOptions {
  /**
   * Optional store consulted after a challenge verifies successfully, to
   * reject addresses revoked before their challenge naturally expired.
   */
  revocationStore?: RevocationStore;
  /** Optional injectable logger for observability. Nothing is logged if omitted. */
  logger?: Logger;
}

// Reference pattern only: expects the raw signed SEP-10 challenge XDR on every
// request via `Authorization: Bearer <base64-xdr>`. A production app would
// typically verify once and issue a short-lived session JWT instead of
// re-verifying the challenge transaction on every request; that is out of
// scope for this package.
export function createSep10Middleware(options: Sep10MiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    const authHeader = req.header('Authorization') ?? '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      res.status(401).json({ error: 'unauthorized', reason: 'missing bearer token' });
      return;
    }

    const result = verifyChallenge(token, options);

    if (!result.valid) {
      options.logger?.warn('sep10-auth: challenge verification failed', result.error);
      res.status(401).json({ error: 'unauthorized', reason: result.error });
      return;
    }

    if (options.revocationStore) {
      let revoked: boolean;
      try {
        revoked = await options.revocationStore.isRevoked(result.address);
      } catch (error) {
        options.logger?.error('sep10-auth: revocation store lookup failed', error);
        next(error);
        return;
      }

      if (revoked) {
        options.logger?.warn('sep10-auth: address is revoked', result.address);
        res.status(401).json({ error: 'unauthorized', reason: 'address revoked' });
        return;
      }
    }

    req.stellarAddress = result.address;
    next();
  };
}
