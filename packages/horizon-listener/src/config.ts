export interface HealthConfig {
  /** Enable the optional HTTP health server. Disabled by default. */
  enabled: boolean;
  /** Port the health server listens on. */
  port: number;
  /** Host/interface the health server binds to. */
  host: string;
  /**
   * Maximum acceptable listener lag (in ledgers) for `/readyz` to report ready.
   * When the observed lag exceeds this threshold, `/readyz` returns a non-2xx.
   */
  maxLagLedgers: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  enabled: false,
  port: 8080,
  host: "0.0.0.0",
  maxLagLedgers: 10,
};

/**
 * Resolve the health server configuration from environment variables,
 * falling back to the provided defaults. The server stays disabled unless
 * explicitly opted in via `HORIZON_LISTENER_HEALTH_ENABLED`.
 */
export function resolveHealthConfig(
  overrides: Partial<HealthConfig> = {},
): HealthConfig {
  const env = process.env;

  const enabled =
    overrides.enabled ??
    (env.HORIZON_LISTENER_HEALTH_ENABLED !== undefined
      ? env.HORIZON_LISTENER_HEALTH_ENABLED === "true" ||
        env.HORIZON_LISTENER_HEALTH_ENABLED === "1"
      : DEFAULT_HEALTH_CONFIG.enabled);

  const port =
    overrides.port ??
    (env.HORIZON_LISTENER_HEALTH_PORT !== undefined
      ? Number.parseInt(env.HORIZON_LISTENER_HEALTH_PORT, 10)
      : DEFAULT_HEALTH_CONFIG.port);

  const host =
    overrides.host ??
    env.HORIZON_LISTENER_HEALTH_HOST ??
    DEFAULT_HEALTH_CONFIG.host;

  const maxLagLedgers =
    overrides.maxLagLedgers ??
    (env.HORIZON_LISTENER_HEALTH_MAX_LAG !== undefined
      ? Number.parseInt(env.HORIZON_LISTENER_HEALTH_MAX_LAG, 10)
      : DEFAULT_HEALTH_CONFIG.maxLagLedgers);

  return {
    enabled,
    port: Number.isFinite(port) ? port : DEFAULT_HEALTH_CONFIG.port,
    host,
    maxLagLedgers: Number.isFinite(maxLagLedgers)
      ? maxLagLedgers
      : DEFAULT_HEALTH_CONFIG.maxLagLedgers,
  };
}
