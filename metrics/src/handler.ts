/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Framework-agnostic `/metrics` HTTP handler. Zero dependencies — works with
 * Node's `http` module, Express and Fastify via structural typing.
 *
 * ```ts
 * http.createServer((req, res) => req.url === '/metrics' && handler(req, res));
 * app.get('/metrics', metricsHandler(registry));            // Express
 * fastify.get('/metrics', metricsHandler(registry));        // Fastify
 * ```
 */

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

interface Exposable {
  expose(): string;
}

/** Node `http.ServerResponse` / Express `Response` shape. */
interface NodeLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

/** Fastify `FastifyReply` shape. */
interface FastifyLikeReply {
  code(status: number): unknown;
  header(name: string, value: string): unknown;
  send(body?: string): unknown;
}

function isNodeResponse(res: unknown): res is NodeLikeResponse {
  return typeof (res as NodeLikeResponse)?.setHeader === 'function';
}

/**
 * Build a request handler that serves `registry.expose()` in Prometheus text
 * format. Accepts `(req, res)` for Node http / Express and `(request, reply)`
 * for Fastify. A registry error results in a `500` with no body.
 */
export function metricsHandler(
  registry: Exposable,
): (req: unknown, res: NodeLikeResponse | FastifyLikeReply) => void {
  return (_req, res) => {
    let body: string;
    let status = 200;
    try {
      body = registry.expose();
    } catch {
      body = '';
      status = 500;
    }

    if (isNodeResponse(res)) {
      res.statusCode = status;
      res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
      res.end(body);
      return;
    }

    res.code(status);
    res.header('Content-Type', PROMETHEUS_CONTENT_TYPE);
    res.send(body);
  };
}
