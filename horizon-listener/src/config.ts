export interface ListenerConfig {
  /**
   * Optional Redis lock-based leader election. When enabled, only the replica
   * holding the lock processes and delivers webhooks; followers stay idle and
   * take over once the lock expires. Disabled by default so single-replica
   * deployments behave exactly as before.
   */
  leaderElection?: LeaderElectionConfig;
}

export interface LeaderElectionConfig {
  /** Enable leader election. Defaults to false. */
  enabled?: boolean;
  /** Redis connection URL used to acquire the leader lock. */
  redisUrl?: string;
  /** Key used for the leader lock. */
  lockKey?: string;
  /** Lock TTL in milliseconds; followers take over after this expires. */
  lockTtlMs?: number;
  /** How often followers attempt to acquire the lock, in milliseconds. */
  retryIntervalMs?: number;
}

export interface ResolvedLeaderElectionConfig {
  enabled: boolean;
  redisUrl: string;
  lockKey: string;
  lockTtlMs: number;
  retryIntervalMs: number;
}

const DEFAULT_LOCK_KEY = 'horizon-listener:leader';
const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_RETRY_INTERVAL_MS = 5_000;

/**
 * Resolve leader election settings from config, applying defaults.
 * Returns `null` when leader election is not enabled, preserving the
 * single-replica behavior.
 */
export function resolveLeaderElection(
  config: ListenerConfig,
): ResolvedLeaderElectionConfig | null {
  const leader = config.leaderElection;
  if (!leader || !leader.enabled) {
    return null;
  }

  const redisUrl = leader.redisUrl ?? process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error(
      'leaderElection.redisUrl (or REDIS_URL) is required when leader election is enabled',
    );
  }

  return {
    enabled: true,
    redisUrl,
    lockKey: leader.lockKey ?? DEFAULT_LOCK_KEY,
    lockTtlMs: leader.lockTtlMs ?? DEFAULT_LOCK_TTL_MS,
    retryIntervalMs: leader.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
  };
}
