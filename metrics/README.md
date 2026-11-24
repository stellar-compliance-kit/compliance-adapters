# @compliance-adapters/metrics

Zero-dependency metrics shared by `horizon-listener` and `sanctions-oracle`
(both re-export their phase-bound `MetricsRegistry` from here).

## `/metrics` endpoint

```ts
import { metricsHandler } from '@compliance-adapters/metrics';

const handler = metricsHandler(registry);

http.createServer((req, res) => (req.url === '/metrics' ? handler(req, res) : res.end()));
app.get('/metrics', handler);      // Express
fastify.get('/metrics', handler);  // Fastify
```

## OpenTelemetry (OTLP) export

For collectors that receive OTLP instead of scraping Prometheus:

```ts
import { OtlpMetricsExporter } from '@compliance-adapters/metrics';

const exporter = new OtlpMetricsExporter(registry, {
  url: 'http://localhost:4318/v1/metrics',
  headers: { authorization: 'Bearer …' },
  serviceName: 'horizon-listener',
  intervalMs: 30_000,
  onError: (err) => logger.warn('otlp export failed', err),
});
exporter.start();
// on shutdown
await exporter.shutdown(); // flushes a final batch
```

Counters are exported as monotonic cumulative Sums and histograms as
cumulative Histograms with explicit bounds, using the OTLP/HTTP JSON encoding.
`toOtlpMetrics(registry)` returns the request body if you want to send it yourself.
