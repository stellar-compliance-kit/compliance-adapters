---
'sep10-auth': minor
---

Cache `client_domain` signing-key lookups with a bounded (LRU), configurable TTL cache. `createSep10Router` wraps `resolveClientSigningKey` automatically; `createCachedClientSigningKeyResolver`, `createClientDomainTomlResolver`, and hit/miss metrics are exported for direct use.
