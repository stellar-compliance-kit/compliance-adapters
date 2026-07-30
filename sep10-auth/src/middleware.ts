import { RequestHandler } from 'express';
import { type Logger, noopLogger } from '@compliance-adapters/logger';
import { verifyChallenge, VerifyChallengeOptions } from './verify';
import { RevocationStore } from './revocation';

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
  const logger = options.logger ?? noopLogger;

  return async (req, res, next) => {
    const authHeader = req.header('Authorization') ?? '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      logger.warn('sep10-auth: missing or malformed bearer token', {
        ip: req.ip,
        path: req.path,
      });
      res.status(401).json({ error: 'unauthorized', reason: 'missing bearer token' });
      return;
    }

    const result = verifyChallenge(token, options);

    if (!result.valid) {
      logger.warn('sep10-auth: challenge verification failed', {
        reason: result.error,
        ip: req.ip,
        path: req.path,
      });
      res.status(401).json({ error: 'unauthorized', reason: result.error });
      return;
    }

    if (options.revocationStore) {
      let revoked: boolean;
      try {
        revoked = await options.revocationStore.isRevoked(result.address);
      } catch (error) {
        logger.error('sep10-auth: revocation store lookup failed', error);
        next(error);
        return;
      }

      if (revoked) {
        logger.warn('sep10-auth: address is revoked', { address: result.address });
        res.status(401).json({ error: 'unauthorized', reason: 'address revoked' });
        return;
      }
    }

    logger.debug('sep10-auth: request authenticated', { address: result.address, path: req.path });
    req.stellarAddress = result.address;
    next();
  };
}
