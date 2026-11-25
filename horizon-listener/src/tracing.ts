/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenTelemetry-compatible tracing for horizon-listener.
 *
 * The generic tracer machinery lives in `@compliance-adapters/tracing`
 * (shared with sanctions-oracle). See that package for the full design
 * rationale.
 *
 * Phases instrumented
 * ────────────────────
 * rpc_poll    — each call to `eventSource.getEvents()`
 * event_relay — each call to the `onEvent` handler
 * webhook     — each call to a `WebhookSender.send()`
 */

/**
 * Default in-memory tracer implementation.
 *
 * @example
 * ```ts
 * import { DefaultTracer } from 'horizon-listener';
 *
 * const tracer = new DefaultTracer({ serviceName: 'horizon-listener' });
 * const span = tracer.startSpan('rpc_poll');
 * span.setAttribute('ledger', 12345);
 * span.end();
 * ```
 */
export { DefaultTracer } from '@compliance-adapters/tracing';

/**
 * No-op tracer that discards all spans. Useful in tests or when tracing
 * is disabled.
 *
 * @example
 * ```ts
 * import { NoopTracer } from 'horizon-listener';
 *
 * const tracer = new NoopTracer();
 * const span = tracer.startSpan('event_relay');
 * span.end(); // no-op
 * ```
 */
export { NoopTracer } from '@compliance-adapters/tracing';

export {
  type AnyTracer,
  type Tracer,
  type Span,
  type SpanData,
  type SpanStatus,
  type SpanAttributes,
  type SpanExporter,
  type TracingContext,
  type TracingOptions,
} from '@compliance-adapters/tracing';

/**
 * Extracts a W3C trace context (`traceparent` / `tracestate`) from incoming
 * headers so spans can be linked across services.
 *
 * @example
 * ```ts
 * import { extractTraceContext } from 'horizon-listener';
 *
 * const ctx = extractTraceContext({
 *   traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
 * });
 * // ctx.traceId === '4bf92f3577b34da6a3ce929d0e0e4736'
 * ```
 */
export { extractTraceContext } from '@compliance-adapters/tracing';