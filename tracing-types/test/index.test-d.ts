import { expectType, expectAssignable, expectNotAssignable } from 'tsd';
import {
  TracingConfig,
  TracingOptions,
  SpanContext,
  Span,
  Tracer,
  TracerProvider,
  Sampler,
  SamplingDecision,
  SamplingResult,
  SpanKind,
  SpanStatusCode,
  Attributes,
  AttributeValue,
  Link,
  Event,
  Status,
  Context,
  ContextManager,
  TextMapPropagator,
  TextMapGetter,
  TextMapSetter,
  Baggage,
  BaggageEntry,
  PropagationAPI,
  TraceAPI,
  ProxyTracer,
  ProxyTracerProvider,
  NoopTracer,
  NoopTracerProvider,
  createTracer,
  createTracerProvider,
  getTracer,
  getTracerProvider,
  setTracerProvider,
  setGlobalTracerProvider,
  getGlobalTracerProvider,
  isTracingSuppressed,
  suppressTracing,
  unsuppressTracing,
  trace,
  context,
  propagation,
  ROOT_CONTEXT,
  INVALID_SPAN_CONTEXT,
  INVALID_SPANID,
  INVALID_TRACEID,
  isSpanContextValid,
  isTracingSuppressed as isTracingSuppressedFn,
} from '../src';

// ---------------------------------------------------------------------------
// TracingConfig
// ---------------------------------------------------------------------------

expectType<TracingConfig>({});
expectType<TracingConfig>({ enabled: true });
expectType<TracingConfig>({ enabled: false, sampler: undefined });
expectNotAssignable<TracingConfig>({ enabled: 'yes' });
expectNotAssignable<TracingConfig>({ unknownOption: true });

// ---------------------------------------------------------------------------
// TracingOptions
// ---------------------------------------------------------------------------

expectType<TracingOptions>({});
expectType<TracingOptions>({ enabled: true });
expectNotAssignable<TracingOptions>({ enabled: 1 });

// ---------------------------------------------------------------------------
// SpanContext
// ---------------------------------------------------------------------------

declare const spanContext: SpanContext;
expectType<string>(spanContext.traceId);
expectType<string>(spanContext.spanId);
expectType<number>(spanContext.traceFlags);
expectType<boolean | undefined>(spanContext.isRemote);

expectAssignable<SpanContext>({
  traceId: '00000000000000000000000000000001',
  spanId: '0000000000000001',
  traceFlags: 0,
});

expectNotAssignable<SpanContext>({
  traceId: 1,
  spanId: '0000000000000001',
  traceFlags: 0,
});

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

declare const span: Span;
expectType<SpanContext>(span.spanContext());
expectType<void>(span.setAttribute('key', 'value'));
expectType<void>(span.setAttribute('key', 1));
expectType<void>(span.setAttribute('key', true));
expectType<void>(span.setAttributes({ key: 'value' }));
expectType<void>(span.addEvent('event'));
expectType<void>(span.addEvent('event', { key: 'value' }));
expectType<void>(span.setStatus({ code: SpanStatusCode.OK }));
expectType<void>(span.updateName('name'));
expectType<void>(span.end());
expectType<void>(span.end(Date.now()));
expectType<boolean>(span.isRecording());
expectType<Span>(span);

expectNotAssignable<Span>({});
expectNotAssignable<Span>({ spanContext: () => spanContext });

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

declare const tracer: Tracer;
expectType<Span>(tracer.startSpan('name'));
expectType<Span>(tracer.startSpan('name', { kind: SpanKind.CLIENT }));
expectType<Span>(tracer.startSpan('name', {}, ROOT_CONTEXT));
expectType<Span>(tracer.startActiveSpan('name', (s: Span) => s));
expectType<Span>(tracer.startActiveSpan('name', {}, (s: Span) => s));
expectType<Span>(tracer.startActiveSpan('name', {}, ROOT_CONTEXT, (s: Span) => s));

expectNotAssignable<Tracer>({});
expectNotAssignable<Tracer>({ startSpan: () => undefined });

// ---------------------------------------------------------------------------
// TracerProvider
// ---------------------------------------------------------------------------

declare const provider: TracerProvider;
expectType<Tracer>(provider.getTracer('name'));
expectType<Tracer>(provider.getTracer('name', '1.0.0'));
expectType<Tracer>(provider.getTracer('name', '1.0.0', { schemaUrl: 'url' }));

expectNotAssignable<TracerProvider>({});
expectNotAssignable<TracerProvider>({ getTracer: () => undefined });

// ---------------------------------------------------------------------------
// Sampler / SamplingDecision / SamplingResult
// ---------------------------------------------------------------------------

declare const sampler: Sampler;
expectType<SamplingResult>(sampler.shouldSample(ROOT_CONTEXT, 'traceId', 'name', SpanKind.INTERNAL, {}, []));
expectType<SamplingResult>(sampler.shouldSample(ROOT_CONTEXT, 'traceId', 'name', SpanKind.INTERNAL, {}, [], []));

expectType<SamplingDecision>(SamplingDecision.NOT_RECORD);
expectType<SamplingDecision>(SamplingDecision.RECORD);
expectType<SamplingDecision>(SamplingDecision.RECORD_AND_SAMPLED);

declare const samplingResult: SamplingResult;
expectType<SamplingDecision>(samplingResult.decision);
expectType<Attributes | undefined>(samplingResult.attributes);
expectType<string | undefined>(samplingResult.traceState);

// ---------------------------------------------------------------------------
// SpanKind / SpanStatusCode
// ---------------------------------------------------------------------------

expectType<SpanKind>(SpanKind.INTERNAL);
expectType<SpanKind>(SpanKind.SERVER);
expectType<SpanKind>(SpanKind.CLIENT);
expectType<SpanKind>(SpanKind.PRODUCER);
expectType<SpanKind>(SpanKind.CONSUMER);

expectType<SpanStatusCode>(SpanStatusCode.UNSET);
expectType<SpanStatusCode>(SpanStatusCode.OK);
expectType<SpanStatusCode>(SpanStatusCode.ERROR);

// ---------------------------------------------------------------------------
// Attributes / AttributeValue
// ---------------------------------------------------------------------------

expectAssignable<AttributeValue>('string');
expectAssignable<AttributeValue>(1);
expectAssignable<AttributeValue>(true);
expectAssignable<AttributeValue>(['a', 'b']);
expectAssignable<AttributeValue>([1, 2]);
expectAssignable<AttributeValue>([true, false]);
expectNotAssignable<AttributeValue>({});
expectNotAssignable<AttributeValue>(null);

expectAssignable<Attributes>({});
expectAssignable<Attributes>({ a: 'string', b: 1, c: true, d: ['x'] });
expectNotAssignable<Attributes>({ a: {} });

// ---------------------------------------------------------------------------
// Link / Event / Status
// ---------------------------------------------------------------------------

expectAssignable<Link>({ context: spanContext });
expectAssignable<Link>({ context: spanContext, attributes: { a: 'b' } });
expectNotAssignable<Link>({});
expectNotAssignable<Link>({ context: {} });

expectAssignable<Event>({ name: 'event' });
expectAssignable<Event>({ name: 'event', attributes: { a: 'b' }, time: [0, 0] });
expectNotAssignable<Event>({});
expectNotAssignable<Event>({ name: 1 });

expectAssignable<Status>({ code: SpanStatusCode.OK });
expectAssignable<Status>({ code: SpanStatusCode.ERROR, message: 'oops' });
expectNotAssignable<Status>({});
expectNotAssignable<Status>({ code: 'OK' });

// ---------------------------------------------------------------------------
// Context / ContextManager
// ---------------------------------------------------------------------------

declare const ctx: Context;
expectType<Context>(ctx.setValue(Symbol('k'), 'v'));
expectType<unknown>(ctx.getValue(Symbol('k')));
expectType<Context>(ctx.deleteValue(Symbol('k')));

expectType<Context>(ROOT_CONTEXT);

declare const contextManager: ContextManager;
expectType<Context>(contextManager.active());
expectType<Context>(contextManager.with(ctx, () => ctx));
expectType<void>(contextManager.with(ctx, () => undefined));
expectType<void>(contextManager.bind(ctx, () => undefined));
expectType<() => void>(contextManager.bind(ctx, () => undefined));
expectType<void>(contextManager.enable());
expectType<void>(contextManager.disable());

// ---------------------------------------------------------------------------
// TextMapPropagator / TextMapGetter / TextMapSetter
// ---------------------------------------------------------------------------

declare const propagator: TextMapPropagator;
expectType<void>(propagator.inject(ctx, {} as TextMapSetter));
expectType<Context>(propagator.extract(ctx, {} as TextMapGetter));
expectType<string[]>(propagator.fields());

declare const getter: TextMapGetter;
expectType<string[]>(getter.keys({}));
expectType<string | undefined>(getter.get({}, 'key'));

declare const setter: TextMapSetter;
expectType<void>(setter.set({}, 'key', 'value'));

// ---------------------------------------------------------------------------
// Baggage / BaggageEntry
// ---------------------------------------------------------------------------

declare const baggage: Baggage;
expectType<BaggageEntry | undefined>(baggage.getEntry('key'));
expectType<Baggage>(baggage.setEntry('key', { value: 'v' }));
expectType<Baggage>(baggage.removeEntry('key'));
expectType<Baggage>(baggage.removeEntries(['a', 'b']));
expectType<Baggage>(baggage.clear());
expectType<Baggage>(baggage.setEntries({ a: { value: 'v' } }));
expectType<[string, BaggageEntry][]>(baggage.getAllEntries());

expectAssignable<BaggageEntry>({ value: 'v' });
expectAssignable<BaggageEntry>({ value: 'v', metadata: {} });
expectNotAssignable<BaggageEntry>({});
expectNotAssignable<BaggageEntry>({ value: 1 });

// ---------------------------------------------------------------------------
// PropagationAPI / TraceAPI
// ---------------------------------------------------------------------------

declare const propagationApi: PropagationAPI;
expectType<void>(propagationApi.setGlobalPropagator(propagator));
expectType<TextMapPropagator>(propagationApi.getGlobalPropagator());
expectType<void>(propagationApi.disable());
expectType<void>(propagationApi.enable());

declare const traceApi: TraceAPI;
expectType<TracerProvider>(traceApi.getTracerProvider());
expectType<void>(traceApi.setGlobalTracerProvider(provider));
expectType<void>(traceApi.disable());
expectType<void>(traceApi.enable());

// ---------------------------------------------------------------------------
// ProxyTracer / ProxyTracerProvider / NoopTracer / NoopTracerProvider
// ---------------------------------------------------------------------------

declare const proxyTracer: ProxyTracer;
expectType<Span>(proxyTracer.startSpan('name'));
expectType<Span>(proxyTracer.startActiveSpan('name', (s: Span) => s));

declare const proxyTracerProvider: ProxyTracerProvider;
expectType<Tracer>(proxyTracerProvider.getTracer('name'));

declare const noopTracer: NoopTracer;
expectType<Span>(noopTracer.startSpan('name'));
expectType<Span>(noopTracer.startActiveSpan('name', (s: Span) => s));

declare const noopTracerProvider: NoopTracerProvider;
expectType<Tracer>(noopTracerProvider.getTracer('name'));

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

expectType<Tracer>(createTracer('name'));
expectType<Tracer>(createTracer('name', '1.0.0'));
expectType<TracerProvider>(createTracerProvider());
expectType<Tracer>(getTracer('name'));
expectType<Tracer>(getTracer('name', '1.0.0'));
expectType<TracerProvider>(getTracerProvider());
expectType<void>(setTracerProvider(provider));
expectType<void>(setGlobalTracerProvider(provider));
expectType<TracerProvider>(getGlobalTracerProvider());

// ---------------------------------------------------------------------------
// Tracing suppression helpers
// ---------------------------------------------------------------------------

expectType<boolean>(isTracingSuppressed(ROOT_CONTEXT));
expectType<boolean>(isTracingSuppressedFn(ROOT_CONTEXT));
expectType<Context>(suppressTracing(ROOT_CONTEXT));
expectType<Context>(unsuppressTracing(ROOT_CONTEXT));

// ---------------------------------------------------------------------------
// trace / context / propagation singletons
// ---------------------------------------------------------------------------

expectType<TraceAPI>(trace);
expectType<ContextManager>(context);
expectType<PropagationAPI>(propagation);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

expectType<string>(INVALID_SPANID);
expectType<string>(INVALID_TRACEID);
expectType<SpanContext>(INVALID_SPAN_CONTEXT);

// ---------------------------------------------------------------------------
// isSpanContextValid
// ---------------------------------------------------------------------------

expectType<boolean>(isSpanContextValid(spanContext));
expectNotAssignable<boolean>(isSpanContextValid({}));