# sanctions-oracle Helm chart

Reference Kubernetes deployment of the `sanctions-oracle` sync job as a
CronJob. It renders:

- a `CronJob` with `concurrencyPolicy: Forbid` so a slow sync cannot overlap
  the next tick;
- a `ConfigMap` with non-secret RPC/network settings and the addresses file
  mounted at `/etc/sanctions-oracle/addresses.json`;
- a `Secret` holding the signing key (or references an existing secret via
  `existingSecret`).

```sh
helm install sanctions-oracle ./charts/sanctions-oracle \
  --set config.contractId=CABCDEF... \
  --set secret.SANCTIONS_ORACLE_SECRET_KEY=SABCDEF...
```

Use a Kubernetes secret manager (e.g. External Secrets Operator) and
`existingSecret` in production rather than passing keys with `--set`.

Key values (see [`values.yaml`](./values.yaml) for all options):

| Value | Description |
|---|---|
| `cronjob.schedule` | Cron schedule, default every 15 minutes. |
| `cronjob.extraArgs` | Extra CLI arguments, e.g. `[--reconcile, --denylist-snapshot, /var/lib/sanctions-oracle/denylist.json]`. |
| `config.addresses` | JSON array of Stellar addresses to screen. |
| `config.rpcUrl` / `config.networkPassphrase` / `config.contractId` | Soroban connection settings. |
| `secret.*` | Secret keys injected as environment variables. |
| `existingSecret` | Name of a pre-created Secret, disables the generated one. |

CI runs `helm lint charts/sanctions-oracle` on every pull request.
