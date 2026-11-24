/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { KafkaForwarder, type EventForwarder, type KafkaProducer } from '../src/forwarder';
import type { AnyMetricsRegistry } from '../src/metrics';
import type { RawContractEvent } from '../src/eventSource';

const event: RawContractEvent = {
  id: '123-0',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABH4M',
  ledger: 123,
  topic: ['transfer'],
  value: { amount: '10' },
};

describe('KafkaForwarder (#1005)', () => {
  it('publishes a decoded JSON envelope keyed by the event id', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const producer: KafkaProducer = { send };
    const forwarder: EventForwarder = new KafkaForwarder({ topic: 'stellar.events', producer });

    await forwarder.send(event);

    expect(send).toHaveBeenCalledTimes(1);
    const record = send.mock.calls[0][0];
    expect(record.topic).toBe('stellar.events');
    expect(record.messages).toHaveLength(1);
    expect(record.messages[0].key).toBe(event.id);
    expect(JSON.parse(record.messages[0].value)).toEqual({ schemaVersion: 1, event });
    expect(record.messages[0].headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Compliance-Schema-Version': '1',
      'Idempotency-Key': event.id,
    });
  });

  it('supports custom keys and headers', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const forwarder = new KafkaForwarder({
      topic: 'events',
      producer: { send },
      keyFromEvent: (e) => e.contractId,
      headers: () => ({ 'X-Tenant': 'acme' }),
    });
    await forwarder.send(event);
    expect(send.mock.calls[0][0].messages[0]).toMatchObject({
      key: event.contractId,
      headers: { 'X-Tenant': 'acme' },
    });
  });

  it('records metrics and rethrows producer failures', async () => {
    const inc = jest.fn();
    const metrics = {
      counter: { inc },
      histogram: { observe: jest.fn() },
      gauge: { set: jest.fn() },
      expose: () => '',
      setLedgerLag: jest.fn(),
      getLedgerLag: () => 0,
    } as unknown as AnyMetricsRegistry;
    const forwarder = new KafkaForwarder({
      topic: 'events',
      producer: { send: jest.fn().mockRejectedValue(new Error('broker down')) },
      metrics,
    });
    await expect(forwarder.send(event)).rejects.toThrow('broker down');
    expect(inc).toHaveBeenCalledWith('webhook', 'failure');
  });

  it('disconnects the producer on stop', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const forwarder = new KafkaForwarder({ topic: 'events', producer: { send: jest.fn(), disconnect } });
    await forwarder.stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('validates its options', () => {
    expect(() => new KafkaForwarder({ topic: '', producer: { send: jest.fn() } })).toThrow(/topic/);
    expect(() => new KafkaForwarder({ topic: 'events', producer: {} as KafkaProducer })).toThrow(
      /producer/,
    );
  });
});
