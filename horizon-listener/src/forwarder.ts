/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import type { RawContractEvent } from './eventSource';
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';

/** Matches MESSAGE_SCHEMA_VERSION; kept local so a bus sink has no HTTP dependency. */
const MESSAGE_SCHEMA_VERSION = 1;

/**
 * A sink for decoded contract events. `WebhookSender` already satisfies this
 * interface, so the listener can forward to webhooks, a message bus, or any
 * custom destination without changing `HorizonListener`.
 */
export interface EventForwarder {
  send(event: RawContractEvent): Promise<void>;
  /** Flush buffered events / release resources. Optional for simple sinks. */
  stop?(): Promise<void>;
}

/** Structural subset of a kafkajs producer (`producer.send`), so no new dependency is required. */
export interface KafkaProducer {
  send(record: {
    topic: string;
    messages: Array<{
      key?: string | null;
      value: string;
      headers?: Record<string, string>;
    }>;
  }): Promise<unknown>;
  disconnect?(): Promise<void>;
}

export interface KafkaForwarderOptions {
  /** Kafka topic to publish events to. */
  topic: string;
  /** A kafkajs-compatible producer (or an adapter for another client). */
  producer: KafkaProducer;
  /** Message key. Defaults to the stable event id, which preserves per-event deduplication. */
  keyFromEvent?: (event: RawContractEvent) => string;
  /** Additional headers merged with the standard compliance headers. */
  headers?: (event: RawContractEvent) => Record<string, string>;
  /** Records success/failure counters and latency for the `webhook` phase. */
  metrics?: AnyMetricsRegistry;
}

/**
 * Forwards contract events to Kafka. The message value is a decoded JSON
 * envelope with the same schema version used by webhook deliveries; the
 * `Idempotency-Key` header is the stable event id so consumers can dedupe.
 */
export class KafkaForwarder implements EventForwarder {
  private readonly topic: string;
  private readonly producer: KafkaProducer;
  private readonly keyFromEvent: (event: RawContractEvent) => string;
  private readonly extraHeaders: (event: RawContractEvent) => Record<string, string>;
  private readonly metrics: AnyMetricsRegistry;

  constructor(options: KafkaForwarderOptions) {
    if (!options.topic) throw new Error('horizon-listener: KafkaForwarder requires a `topic`');
    if (!options.producer || typeof options.producer.send !== 'function') {
      throw new Error('horizon-listener: KafkaForwarder requires a `producer` with a send() method');
    }
    this.topic = options.topic;
    this.producer = options.producer;
    this.keyFromEvent = options.keyFromEvent ?? ((event) => event.id);
    this.extraHeaders = options.headers ?? (() => ({}));
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  async send(event: RawContractEvent): Promise<void> {
    const start = Date.now();
    try {
      await this.producer.send({
        topic: this.topic,
        messages: [
          {
            key: this.keyFromEvent(event),
            value: JSON.stringify({
              schemaVersion: MESSAGE_SCHEMA_VERSION,
              event,
            }),
            headers: {
              'Content-Type': 'application/json',
              'X-Compliance-Schema-Version': String(MESSAGE_SCHEMA_VERSION),
              'Idempotency-Key': event.id,
              ...this.extraHeaders(event),
            },
          },
        ],
      });
      this.metrics.counter.inc('webhook', 'success');
      this.metrics.histogram.observe('webhook', Date.now() - start);
    } catch (error) {
      this.metrics.counter.inc('webhook', 'failure');
      this.metrics.histogram.observe('webhook', Date.now() - start);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Disconnect the producer, if it supports it. Safe to call on shutdown. */
  async stop(): Promise<void> {
    await this.producer.disconnect?.();
  }
}
