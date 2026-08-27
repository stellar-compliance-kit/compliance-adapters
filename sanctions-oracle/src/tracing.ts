/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenTelemetry-compatible tracing for sanctions-oracle.
 *
 * See horizon-listener/src/tracing.ts for the full design rationale.
 * This module mirrors that design for the sanctions-oracle phases:
 *
 * Phases instrumented
 * ────────────────────
 * address_check   — each call to \`provider.checkAddress()\`
 * denylist_write  — each call to \`writer.addToDenylist()\`
 *
 * Privacy
 * ───────
 * Stellar addresses are NOT attached to spans by default. They would increase
 * cardinality unboundedly and may constitute PII in some jurisdictions. The
 * \`redactPayload\` option (default: \`true\`) controls whether the \`address\`
 * attribute is included; callers must opt-in to turn this off.
 */

// ── Span data model ───────────────────────────────────────────────────────────

export type SpanStatus = 'ok' | 'error' | 'cancelled';

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes: SpanAttributes;
  errorMessage?: string;
}

// ── Live span handle ──────────────────────────────────────────────────────────

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  end(status?: SpanStatus, error?: Error): void;
}

// ── Tracer interface ──────────────────────────────────────────────────────────

export interface TracingContext {
  traceId: string;
  spanId: string;
}

export interface Tracer {
  startSpan(name: string, parentContext?: TracingContext): Span;
  extractContext(traceparent: string | undefined): TracingContext | undefined;
  injectContext(context: TracingContext): string;
  shutdown(): Promise<void>;
}

export type SpanExporter = (span: SpanData) => void | Promise<void>;

export interface TracingOptions {
  exporter?: SpanExporter;
  sampler?: (spanName: string) => boolean;
  /** When \`true\` (default), Stellar addresses are NOT attached to spans. */
  redactPayload?: boolean;
  onExportError?: (error: unknown) => void;
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

// ── DefaultTracer ─────────────────────────────────────────────────────────────

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
      redactPayload: options.redactPayload !== false,
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
    await Promise.allSettled(this.pending);
  }

  private handleSpanEnd(data: SpanData): void {
    if (!this.options.exporter) return;

    const exportPromise = Promise.resolve()
      .then(() => this.options.exporter!(data))
      .catch((err) => {
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
