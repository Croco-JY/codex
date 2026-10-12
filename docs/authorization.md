# Authorization
## Identity and policy
An identity is `(issuer, subject)`; there are no passwords or global user roles. Membership is unique per organization/issuer/subject. MembershipLookup supplies facts; OrganizationAuthorization is the single permission policy. Both organization services and AuthorizedStorage call this policy.

| Action | No membership / revoked | VIEWER | ORG_ADMIN / ORG_OWNER |
|---|---|---|---|
| Read organization / private storage | deny | allow | allow |
| Rename organization / write private storage | deny | deny | allow |

Organization list returns only ACTIVE organizations with ACTIVE membership for the authenticated identity. Organization creation atomically creates owner membership and a creation audit event. Membership administration is deferred; integration fixtures insert memberships solely to test policy.
Unknown organizations and nonmember access return the same 403 response. Request IDs are included. Version mismatches return 409. Database foreign keys, unique membership constraints and lifecycle checks strengthen the application policy.

## Tests
PostgreSQL Testcontainers tests prove member access, outsider denial, viewer mutation denial, revoked access denial, scoped lists, optimistic conflict and private storage denial. Production-profile tests prove local identity headers do not authenticate and invalid bearer tokens return correlated 401 responses. Provider decoding is mocked in those tests; live Cognito integration is not claimed.
