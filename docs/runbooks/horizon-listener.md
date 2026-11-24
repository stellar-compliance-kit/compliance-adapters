# Runbook: horizon-listener in production

> `horizon-listener` polls **Soroban RPC `getEvents`** (not Horizon REST/SSE).
> All limits below are in Soroban ledgers (~5 s each on public networks).

## 1. Deployment and sizing

Run one listener instance per logical event stream. Multiple replicas sharing a
cursor will duplicate deliveries; the webhook receiver must deduplicate on
`Idempotency-Key` if replicas are intentional. Container starts should use the
CLI:

```sh
compliance-adapters listen \
  --contract-id "$DENYLIST_GATE_CONTRACT_ID" \
  --rpc-url "$STELLAR_RPC_URL" \
  --webhook-url "$WEBHOOK_URL" \
  --start-ledger "$START_LEDGER" \
  --poll-interval-ms 5000 --max-retries 10
```

| Load | Poll interval | CPU / memory (per instance) | Notes |
|---|---|---|---|
| < 1 event/s, 1 contract | 5000 ms | 0.2 vCPU / 256 MiB | Defaults are fine. |
| 1–20 events/s, few contracts | 1000–2000 ms | 0.5 vCPU / 512 MiB | Use `mode: 'stream'`; raise RPC rate limit. |
| > 20 events/s or fan-out sinks | 1000 ms + batching | 1 vCPU / 1 GiB | `HttpWebhookSender({ batchSize: 50, batchMaxWaitMs: 500 })`; consider the Kafka forwarder. |

Keep `pollIntervalMs >= 250`; lower values usually indicate a typo and risk
provider throttling. Give the process 2–5x the observed peak webhook latency as
its shutdown grace period (SIGTERM → `listener.stop()` → `sender.stop()`).
Terminate TLS at the webhook or use mTLS (`tls` sender option). Never log
signing secrets or webhook response bodies containing credentials.

## 2. Cursor persistence and upgrades without missing events

- The cursor is held **in memory only**. Persist `getStatus().cursor` (or the
  last processed event id) to durable storage — file, database key, or
  ConfigMap — after each successful batch. `FileDeadLetterQueue` covers failed
  deliveries, not cursor state.
- On startup, use the persisted cursor. Only fall back to `startLedger` when no
  cursor exists. RPC nodes retain roughly 17,280 ledgers (~24 h); if the
  persisted cursor is older than the retention window, `CursorOutOfRangeError`
  is returned and a fresh `startLedger` within the window is required — accept
  that events older than retention are unrecoverable from this RPC.
- Deploy upgrades with a **single active consumer**: stop (SIGTERM) old
  instance, wait for it to flush its batch and exit, persist the cursor, then
  start the new instance with that cursor. Rolling deployments with two active
  consumers duplicate events unless the sink is idempotent.
- `onEvent` must be idempotent. `Idempotency-Key` is stable per event (and per
  batch), so receivers can deduplicate replays from the DLQ.
- Before an upgrade, record the current cursor and `latestLedger`; after the
  restart, confirm polling resumes (`logger_lag` drops, new events arrive).

## 3. Metrics and alert thresholds

Expose `MetricsRegistry.expose()` on a `/metrics` endpoint and scrape every
15–30 s. Key signals:

| Signal | Warning | Critical | Meaning |
|---|---|---|---|
| `horizon_listener_ledger_lag` | > 10 ledgers for 5 min | > 50 ledgers for 5 min | Listener is behind the chain head. |
| `increase(horizon_listener_requests_total{phase="rpc_poll",outcome="failure"}[5m])` | > 3 | > 10 | RPC errors / throttling. |
| `rate(horizon_listener_requests_total{phase="event_relay",outcome="failure"}[5m])` | > 0.01/s | > 0.1/s | Sink rejecting events; check DLQ. |
| `rate(horizon_listener_requests_total{phase="webhook",outcome="failure"}[5m])` | > 0.01/s | > 0.1/s | Webhook delivery failing. |
| `horizon_listener_duration_ms_bucket{phase="webhook",le="1000"}` ratio | < 95% | < 80% | Sink latency regression. |
| Process uptime / heartbeat log (`debug` cursor advancement) | no poll in 2 min | no poll in 10 min | Loop stalled or process dead. |

Alert on `ledger_lag` first: it is the user-visible freshness SLO. Correlate
spikes with RPC failover counters and webhook errors before restarting.

## 4. Failure scenarios and recovery

1. **RPC endpoint unreachable / connection refused.** Poll failures log a
   `warn` and back off (capped at 30 s with jitter). Check endpoint health and
   DNS; if persistent, rotate to a healthy URL via `rpcUrls` failover or update
   `--rpc-url`. No cursor change is needed — the last successful cursor is
   reused. Alert if failures exceed `maxRetries` (default 10).

2. **RPC rate limiting (HTTP 429).** Increase `pollIntervalMs` or request a
   higher provider quota; enable `mode: 'stream'` only if quiet periods dominate.
   Verify backoff logs show increasing delays. Do not restart aggressively —
   restarts do not reset provider rate limits.

3. **Cursor out of range / expired event history.** `CursorOutOfRangeError`
   means the cursor is older than RPC retention (~17,280 ledgers). Set
   `startLedger` to a recent ledger, accept the permanent loss of older events,
   and backfill downstream from another source if available. Reduce `ledger_lag`
   alert thresholds so this is caught before retention expires.

4. **Webhook returns 4xx.** Treated as permanent; the event is not retried by
   `HttpWebhookSender` and lands in the DLQ if configured. Fix URL, auth, or
   payload schema (check `X-Compliance-Schema-Version`), then replay with
   `compliance-adapters dlq replay --dlq <path> --webhook <url>`.

5. **Webhook returns 5xx or times out.** Transient failures retry with
   exponential backoff up to `maxRetries` per delivery. Check receiver health
   and `timeoutMs`; if it stays down, stop the listener cleanly, fix the sink,
   then replay from the DLQ using the stable `Idempotency-Key`.

6. **Handler (`onEvent`) throws repeatedly.** Listener keeps polling and logs
   handler errors; events fail and accumulate in the DLQ. Inspect the first
   failing payload, fix the handler or schema mismatch, redeploy, then replay
   the DLQ. Alert on `event_relay` failure rate.

7. **Listener lag grows with no errors.** Usually a slow sink or too-small
   batch/poll budget. Check webhook duration histograms and `ledger_lag`;
   enable batching or add concurrency with `orderingKey: 'contract'` (same
   contract stays ordered). Scale RPC quota before reducing poll interval.

8. **Process killed / OOM (no graceful shutdown).** In-memory cursor is lost.
   Restart with the last persisted cursor (or a retained `startLedger`); replay
   the DLQ for unacknowledged deliveries. Add a restart policy, memory limits
   with headroom, and persist the cursor after every batch to shrink the replay
   window.

9. **Duplicate deliveries after restart or rolling deploy.** Caused by a stale
   persisted cursor or two active consumers. Verify only one replica is active,
   confirm its cursor is ahead of the sink's last seen id, and rely on
   `Idempotency-Key` deduplication in the receiver. Re-run `dlq replay --dry-run`
   to see what would be resent before replaying for real.

## 5. Verification checklist after recovery

- `horizon_listener_ledger_lag` trends back toward 0.
- A fresh event appears in the sink within one poll interval.
- Poll and webhook failure counters stop increasing.
- DLQ depth is stable or decreasing after replay.
- Cursor checkpoint is updated and backed up before the next deploy.
