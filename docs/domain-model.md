# Domain Model

Identity is an issuer/subject pair, not a password account. Organization has a UUID, lifecycle status and optimistic version. Membership relates an identity to an organization with an organization-specific role. Audit records append-only evidence. Storage keys never grant access.

Organization is an account, SupplierProfile is a canonical business and Facility is a site. Supplier creation never creates an account or membership. `supplier_organization_link` keeps ACTIVE/REVOKED history, permits one active organization per supplier and multiple suppliers per organization, and grants no canonical edit authority. Phase 1A exposes no claim/link mutation API.

Suppliers have multiple controlled roles, preserved aliases with search-only normalization, separate lifecycle/verification states and append-only verification events. A verification state change, its event and platform audit are atomic. Manual Phase 1A verification supports DISCOVERED/VERIFIED/AUDITED; future claim/transaction-derived states need their own proof workflows.

Facilities have their own country/region/cluster, independently of the supplier's country. Capabilities form same-category trees. FacilityCapability carries nullable exact NUMERIC quantities and units, not stars or fabricated zeroes. Supplier and facility lifecycle is ACTIVE/ARCHIVED; reference tables may use active booleans.

External identity is `(source, record_kind, normalized_external_record_key)`, with raw keys preserved and source-specific normalization. A typed `*_external_record` binds that identity to one canonical entity. A typed `*_source` instead cites an immutable DataSourceObservation for a fact. Reviews append separate evaluations without changing observations. See [ingestion](data-ingestion.md) and the [Phase 1A ERD and plan](phase-1-plan.md).

Phase 1A adds only V3–V8. Material architecture remains undecided and must be reviewed before V9; no Material, price, inventory, claim or later-phase placeholders are implemented.
