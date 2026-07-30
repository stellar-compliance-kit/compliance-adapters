/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Networks, WebAuth } from '@stellar/stellar-sdk';

export interface VerifyChallengeOptions {
  serverAccountId: string;
  networkPassphrase?: string;
  homeDomains: string | string[];
  webAuthDomain: string;
}

export interface VerifyResult {
  valid: boolean;
  address: string;
  error?: string;
}

export function verifyChallenge(
  signedTransactionXDR: string,
  options: VerifyChallengeOptions,
): VerifyResult {
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

  try {
    const { clientAccountID } = WebAuth.readChallengeTx(
      signedTransactionXDR,
      options.serverAccountId,
      networkPassphrase,
      options.homeDomains,
      options.webAuthDomain,
    );

    WebAuth.verifyChallengeTxSigners(
      signedTransactionXDR,
      options.serverAccountId,
      networkPassphrase,
      [clientAccountID],
      options.homeDomains,
      options.webAuthDomain,
    );

    return { valid: true, address: clientAccountID };
  } catch (error) {
    return {
      valid: false,
      address: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
