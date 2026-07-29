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
