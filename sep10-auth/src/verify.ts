import { Networks, Operation, WebAuth } from '@stellar/stellar-sdk';

export interface VerifyChallengeOptions {
  serverAccountId: string;
  networkPassphrase?: string;
  homeDomains: string | string[];
  webAuthDomain: string;
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

export function verifyChallenge(
  signedTransactionXDR: string,
  options: VerifyChallengeOptions,
): VerifyResult {
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

  try {
    const { clientAccountID, tx } = WebAuth.readChallengeTx(
      signedTransactionXDR,
      options.serverAccountId,
      networkPassphrase,
      options.homeDomains,
      options.webAuthDomain,
    );

    // Also validates that the client_domain operation's source key (if any)
    // co-signed the transaction, per the SEP-10 client domain flow.
    WebAuth.verifyChallengeTxSigners(
      signedTransactionXDR,
      options.serverAccountId,
      networkPassphrase,
      [clientAccountID],
      options.homeDomains,
      options.webAuthDomain,
    );

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
    return {
      valid: false,
      address: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
