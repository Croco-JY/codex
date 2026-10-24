# Domain Model

Identity is an issuer/subject pair, not a password account. Organization has a UUID, lifecycle status and optimistic version. Membership relates an identity to an organization with an organization-specific role. Audit records append-only evidence. Storage keys never grant access.

Organization is an account, SupplierProfile is a canonical business and Facility is a site. Supplier creation never creates an account or membership. `supplier_organization_link` keeps ACTIVE/REVOKED history, permits one active organization per supplier and multiple suppliers per organization, and grants no canonical edit authority. Phase 1A exposes no claim/link mutation API.

Suppliers have multiple controlled roles, preserved aliases with search-only normalization, separate lifecycle/verification states and append-only verification events. A verification state change, its event and platform audit are atomic. Manual Phase 1A verification supports DISCOVERED/VERIFIED/AUDITED; future claim/transaction-derived states need their own proof workflows.

Facilities have their own country/region/cluster, independently of the supplier's country. Capabilities form same-category trees. FacilityCapability carries nullable exact NUMERIC quantities and units, not stars or fabricated zeroes. Supplier and facility lifecycle is ACTIVE/ARCHIVED; reference tables may use active booleans.

External identity is `(source, record_kind, normalized_external_record_key)`, with raw keys preserved and source-specific normalization. A typed `*_external_record` binds that identity to one canonical entity. A typed `*_source` instead cites an immutable DataSourceObservation for a fact. Reviews append separate evaluations without changing observations. See [ingestion](data-ingestion.md) and the [Phase 1A ERD and plan](phase-1-plan.md).

## Current accepted Phase 1

Material is the canonical catalog identity owned by its catalog Supplier. MaterialVariant and MaterialListing independently reference Material. A Listing identifies its Seller Supplier, which may differ from the catalog Supplier; there is no Listing→Variant parent relationship. Composition completeness is explicitly COMPLETE/PARTIAL/UNKNOWN. Fabric and Leather specifications are subtype-protected. Material supports DRAFT/ACTIVE/ARCHIVED; Variant and Listing use ACTIVE/ARCHIVED.

Price is a scoped immutable fact with append-only same-provider evidence and at most one versioned closure. Inventory is append-only observation history: known zero, no observation and unavailable reads are different. Neither is an order, reservation or ATP promise. Phase 1C provides authenticated buyer reads and protected curation for these existing domains, including five typed permanent bindings and atomic canonical create/reuse. Claim/link mutation, transaction-derived trust workflows and buyer Material price filtering remain deferred.

## Planned Phase 2 (not implemented)

Organization → Project → Style is the private development spine. Style UUID is the canonical design identity. One optional structured Requirement sheet, Material Selections, Facility Candidates and generic Development References attach to Style. These private links do not change global catalog ownership, establish commercial snapshots or constitute BOM/RFQ/Tech Pack/Pattern entities.

Organization membership authorizes the workspace; PLATFORM_ADMIN alone does not. Project/Style parents are immutable, each has its own version and ACTIVE/ARCHIVED lifecycle, and archived parents block descendant writes. The exact planned contracts, relationship removal rules and later-phase exclusions are locked in [phase-2-plan.md](phase-2-plan.md). No Phase 2 table or API exists at this documentation baseline.
