# Data Model

## Implemented through Measurement Foundation (3A)

Flyway owns schema; Hibernate uses ddl-auto=validate. Accepted V1–V17 remain byte-identical. Separately authorized 3A introduces V18, pending independent slice review, with 18 migrations, 50 public base tables including Flyway history and 49 application base tables. UUID keys, UTC timestamptz, foreign keys, explicit lifecycle states and versions only where the domain is mutable are established conventions. Identity remains issuer+subject, with no separate user table.

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
| V18 | MeasurementSpec, immutable MeasurementRevision and relational MeasurementPoint snapshots; sealed construction, deferred completeness and serialized sequence guards |

Quantity/money are already NUMERIC/BigDecimal, externally exact decimal strings. MaterialVariant and Listing each reference Material; Listing does not store variantId. Composite unique keys on `(id, material_id)` already support consistent references. Global catalog records are not buyer-Organization-owned. Supplier/Facility early citation APIs append only; their DB edges do not have all the later V9/V10 mutation guards, as recorded in the accepted contract lock.

Project/Style/Requirement/Reference hard DELETE and TRUNCATE are blocked; Selection/Candidate individual unlink DELETE is supported while TRUNCATE remains blocked. Reference PENDING/FAILED/DETACHED metadata and any corresponding bytes are intentionally retained. Storage objects have no fictitious relational registry/FK. See the accepted [2F contract](phase-2f-style-development-references.md) and [2G validation](phase-2g-cumulative-hardening.md).

## Measurement integrity and future Phase 3 schema

[Phase 3 PLAN](phase-3-plan.md) itself changed no schema. [3A](phase-3a-measurement-foundation.md) now implements V18. V19 Pattern/revision foundation, V20 artifact/import, V21 grading and later QA/release remain future, separately approved slices; V19+ is absent. No speculative tables, dummy migrations or Tech Pack/BOM/Sample reservations.

MeasurementSpec is unique per Style and has no mutable business fields. Its deferred insertion constraint requires sealed revision 1 at commit. Each revision's separate deferred constraint requires sealed=true, 1..500 points and positions exactly 0..N−1. Points may be inserted only while the new parent revision is unsealed inside the creation transaction; after sealing no point insertion/update/delete is allowed. The only revision update is false→true sealing with every other column identical. Spec/revision/point deletion and truncation are forbidden. There is no quality status, mutable version or currentRevisionId. A sequence trigger locks only the owning spec and requires exactly latest+1; application writes first lock Project→Style→Spec and compare expected latest. Exact values/tolerances are NUMERIC(19,4)/BigDecimal/JSON strings.

V18 supplies UNIQUE(id,style_id) on both spec and revision, with (measurement_spec_id,style_id) referencing the spec's owner-aware key. Future 3B can target measurement_revision(id,style_id) for same-Style integrity without Java-only ownership validation. No Pattern table/FK is created yet. Future 3C must preserve artifactless historical Pattern revisions and fix artifact identity at new revision creation. Accepted later migrations become immutable; correction uses a new additive migration.
