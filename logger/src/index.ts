/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Minimal structured-logging interface shared across all compliance-adapter
 * packages.  Any object that satisfies this shape — console, pino, winston,
 * a test spy, etc. — can be injected wherever a `Logger` is accepted.
 *
 * The variadic `...args: unknown[]` signature intentionally matches the
 * `console.*` family so consumers can pass `console` directly without
 * wrapping it.
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Default logger that delegates to the global `console`.
 * Suitable for production use when no custom logger is provided.
 */
export const consoleLogger: Logger = {
  debug: (...args: unknown[]) => console.debug(...args),
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

/**
 * No-op logger that silences all output.
 * Useful in tests that don't want to assert on log output, or in
 * consumers that manage their own logging pipeline externally.
 */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export type RedactorFn = (value: unknown) => unknown;

export interface RedactingLoggerOptions {
  keys?: string[];
  redact?: RedactorFn;
  replacement?: string;
}

function defaultRedact(
  value: unknown,
  keys: Set<string>,
  replacement: string,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => defaultRedact(item, keys, replacement, seen));
  }

  if (value instanceof Date || value instanceof RegExp) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.has(k)) {
      result[k] = replacement;
    } else {
      result[k] = defaultRedact(v, keys, replacement, seen);
    }
  }
  return result;
}

/**
 * Creates a wrapping Logger that automatically redacts sensitive fields
 * from logged objects before delegating to the underlying base Logger.
 *
 * This is the recommended pattern for any logging touching secrets, API keys,
 * or credentials to avoid hand-rolling redaction at each call site.
 *
 * @param base - The target Logger to forward redacted logs to (e.g. `consoleLogger`).
 * @param keysOrOptions - An array of property keys to mask with `[REDACTED]`,
 *   a custom redactor function `(value: unknown) => unknown`, or an options object.
 * @returns A new Logger with redaction applied.
 *
 * @example
 * ```ts
 * const secureLogger = createRedactingLogger(consoleLogger, ['secretKey', 'password', 'token']);
 * secureLogger.info('User auth', { username: 'alice', secretKey: 'S...' });
 * // logs: 'User auth' { username: 'alice', secretKey: '[REDACTED]' }
 * ```
 */
export function createRedactingLogger(
  base: Logger,
  keysOrOptions: string[] | RedactorFn | RedactingLoggerOptions,
): Logger {
  let redactor: RedactorFn;

  if (typeof keysOrOptions === 'function') {
    redactor = keysOrOptions;
  } else if (Array.isArray(keysOrOptions)) {
    const keys = new Set(keysOrOptions);
    redactor = (val) => defaultRedact(val, keys, '[REDACTED]');
  } else {
    const replacement = keysOrOptions.replacement ?? '[REDACTED]';
    if (keysOrOptions.redact) {
      redactor = keysOrOptions.redact;
    } else {
      const keys = new Set(keysOrOptions.keys ?? []);
      redactor = (val) => defaultRedact(val, keys, replacement);
    }
  }

  const redactArgs = (args: unknown[]): unknown[] => args.map(redactor);

  return {
    debug: (...args: unknown[]) => base.debug(...redactArgs(args)),
    info: (...args: unknown[]) => base.info(...redactArgs(args)),
    warn: (...args: unknown[]) => base.warn(...redactArgs(args)),
    error: (...args: unknown[]) => base.error(...redactArgs(args)),
  };
}
