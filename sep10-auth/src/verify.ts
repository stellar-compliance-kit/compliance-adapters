import { Networks, WebAuth } from '@stellar/stellar-sdk';

export interface VerifyChallengeOptions {
  serverAccountId: string;
  networkPassphrase?: string;
  homeDomains: string | string[];
  webAuthDomain: string | string[];
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
  const webAuthDomains = Array.isArray(options.webAuthDomain)
    ? options.webAuthDomain
    : [options.webAuthDomain];

  // The underlying SDK only matches against a single webAuthDomain per call,
  // so try each candidate in turn and succeed on the first match.
  let lastError: unknown;

  for (const webAuthDomain of webAuthDomains) {
    try {
      const { clientAccountID } = WebAuth.readChallengeTx(
        signedTransactionXDR,
        options.serverAccountId,
        networkPassphrase,
        options.homeDomains,
        webAuthDomain,
      );

      WebAuth.verifyChallengeTxSigners(
        signedTransactionXDR,
        options.serverAccountId,
        networkPassphrase,
        [clientAccountID],
        options.homeDomains,
        webAuthDomain,
      );

      return { valid: true, address: clientAccountID };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    valid: false,
    address: '',
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}
