# Data Model

## Implemented through Phase 2G

Flyway owns schema; Hibernate uses ddl-auto=validate. V1–V17 are released and immutable. UUID keys, UTC timestamptz, foreign keys, explicit lifecycle states and version columns are established conventions. Identity remains issuer+subject, with no separate user table.

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
| V13 | Organization-owned Project and Style hierarchy; immutable parents and deletion guards |
| V14 | One per-Style Requirement sheet |
| V15 | Scoped private Material Selections pointing to global catalog |
| V16 | Private Style Facility Candidate referencing global Facility only |
| V17 | Per-Style Development Reference with committed upload reservation/finalization states and non-XA storage |

Quantity/money are already NUMERIC/BigDecimal, externally exact decimal strings. MaterialVariant and Listing each reference Material; Listing does not store variantId. Composite unique keys on `(id, material_id)` already support consistent references. Global catalog records are not buyer-Organization-owned. Supplier/Facility early citation APIs append only; their DB edges do not have all the later V9/V10 mutation guards, as recorded in the accepted contract lock.

## Proposed beyond V17 — no migration approved

[Phase 2 design history](phase-2-plan.md#21-migration-ownership-v13v17) was implemented and merged in PR #4. Any statements within earlier planning documents describing V13–V17 as future are historical snapshots of those planning stages, not the current merged state.

[Pattern-to-Transaction commercial readiness proposal](phase-3-commercial-readiness-contract.md) defines future Pattern Artifact, sealed revisions, Marker/Yield/BOM/Costing, immutable manufacturing specification release, guest supplier capability, BYOS private supplier overlay, Entitlement usage ledger and permissioned Data Intelligence. **No such new tables are yet implemented by this proposal.** Each requires fresh baseline inspection, approved independently scoped migrations after V17 and complete tenant/security/regression testing. In particular, V16 candidate is still global-Facility-only and must evolve through additive migration rather than rewriting V16.
