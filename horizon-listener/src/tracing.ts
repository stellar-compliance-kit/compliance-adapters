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
 * rpc_poll    — each call to \`eventSource.getEvents()\`
 * event_relay — each call to the \`onEvent\` handler
 * webhook     — each call to a \`WebhookSender.send()\`
 */

// ── Span data model ───────────────────────────────────────────────────────────

// The span data model and trace context are shared with sanctions-oracle via
// the runtime-free @compliance-adapters/tracing-types package so a context
// produced by either package's tracer can be passed to the other's startSpan().
import type {
  SpanStatus,
  SpanAttributes,
  SpanData,
  TracingContext,
} from '@compliance-adapters/tracing-types';

export type { SpanStatus, SpanAttributes, SpanData, TracingContext };

// ── Live span handle ──────────────────────────────────────────────────────────

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  /** Attach a low-cardinality attribute.  Payload attributes should not be set
   *  unless the caller has disabled payload redaction. */
  setAttribute(key: string, value: string | number | boolean): void;
  end(status?: SpanStatus, error?: Error): void;
}

// ── Tracer interface ──────────────────────────────────────────────────────────

export interface Tracer {
  /** Start a new span. If \`parentContext\` is provided, the new span is a child. */
  startSpan(name: string, parentContext?: TracingContext): Span;
  /**
   * Extract a \`TracingContext\` from W3C \`traceparent\` header format.
   * Returns \`undefined\` if the header is absent or malformed.
   */
  extractContext(traceparent: string | undefined): TracingContext | undefined;
  /**
   * Inject a context into a \`traceparent\` header string.
   * Useful for propagating context to outbound HTTP calls.
   */
  injectContext(context: TracingContext): string;
  /**
   * Flush any pending exporter calls and shut down.
   * Returns a promise that resolves once all in-flight exports settle.
   */
  shutdown(): Promise<void>;
}

// ── Exporter callback ─────────────────────────────────────────────────────────

/**
 * Called with each completed \`SpanData\` after the span ends.
 * May be async; errors thrown are caught and forwarded to \`onExportError\`.
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
