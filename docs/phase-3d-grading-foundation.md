# Phase 3D — Deterministic Grading Foundation

Status: implemented; **Independent Review Pending**. This completion record supplements the accepted Phase 3A–3C documents, Phase 3 plan and ADR 012; it does not rewrite their contracts or the approved final specification's sections 0–27.

## Authority, baseline and boundary

Repository: `Croco-JY/codex`. Checkout: `/workspace/source-os-phase-3d`. Branch: `phase-3-pattern-operations`. Required starting HEAD and implementation parent: `7381303483644ba875305b413d7e3d6047f70aa1` (`feat: add pattern artifacts`). Live preflight confirmed local/origin/GitHub equality, clean source checkout, zero repository-wide open PRs, PR #6 closed without merge, and push CI [40185095517](https://github.com/Croco-JY/codex/actions/runs/40185095517), attempt 1, completed/success at that exact SHA. Baseline full backend verify passed 927 tests. Existing populated Testcontainers migration tests passed before production edits; historical Flyway checksums validated. The original `/workspace/codex` checkout and its `work` branch were preserved.

**GradeRuleSet is NOT a Geometry Engine.** It is Style-owned; one Style owns 0..N GradeRuleSets and needs no Pattern or Measurement to create one. GradeRuleSet has **no Pattern FK**, **no Measurement FK**, no corresponding service/repository/entity/storage dependencies, and **no automatic POM mapping**. Matching string codes establish no relationship or compatibility claim. There is no geometry parsing/transformation, CAD point movement, AI grading, preview, QA/release, Worker, Queue or speculative future-domain prebuild. V21 only; V22 is outside this slice.

The governing principle remains: downstream decisions identify exact immutable development revisions rather than reconstructing history from mutable latest state. Later geometry application requires a separately approved contract and exact GradeRuleSetRevision identity.

## Snapshot truth and exact decimals

The stable GradeRuleSet contains only identity, Style ownership, lifecycle status/version and timestamps. Revision creation does not change its lifecycle version/updatedAt or Project/Style versions. GradeRuleSetRevision is an **immutable full snapshot** of name, base size, unit, notes, ordered Sizes, ordered Rules and their complete Cartesian matrix. Size order and Rule order are explicit contiguous positions derived from request array order; code or fashion vocabulary never determines order. Duplicate labels/names are allowed; codes are unique within a revision.

Delta is **base-relative**, not an adjacent-size increment. Base-size Delta is mathematical zero, including `-0.0000`; no monotonicity, symmetry, spacing or unit conversion is assumed. The authoritative path is PostgreSQL `NUMERIC(19,4)` → Java `BigDecimal` → plain JSON decimal string. API grammar is `^-?[0-9]{1,15}(\.[0-9]{1,4})?$`; numeric tokens, exponent notation and over-scale strings are rejected before database coercion. Frontend drafts retain strings throughout. Serialization preserves exact mathematical value, not the original trailing-zero spelling.

Direct SQL observations distinguish representation from API validation: `1.23456` coerces to `1.2346` under the NUMERIC typmod; the API rejects that original input with 400. NaN is rejected by CHECK (SQLSTATE 23514). Infinity and -Infinity are rejected by the constrained numeric type (22003). NULL and out-of-range values are rejected. No float/double/parseFloat path is authoritative.

Java/DB Unicode boundary rules are identical and independent of locale. The explicit set is U+0009–000D, U+0020, U+0085, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Application canonicalization strips only those outer characters; optional blank notes become null. SQL checks require already canonical nonempty stored text. Lengths count Unicode code points, consistent with PostgreSQL characters, rather than UTF-16 units. Unpaired surrogates and NUL are rejected at the application boundary. Differential tests compare all 63,487 nonzero, nonsurrogate BMP characters and supplementary-character limits; interior boundary characters remain valid.

## V21 integrity and migration evidence

`V21__grade_rule_set.sql` adds exactly five tables: `grade_rule_set`, `grade_rule_set_revision`, `grade_size`, `grade_rule`, `grade_rule_value`. Fresh PostgreSQL 18.3 migration produces **21 migrations, 58 public base tables including Flyway, 57 application tables**. V1–V20 remain byte-identical to the required parent; V22+ are absent.

The five tables have 12 indexes, 7 foreign keys and 22 custom triggers. V21 defines 8 functions and reuses the existing destruction-rejection function. PostgreSQL 18 catalog constraint counts are CHECK15/FK7/NOT NULL29/PK5/constraint-trigger2/UNIQUE5. The circular base relationship is the real relational constraint:

```sql
FOREIGN KEY (id, base_size_code)
REFERENCES grade_size(revision_id, code)
DEFERRABLE INITIALLY DEFERRED
```

`grade_revision_base_size_fk` is confirmed deferrable and initially deferred in the live catalog. Composite same-revision Rule/Size FKs plus the Value triple PK establish valid distinct pairs. The revision-level deferred check requires sealed=true, 2..30 Sizes, 1..100 Rules, contiguous unique positions, an existing base size, exactly SizeCount×RuleCount Values and zero base deltas. Together these prove the complete Cartesian matrix. A separate aggregate-level deferred check requires sealed Revision 1, prohibiting empty aggregates. Direct SQL cannot commit unsealed/partial revisions, skip revision numbers, create a revision on an archived aggregate or attach cross-revision children.

The sequence guard locks the owning GradeRuleSet and requires latest+1, with initial sealed=false. The sole revision UPDATE is false→true sealing with every substantive field unchanged. Child INSERT checks construction state; all child UPDATE/DELETE/TRUNCATE and stable/revision DELETE/TRUNCATE are rejected, including statement-level empty-target attempts. Raw same-status lifecycle UPDATE is rejected; only a status transition with version+1 and strictly increasing updatedAt is permitted. No production test mode, cleanup flag, trigger disable or guard bypass exists.

Completeness is attached once to the new revision INSERT as a deferred event. Child insertion does only construction/FK checks. One aggregate query combines Value count and invalid-base count; no full matrix scan occurs per Value or as a duplicate seal-time scan. A measured ordinary maximum transaction executes the deferred completeness function **once**.

`GradingMigrationTest` first migrates an isolated PostgreSQL Testcontainer to explicit V20 and validates it, populates Organization/Project/Style, Measurement revisions, Pattern revisions and PENDING/READY/FAILED PatternArtifacts, snapshots all 52 existing application tables, applies V21 and validates again. All prior business data and historical states are unchanged, existing trigger definitions/enabled states are preserved, and the five new tables are empty immediately after upgrade. Fresh V21 and historical explicitly targeted V18/V19/V20 tests pass. No external or production database fixture is used. Existing latest-inventory tests change only expected counts/new tables; historical tests retain explicit historical targets.

## Transactions, authorization and audit

Grading uses the public `StyleService.lockContextForWrite` boundary for Project→Style locking before locking GradeRuleSet. All initial/full-snapshot construction, sealing and bounded audits share one transaction. Seven test-owned rollback injection stages cover aggregate/revision/Size/Rule/Value/seal/audit; after each failure there are no new business rows or success audits. Failure injection exists only in tests.

Independent PostgreSQL transactions with latches and actual `pg_blocking_pids` evidence prove the following; sleep-only timing is not used as race proof. NOWAIT probes verify Project→Style→GradeRuleSet lock acquisition order.

| Race | Observed committed result |
|---|---|
| Two writers with expected latest N | One 201/N+1; one 409; no N+2; winner-only audit |
| Two lifecycle commands at version 0 | One 200/version1; one 409; one audit |
| GradeRuleSet archive first, then revision | Archive200, revision409 |
| Revision first, then GradeRuleSet archive | Revision201 retained, archive200 |
| Project archive vs create/revision, both orders | Archive-first rejects write409; write-first commits then archive200 |
| Style archive vs create/revision, both orders | Same ordering guarantees and preserved history |
| Two direct-SQL expected revision2 insertions | Second insertion blocks, then rejects stale sequence after first commit |

Organization authorization precedes hierarchy resolution and scoped Grading reads. OWNER/ADMIN write; VIEWER reads. PLATFORM_ADMIN without requested Organization membership gets 403. Foreign/wrong hierarchy identities return scoped404; archived Project/Style permit reads and reject writes409; archived GradeRuleSet preserves full/history/exact reads and rejects new revisions409. Membership revocation and actor isolation are covered. Creator issuer/subject and sealed never appear in public DTOs.

Audit allowlist additions are only `gradeRuleSetId`, `gradeRuleSetRevisionNumber`, `gradeSizeCount`, `gradeRuleCount`; existing safe styleId/status/version scalars are reused. Initial create emits aggregate.created and revision.created, later snapshots revision.created, lifecycle archive/reactivate one event. No names, notes, codes, labels, deltas, matrix or raw creator identities enter metadata. Errors, rollback, stale losers and same-status no-ops emit no success audit. Current-version same-status lifecycle returns200 with zero SQL UPDATE, zero audit and unchanged version/updatedAt; stale same-status commands return409.

## API, query discipline and contracts

Exactly seven operations are added under the authorized Organization/Project/Style hierarchy: list/create/read/lifecycle and list/create/read-exact revisions. There is no delete, patch, append, geometry or apply endpoint. POST aggregate returns201 full GradeRuleSetView with exact Revision1; POST revision returns201 full revision; PUT lifecycle returns200 compact lifecycle+summary. Lists/history use summaries without matrices. Full exact hydration uses four bounded revision/Size/Rule/Value queries, never one query per cell/Rule/Size.

The collection has one set-oriented lateral latest-summary query, keyset createdAt DESC/id DESC and context bound to resource/Organization/Project/Style/filter. History is revisionNumber DESC with inclusive max anchor, limit+1 lookahead and the first unreturned revision as nextMaxRevisionNumber. The first history page is anchored to the detail's latest number, so a concurrent new head does not enter old anchored history. There is no mutable current/latest pointer, offset or total count.

Actual service SQL EXPLAIN ANALYZE on the synthetic maximum fixture measured collection ACTIVE0.239ms, ALL0.207ms, history0.136ms and latest0.083ms. ACTIVE uses the style/status page index; ALL uses a style-scoped index access and planner-selected small-result sort. Latest/history scan the existing unique aggregate/revision-number index backwards. Summary count subplans read only Sizes/Rules, never Value matrices; tiny Size tables may reasonably receive sequential scans. Collection requires no application N+1 calls. No redundant standalone revision index is added. These fixture plans/times are observations, not a production SLA.

Strict local JSON parsing rejects unknown properties at every nesting level, duplicate keys, trailing tokens, wrong scalar types and caller-selected positions/revision numbers. It does not change shared Jackson or security settings. Runtime frontend hydration validates canonical UUIDs, scoped ownership, safe integers, offset-aware timestamps, code/position uniqueness, complete ordered values, mathematical base zero and history/page bounds; malformed success is ApiError502. All seven generated operation IDs and explicit DTOs are backend-owned.

Official exporter passes 1 and 2 produced byte-identical JSON and generated TypeScript. Compared with the required parent: removed paths0, changed existing paths0, removed schemas0, changed existing schemas0; added4 paths/7 operations/16 schemas. Generated files were not manually edited.

```text
a42f782ae0c9cfb27945a6380e748b38c3cfbb591751affa4309ff725d09d44b  docs/openapi.json
fbe55912e19cde9891260d3c05f8793bdeb00dfef0c5d645245759818c1d7533  apps/web/src/api/schema.ts
```

## Lazy UI, isolation and maximum matrix

Two lazy routes `/styles/:styleId/grading` and `/styles/:styleId/grading/:gradeRuleSetId` live under the existing Organization/Project/Authenticated/WorkspaceGate hierarchy. StyleDetail adds navigation only and retains its accepted four child reads. Browser counters prove StyleDetail Grading0/Pattern0/Measurement0/Artifact0; Grading list one collection/no detail/history/exact; detail one full detail plus one anchored history/no redundant exact latest. Only explicit historical selection fetches exact revision. Grading flows make no Pattern, Measurement or PatternArtifact binary requests.

The semantic table has a caption, column/row headers, labelled string inputs, visible focus, keyboard-accessible explicit size/rule add/remove/move controls, and text status/errors/base/unit/revision indicators. The maximum editor remains a plain table with native fieldset disabling and memoized stable fields; no grid framework, worker or global state dependency is added. The matrix contains horizontal scrolling while the document does not overflow.

Drafts are separate in-memory snapshots with a captured expected head. Background reads do not replace them. Stale409 and network/5xx/malformed-success ambiguity retain the draft and refresh authority; reconciliation explicitly advances the baseline without changing matrix values, submitting, merging or retrying. Matching server content never attributes command success. All mutations have retry:false. Writer archive uses explicit confirmation; VIEWER/archived hierarchies cannot mutate. A→B/ABA/actor changes discard private drafts; old-generation read/mutation/403 callbacks cannot alter current navigation, notices, cache or drafts. Current-generation403 denies the whole Organization workspace. No private matrix/draft is persisted in localStorage, sessionStorage, IndexedDB or URL.

Maximum real HTTP test includes 30 Sizes, 100 Rules, 3,000 Values and maximum-length code/Unicode text fields. Existing request/security configuration accepts it unchanged:

| Measurement | Actual observation |
|---|---:|
| Request JSON | 755,348 bytes |
| 201 full response | 757,484 bytes |
| Full detail response | 757,484 bytes |
| Input validation | 22.052ms |
| HTTP create including response | 502.430ms |
| HTTP detail including response | 73.400ms |
| Value multi-row insertion | 77.717ms |
| Seal UPDATE (without duplicate completeness scan) | 0.978ms |
| Deferred completeness, within commit | 1.051ms |
| Commit, including deferred check | 1.834ms |
| Exact four-query read | 21.308ms |
| Construction SQL statements | 6, including one Value INSERT |
| Exact revision read SQL statements | 4 |
| Full completeness validations/matrix aggregate scans | 1 per new revision |

The isolated construction measurement includes aggregate/revision/Size/Rule/Value/seal statements and separately reports read/commit. Actual HTTP create/detail instrumentation counts15/9 total JDBC statements including existing authorization/parent/audit boundaries; own grading statements10/6 include full response reads. Collection grading statement1, history2 including aggregate scope check, lifecycle no-op SQL UPDATE/audit0. There are no 3,000 remote round trips.

Maximum Chromium observations use shorter synthetic labels than the maximum-field HTTP test; these are distinct measured payloads. Both origins render all 3,000 cells, edit a string delta, traverse by keyboard, move a Rule and Size, retain the exact moved value through stale409, reconcile without resubmitting, explicitly save Revision3, and remove the private draft on Organization switch. Browser heap readings are observed `performance.memory.usedJSHeapSize`, not a portable memory bound or leak certification.

| Maximum browser observation | Same origin | Separate origin |
|---|---:|---:|
| Strict hydration | 5.9ms | 5.5ms |
| Response event to rendered-table assertion | 454.643ms | 481.103ms |
| Cell edit through browser action | 565.698ms | 660.885ms |
| Observed used JS heap | 115,339,090 bytes | 78,057,593 bytes |
| Explicit revision request bytes | 116,681 each | 116,681 each |
| Document/viewport width after maximum editing | 390/390 | 390/390 |
| Matrix contained horizontal scroll | yes | yes |
| Private draft cleared on Organization switch | yes | yes |

At widths1440/820/768/390, eleven states per origin produce **88 captures**: empty/latest/editor/historical/archived/conflict/ambiguous/VIEWER/archived-parents/maximum/maximum-editor. Automated assertions confirm document horizontal overflow0 at every capture and contained matrix scrolling. Representative desktop/tablet/mobile captures were visually inspected; focus, labels, semantic headers and textual status/error controls are tested. This is responsive/accessibility verification, not WCAG certification. Local screenshots/observations are ignored review artifacts under `.local/phase3d-review/`, not private persistent application storage.

## Final local verification and delivery boundary

| Verification | Result |
|---|---|
| `./mvnw -B verify` with environment-local repository/trust settings | 1,029 passed; failures0/errors0/skips0 |
| `ApplicationModules.verify()` | passed, including new Grading dependency boundary |
| Frontend typecheck | passed |
| Vitest | 1,552 passed / 36 files; no skips |
| Frontend production build | passed |
| Full same-origin Playwright | 104 passed |
| Full separate-origin Playwright | 104 passed; actual browser API origins asserted |
| Fresh V21 / populated V20→V21 / Flyway validate | passed, PostgreSQL18.3 |
| Historical populated migration tests | passed with historical targets retained |
| Official exporter ×2 | byte-identical; existing path/schema changes0 |
| Terraform1.14.0 fmt / init -backend=false / validate | passed, unchanged infra |
| `git diff --check` | passed |

New test totals exceed all accepted regression floors. Full verification includes existing Measurement/Pattern/Artifact, supplier/material/facility, Phase2 children, Organization switching, identity/OIDC/security and audit tests. No accepted 3A–3C production defect was found requiring an independent correction.

During development, fixes stayed in new 3D code/tests: explicit unit/base label association, native fieldset/memoization for the maximum editor, efficient test selectors for 3,000 labels, waiting for history availability before selecting a revision, and an explicit authoritative-detail response assertion before checking maximum conflict reconciliation. An intermediate full browser run had103 passed/1 failed at that conflict screen assertion; the final full runs above passed. A baseline StyleDetail unit test timed out only while competing validation jobs occupied the local host; isolated and serial full reruns passed without any existing assertion or timeout change. No historical tests were relaxed, retries added, guards weakened or security settings changed.

Dependencies/lockfiles, SecurityConfiguration, application settings, infra/workflow/compose, storage providers and the PatternArtifact protocol retain zero diff against the required parent. Historical accepted specification/completion documents are unchanged; only current aggregate documentation is updated. There is no production failure injection, extra migration or future-domain implementation.

The authorized delivery is exactly one `feat: add grading revisions` implementation commit with the required parent, push to this existing branch only, no PR, and verification of push CI at the exact new SHA on attempt1. Live open-PR gates are required immediately before commit, before push and at delivery. Final commit SHA, exact changed-file manifest, Gitleaks8.28.0 staged/baseline→final findings, remote equality and exact-head CI details are supplied in the delivery report after those actions; they cannot be embedded as self-referential facts in this commit. Implementation acceptance remains **Independent Review Pending**. Stop after delivery; no next slice starts automatically.
