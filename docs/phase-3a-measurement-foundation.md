# Phase 3A — Measurement Foundation

## Baseline and scope

Repository `Croco-JY/codex`, executable local checkout on `phase-3-pattern-operations`. Starting HEAD and required implementation parent: `7b6b5010294e35762f547e50b13c8c3912c13ca4` (`docs: lock phase 3 pattern operations plan`), parent/main `41c629cce3bcdf5abf776cf33784631a4e150667`. Local/origin/live GitHub HEAD equality, clean worktree, open PR count 0 and PLAN push CI [40120053666](https://github.com/Croco-JY/codex/actions/runs/40120053666), attempt 1 completed/success, were verified before edits.

The unchanged [Phase 3 PLAN](phase-3-plan.md), ADR 012 and accepted Phase 0–2/Correction A/2G contracts remain authority. 3A implements Measurement only: no Pattern/revision/artifact/import, grading, QA/release, AI, Tech Pack/BOM/Sample, commercial or production workflow. No V19+. A pre-existing accepted production defect would invoke Defect-Stop, not be silently patched here.

## Domain and module boundary

Organization → Project → Style → 0..1 MeasurementSpec → 1..N MeasurementRevision → 1..500 MeasurementPoint.

A spec never commits without complete revision 1. Each committed revision is an independently reconstructable immutable snapshot. Existence means only that the snapshot exists: no DRAFT/REVIEWED/APPROVED/PRODUCTION_VERIFIED status is introduced. Requirement remains target/intent, separate from structured manufacturing/development POM truth.

`com.sourceos.measurement` consumes only style, identity, audit and shared public contracts. All operations first use StyleService.readContext or lockContextForWrite; no direct Project/Style/Organization/Supply/file persistence dependency. JdbcClient statements own only the three Measurement tables. ApplicationModules.verify and reflected forbidden dependency tests pass. No reverse dependency or background worker is introduced.

## V18 and complete construction

Only `V18__measurement_revision.sql` is added. V1–V17 are byte-identical; V19+ absent. Fresh V18 has 18 applied migrations / 50 public base tables including Flyway history / 49 application tables. Populated V17→V18 snapshots every existing application table and verifies all prior rows unchanged, the three new tables empty, Flyway validation, then a legal complete construction. Historical upgrade targets remain unchanged; only latest-schema counts/table inventories advance.

- measurement_spec: id, unique style_id FK, created_at; immutable, no version/status/current pointer. UNIQUE(id,style_id) provides an owner-aware target.
- measurement_revision: id, measurement_spec_id, immutable server-derived style_id, revision_number, base_size, unit_system, internal created_by_issuer/subject, internal sealed, created_at. UNIQUE(spec,revision_number), UNIQUE(id,style_id), composite (spec,style) FK to measurement_spec(id,style_id). These keys allow future same-Style PatternRevision ownership enforcement without creating a Pattern table now.
- measurement_point: revision FK, position, code, label, value, optional independent tolerance magnitudes and notes. PK(revision,code), UNIQUE(revision,position). No opaque authoritative JSON, mutable row endpoint or standalone point identity.

The only explicit non-constraint index is revision history `(measurement_spec_id, revision_number DESC)`.

`sealed` is persistence-only construction state, never API/quality/workflow status. The protocol is insert revision unsealed → insert complete ordered points → seal false→true → commit. A BEFORE point INSERT guard locks/reads the parent and rejects missing or sealed revisions. The seal trigger permits false→true only when every other revision column is identical; all substantive/no-op/terminal updates are rejected. No point UPDATE/DELETE/TRUNCATE, spec UPDATE/DELETE/TRUNCATE or revision DELETE/TRUNCATE is permitted. No test cleanup bypass is added.

Two separate DEFERRABLE INITIALLY DEFERRED constraint triggers query authoritative final rows at commit: a new spec must have sealed revision 1; every new revision must be sealed with 1..500 points, min position 0, max position=count−1, and distinct-position count=count. They deliberately permit temporary in-transaction construction and reject unsealed/empty/gapped committed history. Inserting a pre-sealed revision cannot be used to add points afterward.

The revision-sequence BEFORE INSERT trigger locks only the owning spec and requires new number=max+1 (first=1). It never acquires Style/Project after Spec. Application order is Project → Style → Spec → construction. Tests use independent PostgreSQL sessions, latches, pg_blocking_pids and NOWAIT probes; they prove intended ordering/blocking, not mathematically zero deadlock risk.

## Validation and exact values

Codes are unchanged machine identity matching `^[A-Z0-9][A-Z0-9._/-]{0,79}$`; duplicate codes, whitespace/lowercase/unsupported punctuation are 400. Positions are derived from input-array order and cannot be submitted. Base size is trimmed 1..40, label trimmed 1..160, optional notes trimmed max1000 with blank→null; internal multiline notes are allowed. Application normalization covers outer browser-compatible whitespace; DB independently checks POSIX boundary whitespace. No category/size order is inferred.

Explicit unit enum MM/CM/IN has no implicit conversion. The empty create form requires unit selection; new drafts copy the latest explicit unit. Values/tolerances are nonnegative NUMERIC(19,4)/BigDecimal/JSON decimal strings, accepted lexical input `^[0-9]{1,15}(\.[0-9]{1,4})?$`. Leading-zero lexical forms may canonicalize numerically through PostgreSQL. Numeric JSON tokens, signs, exponents, NaN/Infinity and excess precision/range are rejected by feature-local strict Jackson deserializers. Existing DecimalJsonConfiguration/DecimalValues/exact-decimal helpers are unchanged.

Internal provenance comes only from IdentityService.current and remains immutable after membership changes. Public views/summaries contain no raw issuer/subject, sealed, version or quality status.

## API and bounded history

Root M is `/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/measurement-spec`.

| Operation ID | Method/path | Result |
| --- | --- | --- |
| readMeasurementSpec | GET M | 200 spec with full latest snapshot; absent 404 |
| createMeasurementSpec | PUT M, exactly one If-None-Match:* | 201 spec + revision 1; existing 412 |
| listMeasurementRevisions | GET M/revisions | 200 bounded summary page; absent spec 404 |
| readMeasurementRevision | GET M/revisions/{revisionId} | 200 full scoped snapshot, missing/foreign 404 |
| createMeasurementRevision | POST M/revisions | 201 complete N+1; stale expected latest 409 |

Create input is exactly baseSize/unitSystem/points. Later input adds required integer expectedLatestRevisionNumber in 1..9007199254740991. Each point accepts only code/label/value and optional nullable tolerances/notes. All input schemas set additionalProperties=false; global strict JSON parsing plus typed deserializers enforce the runtime shape. Caller IDs, positions, seal, provenance and timestamps are rejected.

The Measurement-specific singleton precondition reads actual header multiplicity, accepts only one `*` with legal HTTP SP/HTAB at its edges, and rejects missing/blank/other ETag/comma/multiple values as 400. It does not alter Requirement WritePreconditions or CORS. Parent authorization/lifecycle precedes this business check.

History limit defaults25, bounds1..100; optional inclusive maxRevisionNumber is 1..9007199254740991. Query `number<=max ORDER BY number DESC LIMIT limit+1`. Return items/limit/required nullable nextMaxRevisionNumber, equal to the extra row's number or null. No offset/total/hasMore. Summaries contain id/spec/style/number/baseSize/unit/pointCount/createdAt, no points or creator identity. No backend per-row detail read is used.

The frontend first reads spec.latestRevision=N and then history(max=N). A newer N+1 cannot drift into that anchored history. The pagination test reads 31..7, then commits32, then follows cursor6 to read6..1 with no duplicate/missing old revision or new head. Latest comes from descending history, not a duplicated currentRevisionId.

## Transactions, concurrency and audit

Initial create atomically locks active parents, validates header/snapshot, inserts spec, revision1, all points, seals and records two audits. ON CONFLICT(style_id) protects the singleton; serialized valid concurrent creates yield 201/412, one spec/revision1/snapshot and exactly two winning audits. No duplicate 409 is substituted.

Later creation locks parents/spec, reads current head under lock, compares captured expectedLatest, constructs/seals N+1 and records one revision audit. Two stale N requests yield 201/409, never silent N+2. Parent archive is tested in both winner orders for Project and Style: archive first denies409; revision first persists history and archive follows. Parent versions and canonical Supply snapshots remain unchanged.

An actual late failure is thrown by the test-owned outer transaction after sealed rows and both audits exist; rollback leaves zero new spec/revision/point/audit rows. No production failure flag/hook is used.

AuditRecorder adds exactly two scalar keys: measurementSpecId and measurementRevisionNumber. Safety/scalar limits and MANDATORY semantics are unchanged. Initial events are measurement_spec.created (MeasurementSpec, after={styleId}) and measurement_revision.created (MeasurementRevision, after={styleId,measurementSpecId,measurementRevisionNumber:1}); subsequent success has only the revision event. Before is null, scope ORGANIZATION, Actor/requestId authenticated. No POM values/tolerances/labels/notes/baseSize/raw creator payload enters audit. Failures/losers/rollback add no success audit.

OWNER/ADMIN read/write; VIEWER reads only; PLATFORM_ADMIN alone/foreign member denied403. All private endpoints authorize requested Organization before scoped Project→Style→Spec→Revision lookup. After requested-org permission, wrong hierarchy is404 without foreign facts. Committed revocation before the next phase denies403; no retroactive cancellation is claimed. Archived parents retain reads but all writes409; reactivation does not alter history. Safe Problem Details preserve requestId and hide SQL, payload and IdP identifiers.

## Lazy UI, requests and isolation

The lazy browser route is `.../styles/:styleId/measurements`, wrapped by Authenticated→WorkspaceGate. StyleDetail adds only a Measurements link: its four accepted Phase 2 child siblings are unchanged and ordinary StyleDetail Measurement HTTP requests=0.

Direct route budget: Project GET→Style GET→spec GET. Pending/invalid parents cause zero deeper requests. Spec404 alone is normal absence after valid parents; history/detail404 remains an error. Absent: spec1/history0/detail0. Existing: spec1 then history1 anchored to embedded latest, exact latest detail0. A 25-summary page has detail fanout0; explicit historical opening performs one scoped exact GET. Pattern/Grading/Release requests0; no speculative next-page load.

Workspace keys include Actor/Organization/Project/Style plus measurement-spec, measurement-revisions/limit/max or measurement-revision/id. Canonical Supply is never invalidated by Measurement success. Own spec/history reconciliation is bounded to this hierarchy; parent-sensitive409 explicitly refetches Project/Style. Query/command paths all use useWorkspace.run; current-generation403 denies the entire Organization workspace. Actor/Org generation boundaries abort/purge old private cache/mutation/draft/history state. Same-Actor Org switch preserves Supply; Actor switch clears old scope.

RHF/useFieldArray/Zod forms edit a cloned complete snapshot. Add/remove/reorder changes only unsaved array order. A new draft captures expectedLatest when begun, never silently adopting a background head. 409/412 retains draft, refetches authoritative spec/bounded history, displays draft/current baselines and requires explicit reconciliation that does not submit. Initial412 never automatically becomes POST. Network/5xx/malformed successful response (502) remains ambiguous, retains draft and refetches; matching content/N+1 is not attributed to this actor's lost request. Explicit reviewed absence can enable a new create-only attempt. Every mutation is retry:false; no transparent resend.

Strict runtime validators enforce UUID syntax, route/spec/revision ownership, safe integer numbers, canonical text, explicit-offset timestamps, units, exact decimal strings, 1..500 points, exact in-order positions and unique codes. Summary numbers descend at/below requested max and a cursor must be safe and strictly below the last returned number. Bad payload→ApiError502 with no invented defaults or reordered truth. VIEWER has read-only absence/history; archived parents have a clear read-only explanation and no mutation action.

Browser storage checks after editing inspect localStorage/sessionStorage/IndexedDB and URL: no unique private draft marker, credential marker or IndexedDB databases. Drafts/cursor stacks are memory-only. A→B/ABA/Actor tests include late reads, late mutation success/error and aborted pending commands; old callbacks do not clear/notice/invalidate replacement drafts.

## Validation evidence

| Check | Actual result |
| --- | --- |
| Complete backend verify | 693 tests; failures0/errors0/skips0 |
| New backend classes | API/validation, direct DB integrity, deterministic races, module boundary, contract and fresh/V17 migration coverage |
| Complete Vitest | 1,303 passed / 31 files; includes all accepted 1,198 tests |
| Typecheck/build | Passed |
| Same-origin full Playwright | 83 passed; no failures/skips |
| Separate-origin full Playwright | 83 passed; no failures/skips |
| Terraform 1.14.0 at infra/terraform | fmt -check, init -backend=false, validate passed; infra diff0 |
| Official exporter pass1/pass2 | Both passed; byte-identical output; existing API paths/schemas unchanged |
| Diff check / Gitleaks | git diff --check passed; standalone Gitleaks 8.28.0 staged changes: 0 findings; baseline→implementation commit scan is reported with the final execution result |

Test-harness corrections during development: direct service calls after MockMvc needed restoring the synthetic authenticated Actor; an anchored-history fixture needed to retain its old revision after a new head; Testing Library role-name strings are already exact (the Playwright-only exact option was removed from component-test types). An illegal LF header injected through MockMvc hit Spring's firewall rather than a valid HTTP precondition boundary; LF/Unicode whitespace rejection remains tested at the Measurement service, and HTTP tests retain legal ASCII invalid/multiple header cases. SecurityConfiguration/firewall was not changed. These are new-test corrections, not weakened accepted expectations or a concealed pre-3A production patch.

Both origin modes captured all eight Measurement states at 1440, 820, 768 and 390px: 32 per mode, 64 ignored captures total. Every capture asserts document.scrollWidth <= viewport width; overflow failures=0. Empty/create, multi-POM editing, revision 1, history, historical detail, real stale-head409, VIEWER and archived-parent states were covered. Representative desktop/mobile/tablet screenshots were directly inspected. Associated labels/field-error descriptions, keyboard Tab focus and visible focus, textual units/status/conflict, read-only role/archived explanations and explicit reconciliation controls were checked; no formal WCAG certification is claimed.

Final generated artifact SHA-256:

```text
d2404f6f83586c50f4a8c01c4e93c0552c0d507d97b0702713b93dbfe6cd5267  docs/openapi.json
b7f9161b6a7c5f1e1d6f2026e003238f9a39a34effaa78a8e66af490bf4129e3  apps/web/src/api/schema.ts
```

Existing accepted OpenAPI paths and schemas are structurally identical; additions are three hierarchical path entries/five stable operations and eight Measurement DTOs. Generated files are produced only by scripts/export-openapi.sh. No manually edited generated contract, new HTTP security permission or runtime dependency.

## Deployment and stop boundary

V18/backend are additive: deploy migration/compatible backend, verify health, then expose the frontend route. Old frontend remains valid; simultaneous release is unnecessary. No DB migration/storage/IdP/infrastructure shortcut, background reconciliation, generic idempotency framework or client persistence is added.

Required commit is `feat: add measurement revisions`, parent exactly the starting PLAN SHA above. Exact implementation SHA, changed-file manifest, local/origin/GitHub equality, clean tree and exact-head push CI are reported with the final execution result, not fabricated in advance. No PR. After that CI succeeds, STOP for independent 3A review. Pattern/PatternRevision/V19, artifacts/import/grading/QA/release/AI remain outside this slice; 3B requires its own approved specification after acceptance.
