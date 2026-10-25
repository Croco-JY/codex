# Phase 3B — Pattern Vault

## Baseline and authority

Executable local checkout of Croco-JY/codex on `phase-3-pattern-operations`, starting/required implementation parent `6d04cea4f4cde5be4db7d4a23703e7c7d0096c60` (`feat: add measurement revisions`), parent `7b6b5010294e35762f547e50b13c8c3912c13ca4`. Main remains `41c629cce3bcdf5abf776cf33784631a4e150667`. Before edits local/origin/live GitHub HEAD equality, clean worktree, open PR0 and accepted push CI [40130508106](https://github.com/Croco-JY/codex/actions/runs/40130508106), attempt1 completed/success, were verified. The unchanged [Phase 3 PLAN](phase-3-plan.md), [ADR012](adr/012-pattern-revision-model.md) and [3A](phase-3a-measurement-foundation.md) remain authority. A discovered accepted baseline defect requires Defect-Stop; none was corrected within this slice.

## Domain and module

Organization → Project → Style → 0..N Pattern → 1..N immutable PatternRevision. Pattern owns stable identity, Style, ACTIVE/ARCHIVED operational lifecycle, lifecycle version and timestamps. Each revision owns the canonical name, optional purpose, optional exact same-Style MeasurementRevision pin, server revision number and timestamp. Internal creator issuer/subject comes only from IdentityService.current and is not exposed publicly. Duplicate names identify separate legitimate families, not duplicates to merge.

Archive retires a family from active work; it is not quality rejection. Revision existence is not geometry/fit/review/production approval. No source-kind or quality-state field exists. All 3B revisions are permanently artifactless; 3C must create a new revision to introduce an artifact. No file/upload/download/storage, geometry, grading, QA, release, AI or commercial domain is added.

`pattern` depends only on style, measurement, identity, audit, shared. Own JdbcClient SQL touches only pattern/pattern_revision. Parent resolution uses StyleService.readContext / lockContextForWrite. The additive MeasurementService.ReferenceContext is exactly revisionId/measurementSpecId/styleId/revisionNumber; it authorizes and resolves the Style, its spec and exact scoped revision without POM hydration. It acquires no Measurement write lock. Pattern validates this optional reference after parent locks and before locking Pattern. No reverse dependency; ApplicationModules.verify and targeted dependency checks pass. Static review confirms no foreign-table Pattern SQL and no Pattern import in Measurement.

## V19 integrity

V1–V18 are byte-identical; the only new migration is `V19__pattern_revision.sql`, V20+ absent. Fresh latest inventory is 19 applied migrations, 52 public base tables including Flyway, 51 application tables. A populated V18→V19 test snapshots every earlier application table, including exact Measurement NUMERIC values and sealed POM rows, and verifies identical values afterward; only Pattern tables are new and empty. Historical upgrade targets remain intact, including explicit fresh V18 coverage.

Pattern has id PK, style FK, status, version0..9007199254740991 and created/updated timestamps, plus UNIQUE(id,style_id). A BEFORE INSERT guard requires ACTIVE/version0. UPDATE permits only an actual ACTIVE↔ARCHIVED flip with version+1 and advancing updated_at; id/style/created_at are immutable. Same-status DB UPDATE, identity move and version jump fail. The HTTP no-op executes no UPDATE and preserves version/time/audit. DELETE and TRUNCATE are blocked.

PatternRevision has id, pattern/style ownership, number1..9007199254740991, name1..160, nullable purpose1..160, nullable MeasurementRevision UUID, internal creator, created_at. Canonical text rejects committed boundary whitespace at DB level; application canonicalization also strips outer browser-compatible whitespace and converts blank optional purpose to null. Body UUIDs require full 8-4-4-4-12 syntax, never shortened UUID coercion. Both creator fields and all substantive revision fields are immutable. UPDATE/DELETE/TRUNCATE fail; no seal is necessary because one row is the complete snapshot and owns no child rows.

Owner-aware composite FKs enforce `(pattern_id,style_id)→pattern(id,style_id)` and `(measurement_revision_id,style_id)→measurement_revision(id,style_id)`. The latter consumes V18's actual key. Same-Style direct inserts and null pins pass; foreign-Style pins fail at the DB boundary even without Java. Nullable MATCH SIMPLE semantics intentionally mean no relation when the pin is null. Old revisions retain their original pin after newer Measurement revisions or Pattern lifecycle changes.

A DEFERRABLE INITIALLY DEFERRED insertion constraint requires revision1 at Pattern commit. The sequence BEFORE INSERT guard locks only the owning Pattern, requires ACTIVE, then requires max+1 (first1). It performs no upward/Measurement write-lock acquisition. Direct empty aggregates, first2, skipped/duplicate numbers and archived append fail. Indexes are exactly Style-created/id page, Style-status-created/id page and Pattern-number-desc history, in addition to constraints.

## API and pagination

P is `/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns`; D is P/{patternId}.

| Operation | Method/path | Behavior |
| --- | --- | --- |
| listPatterns | GET P | status ACTIVE(default)/ARCHIVED/ALL, limit25(default)1..100, opaque cursor |
| createPattern | POST P | 201 Pattern + complete revision1; no caller identity/version |
| readPattern | GET D | 200 embedded latest, including archived families |
| updatePatternLifecycle | PUT D | status + strict integer version; stale409; current same-status200 no-op |
| listPatternRevisions | GET D/revisions | limit25, inclusive maxRevisionNumber, bounded summaries |
| createPatternRevision | POST D/revisions | expectedLatestRevisionNumber + complete metadata; 201 N+1 or stale409 |
| readPatternRevision | GET D/revisions/{revisionId} | scoped exact immutable metadata |

Unknown request fields are400 with additionalProperties=false in generated schemas. Optional purpose/pin are required-nullable in views/summaries. No raw creator, source/quality/artifact fields are public. Integer JSON tokens reject strings, floats, exponent tokens, unsafe values and invalid ranges. Foreign well-formed pins are scoped404; malformed UUID is400. No global Pattern/revision route.

Collection ordering is created_at DESC,id DESC. Keysets filter identity binds resource kind `patterns`, Style and status; a cursor from another Style/status/resource is400. A bounded LEFT LATERAL query supplies latest metadata in one SQL statement, without per-row detail reads. Missing latest due to DB corruption produces integrity failure, not null or silent omission. New newer Patterns do not shift traversed old rows. This is a live lifecycle-filtered list, not an MVCC snapshot: an old family can enter/leave ACTIVE after a concurrent archive/reactivation.

History uses number<=max, descending, limit+1; nextMaxRevisionNumber is the extra row's number or null. The first request is anchored to PatternView.latestRevision.number. No offsets, totals, unbounded history or summary→detail hydration. Latest is derived, never a mutable pointer.

## Transactions, concurrency and audit

Create: lock Project→Style, require active parents, validate/canonicalize and resolve optional Measurement, insert Pattern ACTIVE/v0 and revision1, record two audits, commit atomically. A test-owned late exception after rows and audits exist rolls everything back; no production failure switch. Independent valid identical POSTs may create two IDs; pending controls and retry:false mitigate accidental repeat, while ambiguity is reconciled through reads rather than name-based attribution.

New revision: active parent locks→optional Measurement read→Pattern lock→ACTIVE/head comparison→N+1→audit. Revision creation changes neither Pattern.version nor Pattern.updatedAt; lifecycle and revision concurrency are independent. Stale writers yield201/409 and exactly one new revision/audit, never silent N+2. Lifecycle writers yield200/409; no lost update. Pattern archive/revision and Project/Style archive/write races are tested in both winner orders. pg_blocking_pids with latches and independent NOWAIT probes prove actual PostgreSQL blocking and Project→Style→Pattern ordering. Timeouts fail tests; no sleep-only race oracle or upward lock claim.

OWNER/ADMIN read/write, VIEWER read-only. PLATFORM_ADMIN without requested membership and foreign/non-member actors receive403; unauthenticated401. Authorization precedes private hierarchy lookup. Wrong hierarchy after requested-org authorization is404. Committed revocation denies the next request, without claiming retroactive cancellation. Archived parents preserve reads and block all writes409; parent reactivation never changes Pattern history/lifecycle. Pattern operations leave Project/Style versions, Measurement tables and canonical Supply unchanged.

AuditRecorder adds only patternId/patternRevisionNumber/measurementRevisionId. Initial success: pattern.created after={styleId,status:ACTIVE,version:0}, then pattern_revision.created after={styleId,patternId,patternRevisionNumber:1,measurementRevisionId?}. Later revision has one revision event. Lifecycle archive/reactivation has one bounded before/after event containing only styleId/status/version. Current no-op and failures/losers/rollback add no success audit. Scope/Actor/requestId are authenticated ORGANIZATION context; no name/purpose/POM/creator payload is audited. Safe Problem Details reveal no SQL/constraint/private payload/IdP identity.

## Lazy UI, request budgets and recovery

Routes `.../styles/:styleId/patterns` and `.../patterns/:patternId` are lazy under Authenticated→WorkspaceGate, parent gated Project GET→Style GET. StyleDetail adds only a Patterns link and retains its four existing unordered Phase2 children: Pattern0/Measurement0 requests. Pattern list initial GET1/detail0/history0/Measurement0. Detail initial GET1 then history1 anchored to embedded latest, exact-latest0/Measurement0. Wrong Pattern suppresses history. No artifact/binary/storage/grading/release traffic. A 25-row list/history performs no per-row detail hydration.

Measurement picker mounts only after explicit Pin measurement revision. Additive optional fresh-on-mount arguments on the existing Measurement data hooks are used only here; their default 3A behavior remains unchanged. Even with warm cached data, fresh spec completion gates the one anchored history request. The regression test covers a warm old head with a newer authoritative head. Request budget: spec1, absent history0 or present history1 anchored to Measurement latest, exact detail0. It supports bounded older choices and no pin. An existing old pin is never silently replaced with latest.

RHF/Zod drafts clone complete latest metadata. Revision baseline is captured when editing starts and never silently rewritten. 409 retains draft/baseline, refetches Pattern/anchored history and affected parents, and requires non-submitting explicit reconciliation. If Pattern becomes archived, a pending draft remains visible read-only. Lifecycle archive requires explicit confirmation naming the family/id/version. A stale/ambiguous lifecycle preserves explanation and requires review before another action. VIEWER has no mutation actions; archived parents remain read-only; archived Pattern allows only eligible reactivation.

Network/status0/5xx/lost/malformed-success502 retains create/revision draft and refreshes authoritative list/detail/history. Matching text or N+1 is not attributed to the lost command. No automatic POST/resend/idempotency inference. All commands use existing useWorkspaceCommand/retry:false and all queries use useWorkspace.run. Current-generation403 denies the entire Organization workspace. Actor/Org generation invalidation aborts requests and removes old private cache/mutation/draft/cursor state; A→B/ABA/Actor and late list/detail/history/mutation cases pass. Same-Actor Supply cache is preserved; Actor switch clears old scopes. No durable private draft/purpose/pin/IP storage.

Strict runtime schemas check UUIDs, Style/Pattern/revision ownership, lifecycle, safe integer versions/numbers, canonical names/purpose, nullable pin, explicit-offset timestamp, unique page Pattern IDs, opaque bounded cursor shape and descending anchored history/cursor. Invalid payload becomes safe502 without invented defaults. No Date.parse-only permissiveness or untrusted cursor decoding.

## Validation evidence

| Check | Result |
| --- | --- |
| Full backend verify | 767 tests, failures0/errors0/skips0 |
| Full Vitest | 1,377 passed / 33 files; all accepted 1,303 retained |
| Typecheck/build | Both passed |
| Same-origin full browser | 91 passed, failures/skips0 |
| Separate-origin full browser | 91 passed, failures/skips0 |
| Responsive/accessibility | 80 ignored captures (40/origin), 10 states ×1440/820/768/390; document overflow failures0. Representative screenshots directly inspected; labels, keyboard Tab/visible focus, text status/conflict, named archive confirmation and VIEWER/parent read-only checked. No formal WCAG certification claimed. |
| Official exporter twice | Both passed and byte-identical; accepted OpenAPI unchanged after removing only the new Pattern paths/DTOs |
| Terraform | Terraform1.14.0 fmt -check / init -backend=false / validate passed; infra diff0 |
| Diff/Gitleaks | git diff --check passed. Standalone Gitleaks8.28.0 staged scan: 0 findings. Initial generic-api-key finding was the published generated-contract checksum, verified as a false positive; standard checksum formatting retained the exact value and the rescan passed, without scanner exceptions. Baseline→commit scan is reported with final execution evidence. |

Generated artifact checksums (SHA-256):

```text
5cb8c603a4849bf87dfa369b6433a09f1cd49eb67d24be92e89a8aebd9bec3d0  docs/openapi.json
f8d6eb0c7d0b19b75339d8d8e4ddfbc1844ce9b50a19531ce487075cf841fa08  apps/web/src/api/schema.ts
```

Existing accepted Phase0–3A paths and schemas compare structurally unchanged; only four Pattern path entries/seven stable operations/nine DTOs are added. Dependencies/lockfile, SecurityConfiguration, application settings, infrastructure/workflow/compose remain unchanged. Test helpers are test-import-only, with production import count0; captures are ignored.

During new-test development, a membership fixture used INACTIVE instead of the existing REVOKED value and a loading assertion omitted Skeleton's ellipsis/accessibility label. Both were corrected only in new test support/assertion targeting. A new LEFT LATERAL query needed ON true and new UI recovery needed to keep lifecycle/draft state mounted while authoritative refresh was pending; these were corrections to 3B implementation before commit, not accepted-baseline fixes. A warm-selector test additionally caught reuse of a still-fresh cached head; picker-only fresh reads and parent-before-history gating corrected this new 3B behavior without changing accepted Measurements defaults. A duplicate local verification runner was stopped; the final complete backend run was serial and passed. No timeout/security/contract weakening.

## Deployment and stop boundary

V19 and backend are additive; deploy compatible migration/backend, verify health, then expose lazy frontend routes. Old frontend remains valid. No simultaneous deployment, new dependency, event system, worker or infrastructure is required. Released V1–V18 remain frozen.

Required single commit: `feat: add pattern revisions`, parent exactly the baseline above. Final SHA/changed-file manifest, push HEAD equality, clean tree, no PR and exact-head CI result are reported with final execution evidence; no future result is fabricated here. After 3B push CI succeeds STOP for independent review. No V20, files/import, geometry, grading, QA/release or AI; 3C requires a separate approved specification and cannot retrofit old revisions.
