# Architecture
## Runtime and boundaries
SOURCE OS is a Java 25 / Spring Boot 4.1 modular monolith. React is an SPA; Node is build tooling only. PostgreSQL 18 is the transactional system of record. No Redis, Kafka, search cluster, Kubernetes or microservices are introduced.

Domain packages and public contracts:
- identity: Actor(issuer,subject), IdentityService; local or OIDC security adapter.
- organization: OrganizationService, immutable OrganizationView; JPA organization and JDBC membership facts.
- authorization: MembershipLookup port and OrganizationAuthorization policy. Organization implements the lookup, so authorization has no dependency back to organization.
- audit: AuditRecorder joins an existing transaction (MANDATORY), never commits independently.
- file: StoragePort and AuthorizedStorage; local storage adapter only.
- shared: HTTP request IDs, problem responses and database-backed health; no business entities.

Spring Modulith verifies allowed dependencies and absence of cycles. Other modules cannot access organization entities/repositories or storage implementation classes. Cross-module contracts use IDs, immutable records and application services.

## Transactions
Organization creation, owner membership and audit evidence commit together. Rename uses optimistic version checking and audit evidence in the same transaction. Client organization IDs are never trusted: every protected operation resolves active membership and role centrally.
Flyway V1 creates three foundation tables; V2 prevents audit truncation. JPA validates, never generates production schema. Database storage remains minimal; no future commercial tables.

## API and UI
Java DTOs → springdoc OpenAPI → openapi-typescript schema → openapi-fetch generic client → TanStack Query. One API client injects request IDs and in-memory authentication. React holds selected organization context; selection is advisory, backend authorization remains authoritative. CI regenerates and compares contract artifacts.

## Auxiliary systems
Workers are README-only. Future Python 3.14 + uv workers call controlled Java interfaces and never independently write transactional truth. Terraform is a valid nondeployed skeleton. Production storage, Cognito browser login and AWS resource provisioning remain configuration-dependent deployment work.
