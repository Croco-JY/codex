# Security Model

Production uses Spring Security OIDC resource-server validation with issuer and audience. No passwords are stored. Local identity headers exist exclusively in the local profile, bound to loopback; never deploy this profile. Tenant access is checked centrally against membership on every protected request. Private storage has no public URLs. Production CORS is explicit, tokens are never logged, errors carry request IDs, and audit records reject updates/deletes. CSP and delivery headers are documented in infra. Production secrets belong in Secrets Manager.
