import { expectType, expectAssignable, expectError } from 'tsd';
import {
  trace,
  getTracer,
  getActiveSpan,
  startSpan,
  startActiveSpan,
  withSpan,
  Span,
  Tracer,
  SpanContext,
  SpanStatusCode,
  SpanKind,
  context,
  Context,
  propagation,
  setSpan,
  getSpan,
  deleteSpan,
} from '../src';

// trace
expectType<Tracer>(trace.getTracer('test'));
expectType<Tracer>(trace.getTracer('test', '1.0.0'));
expectAssignable<object>(trace);

// getTracer
expectType<Tracer>(getTracer('test'));
expectType<Tracer>(getTracer('test', '1.0.0'));

// getActiveSpan
expectType<Span | undefined>(getActiveSpan());

// startSpan
expectType<Span>(startSpan('name'));
expectType<Span>(startSpan('name', { kind: SpanKind.INTERNAL }));
expectType<Span>(startSpan('name', { attributes: { key: 'value' } }));

// startActiveSpan
expectType<Span>(startActiveSpan('name', (span) => {
  expectType<Span>(span);
  return span;
}));
expectType<number>(startActiveSpan('name', (span) => {
  expectType<Span>(span);
  return 42;
}));

// withSpan
expectType<Promise<void>>(withSpan('name', async (span) => {
  expectType<Span>(span);
}));
expectType<Promise<string>>(withSpan('name', async (span) => {
  expectType<Span>(span);
  return 'result';
}));

// Span
declare const span: Span;
expectType<SpanContext>(span.spanContext());
expectType<void>(span.setAttribute('key', 'value'));
expectType<void>(span.setAttributes({ key: 'value' }));
expectType<void>(span.addEvent('event'));
expectType<void>(span.setStatus({ code: SpanStatusCode.OK }));
expectType<void>(span.end());
expectType<boolean>(span.isRecording());

// Tracer
declare const tracer: Tracer;
expectType<Span>(tracer.startSpan('name'));
expectType<Span>(tracer.startActiveSpan('name', (s) => {
  expectType<Span>(s);
  return s;
}));

// SpanContext
declare const spanContext: SpanContext;
expectType<string>(spanContext.traceId);
expectType<string>(spanContext.spanId);
expectType<number>(spanContext.traceFlags);

// SpanStatusCode
expectType<SpanStatusCode>(SpanStatusCode.UNSET);
expectType<SpanStatusCode>(SpanStatusCode.OK);
expectType<SpanStatusCode>(SpanStatusCode.ERROR);

// SpanKind
expectType<SpanKind>(SpanKind.INTERNAL);
expectType<SpanKind>(SpanKind.SERVER);
expectType<SpanKind>(SpanKind.CLIENT);
expectType<SpanKind>(SpanKind.PRODUCER);
expectType<SpanKind>(SpanKind.CONSUMER);

// context
expectType<Context>(context.active());
expectType<Context>(context.with(context.active(), () => {
  return context.active();
}));
expectType<Context>(context.bind(context.active(), () => {}));

// propagation
expectType<void>(propagation.inject(context.active(), {}));
expectType<Context>(propagation.extract(context.active(), {}));

// setSpan / getSpan / deleteSpan
expectType<Context>(setSpan(context.active(), span));
expectType<Span | undefined>(getSpan(context.active()));
expectType<Context>(deleteSpan(context.active()));

// Error cases
expectError(getTracer());
expectError(startSpan());
expectError(span.setAttribute('key'));
expectError(span.setStatus('invalid'));