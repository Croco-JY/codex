# ADR 009: oidc-authentication

Status: Accepted

## Decision
Spring Security validates OIDC JWT issuer and audience; Cognito is production target. Local header identity is isolated and never accepts passwords.

## Consequences
Keep Phase 0 small; reconsider only with evidence and explicit review.
