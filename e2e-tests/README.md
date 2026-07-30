# End-to-End Integration Tests

This directory contains true end-to-end tests that validate the complete compliance adapter flow: contract deployment → sanctions sync → event listener observation.

## What Gets Tested

A single comprehensive test that:
1. Deploys `denylist-gate` from compliance-primitives to a local Stellar testnet
2. Runs `sanctions-oracle` sync (non-dry-run) against a known flagged address
3. Starts `horizon-listener` monitoring for denylist events
4. Asserts the event is observed and correctly reported

This proves the three packages actually interoperate end-to-end, beyond isolated unit tests.

## Test Infrastructure

### Network Setup

**Local Testnet**: Stellar Soroban Preview Container (`stellar/soroban-preview:latest`)
- Runs isolated Stellar network in Docker
- No external dependencies on testnet.stellar.org
- Consistent ledger state for repeatable tests
- ~5s block time (configurable via docker-compose)

**Why Docker Compose**: 
- Simple setup/teardown (no manual network management)
- Network isolation for parallel test runs
- Clear dependency ordering (testnet must be ready before tests run)
- Works in CI and locally with identical behavior

### File Structure

```
e2e-tests/
  docker-compose.yml      # Stellar testnet container config
  jest.config.js          # Jest config (separate from unit tests)
  tsconfig.json           # TypeScript config for e2e
  package.json            # e2e test dependencies
  test/
    integration.test.ts   # The main e2e test
    fixtures/
      contract.wasm       # Prebuilt denylist-gate contract
      setup.ts            # Helper to deploy contract, fund accounts
```

### Running Tests

#### Locally (Recommended for Development)

```bash
# Start the testnet container and run tests
npm run e2e

# Run tests without stopping container (for iteration)
npm run e2e:test-only

# Stop the container when done
npm run e2e:stop
```

#### In CI

```bash
# Single command; CI will handle cleanup on job exit
npm run e2e:ci
```

## How It Works

### 1. Setup Phase (Before Test)

```
docker-compose up -d
↓
Wait for testnet RPC to be healthy
↓
Deploy denylist-gate contract
↓
Fund test account (issuer keypair)
↓
Ready for test
```

### 2. Test Flow

```
1. horizon-listener starts polling for events
   (cursor = undefined, RPC will return recent events)

2. sanctions-oracle sync runs (non-dry-run)
   → Checks MOCK_FLAGGED_ADDRESS against provider
   → Calls add_to_denylist on contract
   → Transaction submitted, finalized, event emitted

3. Listener poll cycle detects event
   → Cursor advances past the new event
   → Event handler records the event

4. Assertions:
   ✓ Event was received
   ✓ Event contains correct address
   ✓ Event topic indicates denylist_added
```

### 3. Teardown Phase (After Test)

```
docker-compose down
↓
Container removed, network isolated
↓
Clean state for next test run
```

## Latency & Resilience

### Why This Matters

Real ledgers have unpredictable latency:
- Block times vary (Stellar: 3-5 seconds)
- RPC nodes may lag behind ledger state
- Network partitions and retries happen

Tests that use `setTimeout` are flaky. This test handles it properly.

### Implementation

**Polling with Exponential Backoff**
- horizon-listener already implements backoff (see `src/backoff.ts`)
- For e2e: cursor advances naturally; we wait for it to move
- Timeout: 30 seconds max (5 blocks + buffer)

**Cursor Threading**
- listener.getLatestCursor() exposed for assertions
- Test polls listener until cursor advances past event
- No arbitrary sleeps; waits for actual ledger state

**Transaction Finalization**
- sanctions-oracle CLI returns `{ hash }` from `server.submitTransaction()`
- submitTransaction already waits for finalization in Stellar SDK
- No additional waits needed after sync completes

## Contract & Account Management

### Test Keypairs

```
Issuer (Contract Owner):
  Public: GBUQWP3KQNXKC7XLWFLLJMXE72VAS6QLXRRTGZTTZPPQNYXV3VT5FHI
  Secret: SBXQHF6SRJ6K32UKSJ2NVSRQHXNHOHUWCXZCWZSFUHJ5ZQEVJ7VNU4Y4

Denylist Attester:
  (Same as issuer, for simplicity)

Test Subject (Flagged Address):
  GHBRPOIGF3CBFNOBM2O4RAK3VRJNVGFYGWWQC5HYFSXMECOSFOGYR5XK
  (From sanctions-oracle mock provider)
```

### Contract Deployment

Contracts are pre-built and committed to the repo as WASM artifacts:
- `e2e-tests/fixtures/denylist-gate.wasm`
- Built from compliance-primitives repo

If contracts are updated in compliance-primitives:
```bash
# Copy new WASM files to e2e-tests/fixtures/
cp ../compliance-primitives/target/wasm32-unknown-unknown/release/denylist_gate.wasm e2e-tests/fixtures/

# Rebuild and commit
npm run build --workspace=compliance-adapters
git add e2e-tests/fixtures/
```

## Separation from Unit Tests

E2E tests are **excluded from default `npm test`** to keep CI fast:

```bash
npm test
# Runs only: sep10-auth, sanctions-oracle, horizon-listener unit tests
# Takes ~5s, deterministic (fake timers)

npm run e2e
# Runs only: end-to-end integration test
# Takes ~30s, depends on real ledger latency
# Should only run when explicitly requested or in a separate CI job
```

### CI Setup Example

```yaml
jobs:
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test              # Fast, ~5s

  test-e2e:
    runs-on: ubuntu-latest
    needs: test-unit              # Run after unit tests pass
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm install --workspace=e2e-tests
      - run: npm run e2e:ci       # Slower, ~30s, but proves interop
```

## Troubleshooting

### Container Won't Start

```bash
# Check if port 8000 is already in use
lsof -i :8000

# Kill any existing container
docker-compose -f e2e-tests/docker-compose.yml down -v

# Try again
npm run e2e
```

### RPC Health Check Fails

The test waits up to 30s for RPC to be ready. If it times out:

```bash
# Check container logs
docker-compose -f e2e-tests/docker-compose.yml logs soroban-preview

# Verify RPC endpoint manually
curl http://localhost:8000/soroban/rpc
# Should return 405 (method not allowed on GET); that means it's alive
```

### Event Not Detected

Check listener logs in the test output. If the event wasn't detected:

1. Verify contract call succeeded (sync output should show hash)
2. Check RPC is returning events: `curl http://localhost:8000/soroban/rpc` with getEvents RPC call
3. Verify contract ID in listener matches deployed contract ID
4. Check cursor threading — listener should log cursor advancement

### All Tests Hang

If tests hang indefinitely, most likely causes:
- RPC didn't become ready (container issue)
- Contract deployment timed out (insufficient funds for fees)
- Event emission failed silently (check sync transaction receipt)

Add verbose logging to understand where it's stuck:

```bash
DEBUG=* npm run e2e:test-only
```

## Future Enhancements

- [ ] Parameterize contract source (allow testing with upgraded contract versions)
- [ ] Add allowlist-token sync flow test
- [ ] Test multiple addresses in single sync run
- [ ] Add load test (many denylists in one transaction)
- [ ] Test contract event filtering (listener only receives relevant events)
- [ ] Failure scenarios (insufficient funds, invalid contract state, RPC outages)
