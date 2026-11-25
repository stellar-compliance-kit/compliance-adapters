/// <reference types="jest" />
/**
 * Property-based tests for verifyChallenge using "almost valid" challenges.
 *
 * Each property builds a structurally valid, correctly signed SEP-10
 * challenge, applies exactly one mutation, and asserts that verifyChallenge
 * rejects it. The unmutated challenge must be accepted. The seed is fixed so
 * any failure reproduces: re-run with the seed/path fast-check prints.
 */
import * as fc from 'fast-check';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { verifyChallenge } from '../src/verify';
import { generateChallenge } from '../src/challenge';

const SEED = 0x5e910;
const NUM_RUNS = 20;

type Mutation =
  | 'swap-ops'
  | 'extra-non-managedata-op'
  | 'extra-op-foreign-source'
  | 'expired-timebounds'
  | 'future-timebounds'
  | 'nonzero-sequence'
  | 'wrong-first-op-source'
  | 'wrong-home-domain'
  | 'wrong-web-auth-domain'
  | 'wrong-network'
  | 'missing-client-signature'
  | 'wrong-server-signature';

const MUTATIONS: Mutation[] = [
  'swap-ops',
  'extra-non-managedata-op',
  'extra-op-foreign-source',
  'expired-timebounds',
  'future-timebounds',
  'nonzero-sequence',
  'wrong-first-op-source',
  'wrong-home-domain',
  'wrong-web-auth-domain',
  'wrong-network',
  'missing-client-signature',
  'wrong-server-signature',
];

interface Scenario {
  server: Keypair;
  client: Keypair;
  stranger: Keypair;
  domain: string;
  nonce: Buffer;
  /** Seconds added to the base offset of time-based mutations. */
  skew: number;
}

const keypairArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => Keypair.fromRawEd25519Seed(Buffer.from(seed)));

// "<domain> auth" must fit in a 64-byte manage_data name.
const domainArb = fc.domain().filter((d) => d.length <= 40);

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  server: keypairArb,
  client: keypairArb,
  stranger: keypairArb,
  domain: domainArb,
  nonce: fc.uint8Array({ minLength: 48, maxLength: 48 }).map((b) => Buffer.from(Buffer.from(b).toString('base64'))),
  skew: fc.integer({ min: 0, max: 1000 }),
});

/** Builds a challenge for the scenario with at most one mutation applied. */
function build(s: Scenario, mutation: Mutation | null): { xdr: string; verifyPassphrase: string } {
  const now = Math.floor(Date.now() / 1000);
  const serverId = s.server.publicKey();
  let minTime = now;
  let maxTime = now + 300;
  if (mutation === 'expired-timebounds') {
    minTime = now - 2000 - s.skew;
    maxTime = now - 1000 - s.skew;
  }
  if (mutation === 'future-timebounds') {
    minTime = now + 1000 + s.skew;
    maxTime = now + 1300 + s.skew;
  }

  const authOp = Operation.manageData({
    name: `${mutation === 'wrong-home-domain' ? `x${s.domain}` : s.domain} auth`,
    value: s.nonce,
    source: mutation === 'wrong-first-op-source' ? s.stranger.publicKey() : s.client.publicKey(),
  });
  const webAuthOp = Operation.manageData({
    name: 'web_auth_domain',
    value: mutation === 'wrong-web-auth-domain' ? `x${s.domain}` : s.domain,
    source: serverId,
  });

  const builder = new TransactionBuilder(
    new Account(serverId, mutation === 'nonzero-sequence' ? '0' : '-1'),
    { fee: '100', networkPassphrase: Networks.TESTNET, timebounds: { minTime, maxTime } },
  );
  (mutation === 'swap-ops' ? [webAuthOp, authOp] : [authOp, webAuthOp]).forEach((op) =>
    builder.addOperation(op),
  );
  if (mutation === 'extra-non-managedata-op') {
    builder.addOperation(Operation.bumpSequence({ bumpTo: '1', source: serverId }));
  }
  if (mutation === 'extra-op-foreign-source') {
    builder.addOperation(
      Operation.manageData({ name: 'extra', value: 'x', source: s.stranger.publicKey() }),
    );
  }

  const tx = builder.build();
  tx.sign(mutation === 'wrong-server-signature' ? s.stranger : s.server);
  if (mutation !== 'missing-client-signature') tx.sign(s.client);

  return {
    xdr: tx.toXDR(),
    verifyPassphrase: mutation === 'wrong-network' ? Networks.PUBLIC : Networks.TESTNET,
  };
}

async function verify(s: Scenario, mutation: Mutation | null) {
  const { xdr, verifyPassphrase } = build(s, mutation);
  return verifyChallenge(xdr, {
    serverAccountId: s.server.publicKey(),
    networkPassphrase: verifyPassphrase,
    homeDomains: s.domain,
    webAuthDomain: s.domain,
  });
}

// Distinct accounts are required for the mutations to be meaningful.
const distinctScenarioArb = scenarioArb.filter(
  (s) =>
    new Set([s.server.publicKey(), s.client.publicKey(), s.stranger.publicKey()]).size === 3,
);

describe('verifyChallenge - property-based mutation tests', () => {
  it('covers at least 6 mutation classes', () => {
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(6);
  });

  it('accepts the unmutated challenge', async () => {
    await fc.assert(
      fc.asyncProperty(distinctScenarioArb, async (s) => {
        const result = await verify(s, null);
        expect(result.valid).toBe(true);
        expect(result.address).toBe(s.client.publicKey());
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  it.each(MUTATIONS)('rejects the "%s" mutation', async (mutation) => {
    await fc.assert(
      fc.asyncProperty(distinctScenarioArb, async (s) => {
        const result = await verify(s, mutation);
        expect(result.valid).toBe(false);
        expect(result.address).toBe('');
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip properties over generateChallenge -> sign -> verifyChallenge.
// ---------------------------------------------------------------------------

const MAX_TIMEOUT_SECONDS = 900;

// "<domain> auth" must fit in a 64-byte manage_data name.
const roundTripDomainArb = fc.domain().filter((d) => d.length > 0 && d.length <= 40);

const memoArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 0, max: 2 ** 31 - 1 }).map((n) => String(n)),
);

const timeoutArb = fc.integer({ min: 1, max: MAX_TIMEOUT_SECONDS });

interface RoundTripScenario {
  server: Keypair;
  client: Keypair;
  stranger: Keypair;
  homeDomain: string;
  webAuthDomain: string;
  memo: string | null;
  timeout: number;
}

const roundTripScenarioArb: fc.Arbitrary<RoundTripScenario> = fc
  .record({
    server: keypairArb,
    client: keypairArb,
    stranger: keypairArb,
    homeDomain: roundTripDomainArb,
    webAuthDomain: roundTripDomainArb,
    memo: memoArb,
    timeout: timeoutArb,
  })
  .filter(
    (s) =>
      new Set([s.server.publicKey(), s.client.publicKey(), s.stranger.publicKey()]).size === 3,
  );

type RoundTripMutation =
  | 'none'
  | 'wrong-home-domain'
  | 'wrong-web-auth-domain'
  | 'wrong-memo'
  | 'wrong-timeout'
  | 'wrong-signature';

/** Generates a challenge for the scenario, signs it, and optionally mutates it. */
function buildRoundTrip(
  s: RoundTripScenario,
  mutation: RoundTripMutation,
): { xdr: string; homeDomains: string; webAuthDomain: string } {
  const { xdr } = generateChallenge({
    serverAccountId: s.server.publicKey(),
    clientAccountId: s.client.publicKey(),
    networkPassphrase: Networks.TESTNET,
    homeDomain: s.homeDomain,
    webAuthDomain: s.webAuthDomain,
    memo: s.memo,
    timeout: s.timeout,
  });

  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);

  if (mutation === 'wrong-timeout') {
    // Rebuild with a different timeout so the timebounds no longer match.
    const { xdr: otherXdr } = generateChallenge({
      serverAccountId: s.server.publicKey(),
      clientAccountId: s.client.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomain: s.homeDomain,
      webAuthDomain: s.webAuthDomain,
      memo: s.memo,
      timeout: s.timeout === MAX_TIMEOUT_SECONDS ? 1 : s.timeout + 1,
    });
    const other = TransactionBuilder.fromXDR(otherXdr, Networks.TESTNET);
    other.sign(s.server);
    other.sign(s.client);
    return {
      xdr: other.toXDR(),
      homeDomains: s.homeDomain,
      webAuthDomain: s.webAuthDomain,
    };
  }

  tx.sign(mutation === 'wrong-signature' ? s.stranger : s.server);
  tx.sign(s.client);

  return {
    xdr: tx.toXDR(),
    homeDomains: mutation === 'wrong-home-domain' ? `x${s.homeDomain}` : s.homeDomain,
    webAuthDomain: mutation === 'wrong-web-auth-domain' ? `x${s.webAuthDomain}` : s.webAuthDomain,
  };
}

async function verifyRoundTrip(s: RoundTripScenario, mutation: RoundTripMutation) {
  const { xdr, homeDomains, webAuthDomain } = buildRoundTrip(s, mutation);
  return verifyChallenge(xdr, {
    serverAccountId: s.server.publicKey(),
    networkPassphrase: Networks.TESTNET,
    homeDomains,
    webAuthDomain,
  });
}

describe('generateChallenge/verifyChallenge - round-trip property tests', () => {
  it('accepts generated challenges across domains, memos and timeouts', async () => {
    await fc.assert(
      fc.asyncProperty(roundTripScenarioArb, async (s) => {
        const result = await verifyRoundTrip(s, 'none');
        expect(result.valid).toBe(true);
        expect(result.address).toBe(s.client.publicKey());
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });

  const roundTripMutations: RoundTripMutation[] = [
    'wrong-home-domain',
    'wrong-web-auth-domain',
    'wrong-memo',
    'wrong-timeout',
    'wrong-signature',
  ];

  it.each(roundTripMutations)('rejects the "%s" round-trip mutation', async (mutation) => {
    await fc.assert(
      fc.asyncProperty(roundTripScenarioArb, async (s) => {
        const result = await verifyRoundTrip(s, mutation);
        expect(result.valid).toBe(false);
        expect(result.address).toBe('');
      }),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  });
});
