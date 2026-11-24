/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { HorizonListener, type HorizonListenerOptions } from './listener';
import { RpcEventSource, type RpcEventSourceOptions } from './eventSource';
import { HttpWebhookSender, type HttpWebhookSenderOptions } from './webhook';
import type { EventForwarder } from './forwarder';

export interface WebhookForwarderOptions {
  eventSource: RpcEventSourceOptions;
  webhook: HttpWebhookSenderOptions;
  listenerOptions?: Omit<HorizonListenerOptions, 'eventSource' | 'onEvent'>;
}

export function createWebhookForwarder(
  options: WebhookForwarderOptions,
): HorizonListener {
  return createForwarder({
    eventSource: options.eventSource,
    forwarder: new HttpWebhookSender(options.webhook),
    listenerOptions: options.listenerOptions,
  });
}

export interface ForwarderOptions {
  eventSource: RpcEventSourceOptions;
  /** Any event sink: HttpWebhookSender, KafkaForwarder, or a custom implementation. */
  forwarder: EventForwarder;
  listenerOptions?: Omit<HorizonListenerOptions, 'eventSource' | 'onEvent'>;
}

/** Wires an RPC event source to any pluggable {@link EventForwarder}. */
export function createForwarder(options: ForwarderOptions): HorizonListener {
  const eventSource = new RpcEventSource(options.eventSource);
  return new HorizonListener({
    ...options.listenerOptions,
    eventSource,
    onEvent: async (event) => {
      await options.forwarder.send(event);
    },
  });
}
