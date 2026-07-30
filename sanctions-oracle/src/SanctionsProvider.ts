/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Implement this interface to plug an external sanctions/watchlist data
 * source into the denylist-gate sync flow (see `sync.ts`).
 *
 * `sync.ts` only depends on this shape, so any provider — a REST client
 * for a commercial watchlist API, a local CSV loader, a cache in front of
 * multiple upstream lists, etc. — can be swapped in without touching the
 * sync logic itself.
 *
 * @example
 * Here's a realistic example of a REST-backed provider that queries an
 * external sanctions API. This pattern can be used as a starting point for
 * integrating your own watchlist data source:
 *
 * ```ts
 * import { SanctionsProvider } from 'sanctions-oracle';
 *
 * interface SanctionsApiResponse {
 *   is_flagged: boolean;
 *   risk_level?: string;
 *   lists: string[];
 * }
 *
 * export class RestSanctionsProvider implements SanctionsProvider {
 *   constructor(
 *     private apiBaseUrl: string,
 *     private apiKey: string,
 *   ) {}
 *
 *   async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
 *     try {
 *       const response = await fetch(
 *         `${this.apiBaseUrl}/check?address=${encodeURIComponent(address)}`,
 *         {
 *           headers: { Authorization: `Bearer ${this.apiKey}` },
 *           timeout: 5000,
 *         },
 *       );
 *
 *       if (!response.ok) {
 *         throw new Error(`API error: ${response.status}`);
 *       }
 *
 *       const data = await response.json() as SanctionsApiResponse;
 *
 *       return {
 *         flagged: data.is_flagged,
 *         source: data.lists.join(',') || 'external-watchlist-api',
 *       };
 *     } catch (error) {
 *       console.error(`Failed to check address ${address}:`, error);
 *       // In production, you may want to fail closed (return flagged: true)
 *       // or implement retry logic here.
 *       throw error;
 *     }
 *   }
 * }
 *
 * // Usage:
 * // const provider = new RestSanctionsProvider(
 * //   'https://api.watchlist-provider.com',
 * //   process.env.WATCHLIST_API_KEY!,
 * // );
 * // await syncSanctionsToDenylist({ provider, ... });
 * ```
 */
export interface SanctionsProvider {
  checkAddress(address: string): Promise<{ flagged: boolean; source: string }>;
}
