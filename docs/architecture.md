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
- material: canonical Materials, Variants, Composition, Fabric/Leather specifications and typed evidence/identity contracts.
- materiallisting: Seller Listings belonging to a Material; a Listing has no Variant parent.
- materialprice / materialinventory: immutable Price facts with one-time closure and append-only Inventory observations, scoped commercial resolution/history.
- materialsearch: bounded PostgreSQL Material discovery projections, without owning catalog entities.

PlatformAuthorization checks active issuer/subject PLATFORM_ADMIN grants independently of organization policy. Canonical catalog reads require authentication; canonical mutations and source/provenance administration require platform authorization. Grant bootstrap is operator-only; see [runbook](platform-admin-bootstrap.md).

Spring Modulith verifies allowed dependencies and absence of cycles. Other modules cannot access organization entities/repositories or storage implementation classes. Cross-module contracts use IDs, immutable records and application services.

## Transactions
Organization creation, owner membership and audit evidence commit together. Rename uses optimistic version checking and audit evidence in the same transaction. Client organization IDs are never trusted: every protected Organization operation resolves active membership and role centrally. Global curation uses the separate platform policy.
Flyway V1 creates three foundation tables; V2 prevents audit truncation. V3 extends audit with ORGANIZATION/PLATFORM scopes without rewriting old events or disabling append-only guards. V4–V8 add the Phase 1A role/reference/provenance/Supplier/Facility model; V9 adds Materials/Variants/specifications/Composition/Listings, V10 Price/evidence, V11 Inventory snapshots and V12 search indexes. V1–V12 are accepted released history. JPA validates, never generates production schema. No Project/Style or later transaction-workflow tables exist yet.

Supplier and facility ordinary aggregate persistence uses JPA with optimistic versions. Source upserts, recursive integrity checks, typed citations, reference updates and directory search use JdbcClient/explicit SQL where the database operation is clearer. Mutable SQL-backed records compare versions. Identity resolution locks the source record and atomically creates a canonical row, typed binding, citation and audit event. A repeated identity import returns its existing canonical ID, including archived records; it never auto-merges by name.

Platform mutations join the same transaction as their audit event. Audit states accept explicit scalar business fields only. Region/cluster/facility geography changes share transaction advisory lock 91101; capability-tree changes use 91102. PostgreSQL recursive triggers reject cycles and invalid facility relationships, including reference reparenting. These serialized writes favor integrity; measure throughput before bulk production imports.

## API and UI
Java DTOs → springdoc OpenAPI → openapi-typescript schema → openapi-fetch generic client → TanStack Query. One API client injects request IDs and in-memory authentication. React holds selected organization context; selection is advisory, backend authorization remains authoritative. CI regenerates and compares contract artifacts.

Accepted Phase 1C includes the application shell and buyer discovery/detail workspaces for Materials, Suppliers and Facilities. Listing, Price and Inventory reads and PLATFORM_ADMIN provenance/catalog/commercial/typed-identity curation are implemented. Query/cache ownership uses opaque Actor session scopes; capability pending/error fails closed, revocation removes protected state, and Actor changes cancel/clear owned requests and drafts. BigDecimal crosses HTTP as exact plain decimal strings. Capability and Fabric/Leather first writes use explicit `If-None-Match: *`, with failed precondition 412, missing update 404 and stale update 409. See the [cumulative audit](phase-1c-final-pre-merge-audit.md).

## Planned Phase 2 boundary (not implemented)

[Phase 2 Product Workspace](phase-2-plan.md) introduces private Organization → Project → Style data, authorized by OrganizationAuthorization. PLATFORM_ADMIN alone grants no private tenant access. Separate top-level project and style modules permit style → project only; descendants use public immutable parent contracts. Global catalog ownership does not move into a Project. Organization-scoped keys and cancellation/remount on Organization switch are new work, not an existing guarantee of the current selected-organization state alone.

Current file storage has organization-authorized binary put/get but no persistent Style attachment relation, upload HTTP endpoint or generic object HTTP getter. Phase 2F's planned metadata/failure protocol and necessary narrow file-contract extension are specified in the plan. No outbox, new dependency or infrastructure is justified by this plan.

## Auxiliary systems
Workers are README-only. Future Python 3.14 + uv workers call controlled Java interfaces and never independently write transactional truth. Terraform is a valid nondeployed skeleton. Production storage, Cognito browser login and AWS resource provisioning remain configuration-dependent deployment work.
