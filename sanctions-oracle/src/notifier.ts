/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/** Redact a Stellar address for notifications: keep only prefix/suffix for correlation. */
export function redactAddress(address: string): string {
  if (address.length <= 8) return '[REDACTED]';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Redact every address in a list without revealing the original values. */
export function redactAddresses(addresses: readonly string[]): string[] {
  return addresses.map(redactAddress);
}

export interface SyncNotification {
  /** Whether the run completed or threw before producing a report. */
  status: 'success' | 'failure';
  timestamp: string;
  checked: number;
  added: string[];
  failed: string[];
  invalid: number;
  removed: number;
  /** Present only for a run that threw. */
  error?: string;
}

export interface SyncNotifier {
  notify(notification: SyncNotification): void | Promise<void>;
}

export interface WebhookNotifierOptions {
  /** Injectable fetch, e.g. for tests or a proxy-aware client. */
  fetchImpl?: typeof fetch;
  /** Extra headers to send with the notification. */
  headers?: Record<string, string>;
}

/**
 * POSTs redacted sync results to a Slack-compatible incoming webhook (or any
 * JSON webhook). Full Stellar addresses are never included in the payload.
 */
export class WebhookNotifier implements SyncNotifier {
  constructor(
    private readonly url: string,
    private readonly options: WebhookNotifierOptions = {},
  ) {}

  async notify(notification: SyncNotification): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const text =
      notification.status === 'success'
        ? `sanctions-oracle sync complete: ${notification.checked} checked, ${notification.added.length} added, ${notification.failed.length} failed, ${notification.removed} removed. Addresses: ${notification.added.join(', ') || 'none'}`
        : `sanctions-oracle sync failed: ${notification.error ?? 'unknown error'}`;
    const response = await fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.options.headers },
      body: JSON.stringify({ text, ...notification }),
    });
    if (!response.ok) {
      throw new Error(`Notification webhook returned ${response.status}`);
    }
  }
}
