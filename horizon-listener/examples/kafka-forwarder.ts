/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 *
 * Example: forward decoded contract events to Kafka instead of a webhook.
 * Install the client first: `npm i kafkajs`. No kafkajs dependency is required
 * by horizon-listener itself — KafkaForwarder accepts any compatible producer.
 */

import { Networks } from '@stellar/stellar-sdk';
import { Kafka } from 'kafkajs';
import { createForwarder, KafkaForwarder, MetricsRegistry } from 'horizon-listener';

const kafka = new Kafka({ brokers: ['localhost:9092'], clientId: 'compliance-adapters' });
const producer = kafka.producer();
const metrics = new MetricsRegistry();

const forwarder = new KafkaForwarder({
  topic: 'stellar.contract-events',
  producer,
  metrics,
  // Optional: route events for different contracts to different partitions.
  keyFromEvent: (event) => event.contractId,
});

const listener = createForwarder({
  eventSource: {
    rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
    contractIds: [process.env.DENYLIST_GATE_CONTRACT_ID!],
    startLedger: Number(process.env.START_LEDGER),
    decode: 'native',
  },
  forwarder,
  listenerOptions: { pollIntervalMs: 5000, metrics },
});

process.on('SIGTERM', async () => {
  await listener.stop();
  await forwarder.stop();
});

await producer.connect();
await listener.start();
