# Phase 3D — Deterministic Grading RuleSet (Specification Lock / Review Draft)

> **Document status: SPEC-ONLY, NOT implementation authority.**
> Baseline: `Croco-JY/codex` / `phase-3-pattern-operations` / `7381303483644ba875305b413d7e3d6047f70aa1`, checked 2026-10-25.
> Actual migrations: V1–V17 on `main@41c629cce3bcdf5abf776cf33784631a4e150667` and V18 Measurement, V19 Pattern, V20 Pattern Artifact on Phase 3 branch. [3C completion](phase-3c-pattern-artifacts.md) records exact-HEAD push CI 40185095517 success; independent acceptance/main integration is distinct.
> Dependency: [Phase 3 contract lock](phase-3-plan.md), [ADR 012](adr/012-pattern-revision-model.md), [3C boundaries](phase-3c-pattern-artifacts.md). The architecture correction draft is tracked separately on branch `docs/phase-3c-commercial-boundary-correction` in `docs/phase-3c-commercial-boundary-review.md`, not merged into this baseline.
> **Hard stop:** No V21 migration, runtime code, worker, CAD parser, queue, UI, OpenAPI or generated-client edits from accepting this document. Implementation needs 3C independent acceptance, an independently approved Phase 3D execution task and a fresh exact HEAD, pre-merge repo PR/CI check.

## 1. Executive decision

3D will model **Style-owned, versioned grade rules for deterministic point-of-measure (POM) size progression**. It is **not** a CAD geometry grader, pattern-point translator, DXF parser, marker/yield solver, garment-fit simulator, manufacturing approval, sourcing RFQ or AI engine.

Customer-facing truth hierarchy:
- `MeasurementRevision` (V18): immutable actual reference POM values and baseSize/unit.
- `GradeRuleSet`: stable private business identity under Style.
- `GradeRuleSetRevision`: complete, sealed immutable ordered SizeRange, exact source MeasurementRevision, optional source PatternRevision context and complete signed transition deltas.
- **Derived Size × POM table**: pure deterministic arithmetic over immutable inputs. It may be calculated on demand, but cannot be labeled validated CAD geometry or production-approved specification.
- Later geometry engine may consume reviewed rules only by an independently versioned integration contract. It does not mutate 3D snapshots.

Why: grade-rule provenance, proper size ordering, exact arithmetic and stale-head concurrency are valuable today and independently testable with V18. Attempting DXF curve transformation without a real parser/coordinate model would create fictitious reliability and speculative infrastructure.

## 2. What exists / what does not

### Immutable accepted baseline
- `Style.id` is canonical manufactured design identity, under Organization → Project → Style.
- V18 `measurement_spec`: at most one per Style. `measurement_revision`: immutable, sealed, full snapshot, base_size (1..40), unit_system MM/CM/IN, 1..500 `measurement_point` rows with unique `code` and explicit contiguous `position`, `value` and optional tolerances as `numeric(19,4)`. `measurement_revision` has owner-aware UNIQUE(id,style_id). Units cross JSON as **exact decimal strings**.
- V19 `pattern` is private Style-owned and `pattern_revision` is an immutable metadata snapshot; measurement_revision_id is optional, same Style by composite FK. There may be several Patterns per Style and Pattern revisions cannot be rewritten.
- V20 `pattern_artifact`: at most one per new artifact-expected PatternRevision, PENDING → READY or FAILED; byte SHA-256 integrity; no geometry semantic guarantee. No legacy-revision retrofit.
- Existing top-level Module boundaries enforce parent-first authorization, no PLATFORM_ADMIN tenant bypass; no billing, BYOS, RFQ, release or external guest access at this stage.

### Specifically not present in the actual repository
- No grading aggregate, SizeRange, grade rule or computed graded-size storage.
- No interpreted PatternPiece / PatternPoint geometry, trustworthy DXF-AAMA/DXF-ASTM semantic parser, geometric units/curves, marker solver or grade construction.
- No Pattern manufacturing-release/approval metadata or escrow entitlement.
- No V21 currently implemented; V21 is the Phase 3 planning *candidate* for an independently authorized 3D implementation.

## 3. Scope: positive and negative

### In-scope for a separately authorized future 3D implementation
1. Style-owned GradeRuleSet aggregate and immutable complete GradeRuleSetRevisions.
2. Ordered size range, explicit anchor size, exact numeric signed grade step per POM per adjacent size transition, persistent source MeasurementRevision and optional contextual PatternRevision pin.
3. Deterministic size-by-POM calculation/reconstruction, with explicit source unit and error checks.
4. Scoped immutable create/read/page/revision history, parent lifecycle, concurrency, audit and lazy dedicated UI.
5. SQL-enforced ownership, revision 1 completeness, immutability, duplicate/range constraints; tests with real PostgreSQL.

### Out of scope
- Geometry parsing/normalization from PDF/DXF, CAD-piece/point curves and actual pattern resizing; AI/LLM/worker/queue/cron/outbox.
- Material cuttable width, marker efficiency, yield, BOM, costing, tech pack, sample, QC, release, share, RFQ/contract/payment, licensing or subscription usage.
- Adding `gradeRuleSetId` or other speculative refs to V18/V19/V20/Pattern Artifact; modifying any existing migration.
- Auto-resolving GradeRuleSet to mutable `latest PatternRevision` or `latest MeasurementRevision` at read/reconstruction time.
- Sharing across tenant boundaries, modifying global Supplier/Facility/Material, deduplicating files/CAS or new storage adapter.
- Any production-ready accuracy claim based on rule arithmetic alone.

## 4. Ownership, relational model and immutability decisions (proposal for later V21)

Names below are **contract candidates**, NOT DDL already created.

| Future logical entity | Identity / reference | Invariant |
| --- | --- | --- |
| `grade_rule_set` | id(UUID), style_id(FK Style), status ACTIVE/ARCHIVED, version, created/updated timestamps | Immutable style owner, no ordinary delete/truncate; lifecycle flip only with optimistic version/audit |
| `grade_rule_set_revision` | id, rule_set_id, style_id, revision_number, measurement_revision_id, optional pattern_revision_id, anchor_position, unit_system (must equal pinned measurement unit), creator/time | 1..N linear per aggregate; complete sealed snapshot, immutable content; full Style-matching owner FKs |
| `grade_size` | grade_revision_id, position, size_label | contiguous 0..sizeCount-1, 2..16 sizes, unique normalized labels (preserve original display labels); exactly one anchor position whose label equals pinned Measurement.baseSize |
| `grade_delta` | grade_revision_id, measurement_revision_id, pom_code, to_size_position, delta_from_previous numeric(19,4) signed | one row for each (pinned measurement POM × transition to_size_position in 1..sizeCount-1); no missing/duplicate/implicit zero; exact unit from pinned measurement |
| `grade_calculation` | NOT REQUIRED as a persisted table in 3D | derived transient server projection; no speculative mutable cache or results ledger |

The stable GradeRuleSet is **Style-owned**; its revisions may pin different MeasurementRevisions of *that same Style* only by explicit newly created revision. A later measurement update cannot alter prior rule semantics.

### Binding policy
- `measurement_revision_id` **required for the POM-based 3D calculation**; it must reference a sealed same-Style V18 revision. This is a contract decision to avoid grades with undefined base values. Not a mandatory second pin on existing V19 Pattern.
- `pattern_revision_id` **optional** and represents *context only*, never a geometry validation claim. When present, it must be a same-Style existing immutable V19 revision. If the source PatternRevision already pins a MeasurementRevision, it must equal the GradeRevision's measurement pin; conflict otherwise. If the Pattern has null measurement pin, grade revision may still pin its own measurement source without falsely claiming the Pattern's geometry was validated.
- A new PatternRevision can refer to the same MeasurementRevision while remaining independent of grade rules; no reverse write / FK into Pattern is created.
- Later release/QA/costing decide their own exact-reference approval contract; no assumed implied authorization now.

### DB constraints / completeness before authorizing V21
- Composite (id,style_id) / (parent_id,style_id) FKs to the correctly scoped Style/Measurement/Pattern identities. If duplicated source keys are required for `grade_delta` → V18 `measurement_point(measurement_revision_id,code)` and `grade_size` they must be DB-validated, not Java-only consistency.
- Unique (rule_set_id,revision_number), (grade_revision_id,position), (grade_revision_id,normalized_size_label), (grade_revision_id,measurement_revision_id,pom_code,to_size_position). No nullable-unique loopholes. Size normalization must be explicit, collision tested and must not erase visible label text.
- Deferred completeness at commit: on aggregate INSERT, revision 1 exists; on revision INSERT, all 2..16 sizes, exactly one known anchor, contiguous positions and **POM count × (size count - 1)** distinct delta records; all POM codes must match frozen measurement source; all are sealed. Failure rolls back entire aggregate/revision/audit. Old revision never acquires new grade rows.
- Construction pattern follows V18: permit child INSERT only while new owning revision is unsealed within its transaction; only permitted parent UPDATE is false→true sealed with all content identity unchanged; after seal block every grade_revision/size/delta UPDATE/DELETE/TRUNCATE by DB guard. No silent rollback/rewrite bypass.
- No write path that locks a MeasurementSpec/Pattern aggregate *after* GradeRuleSet locking. Immutable reference reading needs scoped ownership validation, not cross-aggregate mutation; avoid lock cycles. For same-Style reference correctness require direct SQL negative tests.
- Prototype numeric signed delta bounds, checked intermediate sums and net values. Any result outside MeasurementPoint legal value domain (nonnegative and <= 999999999999999.9999) is a **rejected revision** rather than clamped/display-corrected.
- No database-level recursion or wildcard application of rules from a different Style.

**Implementation review gate:** choose the minimal clean SQL DDL that enforces the above without an excessive O(N²) per-row trigger scan. Confirm a transaction-end single completeness check strategy and bounded worst-case data volume (500 POM × 15 transitions = 7500 delta rows); measure realistic cost before finalizing limits. Do not pre-create a generalized rules engine.

## 5. Deterministic arithmetic contract and worked fixture

Sizes are ordered by numeric `position`, never alphabetically (XS/S/M/L/XL/2XL). Anchor must match the source MeasurementRevision `baseSize` exactly after the established canonical label policy; ambiguous case/spacing synonyms require explicit user correction, not guessing.

For size positions 0,...,K-1 and each POM `p`, let `B_p` be its exact baseline `MeasurementPoint.value` at anchor position `a`. Let `d[p,i]` be the **signed transition from size i-1 to size i** for i=1..K-1. Derived value:
- `value[p,a] = B_p`
- For j > a: `value[p,j] = B_p + SUM(d[p,i] for i=a+1..j)`
- For j < a: `value[p,j] = B_p - SUM(d[p,i] for i=j+1..a)`

All arithmetic is authoritative Java BigDecimal plus PostgreSQL NUMERIC; transport JSON **plain decimal strings**. No IEEE-754 `Number`/JS `parseFloat` used to authoritatively compute results, no exponent or numeric-token acceptance, no silent unit conversion, no data-dependent rounding; input and output preserve `scale<=4` from V18. Intermediate arithmetic uses exact decimal scale and explicit range checks. Size-specific tolerance propagation is **NOT** inferred: baseline tolerances remain descriptive baseline fields unless a separate verified grading tolerance contract is approved.

Fixture (CM, baseline `M`, ordered [S,M,L], POM `CHEST` base 100.0000, steps S→M +4.0000 and M→L +4.0000):
- S = 96.0000; M = 100.0000; L = 104.0000.
Fixture (CM, `SLEEVE` base 60.0000, steps S→M +1.5000 and M→L +2.0000):
- S = 58.5000; M = 60.0000; L = 62.0000.
- Zero delta is explicit and distinct from an absent delta. Negative deltas are permitted where measurements shrink as sizes advance; negative *result* is forbidden. Invalid POM code, missing middle size or transition, duplicate size, overflow, incompatible unit, mis-anchored base size, changing measured source after seal must be rejected.

A grade-rule revision is **numeric sizing intent**, not a validated sampled garment and not an artifact suitable for automatic factory release.

## 6. Mutation, lock, conflict and authorization semantics

Identity/authorization chain: authenticated Actor → requested Organization membership → Project → Style → GradeRuleSet → exact GradeRevision (then child rows). Active Organization OWNER/ADMIN write, active VIEWER read, PLATFORM_ADMIN without membership 403. Requested Organization denied yields 403 **before resource lookups**; authorized Organization but wrong Project/Style/RuleSet/source POM/foreign revision is safe scoped 404 after hierarchy authorization. Invalid scalar/body shape is 400. Parent/aggregate archived returns 409 on writes; archived historical reads remain permitted. No supplier/guest/public principal route.

- Initial create commits stable GradeRuleSet + sealed full Revision 1 + complete ordered sizes + transition deltas + organization audit atomically. No empty persistent shell, no partial success audit, no fabrication.
- Revision N+1 requires `expectedLatestRevisionNumber=N`. Lock Project → Style → GradeRuleSet; determine latest only under aggregate lock. Two stale N writers: exactly one succeeds and the other gets 409, with winner-only audit and no silent N+2.
- GradeRuleSet archive/reactivate lifecycle uses optimistic version; historical rule revisions remain readable and unchanged. Do not let revocation/archive retroactively rewrite prior revisions. An archive between preflight and insert must be protected by parent lock checks.
- Snapshot integrity is content **by value**, not links to mutable current data. Immutable source V18 MeasurementRevision and V19 PatternRevision pins are sufficient; no index/latest alias captures.
- Commands `retry:false`. Ambiguous 5xx, network loss, malformed 201, timeout or stale conflict: preserve draft, reload authoritative history/versions, require explicit user reconciliation. Do not automatically resubmit a 7500-row matrix or infer success by matching label alone.
- Audit only actor and org from authenticated identity, bounded ID/revision number/size count/state; never full grade matrix, POM values, manufacturer private IP, JWT/raw OIDC or arbitrary request serialization. Transaction-MANDATORY, winner-only audit.

## 7. Domain topology, endpoints and client contract (future implementation proposal)

The `grading` module may depend on **public immutable `style`, `measurement` and optional `pattern` contracts**, authorization, identity/audit/shared. It must not reach other module's JPA entities/repositories or write V18/V19 data. Existing `style`/`pattern`/`measurement` modules never import `grading` (acyclic Modulith graph). Use provider accessors only for scoped immutable snapshots, not direct JDBC access to foreign tables.

Suggested REST shape, **not currently implemented**:
- `GET /api/v1/organizations/{org}/projects/{project}/styles/{style}/grade-rule-sets` (bounded list)
- `POST .../grade-rule-sets` (atomic create/revision1)
- `GET .../grade-rule-sets/{setId}` (summary/current)
- `GET .../grade-rule-sets/{setId}/revisions` (bounded immutable history)
- `GET .../grade-rule-sets/{setId}/revisions/{revId}` (complete snapshot with bounded rows, or explicit independently paged detail; decision required before approval)
- `POST .../grade-rule-sets/{setId}/revisions` (expectedLatestRevisionNumber)
- `GET .../grade-rule-sets/{setId}/revisions/{revId}/graded-measurements` (server-calculated read-only projection; no CAD output)
- `PATCH .../grade-rule-sets/{setId}` (lifecycle only, optimistic version)

Do not implement both cursor and offset without a contract; reuse accepted keyset conventions when revisions are paged, and avoid historical cursor mutation. Caps for complete matrix, JSON payload, line/entity counts, request size and read response size need explicit HTTP-bound budgets and honest status on excessive input (413 for bytes, 400 for invalid bounded counts). Never expose raw subject/tenant-provenance beyond authorized scope.

OpenAPI pipeline stays Java/springdoc → official exporter → `docs/openapi.json` → generated `apps/web/src/api/schema.ts` → openapi-fetch. No manual generated edits. Exact decimal strings must be explicitly tested in runtime schema/Zod and cross-language roundtrips. Route operations remain hypothetical until implementation approval.

## 8. Lazy UX contract

- GradeRuleSet list and editor are **dedicated, explicitly navigated** Style-scoped views. Opening StyleDetail preserves the existing *four Phase 2 child GETs*; opening Pattern list/detail/history never auto-hydrates grading.
- First grade screen loads only its own bounded list. A specific selected grade revision triggers exactly one intentional revision-detail request; calculation output is lazy/on demand, no N+1 fetch per size/POM/row.
- UI presents ordered sizes, anchor marker, source MeasurementRevision identity/unit, reference PatternRevision (if any), clear signed transitions and calculated values; labels such as **Rule-based estimate / Not CAD geometry / Not production validated** remain visible.
- Use keyboard-accessible grid/table with headers and labels; viewport-wide overflow 0 at 1440/820/768/390. A bounded *internal* horizontally scrollable matrix with accessible headers is permitted; no document-wide overflow. No color-only error/quality states, VIEWER sees no write controls.
- Strict Actor/org generation isolation A→B/ABA, revocation 403 removes private state; late mutation results cannot refill old workspace; private draft not persisted to local/session storage; loading/error of grading never affects successful sibling sections.
- Calculation display may use text formatting; prohibit JS float approximations as authoritative computed values.

## 9. Tests required before any 3D acceptance

**Relational and migration:** populated V20 → candidate V21 additive upgrade; V1–V20 byte-identical/triggers intact; old complete revision/READY artifact unchanged; fresh SQL and upgrade migrations. Direct SQL attempts at wrong-Style grade ↔ measurement/pattern, duplicate labels/order/transitions, missing POM, incomplete row matrix, fabricated revision1, mutation after seal, DELETE/TRUNCATE and invalid lifecycle all rejected.

**Numerical:** anchor at first/middle/last size, asymmetric transitions, zero/negative signed deltas, exact scale 4, limits/overflow, 500 POM × 16 sizes, unsupported unit/synonym, missing rule, 2 sizes, stale source, marker/yield absent. Fixture values above must match exactly across DB/API/frontend.

**Security:** two Organizations; OWNER/ADMIN/VIEWER; active PLATFORM_ADMIN but no membership; archived Project/Style/GradeRuleSet; wrong nested IDs; revoked membership before read/write; request/audit leakage of any POM value or raw auth credential. No cross-tenant public search or other Studio path.

**Concurrency:** actual PostgreSQL blocking proof for N→N+1 vs simultaneous stale submit (one 201, one 409), aggregate creation revision1 atomic rollback on late failure/audit, archiving races, wrong expected head, no automatic resend after lost response. Check SQL lock order against Pattern/Measurement and no reversed parent locks.

**Frontend:** no StyleDetail/Pattern initial grading GETs; lazy detail/calc GET count; 403 workspace denial, one-child 5xx isolation, Strict Timestamp validation and exact decimals; A→B/ABA/Actor; mobile grid internal scrolling and keyboard headers. Preserve all 3C upload/retention/download/CI regression outcomes, without weakening assertions/timeouts.

**Evidence:** exact implementation branch SHA; local/origin/GitHub equality, clean worktree; code diff limited to 3D-approved files and generated artifacts; 3C docs/authority unchanged; fresh complete CI and exposed step outcomes; no skipped/error-relaxed tests. A successful test summary alone is not independent acceptance.

## 10. Preconditions, open decisions and stop rule

Before authorizing a single `V21__...sql` implementation:
1. Verify independent Phase 3C acceptance, unchanged exact Phase 3C source SHA / integration disposition and repo-wide open PR gate, including separate spec-only PRs.
2. Decide whether the 3D feature is only POM rule arithmetic (this proposed scope) or requires actual CAD geometry grading. **If geometry is required, STOP** and obtain real DXF-AAMA/ASTM fixtures, permitted file use, parser security/performance evidence, deterministic piece-point mapping, size coordinate/units and validation/QA contract. Choose a separate Geometry/Parser ADR first. Do not smuggle a worker/queue/AI parser into grading.
3. Review 2..16 SizeRange, 500 POM and 7500 row worst-case cap against actual B2B use cases and max JSON request size. If too restrictive, adjust *before* locking V21, not via fragile post-release mutation.
4. Set label canonicalization, signed grade delta domain, fallback policy (none), PatternRevision optional pin consistency, paging/detail and source accessors, SQL deferred completeness performance, exact error codes.
5. Explicitly approve one slice scope and V21 only if implementation truly requires schema; no empty reserve migration. All future migration versions after V20 must be allocated by their actual approved slice and cannot be used for speculative billing/BYOS tables.

**STOP after publishing this spec for independent review. Do not modify current V1–V20, run implementation, add a parser/queue or create a Phase 3D PR that implies readiness to merge production changes.**

### One-sentence commercial interpretation

**3D makes approved measurement-based size rules traceable and repeatable; it is not yet automatic CAD grading, manufacturing readiness, Yield/BOM costing or Pattern Release.**
