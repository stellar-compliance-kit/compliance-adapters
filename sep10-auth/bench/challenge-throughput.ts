import { Keypair } from '@stellar/stellar-sdk';
import { generateChallenge } from '../src/challenge';

// Measures how many generateChallenge calls per second are achievable, so a
// regression in the SDK's WebAuth.buildChallengeTx cost profile is visible
// as a throughput drop rather than a silent slowdown.

const DURATION_MS = 2000;

function runBenchmark(): void {
  const serverKeypair = Keypair.random();
  const clientKeypair = Keypair.random();
  const clientAddress = clientKeypair.publicKey();

  let iterations = 0;
  const start = Date.now();
  let elapsed = 0;

  while (elapsed < DURATION_MS) {
    generateChallenge(clientAddress, serverKeypair, {
      homeDomain: 'example.com',
      webAuthDomain: 'example.com',
    });
    iterations += 1;
    elapsed = Date.now() - start;
  }

  const opsPerSecond = iterations / (elapsed / 1000);

  console.log(
    `generateChallenge: ${iterations} calls in ${elapsed}ms (${opsPerSecond.toFixed(1)} ops/sec)`,
  );
}

runBenchmark();
