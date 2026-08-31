/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OpenTelemetry-compatible tracing for sanctions-oracle.
 *
 * The generic tracer machinery lives in `@compliance-adapters/tracing`
 * (shared with horizon-listener). See that package for the full design
 * rationale.
 *
 * Phases instrumented
 * ────────────────────
 * address_check   — each call to `provider.checkAddress()`
 * denylist_write  — each call to `writer.addToDenylist()`
 *
 * Privacy
 * ───────
 * Stellar addresses are NOT attached to spans by default. They would increase
 * cardinality unboundedly and may constitute PII in some jurisdictions. The
 * `redactPayload` option (default: `true`) controls whether the `address`
 * attribute is included; callers must opt-in to turn this off.
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
