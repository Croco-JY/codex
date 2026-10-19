# Domain Model

Identity is an issuer/subject pair, not a password account. Organization has a UUID, lifecycle status and optimistic version. Membership relates an identity to an organization with an organization-specific role. Audit records append-only evidence. Storage keys never grant access.
