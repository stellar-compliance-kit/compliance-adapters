/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { AsyncLocalStorage } from 'async_hooks';

/** Minimal view of the active trace context (same shape as `TracingContext`). */
export interface ActiveSpanContext {
  traceId: string;
  spanId: string;
  sampled?: boolean;
}

/** Shared with `@compliance-adapters/tracing` via a global symbol. */
const ACTIVE_SPAN_KEY = Symbol.for('@compliance-adapters/activeSpanContext');

interface ActiveSpanStore {
  getStore(): ActiveSpanContext | undefined;
  enterWith(context: ActiveSpanContext | undefined): void;
  run<T>(context: ActiveSpanContext | undefined, callback: () => T): T;
}

interface ActiveSpanState {
  store: ActiveSpanStore;
  current?: ActiveSpanContext;
}

function activeSpanState(): ActiveSpanState {
  const globalRef = globalThis as unknown as Record<symbol, ActiveSpanState | undefined>;
  if (!globalRef[ACTIVE_SPAN_KEY]) {
    globalRef[ACTIVE_SPAN_KEY] = {
      store: new AsyncLocalStorage<ActiveSpanContext>() as ActiveSpanStore,
      current: undefined,
    };
  }
  return globalRef[ACTIVE_SPAN_KEY]!;
}

/** Read the active span context published by the tracing package. */
export function getActiveSpanContext(): ActiveSpanContext | undefined {
  const state = activeSpanState();
  const scoped = state.store.getStore();
  return scoped !== undefined ? scoped : state.current;
}

/** Publish an active span context (normally done by the tracing package). */
export function setActiveSpanContext(context: ActiveSpanContext | undefined): void {
  activeSpanState().current = context;
}

/** Clear the active span context for the current async execution. */
export function clearActiveSpanContext(): void {
  setActiveSpanContext(undefined);
}

/** Run `callback` with `context` active, restoring the previous context after. */
export function withActiveSpanContext<T>(context: ActiveSpanContext, callback: () => T): T {
  return activeSpanState().store.run(context, callback);
}

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
  /** Return a child logger with `bindings` prepended to every log line. */
  child?: (bindings: Record<string, unknown>) => Logger;
}

/**
 * Return a child logger bound to `bindings`. Uses `logger.child` when
 * available, otherwise falls back to a wrapper that prepends the bindings
 * object to every call. Nested children merge bindings (inner wins).
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
 */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

/** Append active trace context to a log call, if there is one. */
function forwardWithTrace(base: Logger, level: LogLevel, args: unknown[]): void {
  const context = getActiveSpanContext();
  if (!context?.traceId || !context.spanId) {
    base[level](...args);
    return;
  }
  base[level](...args, { traceId: context.traceId, spanId: context.spanId });
}

/**
 * Decorate any logger so every call automatically carries the active trace
 * and span IDs. No IDs are added when no span is active.
 */
export function createTracingLogger(base: Logger): Logger {
  return {
    debug: (...args: unknown[]) => forwardWithTrace(base, 'debug', args),
    info: (...args: unknown[]) => forwardWithTrace(base, 'info', args),
    warn: (...args: unknown[]) => forwardWithTrace(base, 'warn', args),
    error: (...args: unknown[]) => forwardWithTrace(base, 'error', args),
    child: (bindings: Record<string, unknown>) =>
      createTracingLogger(getChildLogger(base, bindings)),
  };
}

/**
 * The four log levels supported by {@link createLeveledLogger}, ordered from
 * least to most severe.
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
 * @param base     The underlying logger to delegate to when the level passes.
 * @param minLevel The minimum level to emit.  Calls below this level are no-ops.
 * @returns        A new Logger instance; the `base` logger is never mutated.
 */
export function createLeveledLogger(base: Logger, minLevel: LogLevel): Logger {
  const minRank = LOG_LEVEL_RANK[minLevel];
  const emit = (level: LogLevel, args: unknown[]) => {
    if (LOG_LEVEL_RANK[level] >= minRank) forwardWithTrace(base, level, args);
  };
  const emitBound = (level: LogLevel, bindings: Record<string, unknown>, args: unknown[]) => {
    if (LOG_LEVEL_RANK[level] >= minRank) {
      forwardWithTrace(getChildLogger(base, bindings), level, args);
    }
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

/** Writable target for {@link jsonLogger}. Only `write` is used. */
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

// ── Sampling ──────────────────────────────────────────────────────────────────

export interface SamplingLoggerOptions {
  /** Probability that a debug call is emitted, in [0, 1]. Defaults to 1. */
  debugSampleRate?: number;
  /** Alias for `debugSampleRate`. */
  sampleRate?: number;
}

function resolveDebugSampleRate(
  rateOrOptions: number | SamplingLoggerOptions,
): number {
  const rate =
    typeof rateOrOptions === 'number'
      ? rateOrOptions
      : (rateOrOptions.debugSampleRate ?? rateOrOptions.sampleRate ?? 1);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`logger: debug sample rate must be in [0, 1], got ${rate}`);
  }
  return rate;
}

/**
 * Wrap a logger so that high-volume `debug` calls are sampled independently
 * per logger. Info, warn, and error calls are always forwarded.
 *
 * @example
 * ```ts
 * const logger = createSampledLogger(consoleLogger, 0.05); // keep 5% of debug logs
 * ```
 */
export function createSampledLogger(
  base: Logger,
  rateOrOptions: number | SamplingLoggerOptions,
): Logger {
  const rate = resolveDebugSampleRate(rateOrOptions);
  const shouldEmit = (level: LogLevel): boolean =>
    level !== 'debug' || rate >= 1 || (rate > 0 && Math.random() < rate);
  const emit = (level: LogLevel, args: unknown[]) => {
    if (shouldEmit(level)) forwardWithTrace(base, level, args);
  };
  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    child: (bindings: Record<string, unknown>) =>
      createSampledLogger(getChildLogger(base, bindings), rateOrOptions),
  };
}

// ── Redaction ─────────────────────────────────────────────────────────────────

/** Value substituted for redacted fields. */
export const REDACTED = '[REDACTED]';

/**
 * Field names that are always redacted, even when no custom paths are given.
 * Matching is case-insensitive on the last path segment.
 */
export const DEFAULT_REDACTED_KEYS = [
  'secret',
  'secretKey',
  'privateKey',
  'apiKey',
  'password',
  'passwd',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'seed',
  'mnemonic',
] as const;

export type RedactorFn = (value: unknown) => unknown;

export interface RedactingLoggerOptions {
  /** Exact field names to redact at any depth, in addition to the defaults. */
  keys?: string[];
  /** Dotted paths to redact. `*` matches one segment, `**` matches any depth. */
  paths?: string[];
  /** Value used in place of redacted fields. Defaults to `[REDACTED]`. */
  replacement?: string;
  /** Custom redactor applied to every log argument (legacy escape hatch). */
  redact?: RedactorFn;
}

function matchesPath(path: string[], pattern: string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  // A bare name matches that field name at any depth.
  if (pattern.length === 1) {
    return path.length > 0 && path[path.length - 1].toLowerCase() === pattern[0].toLowerCase();
  }
  // A leading wildcard allows the remaining pattern to match at any depth,
  // so `*.secret` covers both `user.secret` and `a.b.secret`.
  if (pattern[0] === '*' || pattern[0] === '**') {
    return matchesPath(path, pattern.slice(1)) || (path.length > 0 && matchesPath(path.slice(1), pattern));
  }
  return (
    path.length > 0 &&
    path[0].toLowerCase() === pattern[0].toLowerCase() &&
    matchesPath(path.slice(1), pattern.slice(1))
  );
}

const DEFAULT_PATTERNS = DEFAULT_REDACTED_KEYS.map((key) => [key]);

/**
 * Deep-clone a logged value, replacing fields whose dotted path matches a
 * configured pattern or a known secret name. Errors and non-objects pass
 * through untouched.
 */
export function redactSensitiveFields(value: unknown, options: RedactingLoggerOptions = {}): unknown {
  const replacement = options.replacement ?? REDACTED;
  const patterns = [
    ...DEFAULT_PATTERNS,
    ...(options.keys ?? []).map((key) => [key]),
    ...(options.paths ?? []).map((p) => p.split('.')),
  ];
  const seen = new WeakSet<object>();

  const walk = (input: unknown, path: string[]): unknown => {
    if (input === null || typeof input !== 'object' || input instanceof Error) return input;
    if (seen.has(input)) return input;
    seen.add(input);
    if (Array.isArray(input)) {
      return input.map((item) => walk(item, [...path, '*']));
    }
    if (input instanceof Date || input instanceof RegExp) return input;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      const childPath = [...path, key];
      result[key] = patterns.some((pattern) => matchesPath(childPath, pattern))
        ? replacement
        : walk(child, childPath);
    }
    return result;
  };

  return walk(value, []);
}

/**
 * Wrap a logger so that sensitive fields are redacted before delegation.
 *
 * Known secret names (e.g. `secret`, `privateKey`, `token`) are redacted by
 * default; callers can add dotted paths such as `*.secret` via `options.paths`.
 */
export function createRedactingLogger(
  base: Logger,
  keysOrOptions: string[] | RedactorFn | RedactingLoggerOptions,
): Logger {
  const options: RedactingLoggerOptions = Array.isArray(keysOrOptions)
    ? { keys: keysOrOptions }
    : typeof keysOrOptions === 'function'
      ? { redact: keysOrOptions }
      : keysOrOptions;
  const redactArgs = (args: unknown[]): unknown[] =>
    options.redact
      ? args.map(options.redact)
      : args.map((arg) => redactSensitiveFields(arg, options));
  const emit = (level: LogLevel, args: unknown[]) =>
    forwardWithTrace(base, level, redactArgs(args));
  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
    child: (bindings: Record<string, unknown>) => {
      const safeBindings = (
        options.redact ? options.redact(bindings) : redactSensitiveFields(bindings, options)
      ) as Record<string, unknown>;
      return createRedactingLogger(getChildLogger(base, safeBindings), keysOrOptions);
    },
  };
}

/**
 * Create a JSON structured logger that writes one JSON object per line.
 *
 * Each line has pino-compatible field names: `time` (epoch ms), `level`
 * (level name), `msg` (message string) plus any merged `context` fields.
 * Errors serialize to `{ msg, stack, type }`.
 */
export function jsonLogger(
  options: {
    level?: LogLevel;
    stream?: JsonLogStream;
    debugSampleRate?: number;
    sampleRate?: number;
  } = {},
): Logger {
  const minLevel = options.level ?? 'debug';
  const minRank = LOG_LEVEL_RANK[minLevel];
  const sampleRate = resolveDebugSampleRate({
    debugSampleRate: options.debugSampleRate,
    sampleRate: options.sampleRate,
  });
  const stream: JsonLogStream =
    options.stream ?? ({ write: (s: string) => process.stdout.write(s) } as JsonLogStream);
  const emit = (level: LogLevel, args: unknown[]): void => {
    if (LOG_LEVEL_RANK[level] < minRank) return;
    if (level === 'debug' && !(sampleRate >= 1 || (sampleRate > 0 && Math.random() < sampleRate))) {
      return;
    }
    const { msg, context } = argsToRecord(args);
    const traceContext = getActiveSpanContext();
    const traceFields =
      traceContext?.traceId && traceContext.spanId
        ? { traceId: traceContext.traceId, spanId: traceContext.spanId }
        : {};
    stream.write(JSON.stringify({ time: Date.now(), level, msg, ...context, ...traceFields }) + '\n');
  };
  return {
    debug: (...args: unknown[]) => emit('debug', args),
    info: (...args: unknown[]) => emit('info', args),
    warn: (...args: unknown[]) => emit('warn', args),
    error: (...args: unknown[]) => emit('error', args),
  };
}
