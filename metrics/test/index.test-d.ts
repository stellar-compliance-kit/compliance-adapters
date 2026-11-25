import { expectType, expectAssignable, expectError } from 'tsd';
import {
  Counter,
  Gauge,
  Histogram,
  Summary,
  Registry,
  MetricsClient,
  createCounter,
  createGauge,
  createHistogram,
  createSummary,
  createRegistry,
  createMetricsClient,
} from '../src/index';

// Counter
const counter = createCounter({ name: 'requests_total', help: 'Total requests' });
expectType<Counter>(counter);
expectType<void>(counter.inc());
expectType<void>(counter.inc(5));
expectType<void>(counter.inc({ labels: { method: 'GET' } }));
expectType<void>(counter.inc(5, { labels: { method: 'GET' } }));
expectType<number>(counter.get());
expectType<number>(counter.get({ labels: { method: 'GET' } }));
expectError(counter.inc('5'));
expectError(counter.inc({ labels: { method: 1 } }));

// Gauge
const gauge = createGauge({ name: 'temperature', help: 'Current temperature' });
expectType<Gauge>(gauge);
expectType<void>(gauge.set(42));
expectType<void>(gauge.set(42, { labels: { room: 'kitchen' } }));
expectType<void>(gauge.inc());
expectType<void>(gauge.inc(2));
expectType<void>(gauge.dec());
expectType<void>(gauge.dec(2));
expectType<number>(gauge.get());
expectType<number>(gauge.get({ labels: { room: 'kitchen' } }));
expectError(gauge.set('42'));
expectError(gauge.inc('2'));

// Histogram
const histogram = createHistogram({
  name: 'request_duration_seconds',
  help: 'Request duration',
  buckets: [0.1, 0.5, 1, 5],
});
expectType<Histogram>(histogram);
expectType<void>(histogram.observe(0.3));
expectType<void>(histogram.observe(0.3, { labels: { route: '/home' } }));
expectType<number>(histogram.get());
expectError(histogram.observe('0.3'));

// Summary
const summary = createSummary({
  name: 'request_size_bytes',
  help: 'Request size',
  percentiles: [0.5, 0.9, 0.99],
});
expectType<Summary>(summary);
expectType<void>(summary.observe(1024));
expectType<void>(summary.observe(1024, { labels: { route: '/home' } }));
expectType<number>(summary.get());
expectError(summary.observe('1024'));

// Registry
const registry = createRegistry();
expectType<Registry>(registry);
expectType<void>(registry.register(counter));
expectType<void>(registry.register(gauge));
expectType<void>(registry.register(histogram));
expectType<void>(registry.register(summary));
expectType<Counter>(registry.getCounter('requests_total'));
expectType<Gauge>(registry.getGauge('temperature'));
expectType<Histogram>(registry.getHistogram('request_duration_seconds'));
expectType<Summary>(registry.getSummary('request_size_bytes'));
expectType<string>(registry.metrics());
expectType<string>(registry.contentType());
expectError(registry.register({}));

// MetricsClient
const client = createMetricsClient({ registry });
expectType<MetricsClient>(client);
expectType<Counter>(client.counter('requests_total'));
expectType<Gauge>(client.gauge('temperature'));
expectType<Histogram>(client.histogram('request_duration_seconds'));
expectType<Summary>(client.summary('request_size_bytes'));
expectType<Registry>(client.registry);
expectType<Promise<void>>(client.flush());
expectType<Promise<string>>(client.scrape());

// Generic inference
function observeValue<T extends Counter | Gauge | Histogram | Summary>(
  metric: T,
  value: number,
): void {
  if ('inc' in metric) {
    metric.inc(value);
  } else if ('set' in metric) {
    metric.set(value);
  } else {
    metric.observe(value);
  }
}
expectType<void>(observeValue(counter, 1));
expectType<void>(observeValue(gauge, 1));
expectType<void>(observeValue(histogram, 1));
expectType<void>(observeValue(summary, 1));

// Assignability
expectAssignable<Counter>(counter);
expectAssignable<Gauge>(gauge);
expectAssignable<Histogram>(histogram);
expectAssignable<Summary>(summary);
expectAssignable<Registry>(registry);
expectAssignable<MetricsClient>(client);