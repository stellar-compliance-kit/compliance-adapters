import * as fs from 'fs';
import {
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { SanctionsProvider } from './SanctionsProvider';
import { MockSanctionsProvider } from './mockProvider';
import { withRetry, RetryOptions } from './retry';

interface CacheEntry {
  result: { flagged: boolean; source: string };
  timestamp: number;
}

/**
 * Optional cache layer for SanctionsProvider results.
 * Avoids redundant provider calls for addresses checked recently.
 */
export class ProviderResultCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttlMs: number;

  /**
   * Create a result cache with a specified time-to-live (TTL).
   * @param ttlMs Time-to-live for cached results in milliseconds
   */
  constructor(ttlMs: number = 3600000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get a cached result if available and not expired.
   * @returns The cached result, or undefined if not found or expired
   */
  get(address: string): { flagged: boolean; source: string } | undefined {
    const entry = this.cache.get(address);
    if (!entry) return undefined;

    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(address);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Store a result in the cache.
   */
  set(address: string, result: { flagged: boolean; source: string }): void {
    this.cache.set(address, {
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }
}

export interface AuditLogEntry {
  /** The address added to the denylist. */
  address: string;
  /** Timestamp when the write occurred (ISO 8601 string). */
  timestamp: string;
  /** The source watchlist that flagged the address. */
  source: string;
  /** The transaction hash resulting from the write. */
  txHash: string;
}

export type AuditLogger = (entry: AuditLogEntry) => void | Promise<void>;

export interface DenylistWriter {
  addToDenylist(address: string): Promise<{ hash: string }>;
}

export interface SyncOptions {
  provider: SanctionsProvider;
  /**
   * Candidate addresses to check. In a real deployment this might come
   * from a chain scan or an existing account list; here it's just an
   * injected array so this function stays pure and easily testable
   * without a network dependency.
   */
  addresses: string[];
  writer: DenylistWriter;
  dryRun?: boolean;
  /** Retry-with-backoff config applied around each provider.checkAddress call. */
  retry?: RetryOptions;
  /**
   * Optional cache to avoid redundant provider lookups for recently checked addresses.
   * If provided, results are cached with a configurable TTL.
   */
  cache?: ProviderResultCache;
}

/**
 * Result of a sanctions sync operation.
 */
export interface SyncResult {
  /** Total number of candidate addresses checked against the provider. */
  checked: number;
  /** Addresses flagged by the sanctions provider. */
  flagged: string[];
  /** Addresses successfully written to the denylist (empty if dryRun is true). */
  written: string[];
  /** Addresses whose provider check failed on every retry attempt. */
  failed: string[];
  /** Whether this was a dry-run (read-only) operation. */
  dryRun: boolean;
}

interface FlaggedAddressWithSource {
  address: string;
  source: string;
}

export async function syncSanctionsToDenylist(options: SyncOptions): Promise<SyncResult> {
  const { provider, addresses, writer, dryRun = false, retry, cache } = options;

  const flagged: string[] = [];
  const flaggedWithSource: FlaggedAddressWithSource[] = [];
  const failed: string[] = [];
  for (const address of addresses) {
    try {
      let result = cache?.get(address);
      if (!result) {
        result = await withRetry(() => provider.checkAddress(address), retry);
        cache?.set(address, result);
      }
      if (result.flagged) {
        flagged.push(address);
        flaggedWithSource.push({ address, source: result.source });
      }
    } catch (err) {
      failed.push(address);
    }
  }

  const written: string[] = [];
  if (dryRun) {
    for (const { address } of flaggedWithSource) {
      console.log(`[dry-run] would call add_to_denylist(${address})`);
    }
  } else {
    for (const { address, source } of flaggedWithSource) {
      // Call writer with extended interface if available
      const writerExt = writer as DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> };
      let result: { hash: string; auditLog?: AuditLogEntry };
      if (writerExt.addToDenylistWithSource) {
        result = await writerExt.addToDenylistWithSource(address, source);
      } else {
        result = await writer.addToDenylist(address);
      }
      written.push(address);
    }
  }

  return {
    checked: addresses.length,
    flagged,
    written,
    failed,
    dryRun,
  };
}

export interface RpcDenylistWriterOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  sourceKeypair: Keypair;
  /**
   * Optional audit logger to record each denylist write for compliance purposes.
   * Called with address, timestamp, source, and resulting transaction hash.
   */
  auditLogger?: AuditLogger;
}

// Kept behind the DenylistWriter interface (rather than called directly
// from syncSanctionsToDenylist) so tests can inject a fake writer instead
// of touching a live RPC endpoint.
export function createRpcDenylistWriter(options: RpcDenylistWriterOptions): DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> } {
  const { rpcUrl, networkPassphrase, contractId, sourceKeypair, auditLogger } = options;
  const server = new rpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  return {
    async addToDenylist(address: string): Promise<{ hash: string }> {
      const account = await server.getAccount(sourceKeypair.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('add_to_denylist', nativeToScVal(address, { type: 'address' })))
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(sourceKeypair);

      const sendResult = await server.sendTransaction(prepared);
      return { hash: sendResult.hash };
    },
    async addToDenylistWithSource(address: string, source: string): Promise<{ hash: string; auditLog?: AuditLogEntry }> {
      const account = await server.getAccount(sourceKeypair.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('add_to_denylist', nativeToScVal(address, { type: 'address' })))
        .setTimeout(30)
        .build();

      const prepared = await server.prepareTransaction(tx);
      prepared.sign(sourceKeypair);

      const sendResult = await server.sendTransaction(prepared);

      const auditEntry: AuditLogEntry = {
        address,
        timestamp: new Date().toISOString(),
        source,
        txHash: sendResult.hash,
      };

      if (auditLogger) {
        await auditLogger(auditEntry);
      }

      return { hash: sendResult.hash, auditLog: auditEntry };
    },
  };
}

interface CliArgs {
  addressesPath?: string;
  dryRun: boolean;
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  secretKey?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--addresses':
        args.addressesPath = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--contract-id':
        args.contractId = argv[++i];
        break;
      case '--rpc-url':
        args.rpcUrl = argv[++i];
        break;
      case '--network-passphrase':
        args.networkPassphrase = argv[++i];
        break;
      case '--secret-key':
        args.secretKey = argv[++i];
        break;
      default:
        break;
    }
  }
  return args;
}

export async function runCli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.addressesPath) {
    console.error('Missing required flag: --addresses <path-to-json-array>');
    process.exitCode = 1;
    return;
  }

  const addresses: string[] = JSON.parse(fs.readFileSync(args.addressesPath, 'utf8'));
  // CLI ships only the reference mock provider; wiring a real provider is
  // left to consumers embedding syncSanctionsToDenylist programmatically.
  const provider = new MockSanctionsProvider();

  if (args.dryRun) {
    const result = await syncSanctionsToDenylist({
      provider,
      addresses,
      writer: {
        async addToDenylist(): Promise<{ hash: string }> {
          throw new Error('addToDenylist should not be called in dry-run mode');
        },
      },
      dryRun: true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!args.contractId || !args.rpcUrl || !args.networkPassphrase || !args.secretKey) {
    console.error(
      'Missing required flags for a live sync. Required: --contract-id, --rpc-url, --network-passphrase, --secret-key (or pass --dry-run).',
    );
    process.exitCode = 1;
    return;
  }

  const writer = createRpcDenylistWriter({
    rpcUrl: args.rpcUrl,
    networkPassphrase: args.networkPassphrase,
    contractId: args.contractId,
    sourceKeypair: Keypair.fromSecret(args.secretKey),
  });

  const result = await syncSanctionsToDenylist({ provider, addresses, writer, dryRun: false });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
