/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { HorizonListener, type HorizonListenerOptions } from './listener';
import { RpcEventSource, type RpcEventSourceOptions } from './eventSource';
import { HttpWebhookSender, type HttpWebhookSenderOptions } from './webhook';

export interface WebhookForwarderOptions {
  eventSource: RpcEventSourceOptions;
  webhook: HttpWebhookSenderOptions;
  listenerOptions?: Omit<HorizonListenerOptions, 'eventSource' | 'onEvent'>;
}

/**
 * Creates a {@link HorizonListener} that forwards every received event to an
 * HTTP webhook. It wires an {@link RpcEventSource} and an
 * {@link HttpWebhookSender} together so you don't have to construct them
 * manually.
 *
 * @param options - Configuration for the event source, the webhook sender,
 *   and any additional listener options.
 * @returns A configured {@link HorizonListener} instance.
 *
 * @example
 * ```ts
 * import { createWebhookForwarder } from 'horizon-listener';
 *
 * const listener = createWebhookForwarder({
 *   eventSource: {
 *     rpcUrl: 'https://soroban-testnet.stellar.org',
 *     contractIds: ['CABC...XYZ'],
 *   },
 *   webhook: {
 *     url: 'https://example.com/hooks/stellar',
 *     secret: process.env.WEBHOOK_SECRET,
 *   },
 *   listenerOptions: {
 *     pollIntervalMs: 5_000,
 *   },
 * });
 *
 * await listener.start();
 * ```
 */
export function createWebhookForwarder(
  options: WebhookForwarderOptions,
): HorizonListener {
  const eventSource = new RpcEventSource(options.eventSource);
  const webhook = new HttpWebhookSender(options.webhook);

  return new HorizonListener({
    ...options.listenerOptions,
    eventSource,
    onEvent: async (event) => {
      await webhook.send(event);
    },
  });
}