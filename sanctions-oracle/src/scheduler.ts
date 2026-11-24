/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
/** Minimal logger shape, compatible with the shared `Logger` interface. */
type SchedulerLogger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

/** Parse a duration such as `15m`, `30s`, `500ms` or `1h` into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}" (expected e.g. 15m, 30s, 500ms, 1h)`);
  }
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h'
  ];
  const ms = Number(match[1]) * multiplier;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`Duration "${value}" must be positive`);
  }
  return ms;
}

export interface SchedulerOptions {
  /** Interval between sync runs in milliseconds. */
  everyMs: number;
  /** Random delay of up to this many milliseconds added to each interval (default 0). */
  jitterMs?: number;
  run: () => Promise<void>;
  /** Exclusive lock file path; defaults to a per-user path in the OS temp directory. */
  lockPath?: string;
  logger?: SchedulerLogger;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  stopAfter?: number;
}

function lockIsStale(lockPath: string): boolean {
  try {
    const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return true;
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // ESRCH means the owning process is gone; ENOENT means it was removed already.
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ESRCH' || code === 'ENOENT' || error instanceof SyntaxError;
  }
}

/**
 * Run a sync job repeatedly with jitter and a filesystem lock. If a previous
 * run still holds the lock, the tick is skipped instead of starting an
 * overlapping sync. Set `SANCTIONS_ORACLE_SCHEDULER_LOCK` to share the lock
 * across containers mounting the same volume.
 */
export async function runScheduler(options: SchedulerOptions): Promise<void> {
  const {
    everyMs,
    jitterMs = 0,
    run,
    lockPath = process.env.SANCTIONS_ORACLE_SCHEDULER_LOCK ??
      path.join(os.tmpdir(), `sanctions-oracle-${process.getuid?.() ?? 'user'}.lock`),
    logger,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    stopAfter,
  } = options;
  if (!Number.isFinite(everyMs) || everyMs <= 0) throw new Error('everyMs must be positive');
  if (!Number.isFinite(jitterMs) || jitterMs < 0) throw new Error('jitterMs must be non-negative');

  let completed = 0;
  while (stopAfter === undefined || completed < stopAfter) {
    const delay = everyMs + Math.floor(random() * jitterMs);
    await sleep(delay);

    let fd: number;
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!lockIsStale(lockPath)) {
        logger?.warn?.('sanctions-oracle: previous sync still running; skipping this tick', {
          lockPath,
        });
        completed += 1;
        continue;
      }
      fs.unlinkSync(lockPath);
      fd = fs.openSync(lockPath, 'wx');
    }

    try {
      fs.writeSync(fd, String(process.pid));
      logger?.info?.('sanctions-oracle: scheduled sync starting', { lockPath });
      try {
        await run();
      } catch (error) {
        logger?.error?.('sanctions-oracle: scheduled sync failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      completed += 1;
    } finally {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger?.warn?.('sanctions-oracle: could not remove scheduler lock', {
            lockPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}
