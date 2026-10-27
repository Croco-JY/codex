# Data Model

## Implemented through Human Pattern QA (3E)

Flyway owns schema; Hibernate uses ddl-auto=validate. Accepted V1–V21 remain byte-identical. Accepted 3A/3B/3C introduced V18/V19/V20; [3D](phase-3d-grading-foundation.md) and R01 are independently accepted. Separately authorized [3E](phase-3e-human-qa.md) adds V22, pending independent acceptance, with 22 migrations, 59 public base tables including Flyway history and 58 application base tables. UUID keys, UTC timestamptz, foreign keys, explicit lifecycle states and versions only where the domain is mutable are established conventions. Identity remains issuer+subject, with no separate user table.

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
| V19 | Pattern lifecycle and immutable metadata revisions; deferred revision1, active sequence guard and same-Style Measurement FK |
| V20 | New-revision artifact reservation, immutable identity/private digest and terminal READY/FAILED; old revision retrofit prohibited |
| V21 | Independent Style-owned GradeRuleSet, immutable ordered full snapshots and complete exact base-relative Size × Rule matrices |
| V22 | Exact PatternRevision human assessments, immutable linear history and same-revision READY evidence |

Quantity/money are already NUMERIC/BigDecimal, externally exact decimal strings. MaterialVariant and Listing each reference Material; Listing does not store variantId. Composite unique keys on `(id, material_id)` already support consistent references. Global catalog records are not buyer-Organization-owned. Supplier/Facility early citation APIs append only; their DB edges do not have all the later V9/V10 mutation guards, as recorded in the accepted contract lock.

Project/Style/Requirement/Reference hard DELETE and TRUNCATE are blocked; Selection/Candidate individual unlink DELETE is supported while TRUNCATE remains blocked. Reference PENDING/FAILED/DETACHED metadata and any corresponding bytes are intentionally retained. Storage objects have no fictitious relational registry/FK. See the accepted [2F contract](phase-2f-style-development-references.md) and [2G validation](phase-2g-cumulative-hardening.md).

## Measurement integrity and future Phase 3 schema

[Phase 3 PLAN](phase-3-plan.md) itself changed no schema. [3A](phase-3a-measurement-foundation.md) implements V18. [3B](phase-3b-pattern-vault.md) adds V19 Pattern/revision foundation. [3C](phase-3c-pattern-artifacts.md) adds V20 private artifacts on new revisions. [3D](phase-3d-grading-foundation.md) adds V21 grading, and [3E](phase-3e-human-qa.md) adds V22 human assessments. Release remains a separately approved future slice; V23+ is absent. No speculative tables, dummy migrations or Tech Pack/BOM/Sample reservations.

MeasurementSpec is unique per Style and has no mutable business fields. Its deferred insertion constraint requires sealed revision 1 at commit. Each revision's separate deferred constraint requires sealed=true, 1..500 points and positions exactly 0..N−1. Points may be inserted only while the new parent revision is unsealed inside the creation transaction; after sealing no point insertion/update/delete is allowed. The only revision update is false→true sealing with every other column identical. Spec/revision/point deletion and truncation are forbidden. There is no quality status, mutable version or currentRevisionId. A sequence trigger locks only the owning spec and requires exactly latest+1; application writes first lock Project→Style→Spec and compare expected latest. Exact values/tolerances are NUMERIC(19,4)/BigDecimal/JSON strings.

V18 supplies UNIQUE(id,style_id) on both spec and revision, with (measurement_spec_id,style_id) referencing the spec's owner-aware key. 3B now targets measurement_revision(id,style_id) for same-Style integrity without Java-only ownership validation. 3C preserves artifactless historical Pattern revisions and fixes artifact identity at new revision creation. Accepted later migrations become immutable; correction uses a new additive migration.

## V19 Pattern integrity

[3B](phase-3b-pattern-vault.md) introduced only pattern and pattern_revision, preserving V1–V18; V20+ was absent at that boundary. Pattern starts ACTIVE/v0, may only flip lifecycle with exact version+1 and immutable identity, and cannot be deleted/truncated. A deferred constraint requires revision1 at commit. A revision sequence trigger locks only its Pattern, requires ACTIVE and max+1. Revision UPDATE/DELETE/TRUNCATE are blocked. Owner-aware Pattern and Measurement composite FKs enforce same-Style relationships even through direct SQL. Null Measurement pin is intentional MATCH SIMPLE behavior. Name/purpose are canonical immutable revision content, never aggregate metadata. The 3B revision had no artifact/source/quality columns or speculative tables. Populated V18→V19 preserves Measurement and all older table values.

## V20 Pattern artifact integrity

See [3C](phase-3c-pattern-artifacts.md). V19 revision no-update trigger stays installed/enabled. The new immutable artifact_expected flag defaults false; deferred insertion integrity requires exactly one artifact for true. Old revisions cannot acquire artifacts. Private object UUID/digest/format/name/size are immutable, PENDING alone finalizes to terminal READY/FAILED, and artifact DELETE/TRUNCATE is blocked. No storage registry or garbage collection exists.

## V21 grading integrity

Exactly five tables: grade_rule_set, grade_rule_set_revision, grade_size, grade_rule and grade_rule_value. There is no Pattern FK or Measurement FK. The parent `(revision.id,base_size_code)` references `(grade_size.revision_id,code)` through an ALTER-added DEFERRABLE INITIALLY DEFERRED composite FK; GradeSize also references its parent revision. PKs, same-revision composite FKs, contiguous positions and exact cardinality prove the complete matrix.

Revision construction is unsealed insert→ordered children→multi-row values→seal→commit. A single revision-level deferred event validates final sealing, counts/order and mathematical base zero. Child insertion checks construction state under the parent lock; no child event scans the matrix. Immutable revision/child guards and statement-level destruction guards preserve history. Lifecycle-only stable version/timestamps remain independent of new revisions. Exact signed NUMERIC(19,4) values reject NaN; PostgreSQL typmod rejects infinities and may round direct-SQL over-scale input. API grammar rejects over-scale strings before persistence. Java code-point validation and V21's explicit boundary set agree without locale/POSIX whitespace assumptions. See [3D](phase-3d-grading-foundation.md) for observed migration and numeric evidence.

## V22 human assessment integrity

Exactly one new table, pattern_qa_assessment, references pattern_revision(id,style_id) and optional pattern_artifact(id). A BEFORE INSERT trigger resolves revision ownership, locks Pattern, requires ACTIVE, allocates/validates exact-revision max+1 and verifies any artifact belongs to that revision/Style and is READY. Unique(revision,assessment_number) supports reverse latest/history scans without a duplicate index. Statement guards reject UPDATE/DELETE/TRUNCATE, including empty-target statements and cascade truncation.

Three stored outcomes: OBSERVED, CHANGES_REQUESTED, HUMAN_REVIEWED. Metadata-only evidence requires null artifact and cannot claim HUMAN_REVIEWED. UNREVIEWED is derived, not a dummy row. Required notes contain 1–2,000 Unicode code points with the fixed 26-character boundary set; null, noncanonical boundaries and invalid input are rejected. Reviewer provenance is internal and reviewed_at is server-owned; DTOs expose no raw issuer/subject. No mutable QA aggregate/current pointer or old revision/artifact/grading rewrite. Fresh V22 and populated V21→V22 validate; all 57 old application-table snapshots are preserved and QA starts empty.
