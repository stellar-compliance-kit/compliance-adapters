import { createHmac, timingSafeEqual } from 'crypto';

export interface TokenClaims {
  sub: string;
  exp: number;
  client_domain?: string;
  jti?: string;
}

export interface IntrospectionResult {
  active: boolean;
  sub?: string;
  exp?: number;
  client_domain?: string;
}

const REVOKED_PREFIX = 'revoked:';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payload).digest());
}

export function issueToken(claims: TokenClaims, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const payload = `${header}.${body}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token: string, secret: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let claims: TokenClaims;
  try {
    claims = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    return null;
  }
  return claims;
}

export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean> | boolean;
  revoke(jti: string, exp: number): Promise<void> | void;
}

export function createMemoryRevocationStore(): RevocationStore {
  const revoked = new Map<string, number>();
  return {
    isRevoked(jti: string): boolean {
      const exp = revoked.get(jti);
      if (exp === undefined) return false;
      if (exp * 1000 <= Date.now()) {
        revoked.delete(jti);
        return false;
      }
      return true;
    },
    revoke(jti: string, exp: number): void {
      revoked.set(jti, exp);
    },
  };
}

export async function introspectToken(
  token: string,
  secret: string,
  store: RevocationStore,
): Promise<IntrospectionResult> {
  const claims = verifyToken(token, secret);
  if (!claims) return { active: false };
  if (claims.jti && (await store.isRevoked(claims.jti))) {
    return { active: false };
  }
  return {
    active: true,
    sub: claims.sub,
    exp: claims.exp,
    client_domain: claims.client_domain,
  };
}

export function isAuthorizedIntrospectionCaller(
  providedSecret: string | undefined,
  expectedSecret: string,
): boolean {
  if (!providedSecret || !expectedSecret) return false;
  const a = Buffer.from(providedSecret);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { REVOKED_PREFIX };
