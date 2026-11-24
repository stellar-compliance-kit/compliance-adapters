/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { DefaultTracer, NoopTracer, normalizeTraceState } from '../src';

const TP = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('W3C tracestate pass-through', () => {
  it('extracts tracestate alongside traceparent', () => {
    const ctx = new DefaultTracer().extractContext(TP, 'congo=t61rcWkgMzE, rojo=00f067aa0ba902b7');
    expect(ctx).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceState: 'congo=t61rcWkgMzE,rojo=00f067aa0ba902b7',
    });
  });

  it('omits traceState when header is absent', () => {
    expect(new DefaultTracer().extractContext(TP)).not.toHaveProperty('traceState');
  });

  it('ignores tracestate when traceparent is invalid', () => {
    expect(new DefaultTracer().extractContext('bad', 'a=b')).toBeUndefined();
  });

  it('injects tracestate from context', () => {
    const ctx = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceState: 'k=v' };
    expect(new DefaultTracer().injectTraceState(ctx)).toBe('k=v');
    expect(new NoopTracer().injectTraceState(ctx)).toBe('k=v');
    expect(new DefaultTracer().injectTraceState({ traceId: ctx.traceId, spanId: ctx.spanId })).toBeUndefined();
  });

  it('normalizes and bounds tracestate values', () => {
    expect(normalizeTraceState(' a=1 ,, b=2 ')).toBe('a=1,b=2');
    expect(normalizeTraceState('   ')).toBeUndefined();
    expect(normalizeTraceState('x=' + 'y'.repeat(600))).toBeUndefined();
  });
});
