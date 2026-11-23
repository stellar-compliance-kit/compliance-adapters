import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HorizonListenerOptions, HorizonListenerHealthOptions } from "./types";

const DEFAULT_HEALTH_PATH = "/healthz";
const DEFAULT_READY_PATH = "/readyz";
const DEFAULT_MAX_LAG_LEDGERS = 10;

export interface HorizonListenerHealthState {
  /** Whether the listener process is up and running. */
  isRunning: () => boolean;
  /** Current listener lag in ledgers, or null when unknown. */
  getLag: () => number | null;
}

/**
 * Optional HTTP server exposing liveness (`/healthz`) and readiness (`/readyz`)
 * probes for container orchestrators. Disabled unless explicitly enabled via
 * `options.health.enabled`.
 */
export class HorizonListenerHealthServer {
  private readonly options: Required<HorizonListenerHealthOptions>;
  private readonly state: HorizonListenerHealthState;
  private server: Server | null = null;

  constructor(state: HorizonListenerHealthState, options: HorizonListenerHealthOptions = {}) {
    this.state = state;
    this.options = {
      enabled: options.enabled ?? false,
      port: options.port ?? 8080,
      host: options.host ?? "0.0.0.0",
      healthPath: options.healthPath ?? DEFAULT_HEALTH_PATH,
      readyPath: options.readyPath ?? DEFAULT_READY_PATH,
      maxLagLedgers: options.maxLagLedgers ?? DEFAULT_MAX_LAG_LEDGERS,
    };
  }

  get isEnabled(): boolean {
    return this.options.enabled;
  }

  async start(): Promise<void> {
    if (!this.options.enabled || this.server) {
      return;
    }

    const server = createServer((req, res) => this.handleRequest(req, res));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener("listening", onListening);
        this.server = null;
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, this.options.host);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (req.method !== "GET" && req.method !== "HEAD") {
      this.respond(res, 405, { status: "method_not_allowed" });
      return;
    }

    if (path === this.options.healthPath) {
      const running = this.state.isRunning();
      this.respond(res, running ? 200 : 503, { status: running ? "ok" : "down" });
      return;
    }

    if (path === this.options.readyPath) {
      const lag = this.state.getLag();
      const ready = lag !== null && lag <= this.options.maxLagLedgers;
      this.respond(res, ready ? 200 : 503, {
        status: ready ? "ready" : "not_ready",
        lag,
        maxLagLedgers: this.options.maxLagLedgers,
      });
      return;
    }

    this.respond(res, 404, { status: "not_found" });
  }

  private respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    const payload = JSON.stringify(body);
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("content-length", Buffer.byteLength(payload));
    res.end(payload);
  }
}

export function createHealthServer(
  state: HorizonListenerHealthState,
  options?: HorizonListenerHealthOptions,
): HorizonListenerHealthServer {
  return new HorizonListenerHealthServer(state, options);
}

export type { HorizonListenerOptions };
