/**
 * Injectable logger, mirroring `horizon-listener`'s `Logger` interface.
 * Unlike `horizon-listener`, this package has no default console-based
 * implementation: sep10-auth forbids `console.*` calls (see the repo's
 * eslint config), so when no logger is supplied, nothing is logged.
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}
