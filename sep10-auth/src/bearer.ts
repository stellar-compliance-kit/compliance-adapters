/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Extract the token from an `Authorization: Bearer <token>` header.
 *
 * Returns the token, or `null` when the header is absent, uses a different
 * scheme, or carries no token. Framework-agnostic: the Express middleware in
 * this package uses it, and a Fastify/Koa adapter can reuse it rather than
 * re-deriving the same split.
 *
 * Scheme matching is **case-sensitive** (`Bearer`, not `bearer`). That is the
 * behaviour this package has always had, and it is preserved here deliberately:
 * RFC 7235 defines auth schemes as case-insensitive, so relaxing it would be a
 * real improvement — but it would also widen what authenticates, which is a
 * security-relevant change and not one to smuggle into an extraction.
 *
 * @example
 * parseBearerToken('Bearer abc123'); // 'abc123'
 * parseBearerToken('Basic abc123');  // null
 * parseBearerToken(undefined);       // null
 */
export function parseBearerToken(header: string | undefined | null): string | null {
  const [scheme, token] = (header ?? '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}
