# SEP-10 Troubleshooting Guide

This guide maps every error code surfaced by the SEP-10 authentication flow to its likely causes, diagnostic steps, and fixes. It covers:

- [`Sep10ErrorCode`](#sep10errorcode) — errors raised by the SEP-10 server / challenge validation layer.
- [`VerifyErrorCode`](#verifyerrorcode) — errors raised by the client-side `verifyChallenge` helper.
- [`Sep10ClientError`](#sep10clienterror) — errors raised by the `Sep10Client` wrapper.

For the general error-handling conventions used throughout this package (error shapes, `code`/`message`/`details` fields, logging expectations), see [`ERROR_HANDLING_CONVENTIONS.md`](../ERROR_HANDLING_CONVENTIONS.md).

---

## How errors are classified

### Server-side: `Sep10ErrorCode`

Server-side errors are produced directly by the SEP-10 endpoint handlers and challenge validation logic. Each error carries a stable `code` string (one of the `Sep10ErrorCode` values below) plus a human-readable `message`. Clients should branch on `code`, never on `message`.

### Client-side: `classifyError` in `src/verify.ts`

The `verifyChallenge` helper does not receive structured error codes from every failure path — some failures originate in the Stellar SDK, the network layer, or the challenge transaction parser, and arrive as plain `Error` messages. To give callers a stable contract, `classifyError` inspects the raw error message (and, where available, the error's `name`/`response` fields) and maps it to a `VerifyErrorCode`.

Operators debugging a `VerifyErrorCode` should therefore **look at the original SDK message** that `classifyError` matched against. The mapping is message-pattern based, so:

- A message that matches no known pattern is classified as `UNKNOWN`. If you see `UNKNOWN`, capture the raw message — it usually indicates an SDK upgrade changed wording, or a genuinely new failure mode.
- Because matching is pattern-based, an SDK version bump can silently reclassify an error. Pin your `@stellar/stellar-sdk` version and re-run your integration tests after upgrading.
- When reporting a bug, include both the `VerifyErrorCode` **and** the raw underlying message so the pattern can be corrected.

The table below lists the codes `classifyError` can emit and the typical raw messages that produce them.

---

## `Sep10ErrorCode`

| Code | Likely causes | Diagnostic steps | Fix |
| --- | --- | --- | --- |
| `missing_token` | No `Authorization` header sent; header present but empty; proxy stripped the header. | Log incoming headers at the edge. Confirm the client sends `Authorization: Bearer <token>`. Check reverse-proxy / API-gateway config for header stripping. | Send the JWT returned by the challenge endpoint in the `Authorization: Bearer` header. Whitelist the header in your proxy. |
| `malformed_token` | Token is not a well-formed JWT (wrong number of segments, bad base64url, truncated copy/paste). | Decode the token at [jwt.io](https://jwt.io) or with `jose`. Check for whitespace/newlines introduced by env vars or config files. | Re-issue the token from the challenge endpoint. Trim whitespace. Ensure the client stores the token verbatim. |
| `token_too_large` | Oversized JWT — usually caused by stuffing large custom claims or a huge `client_domain`/memo into the token. | Inspect token length and decoded payload size. Compare against the configured max token size. | Reduce claim size; move large data out of the token. If legitimately needed, raise the configured limit. |
| `invalid_token` | Signature verification failed; wrong signing key; token signed by a different server; clock skew beyond `exp`/`nbf` tolerance. | Verify the token against the server's current `SIGNING_KEY`. Check `iss`/`aud`/`exp` claims. Compare server clocks. | Ensure the server signs with the key clients verify against (rotate keys carefully). Fix clock skew (NTP). Re-issue the token. |
| `token_revoked` | Token invalidated (logout, key rotation, account deauthorized) but client still presents it. | Check the revocation store / deny-list for the token's `jti`. Correlate with key-rotation events. | Client should discard the token and re-run the challenge flow. Investigate why a revoked token is still in use (caching, long-lived storage). |
| `rate_limit_exceeded` | Too many challenge or token requests from one IP/account within the window. | Inspect rate-limiter logs and counters keyed by IP/account. Check for retry storms or a misbehaving client. | Back off and retry with jitter. Raise limits for legitimate high-volume clients. Fix client retry loops. |
| `missing_account` | Challenge request omitted the `account` parameter, or it was empty. | Log the request body/query. Confirm the client sends `account`. | Send a valid Stellar account ID (`G...`) as `account`. |
| `invalid_account` | `account` is not a valid Stellar public key (bad checksum, wrong length, wrong prefix, typo). | Validate with `StrKey.isValidEd25519PublicKey(account)`. | Correct the account ID. Ensure it is a `G...` ed25519 public key, not a secret (`S...`) or muxed (`M...`) address unless explicitly supported. |
| `invalid_home_domain` | `home_domain` parameter is malformed (invalid hostname, scheme included, trailing dot issues). | Log the raw `home_domain`. Validate against hostname rules (no scheme, no path). | Send a bare hostname (e.g. `example.com`), not a URL. |
| `client_domain_unsupported` | Client sent `client_domain` but the server is not configured to accept it. | Check server config for the client-domain allow-list / feature flag. | Either enable client-domain support on the server or stop sending `client_domain`. |
| `invalid_client_domain` | `client_domain` is malformed or not on the allow-list. | Compare the supplied domain against the configured allow-list. Validate hostname format. | Use an allow-listed, well-formed hostname. Update the allow-list if the domain is legitimate. |
| `invalid_memo` | `memo` is not a valid integer, is out of range, or is of an unsupported memo type. | Log the raw memo and its type. Check against SEP-10 memo constraints (unsigned 64-bit integer). | Send a valid unsigned 64-bit integer memo, or omit it. |
| `invalid_domain` | The `home_domain`/domain in the challenge does not match the server's configured domain, or the domain fails validation. | Compare the challenge domain with the server's configured `HOME_DOMAIN`. Check DNS/TLS for the domain. | Align the challenge domain with the server config. Fix DNS/TLS. |
| `missing_transaction` | Challenge request omitted the `transaction` parameter (or it was empty) when submitting a signed challenge. | Log the request body. Confirm the client posts the signed XDR. | Include the signed challenge envelope XDR in `transaction`. |
| `transaction_too_large` | Signed challenge XDR exceeds the configured maximum size — often from extra operations or large memo/manage-data. | Measure the base64 XDR length. Inspect the envelope for unexpected operations. | Reduce envelope size; strip unnecessary operations. Raise the limit only if justified. |
| `invalid_transaction` | Challenge XDR is unparseable, not a valid `TransactionEnvelope`, wrong network passphrase, wrong source account, missing/invalid time bounds, or signature verification failed. | Decode the XDR with the Stellar SDK. Verify network passphrase, source account, sequence, time bounds, and signatures against the server's `SIGNING_KEY`. | Rebuild the challenge from the server's response without modification. Sign with the correct key and network. Ensure the envelope is unmodified. |

---

## `VerifyErrorCode`

These codes are emitted by `verifyChallenge` (via `classifyError`). The "raw message to look for" column shows the SDK/underlying messages that `classifyError` matches to produce each code.

| Code | Raw message to look for | Likely causes | Diagnostic steps | Fix |
| --- | --- | --- | --- | --- |
| `INVALID_SERVER_ACCOUNT_ID` | Messages indicating the server account ID is invalid / not a valid public key. | `serverAccountID` option is malformed, empty, or not a `G...` ed25519 key. | Validate the option with `StrKey.isValidEd25519PublicKey`. | Pass a valid `G...` server account ID matching the challenge source account. |
| `INVALID_OPTIONS` | Messages indicating missing/invalid options (e.g. missing `networkPassphrase`, `domain`, or `serverAccountID`). | Required options omitted or of the wrong type. | Log the options object passed to `verifyChallenge`. Check each required field. | Supply all required options with correct types. See the `verifyChallenge` signature in `src/verify.ts`. |
| `CHALLENGE_EXPIRED` | Messages mentioning expired time bounds / challenge outside its valid window. | Challenge `maxTime`/`minTime` window elapsed; client clock skew; slow round-trip. | Decode the challenge and compare `timeBounds` to the current time. Check client clock. | Re-request a fresh challenge and submit promptly. Fix client clock skew (NTP). |
| `WRONG_SIGNER` | Messages indicating the signer does not match / unexpected signer / signature verification failed for the signer. | Challenge signed by the wrong key; client signed with a different account than the challenge source; extra signers. | Decode the envelope and inspect `signatures` and the signer key. Compare against the expected client account. | Sign with the account that owns the challenge source. Remove stray signatures. |
| `WRONG_DOMAIN` | Messages indicating the challenge domain / home domain does not match the expected domain. | `domain` option does not match the challenge's `home_domain`/`web_auth_domain`; server misconfigured. | Compare the `domain` option to the challenge's manage-data / home domain value. | Pass the correct `domain`; align server and client configuration. |
| `INVALID_CHALLENGE` | Messages indicating the challenge transaction is malformed, has wrong structure, wrong network, wrong sequence, or missing required operations. | Envelope tampered with; wrong network passphrase; not a SEP-10 challenge; wrong source account. | Decode the XDR; verify network passphrase, source account, sequence `0`, time bounds, and the manage-data operation. | Use the challenge exactly as returned by the server. Verify network passphrase matches. Do not modify the envelope. |
| `UNKNOWN` | Any message not matching a known pattern. | SDK version change altered wording; genuinely new failure mode; non-`Error` thrown value. | Capture the raw error message, `name`, and stack. Check the installed `@stellar/stellar-sdk` version. | Report the raw message so the `classifyError` pattern can be updated. As a workaround, inspect the raw error directly. |

> **Note on `classifyError`:** Because classification is message-pattern based, always log the **raw** underlying error alongside the resulting `VerifyErrorCode`. If an SDK upgrade changes message wording, previously classified errors may fall through to `UNKNOWN`. Keep integration tests that assert on `VerifyErrorCode` and run them after dependency upgrades.

---

## `Sep10ClientError`

The `Sep10Client` wrapper (see [`README.md`](../README.md)) raises `Sep10ClientError` for failures in the client orchestration layer — before or around the raw SEP-10/verify calls. These wrap or precede the codes above.

| Code | Likely causes | Diagnostic steps | Fix |
| --- | --- | --- | --- |
| `NETWORK_ERROR` | Challenge endpoint unreachable; DNS failure; TLS error; timeout; connection reset. | Check connectivity to the server's `web_auth_endpoint`. Inspect TLS certs and DNS. Review timeout settings. | Fix network/DNS/TLS. Increase timeout for slow networks. Retry with backoff. |
| `HTTP_ERROR` | Server returned a non-2xx response (4xx/5xx) that is not a structured SEP-10 error. | Log the HTTP status and response body. Check server logs for the corresponding request. | Address the underlying server error. For 5xx, retry with backoff; for 4xx, fix the request. |
| `INVALID_RESPONSE` | Server response is missing required fields (`transaction`, `network_passphrase`) or is not valid JSON. | Log the raw response body. Validate against the SEP-10 challenge response schema. | Fix the server to return a conformant response. Ensure content-type is JSON. |
| `SIGNING_ERROR` | Client failed to sign the challenge — missing/invalid keypair, signing threw. | Verify the keypair is present and valid. Check that the keypair matches the account. | Provide a valid `Keypair`. Ensure the signing key corresponds to the authenticated account. |
| `VERIFICATION_ERROR` | `verifyChallenge` failed; wraps a `VerifyErrorCode`. | Inspect the wrapped `cause`/`details` for the underlying `VerifyErrorCode` and raw message. | Resolve using the `VerifyErrorCode` table above. |
| `CONFIGURATION_ERROR` | Client constructed with missing/invalid options (e.g. no `serverAccountID`, no `networkPassphrase`, no endpoint). | Log the constructor options. | Supply all required options. See `Sep10Client` constructor in `README.md`. |

> When a `Sep10ClientError` wraps another error, the underlying `VerifyErrorCode` (or `Sep10ErrorCode`) is available on the error's `cause`/`details`. Always surface both the wrapper code and the underlying code in logs.

---

## Quick reference: where to look first

| Symptom | Start here |
| --- | --- |
| `401` with `missing_token` / `malformed_token` | Header handling, proxy config, token storage. |
| `401` with `invalid_token` / `token_revoked` | Signing key, clock skew, revocation store. |
| `400` on challenge request | `missing_account`, `invalid_account`, `invalid_home_domain`, `invalid_client_domain`, `invalid_memo`. |
| `400` on challenge submission | `missing_transaction`, `transaction_too_large`, `invalid_transaction`. |
| `429` | `rate_limit_exceeded` — back off, review limits. |
| Client throws `VERIFICATION_ERROR` | The wrapped `VerifyErrorCode` table. |
| Client throws `UNKNOWN` verify code | Capture raw SDK message; check SDK version. |

---

## Reporting issues

When filing a bug, include:

1. The error `code` (and, for `Sep10ClientError`, the wrapped code).
2. The **raw** underlying message that `classifyError` matched against.
3. The installed `@stellar/stellar-sdk` version.
4. The relevant request/response (redact secrets and tokens).

This lets maintainers correct the `classifyError` patterns and keep the mapping accurate across SDK upgrades.