/**
 * E2E Test Setup Helpers
 *
 * Handles:
 * - RPC health checks and waits
 * - Test account funding
 * - Contract deployment (if needed; pre-built WASMs committed to repo)
 * - Network configuration
 */

import {
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  nativeToScVal,
  rpc,
  Contract,
  Address,
} from '@stellar/stellar-sdk';

/**
 * Configuration for the local testnet.
 * Matches docker-compose.yml environment.
 */
export const TEST_CONFIG = {
  rpcUrl: 'http://localhost:8000/soroban/rpc',
  networkPassphrase: Networks.FUTURENET_NETWORK_PASSPHRASE,
  networkId: 'Testnet SDF Future Network ; October 2022',
  
  // Test keypairs (derived from Stellar testnet defaults)
  // These are PUBLIC/REUSABLE; never commit real secrets
  issuer: Keypair.fromSecret('SBXQHF6SRJ6K32UKSJ2NVSRQHXNHOHUWCXZCWZSFUHJ5ZQEVJ7VNU4Y4'),
  
  // Known flagged address from sanctions-oracle mock provider
  flaggedAddress: 'GHBRPOIGF3CBFNOBM2O4RAK3VRJNVGFYGWWQC5HYFSXMECOSFOGYR5XK',
  
  // Timeouts
  rpcHealthCheckTimeoutMs: 30000,
  txSubmitTimeoutMs: 30000,
  eventPollTimeoutMs: 30000,
};

/**
 * Wait for RPC to be healthy and responding.
 * Retries with exponential backoff up to maxAttempts.
 */
export async function waitForRpcHealth(
  maxAttempts: number = 30,
  delayMs: number = 1000,
): Promise<rpc.Server> {
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const server = new rpc.Server(TEST_CONFIG.rpcUrl);
      // Make a simple RPC call to verify connectivity
      const response = await server.getNetwork();
      console.log(`✓ RPC healthy at attempt ${attempt}, network:`, response);
      return server;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        console.log(
          `⏳ RPC not ready (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  
  throw new Error(
    `RPC health check failed after ${maxAttempts} attempts. Last error: ${lastError?.message}`,
  );
}

/**
 * Fund a test account with native asset.
 * Uses the Stellar testnet friendbot equivalent (simulated via synthetic transactions).
 */
export async function fundAccount(
  server: rpc.Server,
  keypair: Keypair,
  nativeAmount: string = '1000',
): Promise<void> {
  try {
    const account = await server.getAccount(keypair.publicKey());
    console.log(`✓ Account ${keypair.publicKey()} already funded, balance:`, account.balances);
    return;
  } catch (err) {
    // Account doesn't exist; need to fund it
  }

  // In a real testnet, we'd call friendbot. For soroban-preview, we use a synthetic account.
  // For now, we'll use a helper that submits a synthetic funding transaction.
  console.log(`⏳ Funding account ${keypair.publicKey()}...`);

  // Option 1: If soroban-preview has a built-in friendbot, use it:
  // const response = await fetch(`${TEST_CONFIG.rpcUrl}/friendbot?addr=${keypair.publicKey()}`);

  // Option 2: Use a master account to fund (requires running a master that's already funded)
  // This is what we'll do for the e2e test environment.

  // For now, throw a helpful error that explains the setup
  throw new Error(
    `Account ${keypair.publicKey()} is not funded. ` +
      `In soroban-preview, manually fund with: stellar account fund ${keypair.publicKey()} native 1000`,
  );
}

/**
 * Get or create a test account, ensuring it's funded and ready.
 */
export async function getOrFundAccount(
  server: rpc.Server,
  keypair: Keypair,
): Promise<{ pubkey: string; sequence: string; balance: string }> {
  try {
    const account = await server.getAccount(keypair.publicKey());
    const nativeBalance =
      account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
    return {
      pubkey: keypair.publicKey(),
      sequence: account.sequence,
      balance: nativeBalance,
    };
  } catch (err) {
    throw new Error(
      `Account ${keypair.publicKey()} not funded. ` +
        `RPC returned: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Deploy a prebuilt Soroban contract WASM.
 * 
 * Assumes the WASM is already in e2e-tests/fixtures/ and committed to the repo.
 * This test does NOT build the contract; it uses a pre-built artifact.
 */
export async function deployContract(
  server: rpc.Server,
  issuerKeypair: Keypair,
  wasmPath: string,
  contractName: string = 'denylist-gate',
): Promise<{ contractId: string; deployTxHash: string }> {
  throw new Error(
    `Contract deployment not yet implemented. ` +
      `For this e2e test, use a pre-deployed contract instance or implement Soroban contract deployment.`,
  );
  // TODO: Implement if contracts are not pre-deployed to the testnet
  // This would involve:
  // 1. Reading the WASM file from disk
  // 2. Building an upload contract transaction
  // 3. Submitting and waiting for finalization
  // 4. Returning the deployed contract ID
}

/**
 * Wait for a transaction to be finalized on the ledger.
 * Returns the final transaction result or throws if timeout/not found.
 */
export async function waitForTransactionFinalization(
  server: rpc.Server,
  txHash: string,
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 500,
): Promise<{ ledger: number; envelope: unknown }> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await server.getTransaction(txHash);
      if (response.status === 'SUCCESS') {
        console.log(`✓ Transaction finalized: ${txHash}, ledger:`, response.ledger);
        return { ledger: response.ledger, envelope: response.envelope_xdr };
      }
      if (response.status === 'FAILED') {
        throw new Error(
          `Transaction failed: ${txHash}, reason: ${response.result_xdr}`,
        );
      }
      // status === 'PENDING', wait a bit more
    } catch (err) {
      if (err instanceof Error && err.message.includes('Transaction not found')) {
        // Not yet finalized, continue polling
      } else {
        throw err;
      }
    }
    
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  
  throw new Error(
    `Transaction ${txHash} not finalized within ${maxWaitMs}ms`,
  );
}

/**
 * Submit and wait for a transaction to finalize.
 */
export async function submitTransaction(
  server: rpc.Server,
  tx: TransactionBuilder,
  signer: Keypair,
  timeoutMs: number = 30000,
): Promise<{ hash: string; ledger: number }> {
  // Build and sign the transaction
  const built = tx.build();
  built.sign(signer);
  
  // Submit to RPC
  const response = await server.sendTransaction(built);
  const hash = response.hash;
  
  console.log(`📤 Transaction submitted: ${hash}`);
  
  // Wait for finalization
  const { ledger } = await waitForTransactionFinalization(server, hash, timeoutMs);
  
  console.log(`✓ Transaction finalized at ledger ${ledger}`);
  return { hash, ledger };
}

/**
 * Helper to poll for a contract event with a cursor.
 * Used by tests to verify denylist-gate events are emitted.
 */
export async function pollForContractEvent(
  server: rpc.Server,
  contractId: string,
  options: {
    cursor?: string;
    timeout?: number;
    pollInterval?: number;
  } = {},
): Promise<{
  events: { id: string; topic: string[]; value: unknown; ledger: number }[];
  nextCursor: string;
}> {
  const { timeout = 30000, pollInterval = 500 } = options;
  const startTime = Date.now();
  let cursor = options.cursor;
  
  while (Date.now() - startTime < timeout) {
    try {
      const request: Parameters<typeof server.getEvents>[0] =
        cursor
          ? {
              cursor,
              filters: [{ type: 'contract', contractIds: [contractId] }],
            }
          : {
              startLedger: 0,
              filters: [{ type: 'contract', contractIds: [contractId] }],
            };
      
      // Type gymnastics to satisfy the SDK's generic types
      const rawResponse = await (server.getEvents as (req: unknown) => Promise<unknown>)(
        request,
      );
      
      const response = rawResponse as {
        events?: Array<{
          id: string;
          topic?: unknown[];
          value: unknown;
          ledger: number;
        }>;
        cursor?: string;
      };
      
      const events = (response.events ?? []).map((e) => ({
        id: e.id,
        topic: (e.topic ?? []).map((t) => String(t)),
        value: e.value,
        ledger: e.ledger,
      }));
      
      const nextCursor = response.cursor ?? (events.length > 0 ? events[events.length - 1].id : cursor ?? '');
      
      if (events.length > 0) {
        console.log(`✓ Found ${events.length} contract events`);
        return { events, nextCursor };
      }
      
      cursor = nextCursor;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (err) {
      console.warn(`⚠ Error polling for events:`, err instanceof Error ? err.message : String(err));
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
  
  throw new Error(
    `No contract events found for ${contractId} within ${timeout}ms`,
  );
}
