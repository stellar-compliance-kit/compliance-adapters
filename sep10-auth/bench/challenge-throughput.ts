import { Keypair } from '@stellar/stellar-sdk';
import { generateChallenge } from '../src/challenge';
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Measures how many generateChallenge calls per second are achievable, so a
// regression in the SDK's WebAuth.buildChallengeTx cost profile is visible
// as a throughput drop rather than a silent slowdown.

const DURATION_MS = 2000;

interface BenchmarkResult {
  benchmark: 'sep10-auth-generate-challenge-throughput';
  durationMs: number;
  iterations: number;
  opsPerSecond: number;
  timestamp: string;
}

function runBenchmark(): BenchmarkResult {
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

  const opsPerSecond = Number((iterations / (elapsed / 1000)).toFixed(1));
  return {
    benchmark: 'sep10-auth-generate-challenge-throughput',
    durationMs: elapsed,
    iterations,
    opsPerSecond,
    timestamp: new Date().toISOString(),
  };
}

function printResult(result: BenchmarkResult): void {
  console.log(
    `generateChallenge: ${result.iterations} calls in ${result.durationMs}ms (${result.opsPerSecond.toFixed(1)} ops/sec)`,
  );
  // Machine-readable marker consumed by CI regression checks.
  console.log(`BENCHMARK_RESULT_JSON=${JSON.stringify(result)}`);
}

const result = runBenchmark();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result));
} else {
  printResult(result);
}

// ---------------------------------------------------------------------------
// k6 load test for the SEP-10 router (issue #1048).
//
// Exercises GET /auth (challenge issuance) and POST /auth (token exchange)
// against a locally started server. Run with:
//
//   k6 run sep10-auth/bench/challenge-throughput.ts \
//     --env BASE_URL=http://localhost:3000 \
//     --env VUS=20 --env DURATION=30s
//
// Thresholds fail the run on latency/error regressions. A machine-readable
// summary is emitted via handleSummary() as summary.json.
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.VUS || 10);
const DURATION = __ENV.DURATION || '30s';

const challengeLatency = new Trend('sep10_challenge_latency', true);
const tokenLatency = new Trend('sep10_token_latency', true);
const challengeErrors = new Rate('sep10_challenge_errors');
const tokenErrors = new Rate('sep10_token_errors');
const challengeCount = new Counter('sep10_challenge_requests');
const tokenCount = new Counter('sep10_token_requests');

export const options = {
  scenarios: {
    sep10_load: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    sep10_challenge_errors: ['rate<0.01'],
    sep10_token_errors: ['rate<0.01'],
    sep10_challenge_latency: ['p(95)<500'],
    sep10_token_latency: ['p(95)<500'],
  },
};

interface ChallengeResponse {
  transaction?: string;
  network_passphrase?: string;
}

export default function (): void {
  const clientKeypair = Keypair.random();
  const account = clientKeypair.publicKey();

  // GET /auth — request a challenge transaction.
  const challengeRes = http.get(
    `${BASE_URL}/auth?account=${encodeURIComponent(account)}&home_domain=example.com`,
  );
  challengeLatency.add(challengeRes.timings.duration);
  challengeCount.add(1);
  const challengeOk = check(challengeRes, {
    'challenge status is 200': (r) => r.status === 200,
  });
  challengeErrors.add(!challengeOk);

  if (!challengeOk) {
    return;
  }

  let challenge: ChallengeResponse;
  try {
    challenge = challengeRes.json() as ChallengeResponse;
  } catch {
    challengeErrors.add(true);
    return;
  }

  if (!challenge.transaction) {
    challengeErrors.add(true);
    return;
  }

  // POST /auth — exchange the signed challenge for a token.
  const tokenRes = http.post(
    `${BASE_URL}/auth`,
    JSON.stringify({ transaction: challenge.transaction }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  tokenLatency.add(tokenRes.timings.duration);
  tokenCount.add(1);
  const tokenOk = check(tokenRes, {
    'token status is 200': (r) => r.status === 200,
  });
  tokenErrors.add(!tokenOk);
}

export function handleSummary(data: unknown): Record<string, string> {
  const summary = {
    loadTest: 'sep10-auth-challenge-and-token',
    baseUrl: BASE_URL,
    vus: VUS,
    duration: DURATION,
    timestamp: new Date().toISOString(),
    metrics: data,
  };
  return {
    'summary.json': JSON.stringify(summary, null, 2),
    stdout: `SEP10_LOAD_SUMMARY_JSON=${JSON.stringify(summary)}\n`,
  };
}
