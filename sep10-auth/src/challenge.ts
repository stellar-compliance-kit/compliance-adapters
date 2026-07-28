import { Keypair, Networks, StrKey, WebAuth } from '@stellar/stellar-sdk';

export class InvalidClientAddressError extends Error {
  constructor(address: string) {
    super(`Invalid client address: ${address}`);
    this.name = 'InvalidClientAddressError';
  }
}

export interface GenerateChallengeOptions {
  homeDomain?: string;
  webAuthDomain?: string;
  networkPassphrase?: string;
  timeoutSeconds?: number;
  memo?: string | null;
}

export interface GeneratedChallenge {
  transactionXDR: string;
  networkPassphrase: string;
  expiresAt: Date;
}

const DEFAULT_HOME_DOMAIN = 'localhost:3000';
const DEFAULT_TIMEOUT_SECONDS = 300;

// Takes the server's Keypair (not just its public address) because building
// and signing the SEP-10 challenge transaction requires the server's secret key.
export function generateChallenge(
  clientAddress: string,
  serverKeypair: Keypair,
  options: GenerateChallengeOptions = {},
): GeneratedChallenge {
  if (!StrKey.isValidEd25519PublicKey(clientAddress)) {
    throw new InvalidClientAddressError(clientAddress);
  }

  const homeDomain = options.homeDomain ?? DEFAULT_HOME_DOMAIN;
  const webAuthDomain = options.webAuthDomain ?? homeDomain;
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  const transactionXDR = WebAuth.buildChallengeTx(
    serverKeypair,
    clientAddress,
    homeDomain,
    timeoutSeconds,
    networkPassphrase,
    webAuthDomain,
    options.memo ?? null,
  );

  return {
    transactionXDR,
    networkPassphrase,
    expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
  };
}
