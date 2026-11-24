/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import {
  clearActiveSpanContext,
  createTracingLogger,
  jsonLogger,
  type JsonLogStream,
} from '../../logger/src/index';
import {
  DefaultTracer,
  clearActiveSpanContext as clearTracingContext,
  getActiveSpanContext,
  withActiveSpan,
} from '../src/index';

describe('active span context', () => {
  afterEach(() => {
    clearActiveSpanContext();
    clearTracingContext();
  });

  it('publishes a started span so loggers can read its IDs', () => {
    const tracer = new DefaultTracer();
    const chunks: string[] = [];
    const stream: JsonLogStream = { write: (chunk) => chunks.push(chunk) };
    const logger = createTracingLogger(jsonLogger({ stream }));

    const span = tracer.startSpan('address_check');
    logger.info('checking');
    expect(getActiveSpanContext()).toMatchObject({ traceId: span.traceId, spanId: span.spanId });
    expect(JSON.parse(chunks[0])).toMatchObject({ traceId: span.traceId, spanId: span.spanId });

    span.end();
    expect(getActiveSpanContext()).toBeUndefined();
  });

  it('scopes an explicitly activated span with withActiveSpan', () => {
    const context = { traceId: 'c'.repeat(32), spanId: 'd'.repeat(16) };
    const base = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const logger = createTracingLogger(base);

    withActiveSpan(context, () => logger.info('inside'));
    expect(base.info).toHaveBeenCalledWith('inside', {
      traceId: context.traceId,
      spanId: context.spanId,
    });
    expect(getActiveSpanContext()).toBeUndefined();
  });
});
