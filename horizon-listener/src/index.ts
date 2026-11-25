/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * horizon-listener — NOTE: despite the name, this package consumes Soroban RPC
 * `getEvents`, not the Horizon REST/SSE API. Point it at a Soroban RPC endpoint.
 * A rename (e.g. `@compliance-adapters/event-listener`) with a deprecation
 * alias is tracked as a follow-up discussion.
 */

/**
 * @example
 * ```ts
 * import { HorizonListener } from '@compliance-adapters/horizon-listener';
 *
 * const listener = new HorizonListener({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
 *   startLedger: 1000,
 * });
 * await listener.start();
 * ```
 */
export { HorizonListener, type HorizonListenerOptions, type Logger } from './listener';
/**
 * @example
 * ```ts
 * import { RpcEventSource } from '@compliance-adapters/horizon-listener';
 *
 * const source = new RpcEventSource({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
 * });
 * for await (const event of source.events()) {
 *   console.log(event.contractId, event.ledger);
 * }
 * ```
 *
 * @example
 * ```ts
 * import { toCursorOutOfRangeError } from '@compliance-adapters/horizon-listener';
 *
 * try {
 *   await source.events();
 * } catch (err) {
 *   const cursorErr = toCursorOutOfRangeError(err);
 *   if (cursorErr) console.warn('cursor out of range:', cursorErr.message);
 * }
 * ```
 */
export {
  RpcEventSource,
  CursorOutOfRangeError,
  toCursorOutOfRangeError,
  type EventSource,
  type RawContractEvent,
  type RpcEventSourceOptions,
  type RpcEventType,
} from './eventSource';
/**
 * @example
 * ```ts
 * import { toJsonSafe, decodeScValToJson, decodeTopicToString } from '@compliance-adapters/horizon-listener';
 *
 * const json = decodeScValToJson(event.value);
 * const topic = decodeTopicToString(event.topic[0]);
 * const safe = toJsonSafe({ topic, json });
 * ```
 */
export {
  toJsonSafe,
  decodeScValToJson,
  decodeTopicToString,
  type EventDecodeMode,
  type JsonSafeValue,
} from './decode';
/**
 * @example
 * ```ts
 * import { InMemoryDeadLetterQueue, replayDeadLetterQueue } from '@compliance-adapters/horizon-listener';
 *
 * const dlq = new InMemoryDeadLetterQueue();
 * await dlq.push({ event, error: 'webhook failed', attempts: 3 });
 * const result = await replayDeadLetterQueue(dlq, async (entry) => {
 *   await forward(entry.event);
 * });
 * console.log(`replayed ${result.replayed}, failed ${result.failed}`);
 * ```
 *
 * @example
 * ```ts
 * import { FileDeadLetterQueue } from '@compliance-adapters/horizon-listener';
 *
 * const dlq = new FileDeadLetterQueue({ path: './dead-letters.jsonl' });
 * await dlq.push({ event, error: 'webhook failed', attempts: 3 });
 * ```
 */
export {
  InMemoryDeadLetterQueue,
  FileDeadLetterQueue,
  replayDeadLetterQueue,
  type DeadLetterEvent,
  type DeadLetterQueue,
  type ReplayDeadLetterQueueOptions,
  type ReplayDeadLetterQueueResult,
} from './deadLetterQueue';
/**
 * @example
 * ```ts
 * import { computeBackoffDelayMs } from '@compliance-adapters/horizon-listener';
 *
 * const delay = computeBackoffDelayMs(3, { baseDelayMs: 100, maxDelayMs: 5000 });
 * await new Promise((resolve) => setTimeout(resolve, delay));
 * ```
 */
export { computeBackoffDelayMs, type BackoffOptions } from '@compliance-adapters/backoff';
/**
 * @example
 * ```ts
 * import { HttpWebhookSender, verifyWebhookSignature } from '@compliance-adapters/horizon-listener';
 *
 * const sender = new HttpWebhookSender({ url: 'https://example.com/hook', secret: 'shh' });
 * await sender.send({ event });
 *
 * const valid = verifyWebhookSignature(rawBody, signatureHeader, 'shh');
 * ```
 */
export { HttpWebhookSender, WebhookHttpError, verifyWebhookSignature, type WebhookSender, type HttpWebhookSenderOptions } from './webhook';
/**
 * @example
 * ```ts
 * import { createWebhookForwarder } from '@compliance-adapters/horizon-listener';
 *
 * const forwarder = createWebhookForwarder({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
 *   webhook: { url: 'https://example.com/hook', secret: 'shh' },
 * });
 * await forwarder.start();
 * ```
 */
export { createWebhookForwarder, type WebhookForwarderOptions } from './factory';
/**
 * @example
 * ```ts
 * import { MetricsRegistry, NoopMetricsRegistry } from '@compliance-adapters/horizon-listener';
 *
 * const metrics = new MetricsRegistry();
 * metrics.counter('events_processed_total').inc({ outcome: 'success' });
 * metrics.histogram('webhook_latency_ms').observe(42);
 *
 * const noop = new NoopMetricsRegistry();
 * ```
 */
export {
  MetricsRegistry,
  NoopMetricsRegistry,
  DEFAULT_HISTOGRAM_BUCKETS,
  type Phase,
  type AnyMetricsRegistry,
  type Counter,
  type Gauge,
  type Histogram,
  type Outcome,
  type MetricsRegistryOptions,
} from './metrics';
/**
 * @example
 * ```ts
 * import { DefaultTracer, NoopTracer, extractTraceContext } from '@compliance-adapters/horizon-listener';
 *
 * const tracer = new DefaultTracer({ serviceName: 'horizon-listener' });
 * const span = tracer.startSpan('forward_event');
 * span.end();
 *
 * const ctx = extractTraceContext({ traceparent: '00-...-...-01' });
 * const noop = new NoopTracer();
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
