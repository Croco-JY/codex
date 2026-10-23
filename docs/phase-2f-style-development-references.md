# Phase 2F — Style Development References

Baseline: local checkout `Croco-JY/codex`, branch `phase-2-product-workspace`, exact parent `67213e1fe620c1d3bf734e0eb617d52a4f41c2f4` (`feat: add style facility candidates`). Local/origin/live GitHub baseline agreed; main was `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`. Prior push SOURCE OS CI `39995437975` completed successfully at the exact Phase 2E head. No open Phase 2 PR or later branch commit was present before editing.

## Ownership and retained metadata

`styledevelopmentreference → style / file / audit / shared`. Style supplies the scoped Organization→Project→Style authorization and write-lock boundary; no Project persistence, raw StoragePort or LocalStorageAdapter is imported by the Reference module. File has no reverse workspace dependency. Module verification and explicit architecture coverage remain enabled.

V17 adds only `style_development_reference`: server UUID `id`, immutable Style FK, separate unique server UUID `storage_object_id`, stripped safe `display_name` (1–255), fixed `application/octet-stream`, server-computed integer `size_bytes` (1–10485760), state, nonnegative version and UTC timestamps. There is no storage registry, storage-object FK, binary column or public URL. Duplicate names/content are legal. Two indexes serve Style pages and optional state-filtered pages, ordered by created_at DESC,id DESC.

The database guards the immutable identity/metadata tuple, every state transition, exact version increment and advancing updated_at. Legal transitions are PENDING→READY/FAILED/DETACHED and READY/FAILED→DETACHED. DETACHED is terminal. DELETE and TRUNCATE reuse `reject_workspace_destruction()`. There is no StoragePort/AuthorizedStorage delete, physical cleanup, GC, retry-in-place or restore.

PENDING, FAILED and DETACHED metadata and any corresponding full or partial bytes are intentionally retained. This is tracked retention, not an atomic PostgreSQL/filesystem transaction or a cleanup guarantee. Capacity monitoring and later reconciliation must retain the association between Organization, Reference and storage object; physical expiry/GC needs separate approval.

## HTTP and multipart

All routes are beneath `/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references`:

| Operation | Result |
| --- | --- |
| GET collection, optional one state | 200 bounded page, including all states when omitted |
| GET /{referenceId} | 200 metadata in every state |
| POST collection, multipart | 201 only after READY v1 commits |
| GET /{referenceId}/content | 200 binary attachment for READY only |
| POST /{referenceId}/detach, explicit integer version | 200 DETACHED v+1 |

Pages default to 25/0, accept limit 1..100 and offset 0..100000, fetch limit+1 for hasMore, and have no total. Collection 404 remains an error. Unknown filters, malformed/unknown detach properties and unsafe versions return 400. Stale/already-detached commands return 409 without a new audit.

The controller combines explicit named `@RequestPart("displayName") String` and `@RequestPart("file") MultipartFile` with `MultipartHttpServletRequest.getParts()` inspection of actual multiplicity. Exactly displayName×1 and file×1 are accepted; unknown, duplicate or missing parts are 400 before reservation/storage/audit. Named parts plus a narrow schema annotation provide Springdoc's required string displayName/binary file contract without hiding runtime parts behind an opaque map.

Original multipart filename, extension, Content-Type and caller Content-Length are untrusted. Display names use Java strip(), reject controls, separators and dot traversal names; names never become storage paths. No extension/MIME inspection is performed. Server buffering reads at most MAX_BYTES+1 to detect excess. Zero is 400; excess is 413.

Multipart configuration preserves max-file-size **10MB** and provides max-request-size **11MB** for bounded metadata/boundary headroom. Actual embedded HTTP/Servlet tests, not only MockMvc, exercise exact 10 MiB success and 10 MiB+1 safe Problem Details 413. Existing framework handling already supplies safe requestId-bearing 413, so Problems and security/CORS configuration are unchanged.

## Reservation → storage → finalization

The orchestration method explicitly forbids an enclosing transaction. A separate package-private Spring transaction bean avoids self-invocation and commits each phase:

1. TX1 obtains Project→Style locks through StyleService, verifies both ACTIVE, validates metadata, inserts PENDING v0 with new Reference/object UUIDs, records upload_started and commits.
2. Outside SQL transactions, `AuthorizedStorage.putNew(org, reservedObjectId, bytes)` independently rechecks write authorization and invokes existing create-only StoragePort.put with the same object UUID. `AuthorizedStorage.MAX_BYTES` is shared with Reference validation. Existing put(org,bytes) remains compatible by allocating its own UUID and delegating.
3. TX2 reauthorizes, locks Project→Style→scoped Reference, verifies ACTIVE ancestors and PENDING, transitions READY v1 and audits ready. Only a committed result can produce 201.

A real storage IOException attempts a separate fully authorized/lifecycle-guarded FAILED v1 transaction, then returns safe 5xx. Revocation, archived parents, detach or DB failure can prevent failure marking; the committed authoritative state remains PENDING or DETACHED. Authorization failures are not disguised as storage IO failures.

| Window/outcome | Retained metadata | Retained bytes/audit |
| --- | --- | --- |
| Before reservation commit / reservation rollback | None | No bytes or lifecycle audit |
| Reservation committed, interruption before storage | PENDING v0 | No bytes; upload_started |
| Storage succeeds, interruption before READY | PENDING v0 | Full bytes; upload_started |
| Storage fails, failure recording succeeds | FAILED v1 | None or partial; upload_started + failed |
| Failure recording blocked | PENDING/DETACHED | Any written bytes retained; committed audits only |
| READY transaction rolls back | PENDING v0 | Full bytes; no ready audit |
| READY commits, response lost | READY v1 | Full bytes; upload_started + ready |

Connection loss during commit can leave PENDING or READY. Neither server nor client automatically repeats binary storage or allocates another object to conceal uncertainty. List/detail inspection is authoritative.

Independent PostgreSQL sessions cover concurrent same-version detach (one success/one409, one audit), Project/Style reservation/finalization archive orderings, detach during blocked storage and the Project→Style→Reference lock chain. Reservation commit and released parent locks are observed through an independent connection inside the storage callback. Revocation committed before each subsequent authorization phase blocks reservation, putNew or finalization as appropriate. No instantaneous retroactive cancellation of a passed authorization phase is claimed.

## Download and detach safety

Organization read authorization and scoped Project/Style resolution precede scoped Reference lookup. Only READY reaches AuthorizedStorage.get, which rechecks read access. PENDING/FAILED/DETACHED return 409 without a storage probe. Missing bytes return safe404; length disagreement returns409 without bytes or metadata rewrite. Safe diagnostics use identifiers/requestId/lengths, never filename, content, credentials or storage filesystem paths.

Responses always use octet-stream, `ContentDisposition.attachment().filename(displayName, UTF_8).build()`, nosniff and `Cache-Control: private, no-store`. Tests parse the UTF-8 filename* representation, recover Korean/spaced/quoted names and reject CR/LF injection. No raw storage UUID route exists. Archived ancestors still permit authorized READY downloads.

Detach locks active Project→Style→scoped Reference, checks exact body version and nonterminal state, advances state/version/time and audits atomically. It performs no binary cleanup. VIEWER can inspect every state and download READY under archived ancestors, but cannot upload/detach. PLATFORM_ADMIN alone does not bypass active Organization membership.

## Audit

Actions: `development_reference.upload_started`, `.ready`, `.failed`, `.detached`. Scope ORGANIZATION, entity StyleDevelopmentReference, entity ID Reference UUID. State contains only styleId/state/version/sizeBytes. Actor is authenticated context; the upload's reservation and finalization use the same HTTP requestId.

AuditRecorder allowlist adds **state and sizeBytes only**. No displayName, object UUID, original filename, request serialization or bytes are audited. Existing scalar/credential/newline safeguards and mandatory transaction behavior remain unchanged. Failed reservation has no audit; later upload failure does not erase the already committed upload_started.

## UI, transport and recovery

Development References follows Requirement, Material Selections and Facility Candidates inside Style detail. Strict Project→Style success gates all four sibling reads. Siblings mount independently, without forced order; a child failure cannot suppress another child. Existing exact request assertions add only the fourth sibling while preserving exact IDs, parent order and initial request multiplicity.

Private page key: `[workspace,sessionScope,org,project,projectId,style,styleId,development-references,state??null,limit,offset]`. Targeted recovery key ends with `development-reference,referenceId`. Upload/detach/download use retry:false workspace commands and Actor/Organization generation guards. Only initiating Style Reference metadata is refreshed; global Supply caches remain untouched.

Default All-state pages expose filename, textual state, exact byte count, version, timestamps and Reference ID. A 25-row page makes zero detail/content requests until explicit recovery/download. Runtime metadata validation fails closed; no invented identity/version or malformed-row actions. No preview or approval terminology is used.

Upload uses RHF and Zod prevalidation plus file bounds; FormData appends only displayName/file once each. A narrow feature serializer sends the actual File through the existing trusted authenticated openapi-fetch client; the browser supplies Content-Type boundary. Only 201 READY v1 clears the memory-only file/name draft and resets All/first page. 413 has intentional “File too large” guidance. Network/5xx ambiguity retains the draft, refreshes All/first page and requires explicit review before a new upload with new identities. Equal names/sizes never identify a prior upload.

PENDING/FAILED may be detached by active writers; they have no resume/finalize/retry controls. DETACHED stays visible, terminal and not downloadable. READY is downloadable by readers even under archived parents. Detach needs explicit confirmation; 409 refreshes parents, exact metadata and bounded page, displays authoritative state/version and requires another explicit confirmation. Ambiguous detach never silently adopts a new version and submits.

Download parses a Blob through the same guarded API client, checks bytes against metadata, creates/clicks/revokes a temporary browser object URL with persisted displayName. Bytes are not returned as cached mutation/query data. Old-generation completion cannot trigger a download. A→B, ABA and Actor switch discard private drafts/conflicts/commands and preserve global Supply cache on Organization-only switch.

## Migration and validation

V1–V16 are compared byte-for-byte with the baseline. V17 is the only new migration; no V18 exists. Latest-schema expectations advance to **17 migrations,47 public base tables including Flyway,46 application tables** and add style_development_reference. Historical Requirement/Selection/Candidate migration tests retain targets14/15/16; Candidate's previous implicit latest migration is explicitly pinned to16. The dedicated populated V16→V17 test snapshots every pre-existing application row, proves all unchanged and the new table empty, validates Flyway, then inserts PENDING and transitions READY. Fresh migration and direct constraints/transition/destruction tests remain enabled.

Final local backend verify: **549 tests, 0 failures, 0 errors, 0 skipped**, across 48 Surefire report files. Focused coverage includes 35 Reference behavior cases, 19 transaction/failure cases, 13 independent-session concurrency cases, 13 actual HTTP multipart/contract cases, focused persistence/upgrade cases and AuthorizedStorage reservation compatibility. Fresh V1→V17, populated V16→V17, Flyway validation, all prior row snapshots and direct state/destruction guards passed.

Frontend: **27 Vitest files / 1,128 tests passed**, including 60 focused Reference cases. `pnpm typecheck` and `pnpm build` passed. The final same-origin Playwright run passed **64/64**. The final separate-origin Playwright run also passed **64/64**, including real authenticated multipart upload, binary download and detach. CORS remained unchanged.

One earlier overlapping browser run failed while fetching the Vite StyleDetailPage dynamic module, before the existing Requirement conflict form mounted. The unchanged existing case passed in isolation (1/1); the complete standalone same-origin rerun then passed. No timeout, authorization, retry or business assertion was relaxed.

Actual HTTP multipart results: max-file-size10MB / max-request-size11MB; zero bytes400; 10485760 bytes201 READY v1 with identical downloaded bytes; 10485761 bytes413. Oversize fixture has **0 Reference rows,0 storage writes,0 upload lifecycle audits**. Unknown third part, duplicate displayName, duplicate file and either missing part all returned400 with no metadata/storage/audit. Valid uploads claiming image/png,text/html,application/pdf all persisted octet-stream.

Download tests: READY200, archived-parent READY200, PENDING/FAILED/DETACHED409 with zero storage probes, missing bytes404, mismatched length409, raw object route404. Headers were octet-stream / attachment with valid recoverable UTF-8 filename* / nosniff / private,no-store. Real browser save used the persisted Korean name and exact synthetic bytes.

Retention fixtures observed READY v1 with full bytes, FAILED v1 with no bytes or one retained partial byte, DETACHED with retained bytes, PENDING v0 with full bytes after blocked/rolled-back finalization, and PENDING/DETACHED after blocked failure recording. No object deletion/cleanup is performed or claimed. Lost-response READY is recovered through authoritative metadata with no automatic second upload.

Terraform fmt-check, init-backend=false and validate all passed locally. Existing contracts were compared structurally: every prior path and schema remained identical. Only four hierarchical Reference paths/five operations and five Reference schemas were added. Both exporter passes used the exact verified backend and produced identical SHA-256 artifacts:

```text
8dbb2dc2bfdc72f28462b365f2cf78d005ae753e86c45227a40608d00fb16dd4  docs/openapi.json
6723ea026a6cee834187e8670e374df41019fb45b5303cffdbaf6f7f3497af23  apps/web/src/api/schema.ts
```

The generated request is required multipart/form-data with exactly required displayName and binary file; download200 is octet-stream/binary. No generated file was handwritten. No dependency, infrastructure, workflow, SecurityConfiguration or global decimal change was made.

Final browser review generated **26 ignored captures** (13 per origin mode) at desktop1440,tablet768,mobile390. Representative empty/upload/READY/confirmation/DETACHED/archived-parent/VIEWER/retained PENDING+FAILED/ambiguity/oversize/download-error/access-denied states were captured; representative attachment sections in both origin modes were visually inspected. Every capture asserted document width ≤ viewport width: zero horizontal overflow. File/name labels, keyboard submit focus, textual states, inline detach confirmation and live announcements were checked without a new focus trap.

Final validation table:

| Check | Observed result |
| --- | --- |
| Backend ./mvnw -B verify | 549 passed / 0 failures / 0 errors / 0 skipped |
| Frontend typecheck / build | Passed locally |
| Vitest | 1,128 passed / 27 files |
| Same-origin Playwright | 64 passed |
| Separate-origin Playwright | 64 passed |
| Multipart real HTTP / storage / transaction / concurrency / migration | Passed in full backend suite |
| Fresh / populated V16→V17 / Flyway validation | Passed; prior data unchanged, new table empty before fixture insertion |
| Latest actual DB metadata | 17 migrations / 47 public tables / 46 application tables |
| Released migration bytes | V1–V16 identical; V17 only; no V18+ |
| Official exporter second pass | Byte-identical artifacts, hashes above |
| Terraform fmt / init -backend=false / validate | Passed locally |
| Security/CORS/dependencies/infrastructure/workflows | Unchanged |
| git diff --check / staged diff check | Passed |
| Standalone Gitleaks8.28.0, staged exact changeset | Passed; zero findings |

Exact-head push CI is evaluated after creating the one implementation commit; the resulting SHA/run result is reported separately because embedding a commit's own hash into its tree is not possible. No earlier run substitutes for that check.

## Deferred scope

No Phase 2G feature, V18, Pattern, Tech Pack, BOM, Approved Sample, public blob route, revision system, retention worker or physical GC is implemented. Phase 2G requires separate authorization and is cumulative hardening only. No PR is created.

## Exact changed-file manifest

```text
apps/api/src/main/java/com/sourceos/audit/AuditRecorder.java
apps/api/src/main/java/com/sourceos/file/AuthorizedStorage.java
apps/api/src/main/java/com/sourceos/styledevelopmentreference/StyleDevelopmentReferenceController.java
apps/api/src/main/java/com/sourceos/styledevelopmentreference/StyleDevelopmentReferenceService.java
apps/api/src/main/java/com/sourceos/styledevelopmentreference/StyleDevelopmentReferenceTransactions.java
apps/api/src/main/java/com/sourceos/styledevelopmentreference/package-info.java
apps/api/src/main/resources/application.yml
apps/api/src/main/resources/db/migration/V17__style_development_reference.sql
apps/api/src/test/java/com/sourceos/ArchitectureTest.java
apps/api/src/test/java/com/sourceos/AuthorizedStorageReservationTest.java
apps/api/src/test/java/com/sourceos/FoundationIntegrationTest.java
apps/api/src/test/java/com/sourceos/MigrationUpgradeTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceConcurrencyTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceMigrationTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceMultipartTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferencePersistenceTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceSupport.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceTest.java
apps/api/src/test/java/com/sourceos/StyleDevelopmentReferenceTransactionTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateMigrationTest.java
apps/api/src/test/java/com/sourceos/SupplierDirectoryTest.java
apps/api/src/test/java/com/sourceos/WorkspaceMigrationTest.java
apps/web/e2e/development-references.spec.ts
apps/web/e2e/facility-candidates.spec.ts
apps/web/e2e/workspace.spec.ts
apps/web/src/api/errors.ts
apps/web/src/api/queryKeys.ts
apps/web/src/api/schema.ts
apps/web/src/features/workspace/DevelopmentReferences.test.tsx
apps/web/src/features/workspace/DevelopmentReferences.tsx
apps/web/src/features/workspace/FacilityCandidates.test.tsx
apps/web/src/features/workspace/MaterialSelections.test.tsx
apps/web/src/features/workspace/Requirement.test.tsx
apps/web/src/features/workspace/Workspace.test.tsx
apps/web/src/features/workspace/developmentReferenceModel.ts
apps/web/src/pages/StyleDetailPage.tsx
apps/web/src/styles.css
docs/openapi.json
docs/phase-2f-style-development-references.md
```
