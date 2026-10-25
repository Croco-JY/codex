# Phase 3C — Pattern Artifacts

## Authority and boundary

The starting branch is `phase-3-pattern-operations` at `cfd4b2e02dc97b4ccb356339cfa0352266e59639` (`feat: add pattern revisions`), parent `6d04cea4f4cde5be4db7d4a23703e7c7d0096c60`. Canonical main remains `41c629cce3bcdf5abf776cf33784631a4e150667`. Baseline push CI [40178205893](https://github.com/Croco-JY/codex/actions/runs/40178205893) completed successfully on attempt 1; branch equality, clean worktree and zero open PRs were checked before editing. Accepted 3A/3B and the Phase 3 PLAN/ADR remain frozen authorities. An unrelated accepted-contract defect requires deterministic reproduction and independent correction review before continuing.

3C adds retained private artifacts to **new** immutable Pattern revisions. It supplies bounded envelope probes, tracked upload, private metadata/download and explicit UI recovery. It implements no geometry parser, format conformance certification, preview, malware scanning, grading, QA, release, AI, pricing, RFQ or public storage. READY means storage and finalization completed, with verified size and digest; it grants no review/production approval. DXF-AAMA and DXF-ASTM are caller declarations, not detected standards conformance. Subsequent implementation requires separate approval; no next slice starts automatically.

## Relational integrity and V19 compatibility

`V20__pattern_artifact.sql` is the only new migration. V1–V19 are byte-identical. V20 adds immutable `pattern_revision.artifact_expected DEFAULT false` and one `pattern_artifact` table. It does **not** disable, drop, recreate or alter the released V19 no-update trigger. Populated V19→V20 testing compares all old table values, excludes only the newly added flag during revision comparison, and compares the trigger definition and enabled state before/after. Existing revisions receive false and remain artifactless forever.

Artifact-bearing revision construction explicitly inserts true. A deferred initially-deferred revision-insert constraint requires exactly one associated artifact at commit. The artifact insertion guard requires true, matching Style and initial PENDING/v0/probeVersion1/no failure. UNIQUE revision and storage UUID constraints prevent multiple artifacts or reused storage identity. The composite revision/Style FK preserves ownership. No artifact row can be attached to an old false revision; the old statement-level revision guard also rejects attempts to change the flag.

Immutable artifact fields are ID, revision/Style, server-generated storage UUID, declared format, safe display name, size, private lowercase SHA-256, probe version and creation timestamp. Only PENDING/v0→READY/v1 or PENDING/v0→FAILED/v1 with advancing updatedAt is legal. READY/FAILED are terminal. FAILED requires exactly one allowlisted code: STORAGE_WRITE_FAILED, STORAGE_READBACK_FAILED or STORAGE_INTEGRITY_MISMATCH. DELETE and TRUNCATE are blocked. There is no storage registry, physical delete, overwrite, replacement, restore or garbage collector. Fresh schema: 20 migrations, 53 public base tables including Flyway, 52 application tables. Historical migration tests retain their original targets; V19 tests now explicitly target 19 instead of following latest.

## Multipart and bounded probes

POST `.../styles/{styleId}/patterns/{patternId}/artifact-revisions` uses exactly one `metadata` and one `file` part. The controller inspects Servlet `getParts()` before accessing business metadata or file streams. Extra, duplicate and missing parts return 400. Metadata must have a concrete application/json-compatible media type, absent/UTF-8 charset and 1..16384 received bytes. A copy of the configured Jackson mapper rejects duplicate JSON keys, trailing tokens, unknown fields and invalid scalar representations. Metadata is the exact six-field snapshot/head/declaration/name DTO, with optional nullable purpose and Measurement pin. No caller identity, storage UUID, size, hash, state, version or quality claim is accepted.

The Springdoc operation uses an explicit multipart schema with required metadata DTO reference and binary file. Runtime parsing remains raw/strict and maps wrong metadata media types to safe 400 rather than delegated 415. Transport stays max-file-size=10MB and max-request-size=11MB. Actual file bytes must be 1..10485760; the application reads at most MAX+1 after preflight. Original filename, MIME and extension are ignored. Display name is separately canonicalized and checked for blank/length/path/control/dot names; it never enters a storage path.

`PatternArtifactProbe` is pure, bounded, deterministic byte logic with no parser dependency, IO, database, cache or geometry result. PDF requires `%PDF-` prefix and final `%%EOF` after stripping only SP/HTAB/CR/LF. DXF rejects binary signature and every NUL, uses at most 8192 bytes per line and one million complete code/value pairs, accepts code ASCII 0..1071, requires (0,SECTION), and ends with (0,EOF) followed solely by SP/HTAB/CR/LF. Tests cover LF, CRLF and standalone CR plus non-UTF-8 value bytes. Extra pairs/comments and form-feed/vertical-tab after EOF fail. Structural acceptance establishes no geometry/standard correctness.

## Non-XA protocol and failure windows

The orchestrator is `Propagation.NEVER`; separate Spring-proxied transactional methods own preflight, reservation, metadata read and finalization. There is no self-invocation transaction fiction or DB transaction spanning file/storage IO.

1. Short preflight reauthorizes Organization write and resolves/locks Project→Style, checks active parents/Pattern and optional same-Style immutable Measurement reference. It ends before application file buffering/probe/hash. Servlet may already have spooled the HTTP body; preflight does not prevent network receipt.
2. Bounded buffering, probe and SHA-256 run outside SQL.
3. TX1 repeats authorization, lifecycle, hierarchy and scoped Measurement reference, then locks Pattern and checks expected latest. It inserts N+1 with true, a server-generated artifact/storage identity in PENDING/v0, revision-created audit and upload-started audit atomically. Reservation failure yields no storage call.
4. After TX1 commit, `AuthorizedStorage.putNew` receives exactly the reserved UUID once. CREATE_NEW and Organization/object UUID paths remain unchanged. No display name enters the path.
5. Mandatory authorized storage read-back must match exact byte length and SHA before TX2.
6. TX2 reauthorizes and locks Project→Style→Pattern→exact revision/artifact, checks active lifecycle and PENDING, then commits READY/audit. It deliberately does not compare latest: a later metadata revision N+2 can commit during N+1 storage without blocking exact N+1 READY.

Only genuine IOException write/read-back failures or verified size/digest mismatch can attempt FAILED. Failure recording is a separate authorized/lifecycle-guarded transaction. Spring authorization denial propagates 403 and never becomes a STORAGE_* classification or failed audit. Revocation can block put, read-back or finalization; archive can block finalization. Failure-mark rollback/denial leaves PENDING. READY transaction rollback leaves PENDING plus full retained bytes. Partial writes remain retained and tracked by the reserved object UUID. A crash before storage leaves PENDING/no bytes; a crash after write may leave PENDING/full bytes. Lost READY response leaves READY/full bytes and client ambiguity. No automatic retry or deletion follows any window.

Independent PostgreSQL sessions inspect actual `pg_blocking_pids` for competing reservations. While storage is held, NOWAIT Project/Style/Pattern locks succeed; independent archive/metadata transactions can commit. Artifact/artifact and both artifact/metadata race orderings yield one N+1 winner and one stale-head409, with winner-only audits/storage. Timeouts fail tests; arbitrary sleeps are not race oracles.

## Private reads, download and audit

All operations follow Actor→requested Organization authorization→Project→Style→Pattern→exact revision→artifact. OWNER/ADMIN write; VIEWER reads/downloads. PLATFORM_ADMIN without membership has no bypass. Authorized foreign hierarchy returns scoped404; denied Organization returns403. Archived Project/Style/Pattern retains metadata and READY download, while upload/finalization requires active ancestors.

GET `.../revisions/{revisionId}/artifact` exposes only id, Pattern/revision/Style IDs, declaredFormat, displayName, sizeBytes, state, nullable failureCode, createdAt/updatedAt. No storageObjectId, SHA, probe version, internal optimistic version or raw issuer/subject is public. GET `.../artifact/content` calls storage only for READY and rechecks size and SHA on every download. Missing/unreadable/length-mismatched/same-length-corrupt content returns safe409 and no artifact bytes. GET never mutates state. Headers are application/octet-stream; framework `ContentDisposition.attachment().filename(name, UTF_8)`; nosniff; private, no-store. No raw object-ID route exists.

Audits are Organization-scoped/authenticated Actor. Reservation commits `pattern_revision.created` and `pattern_artifact.upload_started`; finalization commits only its corresponding ready/failed event. AuditRecorder adds only patternRevisionId, patternArtifactState, patternArtifactFormat and patternArtifactFailureCode. It never records display name, object UUID, SHA, bytes, raw metadata or original filename. No new logging of private payload/path exists.

## Frontend behavior and request budgets

Ordinary StyleDetail still loads exactly four Phase 2 siblings, with artifact requests0. Pattern list/detail/history performs artifact requests0 until explicit Inspect artifact; opening import alone causes no artifact or Measurement fetch. Metadata inspection has one GET and no content preload. An artifact404 is shown as artifactless only after a successful exact scoped revision verification; hierarchy failure remains an error. No per-history-row artifact hydration exists.

Import creates a new revision from a separate in-memory snapshot and captured expected latest. Metadata and actual File are each appended exactly once; browser supplies the multipart boundary. Client prevalidates file size/name/declaration and never inspects/parses file content. The shared Measurement picker was moved unchanged into `MeasurementPicker.tsx` so both metadata and artifact editors use the same explicit lazy provider path without a circular import.

Strict runtime validation checks UUID ownership, formats, size, safe canonical name, exact state/failure relation, explicit-offset timestamps and response revision/result relations. Malformed success is 502 ambiguity. Upload 409/network/5xx/malformed201 retains the File and metadata, refreshes authoritative Pattern/history (parents too on409), never resends or attributes matching state to this request. Explicit reconciliation updates the baseline only; it neither submits nor changes the File. Success clears draft/File. PENDING/FAILED show retained state, no download or retry-in-place. VIEWER and archived ancestors have no import action; READY remains downloadable.

All requests use trusted openapi-fetch transport and `useWorkspace.run`; commands use retry:false. Full hierarchy/Actor query keys include exact revision. Current-generation403 denies the Organization workspace. A→B, ABA and Actor switch discard old draft/cache/callback effects. Late binary response cannot create object URL/click/download. Successful download checks size, rechecks generation/signal, uses metadata display name and immediately revokes its temporary object URL. No durable business draft/bytes/credentials are stored in localStorage/sessionStorage/IndexedDB. Existing same-Actor Supply cache ownership is unchanged.

## Rollout and deferred work

Deploy additive V20/compatible backend before frontend. Older frontends continue using unchanged metadata endpoints and omitted artifact_expected defaults false. New clients on an older backend receive safe unavailable endpoint errors; no fabricated READY or automatic retry. Object identity/hash metadata supports later reconciliation, but physical retention is indefinite in this phase. Production external storage, AV, parser resource isolation/geometry, previews, GC/expiry, upload resume/idempotency and future grading/QA/release require independent specifications.

## Validation evidence

Local executable validation uses PostgreSQL 18.3 and existing dependencies. Backend focused: 160 passed. Full backend: 927 tests, failures0/errors0/skips0. Real embedded HTTP multipart: 32 passed, including metadata16384 bytes plus file10485760→201 READY, file10485761→413 with rows0/storage writes0/upload audits0; zero-byte/extra/duplicate/missing parts→400 without side effects. PDF/DXF probe: 33 passed. Migration: populated V19→20 and fresh20 passed. Storage/transaction tests cover partial write, failed recording, READY rollback, response loss, archive/revocation and later-head finalization. Download tests cover exact bytes/UTF-8 attachment headers and all integrity failures. Existing storage, identity, OIDC, CORS, architecture, Supply and Phase 2 regressions run in full verify.

Focused frontend: 77 passed. Full Vitest: 1454 tests / 34 files, all passed; typecheck and production build passed. Final full Playwright: same-origin98 passed and separate-origin98 passed, including actual archived/VIEWER exact-byte downloads and explicit Pattern reactivation. Initial harness corrections were explicit V19 target, PostgreSQL char cast, Java test import/checked-exception fixes, canonical outer-whitespace test input, browser fixture Style/path separation, excluding Vite source-module requests from the four-child API counter, and explicitly signing in again after full reload because credentials correctly remain memory-only. New 3C inspector keys were distinguished from history keys to avoid React sibling-key collisions. No accepted pre-3C contract defect or weakened timeout/assertion was used.

Contract exporter pass1/pass2 produced byte-identical files. Programmatic comparison against baseline: removed paths0, changed common paths0, removed schemas0, changed common schemas0; exactly three paths and six schemas added. Final checksums:

```text
51950e2dcbb4a6daf4c64ead980a8f86c09dad39008e69ba0fdecc1e450f7dfe  docs/openapi.json
e133411d080e4ab4b5857be3817b700d5d177ba272716a78acf75930c3e8f776  apps/web/src/api/schema.ts
```

Terraform 1.14.0 fmt-check, backend-disabled init and validate passed unchanged. Required immutable surfaces (V1–V19, dependencies/lockfiles, application settings, SecurityConfiguration, infra, workflow and compose) have zero baseline diff. No V21+ exists. Production changes are limited to Pattern artifacts, the four audit allowlist keys and their contextual frontend integration. The Pattern route introduction now describes immutable revisions/private artifacts rather than claiming files are unavailable. Test-support imports remain within tests/E2E; no new runtime dependency, feature flag, bypass or background worker exists.


### Observed upload/retention matrix

| Situation | Committed metadata | Retained bytes | Result |
|---|---|---|---|
| Invalid parts/media/JSON/name/probe, empty file | No new revision/artifact | None | 400 |
| File 10485761 bytes, real servlet HTTP | No new revision/artifact | None; writes0/audits0 | 413 |
| Preflight denied/archived | No new revision/artifact; file stream opens0 | None | 403/409 |
| TX1 late audit failure | No new revision/artifact/audit | None; writes0 | 500 |
| Crash after TX1 before put | PENDING/v0 | None | No confirmed success |
| Verified put/read-back and TX2 commit | READY/v1 | Full | 201 |
| Genuine write IO, successful failure mark | FAILED/v1 / WRITE_FAILED | None or partial retained | 500 |
| Read-back IO | FAILED/v1 / READBACK_FAILED | Full retained | 500 |
| Read-back length or same-size SHA mismatch | FAILED/v1 / INTEGRITY_MISMATCH | Retained corrupt/full bytes | 500 |
| Failure-mark rollback/authorization/lifecycle block | PENDING/v0 | None/partial/full retained | Failure |
| Authorization denied before put | PENDING/v0; no failed audit | None | 403 |
| Authorization denied before read-back or TX2 | PENDING/v0; no failed audit | Full retained | 403 |
| Parent/Pattern archived during storage | PENDING/v0 | Full retained | 409 |
| READY transaction late audit failure | PENDING/v0; no ready audit | Full retained | 500 |
| READY committed, response lost | READY/v1 | Full | Client ambiguous; no resend |
| Later metadata N+2 commits during N+1 storage | N+1 READY/v1; latest remains N+2 | Full N+1 retained | 201 for exact N+1 |

READY download correct bytes returns200 even with archived private ancestors. PENDING/FAILED return409 with storage reads0. READY missing, unreadable, length mismatch or same-length digest mismatch returns409 with zero artifact bytes and no state transition. Header and browser filename checks prove octet-stream attachment, UTF-8-compatible filename, nosniff and private/no-store. No raw storage route is exposed.

Explicit OpenAPI IDs are createPatternArtifactRevision, readPatternArtifact and downloadPatternArtifact. New paths/schemas only; no accepted operation/schema property changes. State/failure combinations are checked in PostgreSQL and strict frontend hydration.

### Changed-file manifest

The implementation changes exactly these 38 source/test/generated/documentation files. Captures, downloads, synthetic file outputs, storage roots and runtime logs remain ignored/outside the changeset.

```text
apps/api/src/main/java/com/sourceos/audit/AuditRecorder.java
apps/api/src/main/java/com/sourceos/pattern/PatternArtifactController.java
apps/api/src/main/java/com/sourceos/pattern/PatternArtifactProbe.java
apps/api/src/main/java/com/sourceos/pattern/PatternArtifactService.java
apps/api/src/main/java/com/sourceos/pattern/PatternArtifactTransactions.java
apps/api/src/main/java/com/sourceos/pattern/package-info.java
apps/api/src/main/resources/db/migration/V20__pattern_artifact.sql
apps/api/src/test/java/com/sourceos/FoundationIntegrationTest.java
apps/api/src/test/java/com/sourceos/MigrationUpgradeTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactArchitectureTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactConcurrencyTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactMigrationTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactMultipartTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactPersistenceTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactProbeTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactSupport.java
apps/api/src/test/java/com/sourceos/PatternArtifactTest.java
apps/api/src/test/java/com/sourceos/PatternArtifactTransactionTest.java
apps/api/src/test/java/com/sourceos/PatternMigrationTest.java
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativePersistenceTest.java
apps/api/src/test/java/com/sourceos/SupplierDirectoryTest.java
apps/api/src/test/java/com/sourceos/WorkspaceMigrationTest.java
apps/web/e2e/pattern-artifacts.spec.ts
apps/web/src/api/queryKeys.ts
apps/web/src/api/schema.ts
apps/web/src/features/pattern/MeasurementPicker.tsx
apps/web/src/features/pattern/PatternArtifacts.test.tsx
apps/web/src/features/pattern/PatternArtifacts.tsx
apps/web/src/features/pattern/PatternRoute.tsx
apps/web/src/features/pattern/Patterns.tsx
apps/web/src/features/pattern/artifactModel.ts
docs/architecture.md
docs/data-model.md
docs/domain-model.md
docs/information-architecture.md
docs/openapi.json
docs/phase-3c-pattern-artifacts.md
docs/roadmap.md
```


Final responsive review generated 72 ignored captures: 36 per origin, nine states (import draft, READY, artifactless historical revision, archived, stale409, response-loss ambiguity, VIEWER, PENDING, FAILED) at 1440/820/768/390. Every capture checks document width against viewport; overflow0. Representative mobile READY and tablet conflict captures received visual inspection; DOM/keyboard checks verify associated labels, focused input and Tab navigation with visible focus style, textual status/errors, VIEWER mutation absence and baseline lifecycle confirmation. No WCAG certification is claimed. Browser storage inspection finds no upload name/draft/file content or credentials. Initial harness failures were corrected without assertion/timeout/auth/retry weakening; final full suites pass, with no disabled/skipped cases or outstanding flake.

Standalone Gitleaks 8.28.0 staged implementation scan: 0 findings. Baseline→final commit scanning and post-commit push CI are additional delivery gates recorded in the final delivery report. No scanner exception/allowlist or workflow change is introduced. `git diff --check` and documentation relative-link inspection passed. The exact final commit/CI cannot be embedded in its own immutable content; they are reported after commit/push. This slice stops after exact-head CI success, with no PR or automatic subsequent feature work.
