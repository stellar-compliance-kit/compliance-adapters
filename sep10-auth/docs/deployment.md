# Production Deployment Guide: `sep10-auth`

This guide covers running `sep10-auth` in production: secret management, signing key rotation, Redis-backed revocation storage, reverse proxy configuration, rate limiting, and monitoring.

The package is intentionally small and framework-agnostic. Most production concerns are handled by wiring the provided building blocks (`RedisRevocationStore`, `createRateLimiter`, JWT helpers) into your application's server setup.

---

## 1. Secret Management

`sep10-auth` requires two secrets:

| Secret | Purpose | Where it is used |
| --- | --- | --- |
| `SEP10_SERVER_SECRET` | Stellar secret key (`S...`) used to sign SEP-10 challenge transactions | Challenge building / signing |
| JWT HMAC secret | Symmetric key used to sign and verify session JWTs | `sep10-auth/src/jwt.ts` |

### Rules

- **Never commit secrets to source control.** Do not put them in `.env` files that are tracked, Dockerfiles, or CI config. Use your platform's secret manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Kubernetes Secrets with encryption-at-rest, etc.).
- **Inject at runtime.** Read secrets from environment variables populated by the secret manager at process start, or fetch them from the secret manager on boot. Do not bake them into images.
- **Least privilege.** Only the `sep10-auth` service (and the operators who rotate keys) should be able to read these secrets. Scope secret-manager IAM policies to the specific secret ARNs and to the service's workload identity.
- **Separate secrets per environment.** Staging and production must use different server keypairs and different JWT HMAC secrets. Never reuse a production signing key in a lower environment.
- **Generate strong HMAC secrets.** The JWT HMAC secret should be at least 32 random bytes (256 bits), generated with a CSPRNG (e.g. `openssl rand -base64 48`). Treat it with the same care as the Stellar secret key.
- **Rotate on a schedule and on suspicion.** See section 2 for signing keys. The JWT HMAC secret can be rotated independently; plan for a brief overlap where both old and new secrets are accepted for verification if you need zero-downtime rotation (verify with old, sign with new, then retire the old after the max token lifetime).

### Stellar secret key handling

- The `SEP10_SERVER_SECRET` is a full signing key. Anyone with it can sign challenges as your server. Restrict access tightly and audit reads.
- Prefer loading it into memory once at startup and not logging it. Ensure your logger redacts `SEP10_SERVER_SECRET` and any `S...` values.
- The corresponding **public key** (`G...`) is not secret and is what you publish as `serverAccountId` / in your `stellar.toml`.

---

## 2. Signing Key Rotation

The server keypair signs SEP-10 challenges. Wallets verify the challenge transaction's signatures against the server account published in your `stellar.toml` (`SIGNING_KEY` / `ACCOUNTS`) and the `serverAccountId` your app advertises. Rotation must therefore be done in a way that never leaves clients unable to verify a challenge.

### Rotation procedure (overlap-based)

1. **Generate a new keypair** offline or in a secure environment. Store the new secret in the secret manager under a new version/ARN. Do not delete the old secret yet.
2. **Publish both public keys.** Add the new public key (`G...`) to your `stellar.toml` `ACCOUNTS` (and/or `SIGNING_KEY`) so clients accept challenges signed by either key. Keep the old public key listed.
3. **Wait for propagation.** Allow enough time for `stellar.toml` caches and client-side caches to refresh (at minimum several hours; a day is safer). During this window the old key is still the active signer.
4. **Switch the active signer.** Update `SEP10_SERVER_SECRET` to the new secret and update your app's `serverAccountId` / home-domain configuration to the new public key. Restart/redeploy the service. New challenges are now signed with the new key.
5. **Verify.** Confirm new challenges verify against the new public key and that clients still accept them (both keys are still published).
6. **Retire the old key.** After the overlap window (long enough that no in-flight challenge or cached config references the old key), remove the old public key from `stellar.toml` and delete the old secret from the secret manager.

### Configuration to update

- `SEP10_SERVER_SECRET` → new secret.
- `serverAccountId` (the `G...` public key advertised to clients) → new public key.
- Home domain configuration (`HOME_DOMAIN` and the `WEB_AUTH_ENDPOINT` in `stellar.toml`) → ensure it still points at this service and that `stellar.toml` lists both keys during overlap.

### Notes

- Challenges are short-lived, so the overlap only needs to cover the challenge TTL plus client config cache time — but err on the side of a longer overlap.
- If you rotate because a key is **compromised**, skip the graceful overlap: publish the new key, switch immediately, and remove the old key as fast as clients can refresh. Accept that some clients may briefly fail verification.
- Rotating the JWT HMAC secret does not require touching `stellar.toml`; it only affects session tokens (see section 1).

---

## 3. Redis-Backed Revocation Storage

### Why not the in-memory store

`sep10-auth/src/revocation.ts` ships an `InMemoryRevocationStore` for development and tests. It keeps revoked token identifiers in a process-local `Map`/`Set`. In production this is unsafe:

- **Revocations are lost on restart or redeploy.** A token you revoked (e.g. after a logout or suspected compromise) becomes valid again after the process restarts.
- **Revocations are not shared across instances.** If you run more than one replica behind a load balancer, a token revoked on replica A is still accepted by replica B.
- **No durability or auditability.**

Use a shared, durable store. `sep10-auth/examples/redisRevocationStore.ts` provides a `RedisRevocationStore` implementation you can adapt.

### Wiring `RedisRevocationStore`

The example store implements the `RevocationStore` interface from `sep10-auth/src/revocation.ts` (`revoke`, `isRevoked`, `list`). To use it:

1. **Provision Redis** (see HA notes below) and inject its connection URL via the secret manager / environment (e.g. `REDIS_URL`). Treat the URL as a secret if it contains credentials.
2. **Construct the store** with a key prefix unique to this deployment and environment, e.g. `sep10:revoked:prod:`. This prevents collisions if multiple services or environments share a Redis instance.
3. **Set TTLs.** Each revocation entry should expire no later than the maximum lifetime of the tokens it protects. If your JWTs live for `T`, set the revocation key TTL to at least `T` — after that the token is expired anyway and the entry is dead weight. This bounds Redis memory usage. If you support refresh tokens with longer lifetimes, size the TTL to the longest-lived credential.
4. **Pass the store** into your SEP-10 verification path so that `isRevoked` is checked on every authenticated request (or at least on token verification).
5. **`list()` uses `SCAN`.** The example implements `list()` by iterating with `SCAN` (not `KEYS`) over the key prefix, which is safe for production Redis. Avoid `KEYS` in any custom implementation — it blocks the server. If you need `list()` frequently or over large sets, consider maintaining a secondary index (e.g. a sorted set keyed by revocation time) rather than scanning.

### Redis availability and HA

- **Do not run a single Redis instance** for revocation in production. Use a managed Redis (ElastiCache, Memorystore, Azure Cache) or a replicated setup with automatic failover (Sentinel or Redis Cluster).
- **Durability:** enable AOF (`appendfsync everysec`) and/or RDB snapshots so revocations survive a Redis restart. A revocation store that loses data on restart reintroduces the in-memory problem.
- **Fail-closed vs fail-open:** decide what happens if Redis is unreachable during `isRevoked`. For a security-sensitive revocation check, **fail closed** (reject the request / return an auth error) rather than silently accepting tokens. Document this behavior and alert on Redis errors.
- **Connection handling:** use a pooled client, set connect/command timeouts, and configure retries with backoff. Do not let a slow Redis stall every request — bound the timeout and surface errors as auth failures.
- **Isolation:** if Redis is shared, use a dedicated logical database or key prefix and set a `maxmemory` policy that will not evict revocation keys unexpectedly (avoid `allkeys-lru` for a security-critical store; prefer `noeviction` with monitoring, or size memory so eviction never happens).

---

## 4. Reverse Proxy Setup

Run `sep10-auth` behind a reverse proxy / load balancer (nginx, Envoy, an ALB, etc.) that terminates TLS.

### TLS termination

- Terminate TLS at the proxy and forward to the app over a private network. Set `X-Forwarded-Proto: https` so the app knows the original scheme.
- Redirect all plain HTTP to HTTPS at the proxy.
- Ensure the proxy forwards the original `Host` header (or sets `X-Forwarded-Host`) so home-domain / endpoint URLs are correct.

### Trusting `X-Forwarded-For` for the rate limiter

The rate limiter's default `keyGenerator` uses the client IP. Behind a proxy, `req.socket.remoteAddress` is the **proxy's** IP, so all clients would share one bucket. Configure the rate limiter to key on the forwarded client IP:

- Have the proxy set `X-Forwarded-For` (appending the real client IP) and `X-Real-IP`.
- In your `keyGenerator`, read the left-most untrusted entry of `X-Forwarded-For` (or `X-Real-IP`), **only after confirming the request came from a trusted proxy**. Never trust `X-Forwarded-For` from arbitrary clients — an attacker can spoof it to bypass rate limits. Restrict the app to accept forwarded headers only from known proxy addresses, or strip client-supplied `X-Forwarded-For` at the edge and have the proxy set it authoritatively.
- If you run multiple proxy hops, parse the header from the right, skipping trusted proxies, to find the real client.

### `WWW-Authenticate` passthrough

SEP-10 authentication failures return `401` responses with a `WWW-Authenticate` header (per SEP-10). Ensure your proxy:

- **Does not strip or rewrite** `WWW-Authenticate` on `401` responses.
- Does not intercept `401`/`403` and replace the body/headers with its own error page.
- Passes through all response headers from the app, including `RateLimit-*` and `Retry-After` (see section 5).

Also make sure the proxy forwards the request body and headers needed for challenge/verify endpoints and does not buffer or truncate them.

---

## 5. Rate Limiting

`sep10-auth/src/rate-limiter.ts` provides `createRateLimiter`, a middleware-style limiter with configurable `windowMs`, `maxRequests`, `keyGenerator`, and `skip`.

### Configuration

- **`windowMs`**: the sliding/fixed window length. A common choice is `60_000` (1 minute). Shorter windows react faster to bursts; longer windows smooth traffic.
- **`maxRequests`**: requests allowed per key per window. Tune per endpoint. Challenge issuance and token verification are the sensitive paths — set limits low enough to deter abuse but high enough for legitimate wallet retries. Consider separate limiters for challenge vs. verify endpoints.
- **`keyGenerator`**: defaults to client IP. Behind a proxy, override it to use the trusted forwarded client IP (section 4). You can also key on a combination (e.g. IP + home domain) to reduce collateral blocking.
- **`skip`**: return `true` to bypass limiting for specific requests. Use this for **health check endpoints** (e.g. `/healthz`, `/readyz`) so liveness/readiness probes from your orchestrator are never throttled — otherwise probes can fail and cause restarts or traffic being pulled.

### Response headers

When a request is limited, the limiter sets standard headers so clients can back off:

- `RateLimit-Limit` — the `maxRequests` for the window.
- `RateLimit-Remaining` — requests left in the current window.
- `RateLimit-Reset` — seconds until the window resets.
- `Retry-After` — seconds the client should wait before retrying (on `429`).

Ensure your reverse proxy passes these through (section 4). Limited requests should return `429 Too Many Requests`.

### Operational notes

- If you run multiple replicas, an in-process limiter counts per replica. For a global limit, back the limiter with a shared store (e.g. Redis) or enforce coarse limits at the proxy/edge in addition to per-instance limits.
- Log rate-limit rejections (see section 6) so you can distinguish abuse from misconfiguration.

---

## 6. Monitoring

### Logging

- Log structured events for authentication outcomes, including the **error code** from `Sep10ErrorCode` (defined alongside the auth flow). Emit the code as a field (e.g. `error_code=invalid_signature`) rather than only a free-text message, so you can aggregate and alert on it.
- **Never log secrets or tokens.** Redact `SEP10_SERVER_SECRET`, the JWT HMAC secret, full JWTs, and signed challenge XDRs. Log token identifiers (jti) only if needed for revocation correlation, and treat them as sensitive.
- Include request correlation IDs, client IP (from the trusted forwarded header), and home domain.

### Alerts

Set alerts on aggregated error codes and events:

- **`rate_limit_exceeded` spikes** — a sudden rise can indicate abuse/DoS, a misconfigured client retry loop, or a proxy misconfiguration causing all traffic to share one key. Alert on rate and on the ratio of limited to total requests.
- **`token_revoked` spikes** — a burst of revoked-token rejections can indicate a mass logout, a compromised token being replayed, or a bug in revocation TTLs. Investigate.
- **Other `Sep10ErrorCode` values** — alert on sustained increases in signature/verification failures (`invalid_signature`, expired challenges, malformed requests), which can signal client breakage or an attack.
- **Redis errors** — alert on `isRevoked` failures / Redis connection errors, since a fail-closed policy turns these into auth failures.
- **Latency and error rate** on challenge and verify endpoints.

### Health checks

- Expose a liveness endpoint (process is up) and a readiness endpoint (dependencies reachable — notably Redis for revocation, and the ability to reach Horizon if used for account lookups).
- **Exclude health endpoints from rate limiting** via the limiter's `skip` (section 5).
- Readiness should fail if Redis is unreachable so the orchestrator stops routing traffic to a replica that cannot perform revocation checks.
- Keep health checks cheap and side-effect free.

---

## Reference

- `sep10-auth/src/revocation.ts` — `RevocationStore` interface and `InMemoryRevocationStore`.
- `sep10-auth/examples/redisRevocationStore.ts` — `RedisRevocationStore` (key prefix, TTLs, `SCAN`-based `list()`).
- `sep10-auth/src/rate-limiter.ts` — `createRateLimiter` (`windowMs`, `maxRequests`, `keyGenerator`, `skip`).
- `sep10-auth/src/jwt.ts` — JWT signing/verification with the HMAC secret.