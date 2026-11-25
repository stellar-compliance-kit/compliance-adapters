import { expectType, expectAssignable, expectError } from 'tsd';
import {
  WebAuth,
  Challenge,
  ChallengeTransaction,
  ClientDomainSigner,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from '../src';

// --- WebAuth static methods ---

expectType<Promise<Challenge>>(
  WebAuth.buildChallengeTx(
    {} as Keypair,
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    'example.com',
    300,
    Networks.TESTNET,
    'example.com',
  ),
);

expectType<Promise<Challenge>>(
  WebAuth.buildChallengeTx(
    {} as Keypair,
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    'example.com',
    300,
    Networks.TESTNET,
    'example.com',
    'client.example.com',
  ),
);

expectType<Promise<Challenge>>(
  WebAuth.buildChallengeTx(
    {} as Keypair,
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    'example.com',
    300,
    Networks.TESTNET,
    'example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<Challenge>(
  WebAuth.readChallengeTx(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    'example.com',
  ),
);

expectType<Challenge>(
  WebAuth.readChallengeTx(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    'example.com',
    'client.example.com',
  ),
);

expectType<Challenge>(
  WebAuth.readChallengeTx(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    'example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ',
    Networks.TESTNET,
    ['GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQZ4ZQ'],
    'example.com',
    undefined,
    'client.example.com',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {} as ClientDomainSigner,
  ),
);

expectType<ChallengeTransaction>(
  WebAuth.verifyChallengeTxSigners(
    'challenge',
    'GBWMCCCM2NVGVXKQYQ5X4QZ4ZQZ4ZQ