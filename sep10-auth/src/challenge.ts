/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Keypair, Networks, StrKey, WebAuth } from '@stellar/stellar-sdk';
import { type Logger, noopLogger } from '@compliance-adapters/logger';

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
  /**
   * The wallet's client domain, as supplied in the SEP-10 `client_domain`
   * request parameter. When set, the challenge transaction includes an
   * additional `client_domain` ManageData operation (sourced from
   * {@link GenerateChallengeOptions.clientSigningKey}) that the wallet's
   * client-domain server must co-sign alongside the client's own key.
   * Requires {@link GenerateChallengeOptions.clientSigningKey} to also be set.
   */
  clientDomain?: string;
  /**
   * The `SIGNING_KEY` published on `<clientDomain>/.well-known/stellar.toml`.
   * The caller is responsible for resolving this value; this package does not
   * fetch stellar.toml itself. Required when {@link GenerateChallengeOptions.clientDomain} is set.
   */
  clientSigningKey?: string;
  logger?: Logger;
}

/**
 * The result of {@link generateChallenge}.
 */
export interface GeneratedChallenge {
  /** Base64-encoded XDR of the unsigned (server-signed only) challenge transaction, to be sent to the client for signing. */
  transactionXDR: string;
  /** The network passphrase the challenge transaction was built for. Must be passed back into {@link verifyChallenge} unchanged. */
  networkPassphrase: string;
  /** When the challenge stops being valid, derived from `timeoutSeconds`. A signed challenge submitted after this time will fail verification. */
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

  const logger = options.logger ?? noopLogger;
  const homeDomain = options.homeDomain ?? DEFAULT_HOME_DOMAIN;
  const webAuthDomain = options.webAuthDomain ?? homeDomain;

  if (!options.homeDomain && process.env.NODE_ENV === 'production') {
    logger.warn(
      `sep10-auth: generateChallenge is using the default homeDomain "${DEFAULT_HOME_DOMAIN}" ` +
        'in a production environment. Pass an explicit `homeDomain` option matching your deployed domain.',
    );
  }
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
    options.clientDomain ?? null,
    options.clientSigningKey ?? null,
  );

  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
  logger.info('sep10-auth: challenge generated', { clientAddress, expiresAt });

  return {
    transactionXDR,
    networkPassphrase,
    expiresAt,
  };
}
