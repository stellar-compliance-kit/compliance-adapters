/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * SEP-10 authentication primitives for Stellar.
 *
 * This barrel re-exports the challenge builder/parser, signature verification,
 * Express-style middleware, revocation store, rate limiter, JWT helpers, router,
 * and error types. Each export below includes a minimal usage example.
 *
 * @example
 * ```ts
 * import { buildChallenge, verifyChallenge } from '@compliance-kit/sep10-auth';
 *
 * const challenge = buildChallenge({
 *   serverSigningKey: serverKeypair.publicKey(),
 *   clientAccount: 'GCLIENT...',
 *   homeDomain: 'example.com',
 *   webAuthDomain: 'example.com',
 *   networkPassphrase: Networks.TESTNET,
 * });
 * const result = verifyChallenge(challenge, { serverSigningKey: serverKeypair.publicKey() });
 * ```
 *
 * @packageDocumentation
 */

/**
 * Challenge construction and parsing utilities.
 *
 * @example
 * ```ts
 * import { buildChallenge, parseChallenge } from '@compliance-kit/sep10-auth';
 *
 * const xdr = buildChallenge({
 *   serverSigningKey: serverKeypair.publicKey(),
 *   clientAccount: 'GCLIENT...',
 *   homeDomain: 'example.com',
 *   webAuthDomain: 'example.com',
 *   networkPassphrase: Networks.TESTNET,
 * });
 * const parsed = parseChallenge(xdr, Networks.TESTNET);
 * console.log(parsed.clientAccount);
 * ```
 */
export * from './challenge';

/**
 * Challenge signature verification utilities.
 *
 * @example
 * ```ts
 * import { verifyChallenge } from '@compliance-kit/sep10-auth';
 *
 * const result = verifyChallenge(signedChallengeXdr, {
 *   serverSigningKey: serverKeypair.publicKey(),
 *   networkPassphrase: Networks.TESTNET,
 * });
 * if (!result.valid) throw new Error(result.reason);
 * ```
 */
export * from './verify';

/**
 * Express-compatible authentication middleware.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { sep10Middleware } from '@compliance-kit/sep10-auth';
 *
 * const app = express();
 * app.use(sep10Middleware({ serverSigningKey: serverKeypair.publicKey() }));
 * ```
 */
export * from './middleware';

/**
 * Session revocation store and helpers.
 *
 * @example
 * ```ts
 * import { InMemoryRevocationStore, revokeSession } from '@compliance-kit/sep10-auth';
 *
 * const store = new InMemoryRevocationStore();
 * await revokeSession(store, { jti: 'session-id', expiresAt: Date.now() + 60_000 });
 * ```
 */
export * from './revocation';

/**
 * Rate limiting utilities for challenge issuance.
 *
 * @example
 * ```ts
 * import { RateLimiter } from '@compliance-kit/sep10-auth';
 *
 * const limiter = new RateLimiter({ windowMs: 60_000, max: 10 });
 * if (!limiter.allow(clientAccount)) throw new Error('rate limited');
 * ```
 */
export * from './rate-limiter';

/**
 * JWT issuance and verification helpers.
 *
 * @example
 * ```ts
 * import { issueJwt, verifyJwt } from '@compliance-kit/sep10-auth';
 *
 * const token = issueJwt({ subject: clientAccount, secret: jwtSecret, expiresIn: '1h' });
 * const claims = verifyJwt(token, { secret: jwtSecret });
 * ```
 */
export * from './jwt';

/**
 * Router that wires SEP-10 endpoints onto an Express app.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { createSep10Router } from '@compliance-kit/sep10-auth';
 *
 * const app = express();
 * app.use('/auth', createSep10Router({ serverSigningKey: serverKeypair.publicKey() }));
 * ```
 */
export * from './router';

/**
 * Error types thrown by SEP-10 operations.
 *
 * @example
 * ```ts
 * import { Sep10Error } from '@compliance-kit/sep10-auth';
 *
 * try {
 *   verifyChallenge(xdr, opts);
 * } catch (err) {
 *   if (err instanceof Sep10Error) console.error(err.code, err.message);
 * }
 * ```
 */
export * from './errors';

/**
 * Logger interface accepted by SEP-10 components.
 *
 * @example
 * ```ts
 * import type { Logger } from '@compliance-kit/sep10-auth';
 *
 * const logger: Logger = {
 *   info: (msg) => console.log(msg),
 *   error: (msg) => console.error(msg),
 * };
 * ```
 */
export type { Logger } from '@compliance-adapters/logger';