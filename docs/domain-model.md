# Domain Model

Identity is an issuer/subject pair, not a password account. Organization has a UUID, lifecycle status and optimistic version. Membership relates an identity to an organization with an organization-specific role. Audit records append-only evidence. Storage keys never grant access.

Organization is an account, SupplierProfile is a canonical business and Facility is a site. Supplier creation never creates an account or membership. `supplier_organization_link` keeps ACTIVE/REVOKED history, permits one active organization per supplier and multiple suppliers per organization, and grants no canonical edit authority. Phase 1A exposes no claim/link mutation API.

Suppliers have multiple controlled roles, preserved aliases with search-only normalization, separate lifecycle/verification states and append-only verification events. A verification state change, its event and platform audit are atomic. Manual Phase 1A verification supports DISCOVERED/VERIFIED/AUDITED; future claim/transaction-derived states need their own proof workflows.

Facilities have their own country/region/cluster, independently of the supplier's country. Capabilities form same-category trees. FacilityCapability carries nullable exact NUMERIC quantities and units, not stars or fabricated zeroes. Supplier and facility lifecycle is ACTIVE/ARCHIVED; reference tables may use active booleans.

External identity is `(source, record_kind, normalized_external_record_key)`, with raw keys preserved and source-specific normalization. A typed `*_external_record` binds that identity to one canonical entity. A typed `*_source` instead cites an immutable DataSourceObservation for a fact. Reviews append separate evaluations without changing observations. See [ingestion](data-ingestion.md) and the [Phase 1A ERD and plan](phase-1-plan.md).

## Current accepted Phase 1

Material is the canonical catalog identity owned by its catalog Supplier. MaterialVariant and MaterialListing independently reference Material. A Listing identifies its Seller Supplier, which may differ from the catalog Supplier; there is no Listing→Variant parent relationship. Composition completeness is explicitly COMPLETE/PARTIAL/UNKNOWN. Fabric and Leather specifications are subtype-protected. Material supports DRAFT/ACTIVE/ARCHIVED; Variant and Listing use ACTIVE/ARCHIVED.

Price is a scoped immutable fact with append-only same-provider evidence and at most one versioned closure. Inventory is append-only observation history: known zero, no observation and unavailable reads are different. Neither is an order, reservation or ATP promise. Phase 1C provides authenticated buyer reads and protected curation for these existing domains, including five typed permanent bindings and atomic canonical create/reuse. Claim/link mutation, transaction-derived trust workflows and buyer Material price filtering remain deferred.

## Current accepted Phase 2

Organization → Project → Style is the implemented private development spine, accepted through [2G](phase-2g-cumulative-hardening.md) and integrated into main. Style UUID is the canonical manufactured-design identity. Its contextual children are one optional structured Requirement sheet, immutable removable Material Selection and Facility Candidate edges, and generic retained Development References. These do not change global catalog ownership, establish commercial snapshots or constitute BOM/RFQ/Tech Pack/Pattern entities. Requirement is target/intent, not a manufacturing measurement specification.

Organization membership authorizes the workspace; PLATFORM_ADMIN alone does not. Project/Style parents are immutable, each has its own version and ACTIVE/ARCHIVED lifecycle. Archived parents retain authorized reads, including READY attachment content, and block descendant writes. Selection/Candidate unlink physically removes only the private edge; Reference detach retains metadata/bytes and is terminal. PENDING/READY/FAILED/DETACHED are upload bookkeeping, not approval. Catalog references survive later global archival. The historical [Phase 2 plan](phase-2-plan.md) and accepted 2A–2G documents retain their original decision context; strict Project/Style timestamp validation is accepted baseline.

## Measurement, Pattern and private artifact foundations

[3A Measurement Foundation](phase-3a-measurement-foundation.md) implements private MeasurementSpec → MeasurementRevision → MeasurementPoint under Style. A spec is 0..1 per Style and can commit only with complete sealed revision 1. Each revision owns 1..500 ordered POM rows with unique machine codes, explicit MM/CM/IN units and exact decimal value/independent tolerance magnitudes. It has no review/approval/quality status. Internal authenticated creator provenance is immutable and is not exposed as raw issuer/subject through the API. New revisions require captured expectedLatestRevisionNumber; stale writers receive 409. Revisions/points cannot be amended, augmented or deleted after commit. Latest is derived, while every older full snapshot remains independently readable.

[3B](phase-3b-pattern-vault.md) adds 0..N Pattern identities/revisions. [3D](phase-3d-grading-foundation.md) adds independent Style-owned GradeRuleSets. Those revisioned aggregates create complete revision 1 atomically and retain linear immutable history. [3E](phase-3e-human-qa.md) adds optional append-only assessments of exact Pattern revisions; it requires no assessment during Pattern creation. Exact-revision release under the [Product Development / Pattern Operations plan](phase-3-plan.md) remains future. Downstream decisions pin exact revision IDs, never a latest alias.

The optional PatternRevision → MeasurementRevision link is same-Style only, scoped 404 for a foreign revision. V18 provides owner-aware unique keys and a spec/revision composite ownership FK now consumed by V19. Metadata-only 3B Pattern revisions must stay artifactless forever; 3C introduces artifacts only with a new revision and immutable association. Artifact lifecycle and QA/release workflow cannot rewrite substantive revision truth. Release grants bounded authorized access, not factory award, production approval or IP transfer. AI remains Phase 4, RFQ Phase 5, and Tech Pack/BOM/Sample ownership remains a separate decision.

## Phase 3B — Pattern identities and immutable metadata

[Pattern Vault](phase-3b-pattern-vault.md) implements 0..N Pattern per Style, each atomically created with immutable revision1. Stable Pattern owns ACTIVE/ARCHIVED operational lifecycle and lifecycle version; revision name/purpose/optional exact Measurement pin change only by creating a new revision. A revision pin is same-Style, application-scoped404 and DB composite-FK enforced. Null pin is valid; older pins never advance with Measurement latest. Lifecycle does not rewrite history, and revision creation does not advance lifecycle version/updatedAt. Archive is retirement, not QA. These metadata-only revisions remain artifactless forever; 3C adds immutable artifact identity only on new revisions and 3E records human assessments separately. Geometry validation and release remain future.

## Phase 3C — Artifact-bearing revisions

[Pattern Artifacts](phase-3c-pattern-artifacts.md) preserves artifactless 3B history forever. Adding a file creates a complete new PatternRevision plus one immutable artifact identity. PENDING/READY/FAILED describe storage bookkeeping only; declared PDF/AAMA/ASTM and envelope probe establish no geometry/QA/production truth. Bytes and tracked metadata are retained without overwrite/delete/GC. No artifact is a public capability or development release.

## Phase 3D — Independent grading rulebooks

A Style owns 0..N GradeRuleSets independently of Pattern and Measurement. Stable identity/lifecycle is separate from immutable GradeRuleSetRevision full snapshots. Ordered GradeSizes and GradeRules define a complete Cartesian GradeRuleValue matrix. Delta is an exact signed base-relative difference in explicit MM/CM/IN; every base-size delta is mathematical zero. No monotonicity, unit conversion, POM mapping, geometry compatibility or application is inferred. New substantive content creates a new full revision; archival retains every revision. See [3D](phase-3d-grading-foundation.md).

## Phase 3E — Exact revision human assessment

[PatternQaAssessment](phase-3e-human-qa.md) belongs to exactly one immutable PatternRevision, with 0..N independent append-only assessments numbered 1, 2, … . The current state is UNREVIEWED before any row, otherwise the latest outcome: OBSERVED, CHANGES_REQUESTED or HUMAN_REVIEWED. A newer PatternRevision inherits no QA; an active historical revision may be explicitly reassessed. No revision content, Measurement pin, artifact identity or lifecycle version changes.

METADATA_ONLY records an observation/change request without artifact attestation. READY_ARTIFACT must identify the same revision/Style's existing READY artifact. HUMAN_REVIEWED requires the latter and explicit authenticated human attestation plus notes; the server cannot prove actual inspection. It is not automated validation, sample/production approval, manufacturing authorization, release or IP transfer. Stored history remains an immutable account of review-time attestation even if a later authorized download detects a content-integrity failure. Existing download security remains authoritative. No grading application, QA binary upload, geometry or release is introduced.
