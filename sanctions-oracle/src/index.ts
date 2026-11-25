/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @example
 * ```ts
 * import { SanctionsProvider } from '@stellar-compliance/sanctions-oracle';
 *
 * const provider: SanctionsProvider = myProvider;
 * const result = await provider.check('GABC...');
 * console.log(result.flagged);
 * ```
 */
export { SanctionsProvider, CheckResult } from './SanctionsProvider';

/**
 * @example
 * ```ts
 * import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '@stellar-compliance/sanctions-oracle';
 *
 * const provider = new MockSanctionsProvider();
 * const result = await provider.check(MOCK_FLAGGED_ADDRESSES[0]);
 * console.log(result.flagged); // true
 * ```
 */
export { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from './mockProvider';

/**
 * @example
 * ```ts
 * import { CsvSanctionsProvider, parseCsv } from '@stellar-compliance/sanctions-oracle';
 *
 * const rows = parseCsv('address,reason\nGABC...,sanctioned');
 * const provider = new CsvSanctionsProvider(rows);
 * const result = await provider.check('GABC...');
 * console.log(result.flagged); // true
 * ```
 */
export { CsvSanctionsProvider, parseCsv } from './csvProvider';

/**
 * @example
 * ```ts
 * import {
 *   syncSanctionsToDenylist,
 *   createRpcDenylistWriter,
 *   runCli,
 *   ProviderResultCache,
 *   toSafeLogString,
 *   createRpcFeeEstimator,
 *   stroopsToXlm,
 * } from '@stellar-compliance/sanctions-oracle';
 *
 * // Sync flagged addresses to an on-chain denylist
 * const writer = createRpcDenylistWriter({ rpcUrl, contractId, keypair });
 * const result = await syncSanctionsToDenylist(provider, writer, { dryRun: false });
 * console.log(result.synced);
 *
 * // Run the CLI entrypoint
 * await runCli(['--csv', 'sanctions.csv']);
 *
 * // Cache provider results
 * const cache = new ProviderResultCache({ ttlMs: 60_000 });
 *
 * // Sanitize values before logging
 * console.log(toSafeLogString(userInput));
 *
 * // Estimate fees
 * const estimator = createRpcFeeEstimator({ rpcUrl });
 * const fee = await estimator.estimate();
 * console.log(stroopsToXlm(fee.stroops));
 * ```
 */
export {
  syncSanctionsToDenylist,
  createRpcDenylistWriter,
  runCli,
  ProviderResultCache,
  DenylistWriter,
  AuditLogEntry,
  AuditLogger,
  SyncOptions,
  SyncResult,
  FailedAddress,
  RpcDenylistWriterOptions,
  CliArgs,
  toSafeLogString,
  createRpcFeeEstimator,
  stroopsToXlm,
  ReviewAddress,
  FeeEstimate,
  RpcFeeEstimatorOptions,
} from './sync';

/**
 * @example
 * ```ts
 * import { InMemoryCheckpointStore, FileCheckpointStore } from '@stellar-compliance/sanctions-oracle';
 *
 * const store = new InMemoryCheckpointStore();
 * await store.save({ lastLedger: 12345 });
 *
 * const fileStore = new FileCheckpointStore('./checkpoint.json');
 * const checkpoint = await fileStore.load();
 * console.log(checkpoint?.lastLedger);
 * ```
 */
export { SyncCheckpointStore, InMemoryCheckpointStore, FileCheckpointStore } from './checkpoint';

/**
 * @example
 * ```ts
 * import { createJsonlAuditLogger } from '@stellar-compliance/sanctions-oracle';
 *
 * const logger = createJsonlAuditLogger({ path: './audit.jsonl' });
 * await logger.log({ action: 'sync', address: 'GABC...', outcome: 'ok' });
 * ```
 */
export { createJsonlAuditLogger, JsonlAuditLoggerOptions } from './auditLog';

/**
 * @example
 * ```ts
 * import { withRetry } from '@stellar-compliance/sanctions-oracle';
 *
 * const result = await withRetry(() => provider.check('GABC...'), {
 *   retries: 3,
 *   baseDelayMs: 100,
 * });
 * ```
 */
export { withRetry, RetryOptions } from './retry';

/**
 * @example
 * ```ts
 * import { ProviderRegistry, ConflictResolutionPolicy } from '@stellar-compliance/sanctions-oracle';
 *
 * const registry = new ProviderRegistry({
 *   conflictResolution: ConflictResolutionPolicy.FlagWins,
 * });
 * registry.register('mock', new MockSanctionsProvider());
 * const result = await registry.check('GABC...');
 * console.log(result.flagged);
 * ```
 */
export {
  ProviderRegistry,
  ProviderRegistryAllProvidersFailedError,
  ConflictResolutionPolicy,
  ProviderErrorMode,
  TieBreak,
  ProviderRegistryOptions,
  RegisterOptions,
  ProviderCheckOutcome,
  ProviderErrorOutcome,
  RegistryCheckResult,
} from './ProviderRegistry';

/**
 * @example
 * ```ts
 * import { MetricsRegistry, NoopMetricsRegistry } from '@stellar-compliance/sanctions-oracle';
 *
 * const metrics = new MetricsRegistry();
 * const counter = metrics.counter('checks_total');
 * counter.inc({ outcome: 'ok' });
 *
 * const noop = new NoopMetricsRegistry();
 * ```
 */
export {
  MetricsRegistry,
  NoopMetricsRegistry,
  DEFAULT_HISTOGRAM_BUCKETS,
  type AnyMetricsRegistry,
  type Counter,
  type Histogram,
  type SanctionsPhase,
  type Outcome,
  type MetricsRegistryOptions,
} from './metrics';

/**
 * @example
 * ```ts
 * import { DefaultTracer, extractTraceContext } from '@stellar-compliance/sanctions-oracle';
 *
 * const tracer = new DefaultTracer();
 * const span = tracer.startSpan('check');
 * span.end();
 *
 * const ctx = extractTraceContext({ traceparent: '00-...-...-01' });
 * console.log(ctx.traceId);
 * ```
 */
export {
  DefaultTracer,
  NoopTracer,
  type AnyTracer,
  type Tracer,
  type Span,
  type SpanData,
  type SpanStatus,
  type SpanAttributes,
  type SpanExporter,
  type TracingContext,
  type TracingOptions,
  extractTraceContext,
} from './tracing';

/**
 * @example
 * ```ts
 * import { RateLimitedSanctionsProvider } from '@stellar-compliance/sanctions-oracle';
 *
 * const provider = new RateLimitedSanctionsProvider(innerProvider, {
 *   maxRequests: 10,
 *   windowMs: 1000,
 * });
 * const result = await provider.check('GABC...');
 * ```
 */
export { RateLimitedSanctionsProvider, RateLimitOptions } from './rateLimitedProvider';

/**
 * @example
 * ```ts
 * import { RestSanctionsProvider } from '@stellar-compliance/sanctions-oracle';
 *
 * const provider = new RestSanctionsProvider({ baseUrl: 'https://api.example.com' });
 * const result = await provider.check('GABC...');
 * console.log(result.flagged);
 * ```
 */
export { RestSanctionsProvider } from './restProvider';
export type { RestSanctionsProviderOptions } from './restProvider';
export type { Logger } from '@compliance-adapters/logger';
