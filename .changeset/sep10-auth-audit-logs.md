---
"@stellar/sep10-auth": minor
---

Add an optional structured audit logger hook for authentication events. When configured, the module emits redacted audit records for challenge, verify, and revoke operations, including the redacted account address, client domain, and timestamp.
