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
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';
import { withRetry, RetryOptions } from './retry';
import { computeBackoffDelayMs } from './backoff';

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

export interface Logger {
  log(message: string): void;
  error(message: string): void;
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
  /**
   * Optional logger for progress logging during large address syncs.
   * If provided, logs will be emitted periodically (every progressInterval addresses).
   */
  logger?: Logger;
  /**
   * Number of addresses to process before emitting a progress log.
   * Defaults to 100 if logger is provided.
   */
  progressInterval?: number;
  /**
   * Optional concurrency limit for provider.checkAddress calls.
   * If provided, limits the number of concurrent address checks.
   * Defaults to unlimited (sequential processing).
   */
  concurrency?: number;
  /**
   * Optional metrics registry.  Pass a `MetricsRegistry` instance to record
   * per-phase counters and latency histograms for `address_check` and
   * `denylist_write` operations.  When omitted all instrumentation is a no-op.
   */
  metrics?: AnyMetricsRegistry;
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

async function executeConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency?: number,
): Promise<void> {
  if (!concurrency || concurrency >= items.length) {
    for (const item of items) {
      await fn(item);
    }
    return;
  }

  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      const promise = fn(item).then(() => {
        active.splice(active.indexOf(promise), 1);
      });
      active.push(promise);
    }

    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

export async function syncSanctionsToDenylist(options: SyncOptions): Promise<SyncResult> {
  const {
    provider,
    addresses,
    writer,
    dryRun = false,
    retry,
    cache,
    logger,
    progressInterval = 100,
    concurrency,
    metrics = new NoopMetricsRegistry(),
  } = options;

  const uniqueAddresses = Array.from(new Set(addresses));
  const flagged: string[] = [];
  const flaggedWithSource: FlaggedAddressWithSource[] = [];
  const failed: string[] = [];
  let checked = 0;

  await executeConcurrent(
    uniqueAddresses,
    async (address) => {
      const start = Date.now();
      try {
        let result = cache?.get(address);
        if (!result) {
          result = await withRetry(() => provider.checkAddress(address), retry);
          cache?.set(address, result);
        }
        const durationMs = Date.now() - start;
        metrics.counter.inc('address_check', 'success');
        metrics.histogram.observe('address_check', durationMs);
        if (result.flagged) {
          flagged.push(address);
          flaggedWithSource.push({ address, source: result.source });
        }
      } catch (err) {
        const durationMs = Date.now() - start;
        metrics.counter.inc('address_check', 'failure');
        metrics.histogram.observe('address_check', durationMs);
        failed.push(address);
      } finally {
        checked += 1;
        if (logger && checked % progressInterval === 0) {
          logger.log(`Progress: ${checked}/${uniqueAddresses.length} addresses checked`);
        }
      }
    },
    concurrency,
  );

  const written: string[] = [];
  if (dryRun) {
    for (const { address } of flaggedWithSource) {
      console.log(`[dry-run] would call add_to_denylist(${address})`);
    }
  } else {
    for (const { address, source } of flaggedWithSource) {
      const start = Date.now();
      try {
        // Call writer with extended interface if available
        const writerExt = writer as DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> };
        let result: { hash: string; auditLog?: AuditLogEntry };
        if (writerExt.addToDenylistWithSource) {
          result = await writerExt.addToDenylistWithSource(address, source);
        } else {
          result = await writer.addToDenylist(address);
        }
        const durationMs = Date.now() - start;
        metrics.counter.inc('denylist_write', 'success');
        metrics.histogram.observe('denylist_write', durationMs);
        written.push(address);
      } catch (err) {
        const durationMs = Date.now() - start;
        metrics.counter.inc('denylist_write', 'failure');
        metrics.histogram.observe('denylist_write', durationMs);
        throw err;
      }
    }
  }

  return {
    checked: uniqueAddresses.length,
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
  /**
   * Optional maximum number of retry attempts for sendTransaction.
   * Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Optional backoff options for retry delays.
   */
  backoffOptions?: any;
}

// Kept behind the DenylistWriter interface (rather than called directly
// from syncSanctionsToDenylist) so tests can inject a fake writer instead
// of touching a live RPC endpoint.
export function createRpcDenylistWriter(options: RpcDenylistWriterOptions): DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> } {
  const { rpcUrl, networkPassphrase, contractId, sourceKeypair, auditLogger, maxRetries = 3, backoffOptions } =
    options;
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

      let prepared;
      try {
        prepared = await server.prepareTransaction(tx);
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to prepare transaction (simulation error): ${err}`);
      }

      prepared.sign(sourceKeypair);

      let sendResult;
      let lastError;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          sendResult = await server.sendTransaction(prepared);
          return { hash: sendResult.hash };
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries - 1) {
            const delayMs = computeBackoffDelayMs(attempt, backoffOptions);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      const err = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Failed to send transaction after ${maxRetries} attempts: ${err}`);
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

export interface CliArgs {
  addressesPath?: string;
  dryRun: boolean;
  contractId?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  secretKey?: string;
  help?: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
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
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
sanctions-oracle sync - Synchronize sanctions data to a Soroban denylist

USAGE:
  sanctions-oracle sync [OPTIONS]

OPTIONS:
  --addresses <path>          Path to JSON file containing array of addresses to check
  --contract-id <id>          Soroban contract ID (required for live sync)
  --rpc-url <url>             Soroban RPC endpoint URL (required for live sync)
  --network-passphrase <str>  Network passphrase (required for live sync)
  --secret-key <key>          Source account secret key (required for live sync)
  --dry-run                   Preview output without writing to the contract
  --help, -h                  Show this help message

EXAMPLES:
  # Dry-run mode: check addresses without writing
  sanctions-oracle sync --addresses addresses.json --dry-run

  # Live mode: sync flagged addresses to contract
  sanctions-oracle sync \\
    --addresses addresses.json \\
    --contract-id CXXXX \\
    --rpc-url https://soroban-testnet.stellar.org \\
    --network-passphrase "Test SDF Network ; September 2015" \\
    --secret-key SBXXXX
  `);
}

export async function runCli(argv?: string[]): Promise<void> {
  const processArgv = argv ?? process.argv.slice(2);
  const args = parseArgs(processArgv);

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.addressesPath) {
    console.error('sanctions-oracle: Missing required flag: --addresses <path-to-json-array>');
    process.exitCode = 1;
    return;
  }

  let addresses: string[];
  try {
    const parsed = JSON.parse(fs.readFileSync(args.addressesPath, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('Addresses file must contain a JSON array');
    }
    if (!parsed.every((item) => typeof item === 'string')) {
      throw new Error('All entries in the addresses array must be strings');
    }
    addresses = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load addresses from ${args.addressesPath}: ${message}`);
    process.exitCode = 1;
    return;
  }
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
      'sanctions-oracle: Missing required flags for a live sync. Required: --contract-id, --rpc-url, --network-passphrase, --secret-key (or pass --dry-run).',
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
    console.error('sanctions-oracle:', err);
    process.exitCode = 1;
  });
}
