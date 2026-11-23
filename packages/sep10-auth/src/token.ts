import jwt from "jsonwebtoken";

export interface IssueTokenOptions {
  secret: string;
  subject: string;
  expiresInSeconds?: number;
  clockToleranceSeconds?: number;
  issuer?: string;
  audience?: string;
  extraClaims?: Record<string, unknown>;
}

export interface VerifyTokenOptions {
  secret: string;
  clockToleranceSeconds?: number;
  issuer?: string;
  audience?: string;
}

export interface VerifiedTokenPayload {
  sub: string;
  iat: number;
  nbf: number;
  exp: number;
  iss?: string;
  aud?: string | string[];
  [claim: string]: unknown;
}

const DEFAULT_EXPIRES_IN_SECONDS = 60 * 60 * 24;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

export function issueToken(options: IssueTokenOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;

  const payload: Record<string, unknown> = {
    ...options.extraClaims,
    sub: options.subject,
    iat: now,
    nbf: now,
    exp: now + expiresInSeconds,
  };

  if (options.issuer !== undefined) {
    payload.iss = options.issuer;
  }
  if (options.audience !== undefined) {
    payload.aud = options.audience;
  }

  return jwt.sign(payload, options.secret, { algorithm: "HS256" });
}

export function verifyToken(
  token: string,
  options: VerifyTokenOptions,
): VerifiedTokenPayload {
  const clockToleranceSeconds =
    options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;

  const decoded = jwt.verify(token, options.secret, {
    algorithms: ["HS256"],
    clockTolerance: clockToleranceSeconds,
    ...(options.issuer !== undefined ? { issuer: options.issuer } : {}),
    ...(options.audience !== undefined ? { audience: options.audience } : {}),
  });

  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  return decoded as VerifiedTokenPayload;
}
