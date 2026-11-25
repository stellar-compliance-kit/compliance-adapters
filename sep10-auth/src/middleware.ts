/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Request, RequestHandler } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import { type Logger, noopLogger } from '@compliance-adapters/logger';
import { verifyChallenge, VerifyChallengeOptions } from './verify';
import { RevocationStore } from './revocation';
import { assertBareDomain } from './challenge';
import { makeErrorBody } from './errors';

declare global {
  namespace Express {
    interface Request {
      stellarAddress?: string;
      /** Identifier (`jti`) of the verified token; use with `RevocationStore.revokeToken`. */
      stellarTokenId?: string;
    }
  }
}

/**
 * The result of {@link parseBearerToken}.
 *
 * A discriminated union: `ok: true` carries the extracted token; `ok: false`
 * carries a human-readable reason string explaining why parsing failed.
 *
 * @example
 * ```ts
 * const result: ParseBearerTokenResult = { ok: true, token: 'AAAA...' };
 * if (result.ok) {
 *   console.log(result.token);
 * } else {
 *   console.error(result.reason);
 * }
 * ```
 */
export type ParseBearerTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

/**
 * Extracts the Bearer token from a raw `Authorization` header value.
 *
 * Accepts the standard `Bearer <token>` format (scheme matching is
 * case-insensitive, as required by RFC 7235). Returns a discriminated-union
 * result rather than throwing so callers can handle errors without try/catch.
 *
 * @param header - The raw value of the `Authorization` header. Pass an empty
 *   string or `undefined` (coerced to `''`) when the header is absent.
 *
 * @returns `{ ok: true, token }` when a non-empty Bearer token was found, or
 *   `{ ok: false, reason }` for any of the following failure cases:
 *   - header is missing or empty
 *   - the scheme is not `Bearer` (case-insensitive)
 *   - the token portion is missing or empty (e.g. `"Bearer "` with trailing space only)
 *   - the header contains more than two whitespace-separated parts (malformed)
 *
 * @example
 * ```ts
 * const result = parseBearerToken(req.header('Authorization') ?? '');
 * if (!result.ok) {
 *   res.status(401).json({ error: result.reason });
 *   return;
 * }
 * // result.token is the raw base64-XDR string
 * ```
 */
export function parseBearerToken(header: string): ParseBearerTokenResult {
  if (!header) {
    return { ok: false, reason: 'missing bearer token' };
  }

  // Split on a single space only. RFC 7235 §2.1 says the token68 value is
  // a single contiguous string, so legitimate Bearer headers are exactly
  // two whitespace-separated parts. We split on the first space only so that
  // a token that itself contains spaces is never silently truncated — instead
  // it produces the correct "malformed" error.
  const spaceIndex = header.indexOf(' ');
  if (spaceIndex === -1) {
    // e.g. "Bearer" with no space at all
    return { ok: false, reason: 'missing bearer token' };
  }

  const scheme = header.slice(0, spaceIndex);
  const rest = header.slice(spaceIndex + 1);

  if (scheme.toLowerCase() !== 'bearer') {
    return { ok: false, reason: 'missing bearer token' };
  }

  // Reject trailing-space-only values and anything with embedded whitespace
  // (a valid XDR token is a single base64 string with no spaces).
  const token = rest.trim();
  if (!token) {
    return { ok: false, reason: 'missing bearer token' };
  }

  // A legitimate Bearer token must not contain internal whitespace.
  if (/\s/.test(rest)) {
    return { ok: false, reason: 'malformed bearer token' };
  }

  return { ok: true, token };
}

function parseCustomToken(token: string | undefined): ParseBearerTokenResult {
  return token ? { ok: true, token } : { ok: false, reason: 'missing bearer token' };
}

/**
 * Options accepted by {@link createSep10Middleware} and the framework-agnostic
 * helpers in this module.
 *
 * @example
 * ```ts
 * const options: Sep10MiddlewareOptions = {
 *   serverAccountId: 'G...',
 *   homeDomains: ['example.com'],
 *   webAuthDomain: 'example.com',
 *   networkPassphrase: Networks.TESTNET,
 * };
 * ```
 */
export interface Sep10MiddlewareOptions extends VerifyChallengeOptions {
  /**
   * Optional store consulted after a challenge verifies successfully, to
   * reject addresses revoked before their challenge naturally expired.
   */
  revocationStore?: RevocationStore;
  /** Optional injectable logger for observability. Nothing is logged if omitted. */
  logger?: Logger;
  /**
   * Maximum accepted length (in characters) of the bearer token, rejected
   * with 401 before XDR parsing is attempted. A signed SEP-10 challenge XDR
   * has a well-known bounded size, so this guards against unauthenticated
   * callers forcing expensive XDR-parsing work with oversized garbage input.
   * @default 8192
   */
  maxTokenLength?: number;
  /**
   * Custom token extractor, e.g. to read the token from a cookie or query
   * parameter instead of the `Authorization: Bearer` header. Return
   * `undefined` (or an empty string) when the request carries no token; the
   * request is then rejected with 401. When omitted, the token is read from
   * the `Authorization` header as a Bearer token.
   *
   * Cookie-based extraction exposes the endpoint to CSRF: browsers attach
   * cookies automatically, so pair it with SameSite cookies and/or a CSRF
   * token check.
   */
  getToken?: (req: Request) => string | undefined;
}

const DEFAULT_MAX_TOKEN_LENGTH = 8192;

/**
 * RFC 6750 §3.1 error code for a 401 response: `invalid_request` when the
 * `Authorization` header is missing or malformed, `invalid_token` when the
 * token itself was rejected.
 *
 * @example
 * ```ts
 * const code: BearerErrorCode = 'invalid_token';
 * ```
 */
export type BearerErrorCode = 'invalid_request' | 'invalid_token';

/** Request headers as exposed by Node's `http` module and Fastify. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * The result of {@link authenticateRequest}.
 *
 * On failure, `wwwAuthenticate` is the RFC 6750 §3 `WWW-Authenticate` header
 * value adapters must send alongside the 401 response.
 *
 * @example
 * ```ts
 * const result: AuthenticateRequestResult = await authenticateRequest(headers, options);
 * if (result.ok) {
 *   console.log('authenticated', result.address);
 * } else {
 *   res.set('WWW-Authenticate', result.wwwAuthenticate).status(401).end();
 * }
 * ```
 */
export type AuthenticateRequestResult =
  | { ok: true; address: string; jti?: string }
  | {
      ok: false;
      error: BearerErrorCode;
      reason: string;
      wwwAuthenticate: string;
      logMessage: string;
      logContext?: Record<string, unknown>;
    };

/** Builds an RFC 6750 §3 `WWW-Authenticate` header value. */
function buildWwwAuthenticate(realm: string, error: BearerErrorCode): string {
  return `Bearer realm="${realm}", error="${error}"`;
}

/**
 * Validates the middleware options once at construction time and returns the
 * normalised home domains. Shared by every framework adapter.
 *
 * @param options - The SEP-10 middleware options to validate.
 * @returns The normalised array of home domains.
 * @throws If `serverAccountId`, `homeDomains`, or `webAuthDomain` are invalid.
 *
 * @example
 * ```ts
 * const homeDomains = assertSep10MiddlewareOptions({
 *   serverAccountId: 'G...',
 *   homeDomains: 'example.com',
 *   webAuthDomain: 'example.com',
 *   networkPassphrase: Networks.TESTNET,
 * });
 * // homeDomains => ['example.com']
 * ```
 */
export function assertSep10MiddlewareOptions(options: Sep10MiddlewareOptions): string[] {
  if (!StrKey.isValidEd25519PublicKey(options.serverAccountId)) {
    throw new Error(
      `sep10-auth: Invalid serverAccountId: ${options.serverAccountId}`,
    );
  }

  const homeDomains = Array.isArray(options.homeDomains)
    ? options.homeDomains
    : [options.homeDomains];
  if (homeDomains.length === 0 || homeDomains.some((d) => !d)) {
    throw new Error('sep10-auth: homeDomains must be a non-empty array of non-empty strings');
  }
  homeDomains.forEach((d) => assertBareDomain('homeDomains', d));

  const webAuthDomains = Array.isArray(options.webAuthDomain)
    ? options.webAuthDomain
    : [options.webAuthDomain];
  if (webAuthDomains.length === 0 || webAuthDomains.some((d) => !d)) {
    throw new Error('sep10-auth: webAuthDomain must be a non-empty array of non-empty strings');
  }
  webAuthDomains.forEach((d) => assertBareDomain('webAuthDomain', d));

  return homeDomains;
}

/**
 * Verifies the `Authorization` header and signed challenge. It does not
 * consult the revocation store, so callers needing revocation checks should
 * use {@link authenticateRequest} instead.
 *
 * @param headers - The request headers (Node `http` / Fastify style).
 * @param options - The SEP-10 middleware options.
 * @returns The authentication result, without revocation checks applied.
 *
 * @example
 * ```ts
 * const result = await verifyRequestHeaders(
 *   { authorization: req.headers.authorization },
 *   options,
 * );
 * if (!result.ok) {
 *   res.set('WWW-Authenticate', result.wwwAuthenticate).status(401).end();
 *   return;
 * }
 * console.log('verified address', result.address);
 * ```
 */
export async function verifyRequestHeaders(
  headers: RequestHeaders,
  options: Sep10MiddlewareOptions,
): Promise<AuthenticateRequestResult> {
  const maxTokenLength = options.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH;
  const realm = Array.isArray(options.homeDomains) ? options.homeDomains[0] : options.homeDomains;

  const fail = (
    error: BearerErrorCode,
    reason: string,
    logMessage: string,
    logContext?: Record<string, unknown>,
  ): AuthenticateRequestResult => ({
    ok: false,
    error,
    reason,
    wwwAuthenticate: buildWwwAuthenticate(realm, error),
    logMessage,
    logContext,
  });

  const rawHeader = headers.authorization ?? headers.Authorization;
  const parsed = parseBearerToken(
    (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader) ?? '',
  );

  if (!parsed.ok) {
    return fail(
      'invalid_request',
      parsed.reason,
      'sep10-auth: missing or malformed bearer token',
    );
  }

  const token = parsed.token;

  if (token.length > maxTokenLength) {
    return fail(
      'invalid_token',
      'bearer token too large',
      'sep10-auth: bearer token exceeds maximum length',
      { length: token.length },
    );
  }

  const result = await verifyChallenge(token, options);

  if (!result.valid) {
    return fail(
      'invalid_token',
      result.error ?? 'invalid token',
      'sep10-auth: challenge verification failed',
      { reason: result.error },
    );
  }

  return result.jti !== undefined
    ? { ok: true, address: result.address, jti: result.jti }
    : { ok: true, address: result.address };
}

/**
 * Applies the optional revocation store to a successful
 * {@link verifyRequestHeaders} result. A failed result is returned unchanged.
 * A store lookup failure rejects, as it is an internal failure rather than an
 * authentication failure.
 *
 * @param result - A result from {@link verifyRequestHeaders}.
 * @param options - The SEP-10 middleware options (may carry a `revocationStore`).
 * @returns The original result, or a 401 failure result if revoked.
 *
 * @example
 * ```ts
 * const verified = await verifyRequestHeaders(headers, options);
 * const result = await applyRevocationStore(verified, options);
 * if (!result.ok) {
 *   res.set('WWW-Authenticate', result.wwwAuthenticate).status(401).end();
 * }
 * ```
 */
export async function applyRevocationStore(
  result: AuthenticateRequestResult,
  options: Sep10MiddlewareOptions,
): Promise<AuthenticateRequestResult> {
  if (!result.ok || !options.revocationStore) {
    return result;
  }

  const realm = Array.isArray(options.homeDomains) ? options.homeDomains[0] : options.homeDomains;

  if (await options.revocationStore.isRevoked(result.address)) {
    return {
      ok: false,
      error: 'invalid_token',
      reason: 'address revoked',
      wwwAuthenticate: buildWwwAuthenticate(realm, 'invalid_token'),
      logMessage: 'sep10-auth: address is revoked',
      logContext: { address: result.address },
    };
  }

  if (result.jti !== undefined && options.revocationStore.isTokenRevoked) {
    if (await options.revocationStore.isTokenRevoked(result.jti)) {
      return {
        ok: false,
        error: 'invalid_token',
        reason: 'token revoked',
        wwwAuthenticate: buildWwwAuthenticate(realm, 'invalid_token'),
        logMessage: 'sep10-auth: token is revoked',
        logContext: { address: result.address, jti: result.jti },
      };
    }
  }

  return result;
}

/**
 * Framework-agnostic SEP-10 request authentication. Parses the `Authorization`
 * header, verifies the signed challenge and consults the revocation store.
 *
 * Shared by the Express middleware ({@link createSep10Middleware}) and the
 * Fastify plugin (`sep10-auth/fastify`). A thrown error (e.g. the revocation
 * store being unavailable) is an internal failure, not an authentication
 * failure, and is left for the adapter to forward to its error handler.
 *
 * @param headers - The request headers (Node `http` / Fastify style).
 * @param options - The SEP-10 middleware options.
 * @returns The authentication result, including revocation checks.
 *
 * @example
 * ```ts
 * const result = await authenticateRequest(req.headers, options);
 * if (!result.ok) {
 *   res.set('WWW-Authenticate', result.wwwAuthenticate).status(401).end();
 *   return;
 * }
 * console.log('authenticated', result.address);
 * ```
 */
export async function authenticateRequest(
  headers: RequestHeaders,
  options: Sep10MiddlewareOptions,
): Promise<AuthenticateRequestResult> {
  return applyRevocationStore(await verifyRequestHeaders(headers, options), options);
}

/**
 * Creates an Express middleware that authenticates requests carrying a signed
 * SEP-10 challenge as `Authorization: Bearer <base64-xdr>`. On success it sets
 * `req.stellarAddress` (and `req.stellarTokenId` when a `jti` is present) and
 * calls `next()`; on failure it responds with 401 and an RFC 6750
 * `WWW-Authenticate` header.
 *
 * @param options - The SEP-10 middleware options. Validated eagerly at
 *   construction time.
 * @returns An Express `RequestHandler`.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createSep10Middleware } from 'sep10-auth';
 *
 * const app = express();
 * app.use(
 *   createSep10Middleware({
 *     serverAccountId: 'G...',
 *     homeDomains: ['example.com'],
 *     webAuthDomain: 'example.com',
 *     networkPassphrase: Networks.TESTNET,
 *   }),
 * );
 * app.get('/me', (req, res) => res.json({ address: req.stellarAddress }));
 * ```
 */
// Reference pattern only: expects the raw signed SEP-10 challenge XDR on every
// request via `Authorization: Bearer <base64-xdr>`. A production app would
// typically verify once and issue a short-lived session JWT instead of
// re-verifying the challenge transaction on every request; that is out of
// scope for this package.
export function createSep10Middleware(options: Sep10MiddlewareOptions): RequestHandler {
  const logger = options.logger ?? noopLogger;

  // ── #39: Validate required configuration at construction time ──────────────
  // Catch misconfiguration early rather than on first request.
  assertSep10MiddlewareOptions(options);

  // ── Request handler ─────────────────────────────────────────────────────────

  return async (req, res, next) => {
    const rawToken: ParseBearerTokenResult = options.getToken
      ? parseCustomToken(options.getToken(req))
      : parseBearerToken(req.header('Authorization') ?? '');

    // Use verifyRequestHeaders with the already-parsed token by constructing a
    // synthetic headers object, or delegate directly to the header-based path.
    let result: AuthenticateRequestResult;

    if (options.getToken) {
      // Custom extractor: build a synthetic headers object so verifyRequestHeaders
      // can receive the token without an Authorization header.
      if (!rawToken.ok) {
        const realm = Array.isArray(options.homeDomains)
          ? options.homeDomains[0]
          : options.homeDomains;
        result = {
          ok: false,
          error: 'invalid_request',
          reason: rawToken.reason,
          wwwAuthenticate: buildWwwAuthenticate(realm, 'invalid_request'),
          logMessage: 'sep10-auth: missing or malformed bearer token',
        };
      } else {
        result = verifyRequestHeaders(
          { authorization: `Bearer ${rawToken.token}` },
          options,
        );
      }
    } else {
      result = verifyRequestHeaders({ authorization: req.header('Authorization') }, options);
    }

    if (result.ok && options.revocationStore) {
      try {
        result = await applyRevocationStore(result, options);
      } catch (error) {
        logger.error('sep10-auth: revocation store lookup failed', error);
        next(error);
        return;
      }
    }

    if (!result.ok) {
      // Map the internal reason to a Sep10ErrorCode
      let code: import('./errors').Sep10ErrorCode;
      if (result.reason === 'address revoked' || result.reason === 'token revoked') {
        code = 'token_revoked';
      } else if (result.reason === 'bearer token too large') {
        code = 'token_too_large';
      } else if (result.reason === 'malformed bearer token') {
        code = 'malformed_token';
      } else if (result.error === 'invalid_request') {
        code = 'missing_token';
      } else {
        code = 'invalid_token';
      }

      logger.warn(result.logMessage, {
        ...result.logContext,
        ip: req.ip,
        path: req.path,
      });

      res
        .status(401)
        .set('WWW-Authenticate', result.wwwAuthenticate)
        .json(makeErrorBody('unauthorized', code, { reason: result.reason }));
      return;
    }

    logger.debug('sep10-auth: request authenticated', { address: result.address, path: req.path });
    req.stellarAddress = result.address;
    req.stellarTokenId = result.jti;
    next();
  };
}