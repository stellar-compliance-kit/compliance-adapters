---
name: Pull Request
about: Submit a pull request to contribute changes
title: ""
---

## Summary
A brief description of the changes in this PR and why they were made.

## Packages Affected
- [ ] sep10-auth
- [ ] sanctions-oracle
- [ ] horizon-listener
- [ ] root tooling / other

## Testing Performed
Describe the testing you've performed to validate these changes:

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed
- [ ] N/A (documentation or configuration only)

## Security Review Checklist

> **Required** for any PR that touches `sep10-auth` or signing code (webhook HMAC signing, JWT issuance, key handling). If this PR does not touch auth or signing code, mark this section N/A and move on.

- [ ] N/A — this PR does not touch `sep10-auth` or signing code
- [ ] Signing keys/secrets are never logged or committed (no secrets in code, logs, error messages, or test fixtures)
- [ ] Token validation and expiry are enforced (signature, issuer, audience, and `exp`/`nbf`/`iat` checks as applicable)
- [ ] Revocation store is consulted where applicable (revoked tokens/keys are rejected)
- [ ] Constant-time comparison is used for signatures and HMACs (no `==`/`===` on secret material)
- [ ] Input validation and size limits are applied to tokens and transactions
- [ ] Rate limiting has been considered for the affected endpoints/paths
- [ ] No new dependencies introduced without review (or reviewed and justified below)

**Notes for reviewers (security-relevant context, threat model, or dependency justification):**

> CODEOWNERS routes `sep10-auth` changes to the auth maintainer for review. Ensure the relevant reviewer has approved before merging.

## Checklist
- [ ] Tests added or updated
- [ ] Documentation updated
- [ ] If this PR adds/changes a public export, the relevant package README has been updated
- [ ] No breaking changes (or documented if applicable)
- [ ] Code follows project style guidelines
- [ ] Changes reviewed locally before submitting

## Related Issues
Closes #(issue number)

## Additional Context
Any additional information, screenshots, or logs relevant to this PR.