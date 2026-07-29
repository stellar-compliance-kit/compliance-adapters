import { Keypair, Networks, WebAuth } from '@stellar/stellar-sdk';
import { type Logger, noopLogger } from '@compliance-adapters/logger';

export interface GenerateChallengeOptions {
  homeDomain?: string;
  webAuthDomain?: string;
  networkPassphrase?: string;
  timeoutSeconds?: number;
  memo?: string | null;
  logger?: Logger;
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
  const logger = options.logger ?? noopLogger;
  const homeDomain = options.homeDomain ?? DEFAULT_HOME_DOMAIN;
  const webAuthDomain = options.webAuthDomain ?? homeDomain;
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;

  logger.debug('sep10-auth: generating challenge', { clientAddress, homeDomain, webAuthDomain });

  const transactionXDR = WebAuth.buildChallengeTx(
    serverKeypair,
    clientAddress,
    homeDomain,
    timeoutSeconds,
    networkPassphrase,
    webAuthDomain,
    options.memo ?? null,
  );

  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
  logger.info('sep10-auth: challenge generated', { clientAddress, expiresAt });

  return {
    transactionXDR,
    networkPassphrase,
    expiresAt,
  };
}
