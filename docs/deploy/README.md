# Scheduling `sanctions-oracle` syncs

Sync is meant to run on a schedule. Both examples below run the
`compliance-adapters sync-sanctions` CLI, prevent overlapping runs, and mount
the signing secret as a file (never as a CLI flag, which leaks via `ps` and
shell history).

| Example | Overlap prevention | Secret handling |
| --- | --- | --- |
| [`kubernetes/sanctions-sync-cronjob.yaml`](./kubernetes/sanctions-sync-cronjob.yaml) | `concurrencyPolicy: Forbid` | Secret volume, mode `0400` |
| [`systemd/sanctions-sync.service`](./systemd/sanctions-sync.service) + [`.timer`](./systemd/sanctions-sync.timer) | `Type=oneshot` (timer never starts a second instance) | `LoadCredential=` |

## Validate

```sh
kubectl apply --dry-run=client -f docs/deploy/kubernetes/sanctions-sync-cronjob.yaml
systemd-analyze verify docs/deploy/systemd/sanctions-sync.service docs/deploy/systemd/sanctions-sync.timer
```

## Install (systemd)

```sh
sudo cp docs/deploy/systemd/sanctions-sync.* /etc/systemd/system/
sudo install -m 0400 -o root /path/to/secret-key /etc/sanctions-oracle/secret-key
sudo systemctl daemon-reload && sudo systemctl enable --now sanctions-sync.timer
```

Tip: run once with `--dry-run` first to check the fee estimate and the planned writes.

## `sep10-auth` rate limiter: trust proxy

The `sep10-auth` rate limiter's default key generator uses `req.ip`. Behind a
load balancer or reverse proxy, `req.ip` is the proxy's address unless the app
is told to trust the proxy's forwarding headers. Without that, **every client
shares one IP and gets rate limited together** — one noisy client can lock out
everyone else.

Configure trust proxy so `req.ip` reflects the real client address. Only trust
proxies you control; trusting all hops (`true`) lets clients spoof `X-Forwarded-For`.

### Express

```js
import express from 'express';
import { sep10Auth } from '@stellar/sep10-auth';

const app = express();

// Trust the first hop (your load balancer / ingress).
// Use a specific IP/CIDR or hop count in production, e.g. '10.0.0.0/8' or 1.
app.set('trust proxy', 1);

app.use(sep10Auth({ /* ... */ }));
```

### Fastify

```js
import Fastify from 'fastify';
import { sep10Auth } from '@stellar/sep10-auth';

const app = Fastify({
  // Trust the first hop (your load balancer / ingress).
  // Use a specific IP/CIDR or hop count in production, e.g. '10.0.0.0/8' or 1.
  trustProxy: 1,
});

await app.register(sep10Auth, { /* ... */ });
```

If you cannot configure trust proxy, supply a custom key generator that derives
the client identity from a header you control instead of relying on `req.ip`.
