/**
 * A store the SEP-10 middleware can consult to reject an otherwise-valid,
 * unexpired challenge transaction for a given Stellar address — e.g. because
 * an operator wants to cut off access immediately instead of waiting for the
 * challenge's `timeoutSeconds` to elapse naturally.
 */
export interface RevocationStore {
  /** Returns whether `address` is currently revoked. */
  isRevoked(address: string): boolean | Promise<boolean>;
  /**
   * Revokes `address`. If `until` is provided, the revocation expires at
   * that time; otherwise it remains in effect until {@link unrevoke} is called.
   */
  revoke(address: string, until?: Date): void | Promise<void>;
  /** Lifts a revocation previously set with {@link revoke}. */
  unrevoke(address: string): void | Promise<void>;
}

/**
 * In-memory reference implementation of {@link RevocationStore}. Revocations
 * are held in a `Map` and are lost on process restart; suitable for a single
 * process or as a template for a persistent (e.g. Redis, database-backed) store.
 */
export class InMemoryRevocationStore implements RevocationStore {
  private readonly revoked = new Map<string, Date | undefined>();

  isRevoked(address: string): boolean {
    const until = this.revoked.get(address);
    if (until === undefined) {
      return this.revoked.has(address);
    }
    if (until.getTime() <= Date.now()) {
      this.revoked.delete(address);
      return false;
    }
    return true;
  }

  revoke(address: string, until?: Date): void {
    this.revoked.set(address, until);
  }

  unrevoke(address: string): void {
    this.revoked.delete(address);
  }
}
