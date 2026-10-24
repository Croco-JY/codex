# Data Model

## Implemented through accepted Phase 2

Flyway owns schema; Hibernate uses ddl-auto=validate. V1–V17 are released and immutable. Latest accepted schema has 17 migrations, 47 public base tables including Flyway history and 46 application base tables. UUID keys, UTC timestamptz, foreign keys, explicit lifecycle states and versions where the domain is mutable are established conventions. Identity remains issuer+subject, with no separate user table.

| Migration | Implemented ownership |
| --- | --- |
| V1–V2 | Organization, Membership and append-only Audit with truncate guard |
| V3–V4 | ORGANIZATION/PLATFORM audit scope and active platform-role grants |
| V5 | Country, Region and Industrial Cluster with geographic integrity |
| V6 | Source, persistent SourceRecord identity, immutable Observation and appended Review |
| V7 | Supplier profile/roles/aliases/verification, account-link history, typed identity and citations |
| V8 | Facility, Capability, assignments and typed identity/citations |
| V9 | Material, Variant, Fabric/Leather specs, Fiber, Composition, Seller Listing and typed evidence/bindings |
| V10 | Price and same-provider evidence; immutable facts except one closure |
| V11 | Append-only Inventory snapshots with imported/manual identities |
| V12 | Bounded Material/commercial search indexes |
| V13 | Private Project/Style hierarchy, independent versions/lifecycle and destruction guards |
| V14 | Singular Style Requirement, exact planning targets and optimistic version |
| V15 | Immutable removable Style Material Selection; NULL-aware scope uniqueness and composite catalog FKs |
| V16 | Immutable removable Style Facility Candidate; Facility-only reference and Style/Facility uniqueness |
| V17 | Durable Style Development Reference metadata, unique object identity, guarded upload/detach state machine; no bytes in PostgreSQL |

Quantity/money are already NUMERIC/BigDecimal, externally exact decimal strings. MaterialVariant and Listing each reference Material; Listing does not store variantId. Composite unique keys on `(id, material_id)` already support consistent references. Global catalog records are not buyer-Organization-owned. Supplier/Facility early citation APIs append only; their DB edges do not have all the later V9/V10 mutation guards, as recorded in the accepted contract lock.

Project/Style/Requirement/Reference hard DELETE and TRUNCATE are blocked; Selection/Candidate individual unlink DELETE is supported while TRUNCATE remains blocked. Reference PENDING/FAILED/DETACHED metadata and any corresponding bytes are intentionally retained. Storage objects have no fictitious relational registry/FK. See the accepted [2F contract](phase-2f-style-development-references.md) and [2G validation](phase-2g-cumulative-hardening.md).

## Planned Phase 3 — no migration in PLAN

[Phase 3](phase-3-plan.md) proposes V18 Measurement foundation, V19 Pattern/revision foundation, V20 artifact/import, V21 grading, and conditional QA/release schema in the following slices. Each separately approved slice owns only its actual next migration; no future tables, dummy migrations or Tech Pack/BOM/Sample reservations. PLAN leaves V1–V17 byte-identical and creates no V18.

Revisioned aggregate creation must atomically insert the stable identity, complete revision 1/children and audit. Revisions have server-assigned parent-unique numbers, immutable full snapshots and durable history. Latest is derived, without a duplicated currentRevisionId pointer. New revisions lock the stable aggregate and check expected latest; concurrent stale-head writes yield one N+1 and one 409, never silent N+2. POM/tolerance/grading values retain NUMERIC/BigDecimal/JSON-string authority.

3A/3B must lock a practical owner-aware relational constraint for optional same-Style PatternRevision → MeasurementRevision references; application-only unchecked UUID validation is insufficient. 3C must preserve artifactless historical revisions and fix artifact identity at new revision creation, with separately controlled operational upload state. Exact DDL belongs to those future specifications. Accepted later migrations become immutable; correction uses a new additive migration.
