import { RequestHandler } from 'express';
import { type Logger, noopLogger } from '@compliance-adapters/logger';
import { verifyChallenge, VerifyChallengeOptions } from './verify';

declare global {
  namespace Express {
    interface Request {
      stellarAddress?: string;
    }
  }
}

export interface Sep10MiddlewareOptions extends VerifyChallengeOptions {
  logger?: Logger;
}

// Reference pattern only: expects the raw signed SEP-10 challenge XDR on every
// request via `Authorization: Bearer <base64-xdr>`. A production app would
// typically verify once and issue a short-lived session JWT instead of
// re-verifying the challenge transaction on every request; that is out of
// scope for this package.
export function createSep10Middleware(options: Sep10MiddlewareOptions): RequestHandler {
  const logger = options.logger ?? noopLogger;

  return (req, res, next) => {
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

    logger.debug('sep10-auth: request authenticated', { address: result.address, path: req.path });
    req.stellarAddress = result.address;
    next();
  };
}
