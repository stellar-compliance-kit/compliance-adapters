---
'horizon-listener': minor
---

Add a pluggable `EventForwarder` interface, a `createForwarder` factory, and a `KafkaForwarder` implementation for deployments that prefer a message bus over webhooks.
