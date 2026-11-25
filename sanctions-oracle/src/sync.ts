/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import {
  Contract,
  Keypair,
  Transaction,
  FeeBumpTransaction,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { isValidStellarAddress, normalizeStellarAddress } from '@compliance-adapters/shared';
import { type Logger, noopLogger, consoleLogger } from '@compliance-adapters/logger';
export type { Logger } from '@compliance-adapters/logger';
import { SanctionsProvider, CheckResult } from './SanctionsProvider';
import { SyncCheckpointStore } from './checkpoint';
import { MockSanctionsProvider } from './mockProvider';
import { CsvSanctionsProvider } from './csvProvider';
import { RateLimitedSanctionsProvider } from './rateLimitedProvider';
import { type AnyTracer, NoopTracer } from './tracing';
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';
import { withRetry, RetryOptions } from './retry';
import { type Signer, toSigner, signTransaction } from './signer';
import { computeBackoffDelayMs, BackoffOptions } from '@compliance-adapters/backoff';

interface CacheEntry {
  result: CheckResult;
  timestamp: number;
}

/**
 * Optional cache layer for SanctionsProvider results.
 * Avoids redundant provider calls for addresses checked recently.
 *
 * @example
 * ```ts
 * const cache = new ProviderResultCache(60_000, 1000);
 * const result = await cache.getOrLoad(address, () => provider.checkAddress(address));
 * ```
 */
export class ProviderResultCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttlMs: number;
  private readonly maxEntries?: number;
  private readonly inFlight = new Map<string, Promise<CheckResult>>();

  /**
   * Create a result cache with a specified time-to-live (TTL).
   * @param ttlMs Time-to-live for cached results in milliseconds
   * @param maxEntries Optional maximum number of entries to retain. When set,
   * the least-recently-used entry is evicted once the cache would exceed this size.
   *
   * @example
   * ```ts
   * // 1-hour TTL, at most 500 entries
   * const cache = new ProviderResultCache(3_600_000, 500);
   * ```
   */
  constructor(ttlMs: number = 3600000, maxEntries?: number) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Get a cached result if available and not expired.
   * @returns The cached result, or undefined if not found or expired
   *
   * @example
   * ```ts
   * const cached = cache.get(address);
   * if (cached) console.log(cached.flagged);
   * ```
   */
  get(address: string): CheckResult | undefined {
    const entry = this.cache.get(address);
    if (!entry) return undefined;

    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(address);
      return undefined;
    }

    // Refresh recency for LRU eviction.
    this.cache.delete(address);
    this.cache.set(address, entry);

    return entry.result;
  }

  /**
   * Store a result in the cache.
   *
   * @example
   * ```ts
   * cache.set(address, { flagged: true, source: 'ofac' });
   * ```
   */
  set(address: string, result: CheckResult): void {
    this.cache.delete(address);
    this.cache.set(address, {
      result,
      timestamp: Date.now(),
    });

    if (this.maxEntries !== undefined) {
      while (this.cache.size > this.maxEntries) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey === undefined) break;
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * Remove a single cached entry, e.g. after an operator determines it's stale.
   * @returns Whether an entry was present and removed.
   *
   * @example
   * ```ts
   * const removed = cache.delete(address);
   * ```
   */
  delete(address: string): boolean {
    return this.cache.delete(address);
  }

  /**
   * Retrieve a cached result or coalesce concurrent misses behind a single
   * in-flight promise, so concurrent lookups for the same address do not race to
   * populate the cache with duplicate provider calls.
   *
   * @example
   * ```ts
   * const result = await cache.getOrLoad(address, () => provider.checkAddress(address));
   * ```
   */
  async getOrLoad(address: string, load: () => Promise<CheckResult>): Promise<CheckResult> {
    const cached = this.get(address);
    if (cached) {
      return cached;
    }

    const existing = this.inFlight.get(address);
    if (existing) {
      return existing;
    }

    let resolve!: (value: CheckResult) => void;
    let reject!: (reason?: unknown) => void;
    const next = new Promise<CheckResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.inFlight.set(address, next);

    (async () => {
      try {
        const result = await load();
        this.set(address, result);
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        const current = this.inFlight.get(address);
        if (current === next) {
          this.inFlight.delete(address);
        }
      }
    })();

    return next;
  }

  /**
   * Clear all cached entries.
   *
   * @example
   * ```ts
   * cache.clear();
   * ```
   */
  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export interface AuditLogEntry {
  /** The address added to (or, when `action` is `'remove'`, removed from) the denylist. */
  address: string;
  /**
   * Set to `'remove'` for a delisting recorded by reconcile mode. Absent for
   * additions, which keeps existing audit consumers unchanged.
   */
  action?: 'remove';
  /** Timestamp when the write occurred (ISO 8601 string). */
  timestamp: string;
  /**
   * The source watchlist that flagged the address. For a removal, the provider
   * source that reported the address as cleared.
   */
  source: string;
  /** The transaction hash resulting from the write. */
  txHash: string;
}

export type AuditLogger = (entry: AuditLogEntry) => void | Promise<void>;

export interface DenylistWriter {
  addToDenylist(address: string): Promise<{ hash: string }>;
  /**
   * Removes an address from the on-chain denylist (`remove_from_denylist`).
   * Optional; a live reconcile run ({@link SyncOptions.reconcile}) requires
   * this or {@link DenylistWriter.removeFromDenylistWithSource}.
   */
  removeFromDenylist?(address: string): Promise<{ hash: string }>;
  /** Like {@link DenylistWriter.removeFromDenylist}, also recording the clearing provider `source` for audit purposes. */
  removeFromDenylistWithSource?(
    address: string,
    source: string,
  ): Promise<{ hash: string; auditLog?: AuditLogEntry }>;
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
   * Optional current denylist contents. When provided, flagged addresses that
   * are already present in the current denylist are still reported as flagged,
   * but they are skipped during the actual write phase.
   */
  currentDenylist?: string[];
  /**
   * Opt-in delisting. When true, every address in {@link SyncOptions.currentDenylist}
   * (the on-chain denylist or a last snapshot) is re-checked with the provider,
   * and those the provider no longer flags are removed from the denylist via the
   * writer's `removeFromDenylist`. Addresses whose check fails are never removed.
   * With `dryRun` the planned removals are reported in
   * {@link SyncResult.plannedRemovals} and nothing is removed. Each removal is
   * audit-logged with the provider source. Defaults to false: sync only adds.
   */
  reconcile?: boolean;
  /**
   * Optional metrics registry.  Pass a `MetricsRegistry` instance to record
   * per-phase counters and latency histograms for `address_check` and
   * `denylist_write` operations.  When omitted all instrumentation is a no-op.
   */
  metrics?: AnyMetricsRegistry;
  /**
   * Optional tracer for OpenTelemetry-compatible distributed tracing.
   * When omitted, a no-op tracer is used — zero overhead and no exports.
   *
   * Stellar addresses are NOT attached to spans unless
   * `TracingOptions.redactPayload` is explicitly set to `false` on the
   * tracer; the span will carry only phase and outcome attributes.
   */
  tracer?: AnyTracer;
  /**
   * Optional checkpoint store that makes a large sync resumable after a crash.
   * As each address is finished, it is recorded via `checkpoint.markComplete`
   * (clean addresses right after the provider check; flagged addresses only
   * once the denylist write succeeds). Pass {@link SyncOptions.resume} on a
   * later run to skip everything already recorded.
   */
  checkpoint?: CheckpointStore | SyncCheckpointStore;
  /**
   * When true and a {@link SyncOptions.checkpoint} is provided, addresses the
   * checkpoint already reports as complete are skipped (returned in
   * {@link SyncResult.skipped}) instead of being re-checked and re-written.
   * Defaults to false.
   */
  resume?: boolean;
  /**
   * Optional score threshold. When set, a flagged result whose provider
   * `score` is below this value is not written on-chain; it is reported in
   * {@link SyncResult.needsReview} for manual review instead. Flagged results
   * without a score, or with `score >= minScoreToBlock`, are written as usual.
   */
  minScoreToBlock?: number;
  /**
   * Dry-run only. Estimates the fee (in stroops) of one representative
   * `add_to_denylist` transaction for the given sample address, e.g. via
   * {@link createRpcFeeEstimator}. The estimate is multiplied by the number of
   * pending writes and reported in {@link SyncResult.feeEstimate}. A failing
   * estimator never fails the dry-run; the error is reported instead.
   */
  feeEstimator?: (sampleAddress: string) => Promise<bigint | number | string>;
}

/** Estimated cost of the writes a dry-run would perform. */
export interface FeeEstimate {
  /** Number of `add_to_denylist` writes the live run would submit. */
  pendingWrites: number;
  /** Simulated fee of one representative transaction, in stroops (decimal string). */
  perTxFeeStroops?: string;
  /** perTxFeeStroops * pendingWrites, in stroops (decimal string). */
  totalFeeStroops?: string;
  /** totalFeeStroops expressed in XLM (1 XLM = 10,000,000 stroops). */
  totalFeeXlm?: string;
  /** Set when the simulation failed; the other fee fields are then absent. */
  error?: string;
}

const STROOPS_PER_XLM = BigInt(10_000_000);

/**
 * Formats a stroop amount as an exact XLM decimal string.
 *
 * @example
 * ```ts
 * stroopsToXlm(BigInt(10_000_000)); // '1.0000000'
 * stroopsToXlm(BigInt(15_000_000)); // '1.5000000'
 * ```
 */
export function stroopsToXlm(stroops: bigint): string {
  const negative = stroops < BigInt(0);
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(7, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

async function estimateDryRunFee(
  pending: string[],
  feeEstimator: NonNullable<SyncOptions['feeEstimator']>,
): Promise<FeeEstimate> {
  const estimate: FeeEstimate = { pendingWrites: pending.length };
  if (pending.length === 0) {
    return {
      ...estimate,
      perTxFeeStroops: '0',
      totalFeeStroops: '0',
      totalFeeXlm: stroopsToXlm(BigInt(0)),
    };
  }
  try {
    const perTx = BigInt(await feeEstimator(pending[0]));
    const total = perTx * BigInt(pending.length);
    return {
      ...estimate,
      perTxFeeStroops: perTx.toString(),
      totalFeeStroops: total.toString(),
      totalFeeXlm: stroopsToXlm(total),
    };
  } catch (err) {
    return {
      ...estimate,
      error: `Fee estimate failed (simulation error): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** A flagged address held back for manual review (score below threshold). */
export interface ReviewAddress {
  address: string;
  source: string;
  score: number;
}

/** CLI exit code used when a run stops because `--max-duration` elapsed. */
export const EXIT_CODE_DEADLINE_EXCEEDED = 3;

/**
 * A single address whose provider check failed on every retry attempt,
 * paired with the message from the last error that caused it to fail.
 */
export interface FailedAddress {
  address: string;
  /** Message of the final error thrown by `provider.checkAddress` (after retries). */
  error: string;
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
  /**
   * Addresses whose provider check failed on every retry attempt.
   *
   * This is kept as a bare `string[]` for backward compatibility; use
   * {@link SyncResult.failedWithReasons} when you need the error message that
   * caused each failure (e.g. to distinguish rate-limit failures from genuine
   * provider errors programmatically).
   */
  failed: string[];
  /**
   * The same addresses as {@link SyncResult.failed}, each paired with the
   * message of the final error that caused it to fail.
   */
  failedWithReasons: FailedAddress[];
  /**
   * Input entries that are not valid Stellar Ed25519 public keys (StrKey
   * `G...`). These are never checked against the provider — a malformed entry
   * (typo, truncated paste, a non-Stellar identifier) is reported here rather
   * than silently landing in neither `flagged` nor `failed`.
   */
  invalid: string[];
  /**
   * Addresses skipped because a {@link SyncOptions.checkpoint} already recorded
   * them as complete and {@link SyncOptions.resume} was set. Empty otherwise.
   */
  skipped: string[];
  /** Whether this was a dry-run (read-only) operation. */
  dryRun: boolean;
  /**
   * Reconcile mode only: denylist addresses the provider has cleared and that
   * were successfully removed (empty if dryRun is true).
   */
  removed?: string[];
  /**
   * Reconcile mode only: denylist addresses the provider has cleared, i.e. the
   * removals that are planned (dry-run) or attempted (live), with the provider
   * source that cleared each.
   */
  plannedRemovals?: { address: string; source: string }[];
  /** Reconcile mode only: cleared addresses whose removal transaction failed. */
  failedRemovals?: FailedAddress[];
  /**
   * Flagged addresses whose score fell below {@link SyncOptions.minScoreToBlock}.
   * Reported for manual review and never written. Present only when
   * `minScoreToBlock` is set.
   */
  needsReview?: ReviewAddress[];
  /** Dry-run only: estimated fee for the pending writes (see {@link SyncOptions.feeEstimator}). */
  feeEstimate?: FeeEstimate;
}

interface FlaggedAddressWithSource {
  address: string;
  source: string;
}

async function executeConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency?: number,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  if (!concurrency || concurrency >= items.length) {
    for (const item of items) {
      if (shouldStop()) return;
      await fn(item);
    }
    return;
  }

  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0 && !shouldStop()) {
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

/**
 * Checks a list of addresses against a sanctions provider and writes the
 * flagged ones to an on-chain denylist via the supplied writer.
 *
 * @example
 * ```ts
 * import { syncSanctionsToDenylist, MockSanctionsProvider } from 'sanctions-oracle';
 *
 * const result = await syncSanctionsToDenylist({
 *   provider: new MockSanctionsProvider(),
 *   addresses: ['GABCDEF...'],
 *   writer: {
 *     async addToDenylist(address) {
 *       return { hash: 'deadbeef' };
 *     },
 *   },
 *   dryRun: true,
 * });
 * console.log(result.flagged, result.written);
 * ```
 */
export async function syncSanctionsToDenylist(options: SyncOptions): Promise<SyncResult> {
  const {
    provider,
    addresses,
    writer,
    dryRun = false,
    logger = noopLogger,
    retry,
    cache,
    progressInterval = 100,
    concurrency,
    currentDenylist = [],
    metrics = new NoopMetricsRegistry(),
    tracer = new NoopTracer(),
    checkpoint,
    resume = false,
    reconcile = false,
    minScoreToBlock,
    feeEstimator,
  } = options;
  const deadline = maxDurationMs !== undefined ? Date.now() + maxDurationMs : undefined;
  const pastDeadline = () => deadline !== undefined && Date.now() >= deadline;
  const started = new Set<string>();

  const legacyLogger = logger as Logger & { log?: (...args: unknown[]) => void };
  const safeLogger = {
    debug: (...args: unknown[]) =>
      typeof legacyLogger.debug === 'function'
        ? legacyLogger.debug(...args)
        : legacyLogger.log?.(...args),
    info: (...args: unknown[]) =>
      typeof legacyLogger.info === 'function'
        ? legacyLogger.info(...args)
        : legacyLogger.log?.(...args),
    warn: (...args: unknown[]) =>
      typeof legacyLogger.warn === 'function'
        ? legacyLogger.warn(...args)
        : legacyLogger.log?.(...args),
    error: (...args: unknown[]) =>
      typeof legacyLogger.error === 'function'
        ? legacyLogger.error(...args)
        : legacyLogger.log?.(...args),
  };
  const progressLogger = (message: string) => {
    if (typeof (logger as Logger & { log?: (...args: unknown[]) => void }).log === 'function') {
      (logger as Logger & { log?: (...args: unknown[]) => void }).log!(message);
      return;
    }
    safeLogger.debug(message);
  };

  safeLogger.info('sanctions-oracle: starting sync', { total: addresses.length, dryRun });

  if (reconcile && !dryRun && !writer.removeFromDenylist && !writer.removeFromDenylistWithSource) {
    throw new Error(
      'sanctions-oracle: reconcile requires a writer that implements removeFromDenylist',
    );
  }

  // Reject malformed input up front so a typo / truncated paste / non-Stellar
  // identifier is reported distinctly instead of being checked and quietly
  // landing in neither `flagged` nor `failed`. Valid input is normalized
  // (trimmed, uppercased) first so one account maps to one canonical address
  // for the provider lookup, the cache key and the denylist write.
  const normalizedInput = addresses.map(normalizeStellarAddress);
  const invalid: string[] = [];
  const validAddresses: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();
  addresses.forEach((raw, i) => {
    const address = normalizedInput[i];
    if (isValidStellarAddress(address)) {
      if (!seenValid.has(address)) {
        seenValid.add(address);
        validAddresses.push(address);
      }
    } else if (!seenInvalid.has(raw)) {
      seenInvalid.add(raw);
      invalid.push(raw);
    }
  });
  const uniqueCount = validAddresses.length + invalid.length;

  const currentDenylistSet = new Set(currentDenylist.map(normalizeStellarAddress));
  if (reconcile) {
    // Denylist entries must be re-checked to learn whether they were cleared.
    for (const entry of currentDenylistSet) {
      if (isValidStellarAddress(entry) && !seenValid.has(entry)) {
        seenValid.add(entry);
        validAddresses.push(entry);
      }
    }
  }
  if (invalid.length > 0) {
    safeLogger.warn('sanctions-oracle: skipping malformed addresses', { count: invalid.length });
  }

  // On a resume run, drop anything a prior run already finished.
  const skipped: string[] = [];
  let pendingAddresses = validAddresses;
  if (resume && checkpoint) {
    pendingAddresses = [];
    const loaded = 'load' in checkpoint ? new Set(await checkpoint.load()) : undefined;
    for (const address of validAddresses) {
      const complete = loaded
        ? loaded.has(address)
        : await (checkpoint as SyncCheckpointStore).isComplete(address);
      if (complete) {
        skipped.push(address);
      } else {
        pendingAddresses.push(address);
      }
    }
    if (skipped.length > 0) {
      safeLogger.info('sanctions-oracle: resuming sync', {
        skipped: skipped.length,
        pending: pendingAddresses.length,
      });
    }
  }

  const inflightChecks = new Map<string, Promise<CheckResult>>();
  const flagged: string[] = [];
  const flaggedWithSource: FlaggedAddressWithSource[] = [];
  const needsReview: ReviewAddress[] = [];
  const clearedWithSource: FlaggedAddressWithSource[] = [];
  const failed: string[] = [];
  const failedWithReasons: FailedAddress[] = [];
  let checked = 0;

  const getAddressResult = async (address: string): Promise<CheckResult> => {
    if (cache) {
      return cache.getOrLoad(address, () => withRetry(() => provider.checkAddress(address), retry));
    }

    const cached = inflightChecks.get(address);
    if (cached) {
      return cached;
    }

    let resolve!: (value: CheckResult) => void;
    let reject!: (reason?: unknown) => void;
    const pending = new Promise<CheckResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    inflightChecks.set(address, pending);

    (async () => {
      try {
        const result = await withRetry(() => provider.checkAddress(address), retry);
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        if (inflightChecks.get(address) === pending) {
          inflightChecks.delete(address);
        }
      }
    })();

    return pending;
  };

  await executeConcurrent(
    pendingAddresses,
    async (address) => {
      started.add(address);
      const start = Date.now();
      const span = tracer.startSpan('address_check');
      // address is omitted from spans by default (privacy / cardinality).
      span.setAttribute('address_check.index', normalizedInput.indexOf(address));
      try {
        const result = await getAddressResult(address);
        const durationMs = Date.now() - start;
        metrics.counter.inc('address_check', 'success');
        metrics.histogram.observe('address_check', durationMs);
        span.setAttribute('address_check.flagged', result.flagged);
        span.end('ok');
        if (
          result.flagged &&
          minScoreToBlock !== undefined &&
          typeof result.score === 'number' &&
          result.score < minScoreToBlock
        ) {
          // Low-confidence match: report for manual review, never write.
          needsReview.push({ address, source: result.source, score: result.score });
        } else if (result.flagged) {
          flagged.push(address);
          flaggedWithSource.push({ address, source: result.source });
        } else if (reconcile && currentDenylistSet.has(address)) {
          // Cleared by the provider but still on the denylist: it is only
          // checkpointed once the removal succeeds, so an interrupted removal
          // is retried on resume.
          clearedWithSource.push({ address, source: result.source });
        } else {
          // Clean address: nothing left to do for it, so it can be checkpointed
          // now. Flagged addresses are checkpointed only after a successful
          // write (below) so an interrupted write is retried on resume.
          await checkpoint?.markComplete(address);
        }
      } catch (err) {
        const durationMs = Date.now() - start;
        metrics.counter.inc('address_check', 'failure');
        metrics.histogram.observe('address_check', durationMs);
        span.end('error', err instanceof Error ? err : new Error(String(err)));
        failed.push(address);
        failedWithReasons.push({
          address,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        checked += 1;
        if (checked % progressInterval === 0) {
          progressLogger(`Progress: ${checked}/${uniqueCount} addresses checked`);
        }
      }
    },
    concurrency,
    pastDeadline,
  );
  const unprocessed = pendingAddresses.filter((address) => !started.has(address));
  const deadlineExceeded = unprocessed.length > 0;
  if (deadlineExceeded) {
    safeLogger.warn('sanctions-oracle: max duration elapsed; stopping new checks', {
      unprocessed: unprocessed.length,
    });
  }

  safeLogger.info('sanctions-oracle: screening complete', {
    checked: addresses.length,
    flagged: flagged.length,
  });

  const written: string[] = [];
  let feeEstimate: FeeEstimate | undefined;
  if (dryRun) {
    const pendingWrites: string[] = [];
    for (const { address } of flaggedWithSource) {
      if (currentDenylistSet.has(address)) {
        continue;
      }
      pendingWrites.push(address);
      safeLogger.info('sanctions-oracle: [dry-run] would call add_to_denylist', { address });
    }
    if (feeEstimator) {
      feeEstimate = await estimateDryRunFee(pendingWrites, feeEstimator);
      if (feeEstimate.error) {
        safeLogger.warn('sanctions-oracle: [dry-run] fee estimate failed', {
          error: feeEstimate.error,
        });
      } else {
        safeLogger.info('sanctions-oracle: [dry-run] estimated fee', feeEstimate);
      }
    }
  } else {
    for (const { address, source } of flaggedWithSource) {
      if (currentDenylistSet.has(address)) {
        continue;
      }
      const start = Date.now();
      const span = tracer.startSpan('denylist_write');
      try {
        // Call writer with extended interface if available
        const writerExt = writer as DenylistWriter & {
          addToDenylistWithSource?: (
            address: string,
            source: string,
          ) => Promise<{ hash: string; auditLog?: AuditLogEntry }>;
        };
        let result: { hash: string; auditLog?: AuditLogEntry };
        if (writerExt.addToDenylistWithSource) {
          result = await writerExt.addToDenylistWithSource(address, source);
        } else {
          result = await writer.addToDenylist(address);
        }
        const durationMs = Date.now() - start;
        metrics.counter.inc('denylist_write', 'success');
        metrics.histogram.observe('denylist_write', durationMs);
        // transaction hash is set after success — it's a stable, non-PII identifier
        // Issue #598: checkpoint only after the denylist write has succeeded.
        span.setAttribute('denylist_write.tx_hash', result.hash);
        span.end('ok');
        written.push(address);
        await checkpoint?.markComplete(address);
        safeLogger.info('sanctions-oracle: address written to denylist', {
          address,
          hash: result.hash,
        });
      } catch (err) {
        const durationMs = Date.now() - start;
        metrics.counter.inc('denylist_write', 'failure');
        metrics.histogram.observe('denylist_write', durationMs);
        span.end('error', err instanceof Error ? err : new Error(String(err)));
        if (written.length > 0) {
          continue;
        }
        throw err;
      }
    }
  }

  const removed: string[] = [];
  const failedRemovals: FailedAddress[] = [];
  if (reconcile) {
    for (const { address, source } of clearedWithSource) {
      if (dryRun) {
        safeLogger.info('sanctions-oracle: [dry-run] would call remove_from_denylist', {
          address,
          source,
        });
        continue;
      }
      const span = tracer.startSpan('denylist_remove');
      try {
        let result: { hash: string; auditLog?: AuditLogEntry };
        if (writer.removeFromDenylistWithSource) {
          result = await writer.removeFromDenylistWithSource(address, source);
        } else {
          result = await writer.removeFromDenylist!(address);
        }
        span.setAttribute('denylist_remove.tx_hash', result.hash);
        span.end('ok');
        removed.push(address);
        await checkpoint?.markComplete(address);
        // Audit trail: every delisting is recorded with the clearing provider source.
        safeLogger.info('sanctions-oracle: address removed from denylist', {
          action: 'remove',
          address,
          source,
          hash: result.hash,
        });
      } catch (err) {
        span.end('error', err instanceof Error ? err : new Error(String(err)));
        failedRemovals.push({
          address,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    checked: started.size,
    flagged,
    written,
    failed,
    failedWithReasons,
    invalid,
    skipped,
    dryRun,
    ...(reconcile
      ? {
          removed,
          plannedRemovals: clearedWithSource.map(({ address, source }) => ({ address, source })),
          failedRemovals,
        }
      : {}),
    ...(minScoreToBlock !== undefined ? { needsReview } : {}),
    ...(feeEstimate ? { feeEstimate } : {}),
  };
}

export interface RpcFeeEstimatorOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /** Public key (G...) of the account that would submit the writes. */
  sourcePublicKey: string;
}

/**
 * Builds a {@link SyncOptions.feeEstimator} that simulates one
 * `add_to_denylist` call via Soroban RPC and returns the prepared
 * transaction's total fee (inclusion + resource fee) in stroops.
 * Nothing is signed or submitted.
 *
 * @example
 * ```ts
 * const feeEstimator = createRpcFeeEstimator({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 *   contractId: 'CXXXX...',
 *   sourcePublicKey: 'GXXXX...',
 * });
 * const stroops = await feeEstimator('GABCDEF...');
 * ```
 */
export function createRpcFeeEstimator(
  options: RpcFeeEstimatorOptions,
): (sampleAddress: string) => Promise<string> {
  const { rpcUrl, networkPassphrase, contractId, sourcePublicKey } = options;
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const contract = new Contract(contractId);
  return async (sampleAddress: string) => {
    const account = await server.getAccount(sourcePublicKey);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(
        contract.call('add_to_denylist', nativeToScVal(sampleAddress, { type: 'address' })),
      )
      .setTimeout(30)
      .build();
    const prepared = await server.prepareTransaction(tx);
    return prepared.fee;
  };
}

export interface RpcDenylistWriterOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /**
   * Oracle authority key. Either a `Keypair` or any {@link Signer}
   * (e.g. KMS/HSM-backed). Kept as `sourceKeypair` for backward compatibility.
   */
  sourceKeypair?: Keypair | Signer;
  /** Alias of `sourceKeypair` for Signer-based setups; takes precedence when both are set. */
  signer?: Keypair | Signer;
  /**
   * Optional separate fee-paying account. When set, every transaction is
   * wrapped in a FeeBumpTransaction whose fee is paid by this account.
   */
  feeSource?: Keypair | Signer;
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
  backoffOptions?: BackoffOptions;
  /**
   * Optional logger used to record an audit-logging failure without failing
   * the write it accompanies. Defaults to a no-op logger.
   */
  logger?: Logger;
}

/**
 * Creates a {@link DenylistWriter} that submits `add_to_denylist` /
 * `remove_from_denylist` calls to a Soroban contract over RPC.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * import { createRpcDenylistWriter } from 'sanctions-or