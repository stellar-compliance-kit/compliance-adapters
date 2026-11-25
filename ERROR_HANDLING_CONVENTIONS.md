# Error-Handling Conventions

This document describes the error-handling conventions across the compliance-adapters packages and provides guidance for consumers on what to expect.

## Overview

The three packages (`sep10-auth`, `sanctions-oracle`, `horizon-listener`) currently use different error-handling approaches appropriate to their use cases:

- **sep10-auth**: Returns result objects with error details
- **sanctions-oracle**: CLI uses `process.exitCode` + thrown errors; library functions may throw
- **horizon-listener**: Logs and continues for recoverable errors; throws for unrecoverable errors

## Package-Specific Conventions

### sep10-auth

**Pattern**: Result objects with explicit error fields

**Rationale**: As an authentication library, consumers need to distinguish between valid/invalid authentication without exception handling overhead.

**API Contract**:
```typescript
export interface VerifyResult {
  valid: boolean;
  address: string;
  error?: string;
}
```

**Behavior**:
- `verifyChallenge` returns a result object; errors are caught internally and returned in the `error` field; it never throws
- `generateChallenge` returns a `GeneratedChallenge` object on success; it **throws `InvalidClientAddressError`** when `clientAddress` fails Ed25519 public-key validation — it does not return a result object with a `valid` field
- Middleware translates `verifyChallenge` result objects to HTTP responses (401 status with error reason)

**Consumer Expectations**:
- For `verifyChallenge`: check `result.valid` before using `result.address`; inspect `result.error` for validation failure details; no try/catch needed
- For `generateChallenge`: wrap calls in try/catch and handle `InvalidClientAddressError` for invalid input; on success, use the returned `GeneratedChallenge` directly

**Example (verifyChallenge — result object, never throws)**:
```typescript
const result = verifyChallenge(signedXDR, options);
if (!result.valid) {
  console.error('Auth failed:', result.error);
  return;
}
console.log('Authenticated as:', result.address);
```

**Example (generateChallenge — throws on invalid input)**:
```typescript
import { generateChallenge, InvalidClientAddressError } from '@compliance-adapters/sep10-auth';

try {
  const challenge = generateChallenge(clientAddress, serverKeypair, options);
  // On success: challenge.transactionXDR, challenge.networkPassphrase, challenge.expiresAt
  sendToClient(challenge.transactionXDR);
} catch (err) {
  if (err instanceof InvalidClientAddressError) {
    // clientAddress failed Ed25519 public-key validation
    return res.status(400).json({ error: err.message });
  }
  throw err; // re-throw unexpected errors
}
```

### sanctions-oracle

**Pattern**: Mixed approach - CLI uses exit codes, library functions may throw

**Rationale**: The package serves dual purposes: a CLI tool and a library for programmatic use.

**CLI Behavior**:
- Uses `process.exitCode = 1` to indicate failure
- Errors are logged to stderr via `console.error`
- Top-level error handler: `runCli().catch((err) => { console.error(err); process.exitCode = 1; })`
- Validates required flags before execution; sets exit code and returns early on validation errors

**Library Behavior**:
- `syncSanctionsToDenylist()`: May throw from provider implementations or writer operations
- `SanctionsProvider.checkAddress()`: Returns `{ flagged: boolean, source: string }` - does not throw
- `CsvSanctionsProvider`: Never throws — a missing/unreadable CSV file, a malformed row, or an invalid address is logged via `console.warn` and skipped; affected addresses are simply treated as unflagged. A duplicate address with differing sources is aggregated (sources joined with `,`) rather than silently overwritten.
- `RpcDenylistWriter.addToDenylist()`: May throw on RPC/network failures

**Logging Convention**:
- `CliArgs.secretKey` is sensitive; never log the raw `CliArgs` object. Use
  `toSafeLogString(args)` (from `sync.ts`), which masks `secretKey`, in any
  debug logging of parsed args.

**Consumer Expectations**:
- **CLI users**: Check `process.exitCode` after execution; stderr contains error details
- **Library users**: Wrap `syncSanctionsToDenylist` in try/catch; provider implementations should not throw
- Provider implementations should return result objects, not throw

**Example (Library)**:
```typescript
try {
  const result = await syncSanctionsToDenylist({ provider, addresses, writer });
  console.log(`Synced ${result.written.length} addresses`);
} catch (err) {
  console.error('Sync failed:', err);
  // Handle error appropriately
}
```

### horizon-listener

**Pattern**: Context-dependent - logs and continues for recoverable errors, throws for unrecoverable errors

**Rationale**: As a long-running event listener, it should be resilient to transient failures but fail fast for fatal errors.

**Recoverable Errors** (logged, continue):
- Event polling failures: logged with warning, retry with exponential backoff
- `onEvent` handler errors: logged with error, processing continues for subsequent events
- These errors do not stop the listener

**Unrecoverable Errors** (thrown):
- Max retries exceeded: throws error after `maxRetries` consecutive polling failures
- Webhook HTTP errors: `HttpWebhookSender.send()` throws on non-OK responses
- These errors should propagate to the caller to handle shutdown/restart

**Logging**:
- Uses injected `Logger` interface (defaults to console)
- Error messages are prefixed with `horizon-listener:` for easy filtering
- Logs include context (attempt number, cursor, event details)

**Consumer Expectations**:
- Inject a custom logger for production use (structured logging, etc.)
- Wrap `listener.start()` in try/catch for unrecoverable errors
- `onEvent` handlers should handle their own errors or use try/catch internally
- Webhook failures will throw; handle with retry logic or fallback

**Example**:
```typescript
const listener = new HorizonListener({
  eventSource,
  onEvent: async (event) => {
    try {
      await processEvent(event);
    } catch (err) {
      // Log but don't throw - listener will continue
      console.error('Event processing failed:', err);
    }
  },
  logger: myStructuredLogger,
});

try {
  await listener.start();
} catch (err) {
  console.error('Listener failed unrecoverably:', err);
  // Handle shutdown/restart
}
```

## Shared Result Helpers (`@compliance-adapters/shared`)

To reduce the drift between packages, `@compliance-adapters/shared` now exports a
small, dependency-free `Result` type plus helpers:

```typescript
import { ok, err, isOk, isErr, type Result } from '@compliance-adapters/shared';

type ParseError = { code: 'EMPTY' | 'MALFORMED'; message: string };

function parseAddress(raw: string): Result<string, ParseError> {
  if (raw.trim() === '') {
    return err({ code: 'EMPTY', message: 'address is empty' });
  }
  if (!/^G[A-Z2-7]{55}$/.test(raw)) {
    return err({ code: 'MALFORMED', message: 'address is not a valid Stellar account' });
  }
  return ok(raw);
}

const result = parseAddress(input);
if (isErr(result)) {
  console.error(result.error.code, result.error.message);
} else {
  console.log('Parsed:', result.value);
}
```

**API**:
- `Result<T, E>` — discriminated union of `{ ok: true; value: T }` and `{ ok: false; error: E }`
- `ok(value)` — constructs a success result
- `err(error)` — constructs a failure result
- `isOk(result)` / `isErr(result)` — type guards that narrow the union

**Conventions**:
- Use `Result` for expected, recoverable failures (validation, provider responses,
  parsing). Keep `throw` for programmer errors and truly unrecoverable conditions.
- Choose a concrete, machine-readable error type (e.g. a `{ code, message }` object
  or a package-specific error class) rather than `string` where consumers need to
  branch on the failure kind.
- Do not mix patterns within a single function: either return a `Result` or throw,
  and document which in JSDoc.
- `Result` is a plain object, so it serializes cleanly and is safe to log.

**Recommended for new code**: prefer `Result` over ad-hoc `{ valid, error }` shapes
or bare `boolean` returns for any new API surface in any package.

### Pilot Adoption: sanctions-oracle

`sanctions-oracle` is the pilot consumer. Its library-facing helpers that
previously signalled failure by throwing or by returning loosely-typed objects now
return `Result` values, so callers can branch on `isOk`/`isErr` without try/catch:

```typescript
import { isErr } from '@compliance-adapters/shared';
import { syncSanctionsToDenylist } from '@compliance-adapters/sanctions-oracle';

const result = await syncSanctionsToDenylist({ provider, addresses, writer });
if (isErr(result)) {
  console.error('Sync failed:', result.error);
} else {
  console.log(`Synced ${result.value.written.length} addresses`);
}
```

Notes on the pilot:
- The CLI entry point is unchanged: it still sets `process.exitCode` and logs to
  stderr. It simply inspects the `Result` returned by the library layer.
- `SanctionsProvider.checkAddress()` keeps its `{ flagged, source }` shape for now;
  new provider methods should return `Result`.
- Existing throwing call sites remain supported during the transition; the
  `Result`-returning variants are additive.

### Guidance for Other Packages

- **sep10-auth**: `verifyChallenge` already returns a result-like object. New
  functions should return `Result<T, E>`; migrating `VerifyResult` is a breaking
  change and should be done in a major release with a deprecation window.
- **horizon-listener**: keep the resilience-first model (log-and-continue for
  transient errors, throw for fatal ones). `Result` is appropriate for pure
  helpers such as event parsing or webhook payload validation, not for the
  long-running `start()` loop.
- **Migration checklist**:
  1. Add `@compliance-adapters/shared` as a dependency.
  2. Introduce `Result`-returning variants alongside existing APIs (additive first).
  3. Update internal call sites and tests to use `isOk`/`isErr`.
  4. Document the change in this file and in the package README.
  5. Remove the legacy shape in the next major version.

## Alignment Recommendations

### Current State

The three packages use different error-handling approaches because they serve different purposes:

1. **sep10-auth**: Library API - result objects are appropriate for validation logic
2. **sanctions-oracle**: Dual-purpose (CLI + library) - exit codes for CLI, throws for library is appropriate
3. **horizon-listener**: Long-running service - logging+continuing for transient errors, throwing for fatal errors is appropriate

### Recommended Alignments

While the current approaches are context-appropriate, the following alignments would improve consistency:

#### 1. Standardize Error Message Prefixes

**Issue**: Only horizon-listener prefixes error messages (`horizon-listener:`)

**Alignment**: Add package prefixes to all error messages:
- `sep10-auth:` prefix for validation errors
- `sanctions-oracle:` prefix for sync/RPC errors
- `horizon-listener:` (already implemented)

#### 2. sanctions-oracle: Separate CLI and Library Error Handling

**Issue**: `CsvSanctionsProvider` threw in constructor, making it harder to use as a library (resolved — see Implementation Status below)

**Alignment**: 
- Keep CLI exit code behavior for CLI usage
- Change provider constructors to not throw; defer validation to `checkAddress()` calls
- Return result objects from provider methods consistently

#### 3. horizon-listener: Document Error Recovery Strategy

**Issue**: Not clear which errors are recoverable vs unrecoverable

**Alignment**:
- Document in JSDoc which methods may throw
- Document retry/backoff behavior for polling failures
- Clarify that `onEvent` errors are logged but don't stop the listener

#### 4. Common Error Types (Optional Future Enhancement)

**Alignment**: Consider defining common error types across packages:
```typescript
export class ComplianceAdapterError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}
```

This would allow consumers to catch errors by type rather than string matching.

**Decision (2026-09-24)**: Defer introducing a shared `ComplianceAdapterError`
base type for now. The three packages expose intentionally different contracts
(result-object validation in `sep10-auth`, CLI/library split in
`sanctions-oracle`, and resilience-first listener behavior in
`horizon-listener`), so forcing a shared throwable type today would add API
surface without reducing current integration friction. Revisit when at least
two packages need a shared machine-readable error contract in practice.

## Summary for Consumers

| Package | Primary Pattern | Throws? | Consumer Action |
|---------|----------------|---------|-----------------|
| sep10-auth (`verifyChallenge`) | Result objects | No | Check `valid` field |
| sep10-auth (`generateChallenge`) | Returns `GeneratedChallenge` or throws | Yes (`InvalidClientAddressError`) | Use try/catch for invalid input |
| sanctions-oracle (CLI) | Exit codes | No (caught) | Check `process.exitCode` |
| sanctions-oracle (lib) | Throws | Yes | Use try/catch |
| horizon-listener | Logs + throws | Context-dependent | Catch `start()`, log `onEvent` errors |
| any package (new code) | `Result`/`ok`/`err` from `@compliance-adapters/shared` | No | Branch on `isOk`/`isErr` |

## Implementation Status

- [x] Add error message prefixes to sep10-auth
- [x] Add error message prefixes to sanctions-oracle
- [x] Refactor CsvSanctionsProvider to not throw in constructor
- [x] Add JSDoc documentation for throwing methods in horizon-listener
- [x] Decide on common error types roadmap item (deferred; see decision note above)
- [x] Add `Result`/`ok`/`err`/`isOk`/`isErr` helpers to `@compliance-adapters/shared`
- [x] Adopt `Result` in sanctions-oracle as pilot
- [ ] Migrate sep10-auth `VerifyResult` to `Result` (next major)
