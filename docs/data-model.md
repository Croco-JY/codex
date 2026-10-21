# Data Model

## Implemented through Phase 1C

Flyway owns schema; Hibernate uses ddl-auto=validate. V1–V12 are released and immutable. UUID keys, UTC timestamptz, foreign keys, explicit lifecycle states and version columns are established conventions. Identity remains issuer+subject, with no separate user table.

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

Quantity/money are already NUMERIC/BigDecimal, externally exact decimal strings. MaterialVariant and Listing each reference Material; Listing does not store variantId. Composite unique keys on `(id, material_id)` already support consistent references. Global catalog records are not buyer-Organization-owned. Supplier/Facility early citation APIs append only; their DB edges do not have all the later V9/V10 mutation guards, as recorded in the accepted contract lock.

## Planned, not migrated

[Phase 2 schema plan](phase-2-plan.md#21-migration-ownership-v13v17) reserves V13 Project+Style, V14 Requirement, V15 Material Selection, V16 Facility Candidate and V17 Development Reference. No V13 exists yet. Tables and constraints below that boundary are proposals until their individual slice is approved. No future table is pre-created in V13, and no accepted migration may be rewritten by a later slice.
