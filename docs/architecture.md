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
- geography: country, region and industrial-cluster reference data; database-enforced same-country trees and facility consistency.
- dataingestion: persistent source identity, immutable observations and separate append-only reviews. Typed identity bindings and fact citations remain distinct.
- supplier: canonical supplier aggregate, roles, aliases, verification history and historical account-link schema. No claim or account-link mutation API.
- facility / capability: supplier-owned sites, controlled capability hierarchy, quantity assertions and observation citations.
- supplysearch: parameterized, read-only cross-domain directory projections; combined supplier facility filters share one correlated EXISTS.

PlatformAuthorization checks active issuer/subject PLATFORM_ADMIN grants independently of organization policy. Canonical catalog reads require authentication; canonical mutations and source/provenance administration require platform authorization. Grant bootstrap is operator-only; see [runbook](platform-admin-bootstrap.md).

Spring Modulith verifies allowed dependencies and absence of cycles. Other modules cannot access organization entities/repositories or storage implementation classes. Cross-module contracts use IDs, immutable records and application services.

## Transactions
Organization creation, owner membership and audit evidence commit together. Rename uses optimistic version checking and audit evidence in the same transaction. Client organization IDs are never trusted: every protected operation resolves active membership and role centrally.
Flyway V1 creates three foundation tables; V2 prevents audit truncation. V3 extends audit with ORGANIZATION/PLATFORM scopes without rewriting old events or disabling append-only guards. V4–V8 add 21 Phase 1A tables. V1/V2 remain byte-for-byte unchanged. JPA validates, never generates production schema. No Material, price, inventory or commercial workflow tables exist.

Supplier and facility ordinary aggregate persistence uses JPA with optimistic versions. Source upserts, recursive integrity checks, typed citations, reference updates and directory search use JdbcClient/explicit SQL where the database operation is clearer. Mutable SQL-backed records compare versions. Identity resolution locks the source record and atomically creates a canonical row, typed binding, citation and audit event. A repeated identity import returns its existing canonical ID, including archived records; it never auto-merges by name.

Platform mutations join the same transaction as their audit event. Audit states accept explicit scalar business fields only. Region/cluster/facility geography changes share transaction advisory lock 91101; capability-tree changes use 91102. PostgreSQL recursive triggers reject cycles and invalid facility relationships, including reference reparenting. These serialized writes favor integrity; measure throughput before bulk production imports.

## API and UI
Java DTOs → springdoc OpenAPI → openapi-typescript schema → openapi-fetch generic client → TanStack Query. One API client injects request IDs and in-memory authentication. React holds selected organization context; selection is advisory, backend authorization remains authoritative. CI regenerates and compares contract artifacts.

## Auxiliary systems
Workers are README-only. Future Python 3.14 + uv workers call controlled Java interfaces and never independently write transactional truth. Terraform is a valid nondeployed skeleton. Production storage, Cognito browser login and AWS resource provisioning remain configuration-dependent deployment work.
