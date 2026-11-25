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
 *
 * @example
 * ```ts
 * import type { Logger } from '@stellar-compliance-kit/logger';
 *
 * // `console` already satisfies the Logger shape.
 * const logger: Logger = console;
 * logger.info('adapter started', { adapter: 'sep12' });
 * ```
 *
 * @example
 * ```ts
 * import type { Logger } from '@stellar-compliance-kit/logger';
 *
 * // A custom logger can be any object with the four level methods.
 * const logger: Logger = {
 *   debug: (...args) => {},
 *   info: (...args) => {},
 *   warn: (...args) => {},
 *   error: (...args) => {},
 * };
 * ```
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  /** Return a child logger with `bindings` prepended to every log line. */
  child?: (bindings: Record<string, unknown>) => Logger;
}

/**
 * Return a child logger bound to `bindings`. Uses `logger.child` when
 * available, otherwise falls back to a wrapper that prepends the bindings
 * object to every call. Nested children merge bindings (inner wins).
 *
 * @example
 * ```ts
 * import { consoleLogger, getChildLogger } from '@stellar-compliance-kit/logger';
 *
 * const requestLogger = getChildLogger(consoleLogger, { requestId: 'abc-123' });
 * requestLogger.info('handling request');
 * // => { requestId: 'abc-123' } handling request
 * ```
 *
 * @example
 * ```ts
 * import { consoleLogger, getChildLogger } from '@stellar-compliance-kit/logger';
 *
 * // Nested children merge bindings; inner keys win.
 * const parent = getChildLogger(consoleLogger, { adapter: 'sep12', requestId: 'a' });
 * const child = parent.child!({ requestId: 'b' });
 * child.warn('retrying');
 * // => { adapter: 'sep12', requestId: 'b' } retrying
 * ```
 */
export function getChildLogger(logger: Logger, bindings: Record<string, unknown>): Logger {
  if (typeof logger.child === 'function') return logger.child(bindings);
  const wrap = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(bindings, ...args);
  const child: Logger = {
    debug: wrap(logger.debug.bind(logger)),
    info: wrap(logger.info.bind(logger)),
    warn: wrap(logger.warn.bind(logger)),
    error: wrap(logger.error.bind(logger)),
    child: (next: Record<string, unknown>) =>
      getChildLogger(logger, { ...bindings, ...next }),
  };
  return child;
}

/** Merge parent and child bindings; child keys win. */
function mergeBindings(
  parent: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return { ...parent, ...next };
}

/** Build a child of `base` that prepends `bindings` to every call. */
function makeBoundChild(
  base: Logger,
  bindings: Record<string, unknown>,
  emit: (level: LogLevel, bindings: Record<string, unknown>, args: unknown[]) => void,
): Logger {
  const child: Logger = {
    debug: (...args: unknown[]) => emit('debug', bindings, args),
    info: (...args: unknown[]) => emit('info', bindings, args),
    warn: (...args: unknown[]) => emit('warn', bindings, args),
    error: (...args: unknown[]) => emit('error', bindings, args),
    child: (next: Record<string, unknown>) =>
      makeBoundChild(base, mergeBindings(bindings, next), emit),
  };
  return child;
}

/**
 * Default logger that delegates to the global `console`.
 * Suitable for production use when no custom logger is provided.
 *
 * @example
 * ```ts
 * import { consoleLogger } from '@stellar-compliance-kit/logger';
 *
 * consoleLogger.info('compliance check passed', { adapter: 'sep12' });
 * ```
 *
 * @example
 * ```ts
 * import { consoleLogger } from '@stellar-compliance-kit/logger';
 *
 * const scoped = consoleLogger.child!({ adapter: 'sep31' });
 * scoped.error('transfer failed');
 * // => { adapter: 'sep31' } transfer failed
 * ```
 */
export const consoleLogger: Logger = {
  debug: (...args: unknown[]) => console.debug(...args),
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
  child: (bindings: Record<string, unknown>) =>
    makeBoundChild(consoleLogger, bindings, (level, b, args) => {
      console[level](b, ...args);
    }),
};

/**
 * No-op logger that silences all output.
 * Useful in tests that don't want to assert on log output, or in
 * consumers that manage their own logging pipeline externally.
 *
 * @example
 * ```ts
 * import { noopLogger } from '@stellar-compliance-kit/logger';
 *
 * // Pass a silent logger in tests.
 * const adapter = createAdapter({ logger: noopLogger });
 * ```
 *
 * @example
 * ```ts
 * import { noopLogger } from '@stellar-compliance-kit/logger';
 *
 * // Children of the no-op logger are also no-ops.
 * noopLogger.child!({ requestId: 'abc' }).info('nothing is emitted');
 * ```
 */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

/**
 * The four log levels supported by {@link createLeveledLogger}, ordered from
 * least to most severe.
 *
 * @example
 * ```ts
 * import type { LogLevel } from '@stellar-compliance-kit/logger';
 *
 * const level: LogLevel = 'warn';
 * ```
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric rank used to compare log levels. Higher = more severe. */
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Wraps a base {@link Logger} and silences any call whose level is below
 * `minLevel`.  Calls at or above `minLevel` are forwarded to the base logger
 * unchanged.
 *
 * This fills the gap between {@link consoleLogger} (emits everything) and
 * {@link noopLogger} (emits nothing), letting operators configure a minimum
 * severity without having to write a custom Logger object from scratch.
 *
 * @example
 * ```ts
 * // Emit info, warn, and error; suppress debug in production.
 * const logger = createLeveledLogger(consoleLogger, process.env.LOG_LEVEL ?? 'info');
 * ```
 *
 * @example
 * ```ts
 * import { consoleLogger, createLeveledLogger } from '@stellar-compliance-kit/logger';
 *
 * const logger = createLeveledLogger(consoleLogger, 'warn');
 * logger.info('suppressed');  // no output
 * logger.warn('emitted');     // => emitted
 * ```
 *
 * @param base     The underlying logger to delegate to when the level passes.
 * @param minLevel The minimum level to emit.  Calls below this level are no-ops.
 * @returns        A new Logger instance; the `base` logger is never mutated.
 */
export function createLeveledLogger(base: Logger, minLevel: LogLevel): Logger {
  const minRank = LOG_LEVEL_RANK[minLevel];
  const emit = (level: LogLevel, args: unknown[]) => {
    if (LOG_LEVEL_RANK[level] >= minRank) base[level](...args);
  };
  const emitBound = (level: LogLevel, bindings: Record<string, unknown>, args: unknown[]) => {
    if (LOG_LEVEL_RANK[level] >= minRank) getChildLogger(base, bindings)[level](...args);
  };
  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    child: (bindings: Record<string, unknown>) =>
      makeBoundChild(base, bindings, emitBound),
  };
}

/**
 * Writable target for {@link jsonLogger}. Only `write` is used.
 *
 * @example
 * ```ts
 * import type { JsonLogStream } from '@stellar-compliance-kit/logger';
 *
 * const lines: string[] = [];
 * const stream: JsonLogStream = { write: (chunk) => lines.push(chunk) };
 * ```
 */
export interface JsonLogStream {
  write(chunk: string): void;
}

function errorToContext(err: Error): Record<string, unknown> {
  return { msg: err.message, stack: err.stack, type: err.name };
}

function argsToRecord(args: unknown[]): { msg: string; context: Record<string, unknown> } {
  if (args.length === 0) return { msg: '', context: {} };
  const [first, ...rest] = args;
  if (first instanceof Error) {
    const base = errorToContext(first);
    const context: Record<string, unknown> = { ...base };
    for (const extra of rest) {
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.assign(context, extra as Record<string, unknown>);
      } else if (extra !== undefined) {
        context.data = context.data ?? [];
        (context.data as unknown[]).push(extra);
      }
    }
    return { msg: String(base.msg), context };
  }
  if (typeof first === 'string') {
    const context: Record<string, unknown> = {};
    for (const extra of rest) {
      if (extra instanceof Error) {
        Object.assign(context, { error: errorToContext(extra) });
      } else if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.assign(context, extra as Record<string, unknown>);
      } else if (extra !== undefined) {
        context.data = context.data ?? [];
        (context.data as unknown[]).push(extra);
      }
    }
    return { msg: first, context };
  }
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const obj = first as Record<string, unknown>;
    const msg =
      typeof obj.msg === 'string'
        ? obj.msg
        : typeof obj.message === 'string'
          ? obj.message
          : JSON.stringify(first);
    const context: Record<string, unknown> = { ...obj };
    for (const extra of rest) {
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.assign(context, extra as Record<string, unknown>);
      }
    }
    return { msg, context };
  }
  return { msg: String(first), context: rest.length > 0 ? { data: rest } : {} };
}

/**
 * Create a JSON structured logger that writes one JSON object per line.
 *
 * Each line has pino-compatible field names: `time` (epoch ms), `level`
 * (level name), `msg` (message string) plus any merged `context` fields.
 * Errors serialize to `{ msg, stack, type }`.
 *
 * @example
 * ```ts
 * import { jsonLogger } from '@stellar-compliance-kit/logger';
 *
 * const logger = jsonLogger({ level: 'info' });
 * logger.info('compliance check passed', { adapter: 'sep12' });
 * // => {"time":1700000000000,"level":"info","msg":"compliance check passed","adapter":"sep12"}
 * ```
 *
 * @example
 * ```ts
 * import { jsonLogger } from '@stellar-compliance-kit/logger';
 *
 * // Capture output with a custom stream instead of stdout.
 * const lines: string[] = [];
 * const logger = jsonLogger({ stream: { write: (chunk) => lines.push(chunk) } });
 * logger.error(new Error('boom'));
 * // lines[0] => {"time":...,"level":"error","msg":"boom","stack":"...","type":"Error"}
 * ```
 *
 * @param options.level  Minimum level to emit (default `'debug'`).
 * @param options.stream Writable target (default `process.stdout`).
 * @returns              A new Logger that emits JSON lines.
 */
export function jsonLogger(options: { level?: LogLevel; stream?: JsonLogStream } = {}): Logger {
  const minLevel = options.level ?? 'debug';
  const minRank = LOG_LEVEL_RANK[minLevel];
  const stream: JsonLogStream =
    options.stream ?? ({ write: (s: string) => process.stdout.write(s) } as JsonLogStream);
  const emit = (level: LogLevel, args: unknown[]): void => {
    if (LOG_LEVEL_RANK[level] < minRank) return;
    const { msg, context } = argsToRecord(args);
    stream.write(JSON.stringify({ time: Date.now(), level, msg, ...context }) + '\n');
  };
  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
  };
}