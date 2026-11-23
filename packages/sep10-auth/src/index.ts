export interface Sep10AuthOptions {
  /** Secret used to sign and verify SEP-10 tokens. */
  secret: string;
  /** Token lifetime in seconds. Defaults to 900 (15 minutes). */
  expiresInSeconds?: number;
  /**
   * Allowed clock skew, in seconds, when verifying `nbf`/`exp` claims.
   * Defaults to 0 (no tolerance).
   */
  clockToleranceSeconds?: number;
}

export interface Sep10TokenClaims {
  sub: string;
  iat: number;
  nbf: number;
  exp: number;
  [key: string]: unknown;
}

export interface Sep10Auth {
  issue(subject: string, extraClaims?: Record<string, unknown>): string;
  verify(token: string): Sep10TokenClaims;
}

const DEFAULT_EXPIRES_IN_SECONDS = 900;

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64").toString("utf8");
}

function sign(data: string, secret: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require("crypto") as typeof import("crypto");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { timingSafeEqual: eq } = require("crypto") as typeof import("crypto");
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return eq(bufA, bufB);
}

/**
 * Create a SEP-10 auth helper that issues and verifies signed tokens.
 *
 * Issued tokens carry `iat`, `nbf`, and `exp` claims. Verification applies
 * the configured `clockToleranceSeconds` to both `nbf` and `exp` checks so
 * small clock differences between issuer and resource servers are tolerated.
 */
export function createSep10Auth(options: Sep10AuthOptions): Sep10Auth {
  const { secret } = options;
  const expiresInSeconds = options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS;
  const clockToleranceSeconds = options.clockToleranceSeconds ?? 0;

  if (!secret) {
    throw new Error("sep10-auth: secret is required");
  }
  if (clockToleranceSeconds < 0) {
    throw new Error("sep10-auth: clockToleranceSeconds must be >= 0");
  }

  function issue(subject: string, extraClaims: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const payload: Sep10TokenClaims = {
      ...extraClaims,
      sub: subject,
      iat: now,
      nbf: now,
      exp: now + expiresInSeconds,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = sign(signingInput, secret);

    return `${signingInput}.${signature}`;
  }

  function verify(token: string): Sep10TokenClaims {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("sep10-auth: malformed token");
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = sign(signingInput, secret);

    if (!timingSafeEqual(signature, expectedSignature)) {
      throw new Error("sep10-auth: invalid signature");
    }

    const claims = JSON.parse(base64UrlDecode(encodedPayload)) as Sep10TokenClaims;
    const now = Math.floor(Date.now() / 1000);

    if (typeof claims.nbf === "number" && now + clockToleranceSeconds < claims.nbf) {
      throw new Error("sep10-auth: token not yet valid");
    }

    if (typeof claims.exp === "number" && now - clockToleranceSeconds >= claims.exp) {
      throw new Error("sep10-auth: token expired");
    }

    return claims;
  }

  return { issue, verify };
}
