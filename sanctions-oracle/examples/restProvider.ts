/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @file sanctions-oracle/examples/restProvider.ts
 *
 * A realistic example of a REST-backed SanctionsProvider that queries an
 * external watchlist API.  This is the runnable, tested version of the
 * pattern shown in the SanctionsProvider interface doc comment.
 *
 * Key differences from the original doc-comment snippet:
 *  - The `timeout` property has been removed from the fetch RequestInit (it
 *    is not a real fetch option).  AbortController + setTimeout is used
 *    instead, following the same approach as HttpWebhookSender in
 *    horizon-listener/src/webhook.ts.
 *  - `fetchImpl` is injectable so the class can be unit-tested without a
 *    real network connection (see test/restProvider.test.ts).
 *
 * Usage:
 *   const provider = new RestSanctionsProvider(
 *     'https://api.watchlist-provider.com',
 *     process.env.WATCHLIST_API_KEY!,
 *   );
 *   await syncSanctionsToDenylist({ provider, ... });
 */

import type { SanctionsProvider } from '../src/SanctionsProvider';

/** Shape returned by the hypothetical watchlist REST API. */
interface SanctionsApiResponse {
  is_flagged: boolean;
  risk_level?: string;
  lists: string[];
}

export interface RestSanctionsProviderOptions {
  /** Base URL of the watchlist REST API, e.g. https://api.watchlist-provider.com */
  apiBaseUrl: string;
  /** API key passed as a Bearer token in the Authorization header. */
  apiKey: string;
  /**
   * Request timeout in milliseconds.  Implemented via AbortController so it
   * works with the standard Fetch API.  Defaults to 5 000 ms.
   */
  timeoutMs?: number;
  /**
   * Injectable fetch implementation.  Defaults to the global `fetch`.
   * Override in tests to avoid real network I/O.
   */
  fetchImpl?: typeof fetch;
}

/**
 * REST-backed implementation of {@link SanctionsProvider}.
 *
 * On every `checkAddress` call it issues a single GET request to
 * `<apiBaseUrl>/check?address=<address>` and maps the JSON response to the
 * `{ flagged, source }` shape the sync engine expects.
 *
 * **Fail-open vs fail-closed:** The catch block re-throws so the caller
 * (or the retry wrapper inside the sync engine) decides whether to fail
 * open (skip the address) or fail closed (treat it as flagged).  Override
 * this behaviour in a subclass or wrapper if your compliance policy requires
 * a different default.
 */
export class RestSanctionsProvider implements SanctionsProvider {
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RestSanctionsProviderOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, ''); // strip trailing slash
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
    const url = `${this.apiBaseUrl}/check?address=${encodeURIComponent(address)}`;

    // AbortController-based timeout — the `timeout` property on RequestInit is
    // not part of the Fetch specification and is silently ignored by Node's
    // built-in fetch implementation.
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
    } catch (error) {
      const isTimeout =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = isTimeout
        ? `Watchlist API request timed out after ${this.timeoutMs} ms (address: ${address})`
        : `Watchlist API request failed for address ${address}: ${String(error)}`;
      throw new Error(message);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      throw new Error(
        `Watchlist API returned HTTP ${response.status} for address ${address}`,
      );
    }

    const data = (await response.json()) as SanctionsApiResponse;

    return {
      flagged: data.is_flagged,
      source: data.lists.join(',') || 'external-watchlist-api',
    };
  }
}
