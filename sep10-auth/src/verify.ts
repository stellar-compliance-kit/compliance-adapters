/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Networks, Operation, WebAuth } from '@stellar/stellar-sdk';
import { assertBareDomain } from './challenge';
import { isValidStellarAddress } from '@compliance-adapters/shared';

export interface VerifyChallengeOptions {
  serverAccountId: string;
  networkPassphrase?: string;
  homeDomains: string | string[];
  webAuthDomain: string | string[];
  /**
   * Optional expected memo for the signed challenge transaction. If set,
   * verification will fail if the transaction's memo does not match.
   * Useful for replay protection (e.g., tying a challenge to a specific
   * session or request ID).
   *
   * Expected encoding depends on the transaction's memo type: the plain string
   * for `text` and `id` memos, and a hex string (case-insensitive) for `hash`
   * and `return` memos.
   */
  expectedMemo?: string;
}

/**
 * The result of {@link verifyChallenge}.
 */
export interface VerifyResult {
  /** Whether the signed challenge transaction passed all SEP-10 checks. */
  valid: boolean;
  /** The authenticated Stellar account ID (client's master key), or `''` when `valid` is `false`. */
  address: string;
  /**
   * The wallet's client domain, present only when the challenge included a
   * `client_domain` ManageData operation (see {@link
   * GenerateChallengeOptions.clientDomain | generateChallenge's clientDomain
   * option}) and that domain's signing key co-signed the transaction.
   */
  clientDomain?: string;
  /** Human-readable reason verification failed, present only when `valid` is `false`. */
  error?: string;
}

// Buffer#toString() defaults to utf8, which mangles the raw bytes of hash/return
// memos, so those are compared as hex instead.
function encodeMemo(memo: { type: string; value: unknown }): string {
  if (memo.value === null || memo.value === undefined) return '';
  if (Buffer.isBuffer(memo.value) || memo.value instanceof Uint8Array) {
    const buf = Buffer.from(memo.value);
    return memo.type === 'hash' || memo.type === 'return' ? buf.toString('hex') : buf.toString('utf8');
  }
  return String(memo.value);
}

export function verifyChallenge(
  signedTransactionXDR: string,
  options: VerifyChallengeOptions,
): VerifyResult {
  if (!isValidStellarAddress(options.serverAccountId)) {
    return {
      valid: false,
      address: '',
      error: `sep10-auth: Invalid serverAccountId: ${options.serverAccountId}`,
    };
  }

  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
  const homeDomainList = Array.isArray(options.homeDomains)
    ? options.homeDomains
    : [options.homeDomains];
  const webAuthDomains = Array.isArray(options.webAuthDomain)
    ? options.webAuthDomain
    : [options.webAuthDomain];

  try {
    homeDomainList.forEach((d) => assertBareDomain('homeDomains', d));
    webAuthDomains.forEach((d) => assertBareDomain('webAuthDomain', d));
  } catch (error) {
    return { valid: false, address: '', error: (error as Error).message };
  }

  // The underlying SDK only matches against a single webAuthDomain per call,
  // so try each candidate in turn and succeed on the first match.
  let lastError: unknown;

  for (const webAuthDomain of webAuthDomains) {
    try {
      const { clientAccountID, tx } = WebAuth.readChallengeTx(
        signedTransactionXDR,
        options.serverAccountId,
        networkPassphrase,
        options.homeDomains,
        webAuthDomain,
      );

      // Also validates that the client_domain operation's source key (if any)
      // co-signed the transaction, per the SEP-10 client domain flow.
      WebAuth.verifyChallengeTxSigners(
        signedTransactionXDR,
        options.serverAccountId,
        networkPassphrase,
        [clientAccountID],
        options.homeDomains,
        webAuthDomain,
      );

      if (options.expectedMemo !== undefined) {
        const txMemo = encodeMemo(tx.memo);
        const isBinaryMemo = tx.memo.type === 'hash' || tx.memo.type === 'return';
        const matches = isBinaryMemo
          ? txMemo === options.expectedMemo.toLowerCase()
          : txMemo === options.expectedMemo;
        if (!matches) {
          throw new Error(
            `sep10-auth: memo mismatch, expected "${options.expectedMemo}" but got "${txMemo}"`,
          );
        }
      }

      const clientDomainOp = tx.operations.find(
        (op): op is Operation.ManageData => op.type === 'manageData' && op.name === 'client_domain',
      );
      const clientDomain = clientDomainOp?.value?.toString();

      return {
        valid: true,
        address: clientAccountID,
        ...(clientDomain ? { clientDomain } : {}),
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    valid: false,
    address: '',
    error: `sep10-auth: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  };
}
