/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import {
  clearActiveSpanContext,
  createTracingLogger,
  getActiveSpanContext,
  getChildLogger,
  jsonLogger,
  setActiveSpanContext,
  withActiveSpanContext,
  type JsonLogStream,
} from '../src/index';

describe('trace correlation', () => {
  afterEach(() => clearActiveSpanContext());

  it('reports the active span context and restores it after withActiveSpanContext', () => {
    const context = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) };
    expect(getActiveSpanContext()).toBeUndefined();
    withActiveSpanContext(context, () => {
      expect(getActiveSpanContext()).toEqual(context);
    });
    expect(getActiveSpanContext()).toBeUndefined();

    setActiveSpanContext(context);
    expect(getActiveSpanContext()).toEqual(context);
  });

  it('automatically appends traceId and spanId before delegating', () => {
    const base = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const logger = createTracingLogger(base);
    logger.info('no context');
    expect(base.info).toHaveBeenCalledWith('no context');

    setActiveSpanContext({ traceId: 'trace-1', spanId: 'span-1' });
    logger.info('with context', { ok: true });
    expect(base.info).toHaveBeenLastCalledWith('with context', { ok: true }, {
      traceId: 'trace-1',
      spanId: 'span-1',
    });
  });

  it('includes trace fields in jsonLogger output when a span is active', () => {
    const chunks: string[] = [];
    const stream: JsonLogStream = { write: (chunk) => chunks.push(chunk) };
    const logger = jsonLogger({ stream });

    withActiveSpanContext({ traceId: 't'.repeat(32), spanId: 's'.repeat(16) }, () => {
      logger.warn('correlated', { phase: 'fetch' });
    });
    logger.warn('uncorrelated');

    expect(JSON.parse(chunks[0])).toMatchObject({
      msg: 'correlated',
      phase: 'fetch',
      traceId: 't'.repeat(32),
      spanId: 's'.repeat(16),
    });
    expect(JSON.parse(chunks[1]).traceId).toBeUndefined();
  });

  it('adds IDs to child loggers too', () => {
    const base = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    setActiveSpanContext({ traceId: 'trace-2', spanId: 'span-2' });
    getChildLogger(createTracingLogger(base), { component: 'auth' }).debug('child');
    expect(base.debug).toHaveBeenCalledWith(
      { component: 'auth' },
      'child',
      { traceId: 'trace-2', spanId: 'span-2' },
    );
  });
});
