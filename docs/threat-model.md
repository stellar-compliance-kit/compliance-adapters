# Threat Model: Sanctions Sync Pipeline

This document analyses threats specific to the `sanctions-oracle` sync pipeline,
which pulls flagged addresses from a watchlist provider and writes them into a
deployed denylist-gate Soroban contract. It complements [SECURITY.md](../SECURITY.md),
which covers vulnerability disclosure.

## Scope and data flow

```
operator / scheduler
        │  argv + env (SANCTIONS_ORACLE_SECRET_KEY)
        ▼
┌──────────┐   addresses    ┌──────────────┐   signed tx   ┌───────────────────┐
│   CLI    │ ─────────────▶ │ DenylistWriter│ ────────────▶ │ Soroban RPC /      │
│ runCli   │ ◀── results ── │ (RPC writer)  │               │ denylist contract  │
└────┬─────┘                └──────┬────────┘               └───────────────────┘
     │ fetch / screen              │ AuditLogEntry
     ▼                             ▼
┌──────────────┐            ┌─────────────┐
│  Provider    │            │  Audit log  │
│ REST / CSV / │            │ (AuditLogger)│
│ registry     │            └─────────────┘
└──────────────┘
```

**Assets:** integrity of the on-chain denylist; the source-account secret key;
availability of the sync; integrity and completeness of the audit trail.

**Trust boundaries:** operator ↔ CLI process, CLI ↔ provider (network or file),
CLI ↔ Soroban RPC, CLI ↔ audit sink.

## STRIDE by component

Legend: ✅ mitigated · ⚠️ partially mitigated · ❌ open gap.

### 1. CLI (`runCli`, `bin/compliance-adapters.js sync-sanctions`)

| STRIDE | Threat | Status | Mitigation / gap |
| --- | --- | --- | --- |
| Spoofing | An attacker runs the CLI with a stolen key and arbitrary input. | ⚠️ | Relies on host access control and key custody (see Key theft below). |
| Tampering | Flags (`--contract-id`, `--rpc-url`) altered to target an attacker-controlled contract/RPC. | ⚠️ | Required flags are validated for presence only; pin values in deployment config. |
| Repudiation | No record of who ran a sync and with which arguments. | ⚠️ | `toSafeLogString` logs arguments with `secretKey` redacted; no signed run report yet — [#1015](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1015), [#784](https://github.com/stellar-compliance-kit/compliance-adapters/issues/784). |
| Information disclosure | Secret key leaked via `--secret-key` in `ps` output / shell history. | ✅ | `SANCTIONS_ORACLE_SECRET_KEY` env var preferred over the flag; key redacted in logs. |
| Denial of service | Overlapping or replayed runs (cron + manual) race and double-submit. | ⚠️ | Checkpointing (`checkpoint.ts`) and idempotent `add` limit damage; no run lock or scheduler mode — [#1016](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1016). |
| Elevation of privilege | Unbounded sync writes thousands of entries without review. | ❌ | `--dry-run` exists, but no diff/approval gate — [#1012](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1012), [#1014](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1014). |

**Replayed CLI runs.** Re-running a sync with the same input re-submits additions.
Writes are idempotent at the contract level, so the primary impact is fee spend and
duplicate audit entries. A replay with *stale* input after a delisting could re-add
cleared addresses — tracked by reconcile/delisting work in [#1013](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1013).

### 2. Provider (`RestProvider`, `CsvProvider`, `ProviderRegistry`, `RateLimitedProvider`)

| STRIDE | Threat | Status | Mitigation / gap |
| --- | --- | --- | --- |
| Spoofing | DNS/TLS interception impersonates the watchlist API. | ⚠️ | HTTPS base URL expected; no certificate or response pinning. |
| Tampering | **Compromised provider injects arbitrary addresses**, denylisting legitimate users. | ❌ | Addresses are normalised and validated (`StrKey`), but content is trusted; no signed feeds, diff review, or volume threshold — [#1012](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1012), [#1014](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1014). |
| Tampering | Provider silently omits entries so sanctioned addresses are never added. | ⚠️ | Freshness not exposed — [#1019](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1019); cross-provider registry reduces single-source reliance. |
| Repudiation | Cannot prove what the provider returned at sync time. | ⚠️ | `source` recorded per audit entry; raw responses not retained — [#1015](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1015). |
| Information disclosure | Screened addresses sent to a third-party API. | ⚠️ | Inherent to REST screening; prefer bulk/CSV lists where privacy matters. |
| Denial of service | **Slow or hanging provider** stalls the sync. | ✅ | `AbortController` timeout (default 5 s), retry with backoff, `RateLimitedProvider`; results cached per run — cross-run TTL cache in [#1062](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1062). |

### 3. Writer (`createRpcDenylistWriter`)

| STRIDE | Threat | Status | Mitigation / gap |
| --- | --- | --- | --- |
| Spoofing | Malicious RPC returns fake success without submitting. | ⚠️ | Tx hash recorded; no independent confirmation against a second RPC/Horizon. |
| Tampering | Transaction altered in flight. | ✅ | Transactions are signed locally and bound to `--network-passphrase`. |
| Repudiation | Write cannot be attributed to the sync. | ✅ | On-chain tx hash stored in each `AuditLogEntry`. |
| Information disclosure | **Key theft** from process memory, env, or CI secrets. | ⚠️ | Key never logged; no HSM/remote signer support — compromise allows arbitrary denylist edits. Use a dedicated low-balance account with only denylist-admin rights. |
| Denial of service | Fee spikes or RPC outage fail writes. | ⚠️ | Per-address failures reported in `SyncResult.failed`; fee/timeout configurable — [#786](https://github.com/stellar-compliance-kit/compliance-adapters/issues/786); batching — [#788](https://github.com/stellar-compliance-kit/compliance-adapters/issues/788). |
| Elevation of privilege | Stolen key used beyond denylist administration. | ⚠️ | Depends on contract admin model; keep the signer scoped to the denylist contract. |

### 4. Audit log (`AuditLogger`)

| STRIDE | Threat | Status | Mitigation / gap |
| --- | --- | --- | --- |
| Spoofing | Forged audit entries inserted. | ❌ | Entries are unsigned — [#1015](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1015). |
| Tampering | Entries edited or deleted after the fact. | ❌ | Local sink only; no append-only/remote storage — [#1022](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1022). |
| Repudiation | Operator denies a sync occurred. | ⚠️ | Tx hashes can be cross-checked on-chain. |
| Information disclosure | Log exposes screened addresses. | ⚠️ | Addresses are public on-chain anyway; restrict log access. |
| Denial of service | Audit sink failure blocks or silently drops entries. | ⚠️ | Writer failures surface in sync results; alerting — [#1018](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1018). |

## Open gaps

| Gap | Tracking issue |
| --- | --- |
| Provider content is trusted; no diff review before writes | [#1012](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1012) |
| No approval gate for unusually large syncs | [#1014](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1014) |
| Sync reports / audit entries are unsigned | [#1015](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1015) |
| Audit log not stored in tamper-evident remote storage | [#1022](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1022) |
| No run lock / scheduler to prevent overlapping runs | [#1016](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1016) |
| Provider freshness not observable | [#1019](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1019) |
| Delisting / stale-replay handling | [#1013](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1013) |
| No alerting on sync failure | [#1018](https://github.com/stellar-compliance-kit/compliance-adapters/issues/1018) |
| Machine-readable run report | [#784](https://github.com/stellar-compliance-kit/compliance-adapters/issues/784) |

## Operational recommendations

- Supply the key only via `SANCTIONS_ORACLE_SECRET_KEY` from a secret manager; never `--secret-key` in shared environments.
- Use a dedicated signer account whose only privilege is denylist administration.
- Run `--dry-run` and review output before first sync against a new provider.
- Ship audit logs off-host to append-only storage.
