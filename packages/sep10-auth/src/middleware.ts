import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";

export interface Sep10AuthOptions {
  /** Secret used to sign and verify SEP-10 tokens. */
  secret: string;
  /**
   * Tolerance (in seconds) applied to `nbf` and `exp` checks during
   * verification to absorb small clock differences between issuer and
   * resource servers. Defaults to 0.
   */
  clockToleranceSeconds?: number;
  /** Request property the verified payload is attached to. */
  requestProperty?: string;
}

export interface Sep10TokenPayload {
  sub: string;
  iat: number;
  nbf: number;
  exp: number;
  [key: string]: unknown;
}

const DEFAULT_REQUEST_PROPERTY = "sep10";

/**
 * Issue a SEP-10 token. Sets `iat`, `nbf`, and `exp` claims.
 */
export function issueSep10Token(
  payload: Omit<Sep10TokenPayload, "iat" | "nbf" | "exp">,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      ...payload,
      iat: now,
      nbf: now,
      exp: now + expiresInSeconds,
    },
    secret,
  );
}

/**
 * Express middleware that verifies a SEP-10 bearer token, tolerating small
 * clock skew between issuer and resource servers.
 */
export function sep10Auth(options: Sep10AuthOptions): RequestHandler {
  const {
    secret,
    clockToleranceSeconds = 0,
    requestProperty = DEFAULT_REQUEST_PROPERTY,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing bearer token" });
      return;
    }

    const token = header.slice("Bearer ".length).trim();

    try {
      const payload = jwt.verify(token, secret, {
        clockTolerance: clockToleranceSeconds,
      }) as Sep10TokenPayload;

      (req as Request & Record<string, unknown>)[requestProperty] = payload;
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}
