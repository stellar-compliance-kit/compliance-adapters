/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenTelemetry-compatible tracing for sanctions-oracle.
 *
 * The generic tracer machinery is implemented and audited in
 * `@compliance-adapters/tracing`. This package intentionally re-exports that
 * implementation so every adapter shares one RNG and one span lifecycle model.
 *
 * @example
 * ```ts
 * import { DefaultTracer } from './tracing';
 *
 * const tracer = new DefaultTracer({ serviceName: 'sanctions-oracle' });
 * const span = tracer.startSpan('screen-address');
 * span.setAttribute('address', 'GABC...');
 * span.end();
 * ```
 */

/**
 * Default tracer implementation backed by the shared adapter tracing runtime.
 *
 * @example
 * ```ts
 * import { DefaultTracer } from './tracing';
 *
 * const tracer = new DefaultTracer({ serviceName: 'sanctions-oracle' });
 * const span = tracer.startSpan('screen-address');
 * span.setAttribute('address', 'GABC...');
 * span.end();
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
} from '@compliance-adapters/tracing';

/**
 * Extract a W3C trace context from incoming request headers.
 *
 * @example
 * ```ts
 * import { extractTraceContext } from './tracing';
 *
 * const ctx = extractTraceContext({
 *   traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
 * });
 * // ctx.traceId === '4bf92f3577b34da6a3ce929d0e0e4736'
 * ```
 */
export { extractTraceContext } from '@compliance-adapters/tracing';