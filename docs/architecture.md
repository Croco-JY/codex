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
- project / style: private Organization-owned workspace roots; style consumes the public Project boundary.
- stylerequirement: singular exact planning sheet, consuming Style context only.
- stylematerialselection: immutable private catalog-reference edges, consuming Style and Material/Listing reference providers.
- stylefacilitycandidate: immutable private Facility-reference edges, consuming Style and Facility public providers, without Supplier eligibility.
- styledevelopmentreference: durable private metadata and split upload transactions, consuming Style, AuthorizedStorage and audit.
- pattern: metadata-only immutable revision families, active/archive lifecycle and same-Style Measurement pin, consuming style/measurement/identity/audit/shared public contracts.
- measurement: Style-owned singleton spec and immutable complete revision/POM snapshots; consumes Style, IdentityService, AuditRecorder and shared validation only.

PlatformAuthorization checks active issuer/subject PLATFORM_ADMIN grants independently of organization policy. Canonical catalog reads require authentication; canonical mutations and source/provenance administration require platform authorization. Grant bootstrap is operator-only; see [runbook](platform-admin-bootstrap.md).

Spring Modulith verifies allowed dependencies and absence of cycles. Other modules cannot access organization entities/repositories or storage implementation classes. Cross-module contracts use IDs, immutable records and application services.

## Transactions
Organization creation, owner membership and audit evidence commit together. Rename uses optimistic version checking and audit evidence in the same transaction. Client organization IDs are never trusted: every protected Organization operation resolves active membership and role centrally. Global curation uses the separate platform policy.
Flyway V1 creates three foundation tables; V2 prevents audit truncation. V3 extends audit with ORGANIZATION/PLATFORM scopes without rewriting old events or disabling append-only guards. V4–V8 add the Phase 1A role/reference/provenance/Supplier/Facility model; V9 adds Materials/Variants/specifications/Composition/Listings, V10 Price/evidence, V11 Inventory snapshots and V12 search indexes. V13 adds Project/Style, V14 Requirement, V15 Material Selection, V16 Facility Candidate and V17 Development Reference. V1–V17 remain byte-identical. The separately authorized 3A adds V18 Measurement tables and construction/integrity guards; the historical PLAN itself changed no schema. JPA validates, never generates production schema.

Supplier and facility ordinary aggregate persistence uses JPA with optimistic versions. Source upserts, recursive integrity checks, typed citations, reference updates and directory search use JdbcClient/explicit SQL where the database operation is clearer. Mutable SQL-backed records compare versions. Identity resolution locks the source record and atomically creates a canonical row, typed binding, citation and audit event. A repeated identity import returns its existing canonical ID, including archived records; it never auto-merges by name.

Platform mutations join the same transaction as their audit event. Audit states accept explicit scalar business fields only. Region/cluster/facility geography changes share transaction advisory lock 91101; capability-tree changes use 91102. PostgreSQL recursive triggers reject cycles and invalid facility relationships, including reference reparenting. These serialized writes favor integrity; measure throughput before bulk production imports.

## API and UI
Java DTOs → springdoc OpenAPI → openapi-typescript schema → openapi-fetch generic client → TanStack Query. One API client injects request IDs and in-memory authentication. React holds selected organization context; selection is advisory, backend authorization remains authoritative. CI regenerates and compares contract artifacts.

Accepted Phase 1C includes the application shell and buyer discovery/detail workspaces for Materials, Suppliers and Facilities. Listing, Price and Inventory reads and PLATFORM_ADMIN provenance/catalog/commercial/typed-identity curation are implemented. Query/cache ownership uses opaque Actor session scopes; capability pending/error fails closed, revocation removes protected state, and Actor changes cancel/clear owned requests and drafts. BigDecimal crosses HTTP as exact plain decimal strings. Capability and Fabric/Leather first writes use explicit `If-None-Match: *`, with failed precondition 412, missing update 404 and stale update 409. See the [cumulative audit](phase-1c-final-pre-merge-audit.md).

## Current accepted Phase 2 boundary

[Phase 2 Product Workspace](phase-2-plan.md) is implemented through [2G](phase-2g-cumulative-hardening.md) and integrated into main. OrganizationAuthorization protects private Organization → Project → Style data; PLATFORM_ADMIN alone grants no tenant access. Top-level modules permit style → project, with descendants consuming StyleService readContext/lockContextForWrite and immutable public provider contracts. No child queries foreign Project/Style persistence. Global catalog ownership never moves into a Project.

Writes lock Project → Style before the child/provider: Requirement; Material → optional Variant → optional Listing; Facility; or Reference. Catalog registration uses provider-owned MANDATORY/FOR SHARE locks. Private edges survive later global archive. Project/Style archive blocks descendant writes, including unlink/detach, while historical reads and READY content remain authorized-readable. Child writes preserve parent versions and canonical Supply truth.

Style Development References have PENDING/READY/FAILED/DETACHED metadata and Organization-authorized create-only putNew/get. Reservation commits before binary I/O; storage runs outside SQL transaction; finalization reauthorizes and locks parents/reference. Metadata and corresponding retained bytes are not physically collected. Downloads traverse the private hierarchy and use safe attachment/octet-stream headers. There is no generic object HTTP getter or delete, outbox, GC worker or reverse file→workspace dependency.

Private cache ownership includes Actor scope, Organization and monotonic generation. Org switch clears private state but preserves same-Actor Supply; Actor switch clears Actor-owned state. Parent-gated Style detail retains four independent child sections. Current-generation child 403 denies the workspace; other child failures stay local. Strict Project/Style timezone-aware timestamps, exact decimal strings, trusted transport and late binary isolation are accepted baseline.

## Phase 3 foundations and future operations

[3A](phase-3a-measurement-foundation.md) implements atomic MeasurementSpec+revision 1+POM+audit, and subsequent complete immutable revisions. Application writes lock Project→Style→Spec, compare expected latest and construct/seal the snapshot in one SQL transaction. A DB sequence trigger locks only the owning spec; deferred commit checks forbid empty/unsealed/gapped snapshots. No point can be added after seal. Latest is derived, with no mutable pointer/version/quality status. Composite owner-aware keys are ready for future same-Style Pattern references. History uses revision-number keyset bounds anchored to the spec response, not offsets or per-row detail hydration.

The unchanged [Phase 3 PLAN](phase-3-plan.md) and [ADR 012](adr/012-pattern-revision-model.md) govern Pattern and future artifact/Grading/QA/release implementation. Stable aggregates must atomically create revision 1, revisions remain complete immutable snapshots, and stale-head races produce one N+1 / one 409. Same-Style Pattern→Measurement references must consume the owner-aware DB target and scoped public provider boundaries.

Measurement now consumes style/identity/audit/shared, with own-table JDBC only. Pattern consumes style+measurement (artifact path→file); grading consumes only style/identity/audit/shared. Future patternqa→pattern and patternrelease→pattern/required public authorization/file contracts remain separately scoped. No reverse Style/Measurement/File dependency, foreign Repository/Entity/JDBC shortcut or worker-owned transactional truth. Java/PostgreSQL commits business truth; Python may later supply Phase 4 proposals.

Historical 3B artifactless revisions remain artifactless. 3C artifact introduction/replacement creates a new revision with immutable artifact identity; only explicitly modeled upload lifecycle changes afterward. Its separately specified non-XA protocol inherits authorization, retention and create-only lessons from 2F, without silently increasing the 10 MiB cap. QA assesses exact revisions; release grants bounded authorized access, not RFQ/award/production or IP transfer.

Measurements is a lazy Style-contextual route and preserves StyleDetail's four Phase 2 child requests with zero Measurement prefetch. It inherits strict timestamps/exact strings, Actor/Organization generations, current-generation 403 workspace denial and retry:false commands. The PLAN remains historical documentation-only authority; 3A adds only the separately specified Measurement API/UI/V18, without dependency, infrastructure or CORS changes. 3B now adds metadata-only Pattern/V19 as described below; 3C now adds V20 artifact storage as described below; 3D adds independent Style-owned grading/V21 below; geometry/preview/QA/release and V22+ remain unimplemented. AI is Phase 4, RFQ Phase 5; Tech Pack/BOM/Sample and paid Pattern pricing need separate decisions.

## Auxiliary systems
Workers are README-only. Future Python 3.14 + uv workers call controlled Java interfaces and never independently write transactional truth. Terraform is a valid nondeployed skeleton. Production storage, Cognito browser login and AWS resource provisioning remain configuration-dependent deployment work.

## Phase 3B Pattern Vault

[3B](phase-3b-pattern-vault.md) adds V19 Pattern/PatternRevision. Project→Style→optional immutable Measurement reference read→Pattern locks serialize revisions/lifecycle. Pattern-owned SQL touches only its two tables; the additive Measurement provider returns four identity scalars with no POM hydration/write locks. Deferred revision1, active sequence, immutable revision and owner-aware FKs enforce durable history. Pattern lifecycle version/time changes only on actual status flips; revision creation leaves both unchanged. Lists use one bounded LATERAL query and resource/Style/filter-bound keysets, not per-item hydration. Lazy Patterns list/detail routes preserve ordinary StyleDetail's four Phase2 children and zero Phase3 prefetch. 3B has no file/source/quality/geometry/grading/QA/release path; 3C requires a new revision for artifact introduction. Dependencies, security configuration and deployment topology remain unchanged.

## Phase 3C tracked Pattern artifacts

[3C](phase-3c-pattern-artifacts.md) adds Pattern-owned artifact persistence and consumes AuthorizedStorage through the existing public file boundary. A separate proxied transaction component performs short preflight, TX1 reservation and TX2 finalization; buffering/probe/hash/put/read-back occur outside SQL. Every phase reauthorizes hierarchy/lifecycle. Mandatory size+SHA read-back precedes READY; authorization denial never becomes storage failure. V20 adds no reverse file dependency, parser framework or background work. Existing APIs remain structurally identical.

## Phase 3D deterministic grading foundation

[3D](phase-3d-grading-foundation.md) introduces `com.sourceos.grading`, with own-table JDBC and only the public Style, Identity, Audit and Shared providers. Project→Style→GradeRuleSet locks serialize lifecycle/revision commands. Lifecycle version and revision head are independent. V21 uses a deferred circular base-size FK and one deferred revision-level completeness event, with one combined value-count/base-zero aggregate scan. Values use a parameterized multi-row INSERT, not one network round trip per cell. No Pattern/Measurement/storage dependency, geometry engine, Worker or Queue is added.
