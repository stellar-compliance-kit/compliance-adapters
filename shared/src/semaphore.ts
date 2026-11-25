/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Error thrown when a semaphore acquisition exceeds its configured timeout.
 *
 * @example
 * ```ts
 * import { createSemaphore, SemaphoreTimeoutError } from './semaphore';
 *
 * const sem = createSemaphore(1);
 * const release = await sem.acquire();
 * try {
 *   await sem.acquire({ timeoutMs: 10 });
 * } catch (err) {
 *   if (err instanceof SemaphoreTimeoutError) {
 *     console.log(`timed out after ${err.timeoutMs}ms`);
 *   }
 * } finally {
 *   release();
 * }
 * ```
 */
export class SemaphoreTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`semaphore acquire timed out after ${timeoutMs}ms`);
    this.name = 'SemaphoreTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface SemaphoreAcquireOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Semaphore {
  acquire(options?: SemaphoreAcquireOptions): Promise<() => void>;
}

/**
 * Creates a FIFO semaphore for concurrency control.
 *
 * @param limit - Maximum number of concurrent holders, or `Infinity` for no limit.
 * @returns A {@link Semaphore} whose `acquire` resolves to an idempotent release function.
 *
 * @example
 * ```ts
 * import { createSemaphore } from './semaphore';
 *
 * const sem = createSemaphore(2);
 * const release = await sem.acquire({ timeoutMs: 1000 });
 * try {
 *   await doWork();
 * } finally {
 *   release();
 * }
 * ```
 */
export function createSemaphore(limit: number): Semaphore {
  if (limit !== Infinity && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('semaphore limit must be a positive number or Infinity');
  }

  if (limit === Infinity) {
    return {
      acquire: async (options?: SemaphoreAcquireOptions) => {
        options?.signal?.throwIfAborted();
        let released = false;
        return () => {
          if (released) {
            return;
          }
          released = true;
        };
      },
    };
  }

  let inUse = 0;

  interface Waiter {
    grant: () => void;
    cancel: () => void;
    settled: boolean;
  }

  const queue: Waiter[] = [];

  const removeWaiter = (waiter: Waiter): void => {
    const index = queue.indexOf(waiter);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  };

  const drain = (): void => {
    while (inUse < limit && queue.length > 0) {
      const waiter = queue.shift();
      if (!waiter || waiter.settled) {
        continue;
      }
      waiter.settled = true;
      waiter.grant();
    }
  };

  const buildRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      if (inUse > 0) {
        inUse--;
      }
      drain();
    };
  };

  return {
    acquire: (options?: SemaphoreAcquireOptions) => {
      options?.signal?.throwIfAborted();

      if (inUse < limit) {
        inUse++;
        return Promise.resolve(buildRelease());
      }

      return new Promise<() => void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const signal = options?.signal;

        const waiter: Waiter = {
          settled: false,
          grant: () => {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            signal?.removeEventListener('abort', onAbort);
            inUse++;
            resolve(buildRelease());
          },
          cancel: () => {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            signal?.removeEventListener('abort', onAbort);
          },
        };

        const fail = (err: unknown): void => {
          if (waiter.settled) {
            return;
          }
          waiter.settled = true;
          removeWaiter(waiter);
          waiter.cancel();
          reject(err);
        };

        const onAbort = (): void => {
          fail(signal?.reason ?? new Error('semaphore acquire aborted'));
        };

        if (options?.timeoutMs !== undefined) {
          timer = setTimeout(() => {
            fail(new SemaphoreTimeoutError(options.timeoutMs as number));
          }, options.timeoutMs);
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push(waiter);
      });
    },
  };
}
