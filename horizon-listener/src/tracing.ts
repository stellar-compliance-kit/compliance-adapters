/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenTelemetry-compatible tracing for horizon-listener.
 *
 * Architecture
 * ────────────
 * This module defines its own thin interfaces rather than importing
 * \`@opentelemetry/api\` directly, keeping the runtime footprint to zero for
 * operators who don't need tracing. Consumers who want real OTLP export can
 * bridge the two worlds by supplying an \`exporter\` callback that forwards
 * completed \`SpanData\` objects to their chosen OpenTelemetry SDK exporter.
 *
 * Key design decisions
 * ─────────────────────
 * • No transaction payload by default — event values are redacted unless
 *   \`TracingOptions.redactPayload\` is explicitly set to \`false\`.
 * • Exporter failures never propagate — the exporter callback is wrapped in
 *   a try/catch; any error is forwarded to the optional \`onExportError\` hook
 *   and then swallowed so debugging phases always succeed.
 * • Context propagation — spans carry a W3C \`traceparent\`-compatible
 *   traceId + spanId and can inject / extract those values as HTTP headers.
 * • Optional sampling — a \`sampler\` predicate receives the span name and
 *   returns a boolean; defaults to sampling everything.
 * • Graceful shutdown — \`Tracer.shutdown()\` flushes any pending exporter
 *   calls and resolves once they settle.
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
export type SpanExporter = (span: SpanData) => void | Promise<void>;

// ── Tracing options ───────────────────────────────────────────────────────────

export interface TracingOptions {
  /**
   * Called with each completed span.  May forward to any OTLP/Jaeger/Zipkin
   * SDK exporter.  When omitted, spans are silently discarded.
   */
  exporter?: SpanExporter;
  /**
   * Optional predicate controlling which span names are sampled.
   * Receives the span name; return \`true\` to record the span.
   * Defaults to \`() => true\` (sample everything).
   */
  sampler?: (spanName: string) => boolean;
  /**
   * When \`true\` (default), event \`value\` payloads are NOT attached to spans.
   * Set to \`false\` only in environments where payload logging is acceptable.
   */
  redactPayload?: boolean;
  /**
   * Called when the exporter throws.  Useful for surfacing export errors
   * in tests or logs without propagating them.
   */
  onExportError?: (error: unknown) => void;
  /** Optional service name added as an attribute to every span. */
  serviceName?: string;
}

// ── ID generation ─────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < bytes * 2; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

// ── Live span implementation ──────────────────────────────────────────────────

class LiveSpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  private readonly name: string;
  private readonly startTimeMs: number;
  private readonly attrs: SpanAttributes;
  private ended = false;

  private readonly onEnd: (data: SpanData) => void;

  constructor(
    name: string,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined,
    startTimeMs: number,
    serviceName: string | undefined,
    onEnd: (data: SpanData) => void,
  ) {
    this.name = name;
    this.traceId = traceId;
    this.spanId = spanId;
    this.parentSpanId = parentSpanId;
    this.startTimeMs = startTimeMs;
    this.attrs = serviceName ? { 'service.name': serviceName } : {};
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attrs[key] = value;
  }

  end(status: SpanStatus = 'ok', error?: Error): void {
    if (this.ended) return;
    this.ended = true;

    const endTimeMs = Date.now();
    this.onEnd({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTimeMs: this.startTimeMs,
      endTimeMs,
      durationMs: endTimeMs - this.startTimeMs,
      status,
      attributes: { ...this.attrs },
      errorMessage: error?.message,
    });
  }
}

// ── Noop span ─────────────────────────────────────────────────────────────────

class NoopSpan implements Span {
  readonly traceId = '';
  readonly spanId = '';
  setAttribute(_key: string, _value: string | number | boolean): void {}
  end(_status?: SpanStatus, _error?: Error): void {}
}

// ── DefaultTracer ────────────────────────────────────────────────────────────

/**
 * A fully functional tracer that records spans and exports them via the
 * provided \`exporter\` callback. When no exporter is provided, spans are
 * still recorded in-memory but export is skipped.
 */
export class DefaultTracer implements Tracer {
  private readonly options: Required<
    Omit<TracingOptions, 'exporter' | 'onExportError' | 'serviceName'>
  > & {
    exporter: SpanExporter | undefined;
    onExportError: ((error: unknown) => void) | undefined;
    serviceName: string | undefined;
  };
  private readonly pending: Promise<void>[] = [];
  private shuttingDown = false;

  constructor(options: TracingOptions = {}) {
    this.options = {
      exporter: options.exporter,
      sampler: options.sampler ?? (() => true),
      redactPayload: options.redactPayload !== false, // default true
      onExportError: options.onExportError,
      serviceName: options.serviceName,
    };
  }

  startSpan(name: string, parentContext?: TracingContext): Span {
    if (this.shuttingDown || !this.options.sampler(name)) {
      return new NoopSpan();
    }

    const traceId = parentContext?.traceId ?? randomHex(16);
    const spanId = randomHex(8);
    const parentSpanId = parentContext?.spanId;

    return new LiveSpan(
      name,
      traceId,
      spanId,
      parentSpanId,
      Date.now(),
      this.options.serviceName,
      (data) => this.handleSpanEnd(data),
    );
  }

  extractContext(traceparent: string | undefined): TracingContext | undefined {
    if (!traceparent) return undefined;
    // W3C traceparent format: version-traceId-parentId-traceFlags
    // e.g. "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    const parts = traceparent.split('-');
    if (parts.length < 4 || parts[1].length !== 32 || parts[2].length !== 16) {
      return undefined;
    }
    return { traceId: parts[1], spanId: parts[2] };
  }

  injectContext(context: TracingContext): string {
    return `00-${context.traceId}-${context.spanId}-01`;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    // Wait for all in-flight exporter calls to settle
    await Promise.allSettled(this.pending);
  }

  private handleSpanEnd(data: SpanData): void {
    if (!this.options.exporter) return;

    const exportPromise = Promise.resolve()
      .then(() => this.options.exporter!(data))
      .catch((err) => {
        // Exporter failures never surface to the caller
        this.options.onExportError?.(err);
      })
      .finally(() => {
        const idx = this.pending.indexOf(exportPromise);
        if (idx !== -1) this.pending.splice(idx, 1);
      });

    this.pending.push(exportPromise);
  }
}

// ── NoopTracer ────────────────────────────────────────────────────────────────

/**
 * A no-op tracer that creates no spans and never calls any exporter.
 * Used as the default when tracing is not configured — zero overhead.
 */
export class NoopTracer implements Tracer {
  startSpan(_name: string, _parentContext?: TracingContext): Span {
    return new NoopSpan();
  }

  extractContext(_traceparent: string | undefined): TracingContext | undefined {
    return undefined;
  }

  injectContext(context: TracingContext): string {
    return `00-${context.traceId}-${context.spanId}-01`;
  }

  async shutdown(): Promise<void> {}
}

export type AnyTracer = DefaultTracer | NoopTracer;
