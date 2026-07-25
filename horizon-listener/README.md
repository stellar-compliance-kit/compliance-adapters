# horizon-listener

An example/reference service that polls Soroban RPC for contract events emitted
by the `denylist-gate` and `allowlist-token` contracts, logs them, and
re-emits them to a webhook. Soroban RPC's `getEvents` is a cursor-based polling
API — there is no persistent server-sent-events stream for contract events at
that layer — so this package polls on an interval and tracks a cursor between
calls rather than holding open a live connection. "Reconnect" here means the
polling loop hit an error (RPC unreachable, rate-limited, cursor expired) and
backed off before retrying, not a literal TCP reconnect. This package
demonstrates the integration pattern app developers would build on top of;
it is not itself a production event pipeline.

## Install

```sh
npm install
```

(This package is part of the `compliance-adapters` npm workspace; run install
from the repo root.)

## Quick example

```ts
import { Networks } from '@stellar/stellar-sdk';
import { RpcEventSource, HorizonListener, HttpWebhookSender } from 'horizon-listener';

const eventSource = new RpcEventSource({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  contractIds: [process.env.DENYLIST_GATE_CONTRACT_ID!, process.env.ALLOWLIST_TOKEN_CONTRACT_ID!],
});

const webhook = new HttpWebhookSender({ url: 'http://localhost:4000/webhook' });

const listener = new HorizonListener({
  eventSource,
  pollIntervalMs: 5000,
  onEvent: async (event) => {
    await webhook.send(event);
  },
});

listener.start().catch((err) => {
  console.error('horizon-listener gave up after repeated failures', err);
  process.exit(1);
});
```

A minimal stub receiver to point `HttpWebhookSender` at during local
development (using [Express](https://expressjs.com/), not a dependency of this
package):

```ts
import express from 'express';

const app = express();
app.use(express.json());
app.post('/webhook', (req, res) => {
  console.log('received event', req.body);
  res.sendStatus(200);
});
app.listen(4000);
```

## Polling mode vs stream mode

`HorizonListener` supports two polling modes via the `mode` option:

- **`poll`** (default) — fixed-interval polling. The listener always waits
  `pollIntervalMs` between each `getEvents` call, regardless of whether events
  were returned. Suitable for most use cases.

- **`stream`** — backoff-only "stream-like" mode. The listener polls again
  immediately after processing a full page of events, and only sleeps
  `pollIntervalMs` when a poll returns no new events. This reduces latency for
  high-activity contracts without hammering the RPC during quiet periods.

```ts
const listener = new HorizonListener({
  eventSource,
  onEvent: async (event) => { /* ... */ },
  mode: 'stream',      // or 'poll' (default)
  pollIntervalMs: 5000, // sleep duration during quiet periods
});
```

## Reconnect / backoff behavior

If `eventSource.getEvents(...)` throws (RPC unreachable, rate-limited, cursor
expired, etc.), `HorizonListener` does not crash: it logs a warning, waits an
exponentially increasing backoff delay (see `computeBackoffDelayMs` in
`src/backoff.ts`, capped at 30s by default with jitter), and retries. The
retry counter resets to zero after any subsequent successful poll. If
`maxRetries` consecutive failures are exceeded (default 10), `start()`
rejects so the caller knows the listener gave up — in a real deployment a
process manager would be responsible for restarting the process.

Individual `onEvent` handler errors are caught and logged without stopping
the polling loop, so one bad event doesn't take down the whole listener.

## Logging

All logging is routed through an injectable `Logger` interface with a default
console-backed implementation. Log levels are used semantically:

- **debug** — Cursor advancement and other low-level operational details
- **info** — Successful event reception (one log per event received)
- **warn** — Recoverable poll failures with automatic retry (e.g., RPC unreachable, rate-limited)
- **error** — Handler errors and critical listener failures

Pass a custom `Logger` instance to `HorizonListener` options to customize
output (e.g., to route to a production logging service).

## Links

- [Root README](../README.md)
- [`compliance-primitives`](https://github.com/stellar-compliance-kit/compliance-primitives) —
  the on-chain `denylist-gate` and `allowlist-token` Soroban contracts this
  package listens to events from.
