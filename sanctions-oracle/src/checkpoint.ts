/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * A store {@link syncSanctionsToDenylist} can consult to make a large sync
 * resumable after a crash. As the sync completes work on each address it calls
 * {@link SyncCheckpointStore.markComplete}; on a later re-run with
 * `resume: true` any address {@link SyncCheckpointStore.isComplete} reports as
 * already done is skipped instead of being re-checked and (for flagged
 * addresses) re-written.
 *
 * This mirrors the "reference interface, bring your own persistence" pattern
 * used by `RevocationStore` in sep10-auth: the package ships an in-memory
 * reference implementation ({@link InMemoryCheckpointStore}) and expects real
 * deployments to back it with a file, database, or KV store.
 */
export interface SyncCheckpointStore {
  /** Returns whether `address` has already been fully processed by a prior run. */
  isComplete(address: string): boolean | Promise<boolean>;
  /**
   * Records `address` as fully processed. For clean addresses this is called
   * right after the provider check; for flagged addresses only after the
   * denylist write succeeds, so an interrupted write is retried on resume.
   */
  markComplete(address: string): void | Promise<void>;
}

/**
 * In-memory reference implementation of {@link SyncCheckpointStore}. Completed
 * addresses are held in a `Set` and lost on process restart, so this only makes
 * a sync resumable within a single long-running process. Use it as a template
 * for a persistent store (write each completed address to a file, a `denylist`
 * table, Redis, etc.) when you need resume-after-crash.
 */
export class InMemoryCheckpointStore implements SyncCheckpointStore {
  private readonly completed: Set<string>;

  constructor(initiallyComplete: Iterable<string> = []) {
    this.completed = new Set(initiallyComplete);
  }

  isComplete(address: string): boolean {
    return this.completed.has(address);
  }

  markComplete(address: string): void {
    this.completed.add(address);
  }

  /** All addresses recorded as complete so far. */
  snapshot(): string[] {
    return [...this.completed];
  }
}
