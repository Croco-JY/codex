# Authorization
## Identity and policy
An identity is `(issuer, subject)`; there are no passwords or separate user tables. Membership is unique per organization/issuer/subject. MembershipLookup supplies facts; OrganizationAuthorization is the organization permission policy. Both organization services and AuthorizedStorage call this policy.

| Action | No membership / revoked | VIEWER | ORG_ADMIN / ORG_OWNER |
|---|---|---|---|
| Read organization / private storage | deny | allow | allow |
| Rename organization / write private storage | deny | deny | allow |

Organization list returns only ACTIVE organizations with ACTIVE membership for the authenticated identity. Organization creation atomically creates owner membership and a creation audit event. Membership administration is deferred; integration fixtures insert memberships solely to test policy.
Unknown organizations and nonmember access return the same 403 response. Request IDs are included. Version mismatches return 409. Database foreign keys, unique membership constraints and lifecycle checks strengthen the application policy.

## Platform catalog policy
PlatformAuthorization independently requires an ACTIVE PLATFORM_ADMIN assignment for the authenticated Actor's issuer/subject. ORG_OWNER/ORG_ADMIN, arbitrary organization IDs and supplier account links never confer this role. Revocation takes effect on the next authorization check. No role, reviewer or mutation actor is accepted from a request body.

Authenticated users may read/search the global supplier/facility directory and public reference fields across organizations. All canonical mutations, source/observation/review administration and internal citation reads require PLATFORM_ADMIN. This grants no access to another organization's private files. Production has no automatic admin seed, HTTP bootstrap or self-promotion endpoint; use the explicit operator [bootstrap procedure](platform-admin-bootstrap.md). Synthetic principals appear only in local/Testcontainers fixtures.

Platform mutation audit uses PLATFORM scope, NULL organization_id and required entity type/id. Tenant audit remains ORGANIZATION with a required organization_id. Both preserve issuer/subject, request ID and append-only guards. Business states use a scalar field allowlist, never entity dumps.

## Tests
PostgreSQL Testcontainers tests prove member access, outsider denial, viewer mutation denial, revoked access denial, scoped lists, optimistic conflict and private storage denial. Production-profile tests prove local identity headers do not authenticate and invalid bearer tokens return correlated 401 responses. Provider decoding is mocked in those tests; live Cognito integration is not claimed.
