# Phase 2G — cumulative release hardening

## Baseline and scope

Executable local checkout: `Croco-JY/codex`, branch `phase-2-product-workspace`. The sole comparison baseline and implementation-commit parent is `bc8051df1fa9f239a17eaf2eeb8e324c51423aa5` (`fix: validate workspace timestamps strictly`), whose parent is `c0f2583f535282379da726dbd1fed417f919779c`. Main remains `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`. Before this run, live branch HEAD equalled the baseline, open PR count was zero, and SOURCE OS CI [40111959678](https://github.com/Croco-JY/codex/actions/runs/40111959678) was verified as push / exact baseline SHA / completed / success. The accepted Phase 2 history through Correction A was inspected without rewriting it.

Correction A is accepted production baseline: Project/Style `createdAt` and `updatedAt` use the shared `z.iso.datetime({ offset: true })` predicate. Its committed 46-case regression remains unchanged. The previous Phase 2G attempt correctly stopped on date-only timestamp acceptance; the separately authorized correction fixed that defect. This resumed gate compares every immutable surface against **bc8051df**, not the earlier Phase 2F commit.

This slice adds tests, test support and this document only. It adds no product feature, migration, dependency, API, retry, audit key, CORS permission, storage operation or background behavior. All seven accepted Phase 2 authority documents remain unchanged. If another accepted production defect is found, the protocol is: smallest deterministic reproducer; exact contract and observed/required results; affected source and minimum proposed correction; API/migration/security impact; **STOP before production edits or normal 2G commit/push**. Test bugs and synchronization errors can be corrected only in tests; environment failures must be reported accurately.

## Preserved files and test-support isolation

These ten files were preserved across the timestamp Defect-Stop and resumed without discarding the worktree:

```text
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativeArchitectureTest.java
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativeConcurrencyTest.java
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativePersistenceTest.java
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativeSecurityTest.java
apps/api/src/test/java/com/sourceos/PhaseTwoCumulativeSupport.java
apps/web/e2e/phase2g-cumulative.spec.ts
apps/web/e2e/phase2g-fixture.ts
apps/web/src/test/phase2gWorkspace.test.tsx
apps/web/src/test/phase2gWorkspace.tsx
docs/phase-2g-cumulative-hardening.md
```

Import review found `phase2gWorkspace.tsx` imported only by `phase2gWorkspace.test.tsx`, and `phase2g-fixture.ts` only by `phase2g-cumulative.spec.ts`. Production import count is zero. Java support lives under `src/test` and is reached only by cumulative tests. No runtime entrypoint reaches these helpers, and no test route, authorization/audit/lock bypass or production flag was added.

The E2E draft's earlier wrong `Notes` label was corrected to the exact existing `Requirement notes` label; sibling HTTP status checks now wait for the actual response using bounded `expect.poll(...).toBe(200)`. Visual review also found the new Projects capture could precede page mounting; the cumulative draft now waits for the exact Projects heading/list link and Project heading before capture. Those were draft test-harness corrections, not product fixes. No existing timeout, exact status, hierarchy, auth or retry expectation was relaxed.

## Cumulative backend evidence

The new focused classes add 29 cases and execute together with the full accepted suite.

| Invariant | Evidence |
| --- | --- |
| Authorization-first and roles | Populated A/B hierarchies, OWNER/ADMIN/VIEWER, foreign member, nonmember and PLATFORM_ADMIN matrices cover Project, Style and every child, including Reference metadata/content. Read members succeed; only OWNER/ADMIN write; unauthorized requested Organization is 403 even with absent nested IDs. |
| Wrong nesting | Authorized requested Organization plus foreign Project/Style/edge is exactly 404; foreign Reference storage identity/name is absent from errors. Cross-tenant access is tested in both directions. |
| Revocation | Committed revocation denies later reads, Project/Style updates and every child command, without mutation or audit. Existing Reference phase tests independently revoke before reservation, between reservation and putNew, and after storage before finalization. No claim of retroactive transaction cancellation. |
| Lifecycle | Archive Project and Style separately; all reads, including READY bytes, remain available; all child writes return 409. Child snapshots stay identical across archive/reactivation, with only parent lifecycle audit/version changes. |
| Version and canonical independence | Child writes preserve Project/Style versions. Before/after snapshots cover canonical catalog/network records; private writes do not mutate Supply. Existing catalog tests cover retained archived references and all four independent Selection scopes. |
| Actual shared lock spine | Independent PostgreSQL transactions hold Requirement write locks while Selection, Candidate or Reference writer waits. Latches locate phases; `pg_blocking_pids` proves blocking; release allows both commits and exact audit count. Short polling checks an actual lock condition; timeout fails. |
| Existing race families | Full suite retains Requirement create 201/412 and update 200/409; Selection/Candidate duplicate 201/409 and unlink 204/404; Reference same-version detach 200/409. Winner-only audits remain required. Provider SHARE/archive and parent archive races run in the accepted focused classes. |
| Candidate eligibility | Facility ACTIVE + Supplier ARCHIVED remains valid. Provider MANDATORY/FOR SHARE is retained; no Supplier lock or capability eligibility is added. |
| Destruction and audit | Latest-schema direct SQL verifies Project/Style/Requirement/Reference DELETE/TRUNCATE blocked; Selection/Candidate individual DELETE allowed and TRUNCATE blocked; audit UPDATE/DELETE/TRUNCATE blocked. Savepoints roll back probes; no guard bypass. |
| Audit privacy | ORGANIZATION/requested org/authenticated Actor, exact scalar child state keys, rollback/loser semantics and arbitrary unsupported field rejection are checked. AuditRecorder stays byte-identical. No private text, filename, object ID or bytes enter Reference audit. |
| Errors/correlation | Safe Problem Details, private body/path non-disclosure, bounded replacement request IDs for CR/LF input; full suites retain 400/401/403/404/409/412/413/500, with client 502 fail-closed coverage. |

### Stable module and foreign-persistence review

`ApplicationModules.verify()` and reflected dependency types check public parent/provider contracts and prohibit foreign Repository/Entity, Project/Organization persistence, StoragePort and LocalStorageAdapter dependencies in descendants. Provider lock methods remain MANDATORY and return immutable records; Facility has no unnecessary `readReference` method. File has no reverse workspace dependency.

Targeted source review, rather than generic SQL-string parsing, inspected `StyleRequirementService`, `StyleMaterialSelectionService`, `StyleFacilityCandidateService`, `StyleDevelopmentReferenceService` and `StyleDevelopmentReferenceTransactions`. Direct JDBC touches only each module's own private table. Parent hierarchy/lifecycle flows through StyleService; catalog references through MaterialService/ListingService/FacilityService. Reference uses AuthorizedStorage. No foreign Project/Style/catalog persistence shortcut was found.

Accepted lock order remains Project → Style, followed by Requirement; Material → optional Variant → optional Listing; Facility; or Reference. Edge removal stays under the private parent chain. No reverse provider path was introduced.

## Reference retention and binary security

The complete suite executes actual Servlet HTTP multipart tests: empty file 400, exactly 10,485,760 bytes 201 READY plus equal download, and 10,485,761 bytes safe 413 with no reservation, storage write or lifecycle audit. Configuration remains max-file-size 10MB / max-request-size 11MB. Actual part multiplicity is inspected: exactly displayName×1/file×1; unknown, duplicate or missing parts return 400 without side effects. OpenAPI remains explicit named displayName and binary file.

Reference transaction tests observe committed PENDING v0 before storage, acquire independent Project/Style locks during storage, and verify READY finalization after storage. Reservation rollback prevents storage. Storage IOException can commit FAILED; none/partial bytes remain tracked. Crash before storage, full storage before READY, READY rollback, response loss after READY, authorization revocation, archive and detach races retain authoritative committed state. Detach cannot restore/finalize a terminal edge; stale versions require explicit reconciliation.

Only READY probes storage. PENDING/FAILED/DETACHED return 409 with zero reads. READY missing content returns 404, size mismatch 409. Archived private parents still permit READY download. Correct bytes return application/octet-stream, Spring-built UTF-8 attachment Content-Disposition, nosniff, and private/no-store. Raw storage UUID is not an HTTP capability. Create-only Organization/object UUID paths and symlink safety remain covered by accepted storage tests.

PENDING/FAILED/DETACHED metadata and corresponding bytes can consume storage indefinitely. This is intentional Phase 2 retention, not a new cleanup defect. No physical delete, GC, retention worker, retry-in-place, restore, MIME inference or preview was added.

## Frontend and browser integration evidence

The new component suite adds 24 cases using the actual App/workspace components and deterministic request controls. The accepted timestamp suite adds 46 baseline cases: all four Project/Style timestamp properties reject date-only, local-time-only, invalid, empty, null, undefined and numeric values; Z/fractional-Z/explicit offset remain valid. Malformed Project blocks Style and all four children; malformed Style blocks all four children. Invalid parents never enable writer controls.

| Invariant | Evidence |
| --- | --- |
| Parent gating | Exact Project GET → Style GET. Four initial child GETs are each exactly one and become eligible only after Style success; sibling subset alone is unordered. Held Style and wrong-Style tests keep all children at zero. |
| Child 403 boundary | Each of the four current-generation child 403s invokes workspace denial, removes private queries/mutations and interactive sections. A real membership revocation before held Reference authorization confirms it end to end. A late old-generation 403 cannot deny B or fresh ABA A. |
| Other child failures | Four component and four real-browser single-child 500 cases preserve three successful siblings. Playwright intercepts only the selected exact child endpoint, emits safe problem JSON/requestId, and restores interception in finally. Organization, Project, Style and three siblings use the real backend. |
| Isolation | Existing and cumulative tests cover A→B, ABA, Actor reset, request abortion, late read/mutation/401, draft/conflict purge, and authoritative membership re-resolution. Late binary across Org or Actor produces zero object URLs/anchor clicks. |
| Cache ownership | Same-Actor Organization switch removes private queries/mutations while reusing warmed Material/Facility/Supplier/Listing Supply cache. Actor switch purges old Actor-owned Supply/workspace/mutations. No canonical tenant copies. |
| VIEWER and archive | All four sections remain readable; no write request/control. READY download remains usable under archive; writer controls return after deliberate parent reactivation in accepted journeys. |
| Ambiguity/retry | Existing focused suites retain one-attempt mutation assertions, conflict draft retention, exact-version explicit reconciliation, and no automatic upload resend. Upload ambiguity refreshes All/first page without filename/size correlation. |
| Durable storage | Real integrated journey inspects localStorage/sessionStorage for private draft markers, upload draft filename, private label, Actor/credential markers. No such values are persisted. Existing client/session tests preserve memory-only credential handling. |

### Bounded contextual reads

Existing focused fixtures are executed unchanged: 25 distinct full Selections yield exactly 25 Material + 25 Variant + 25 Listing identities, maximum 75; shared canonical keys deduplicate in flight. Candidate 25-row fixture yields 25 Facility + 25 derived Supplier exact identities, maximum 50, with shared Supplier deduplication. Facility pending/404/5xx/malformed causes zero dependent Supplier requests; Candidate capability detail requests are zero. Reference list uses page metadata with zero detail/content fanout until explicit action. No next-page speculative prefetch. These are fixture observations and ceilings, not a fixed count promised for every real Style load.

### Transport/security regression

Complete accepted security tests retain production X-Dev-Subject denial, valid/invalid OIDC issuer/audience behavior, exact-origin CORS/no wildcard/no credentials, explicit headers and DELETE only for Selection/Candidate unlink. Trusted target validation precedes credentials; redirect:error cannot be overridden; old-session/aborted late 401 cannot end a replacement session. No raw feature HTTP stack or public object endpoint was introduced. Requirement exact decimals remain strings, including 0/0.0000/upper precision boundaries; no decimal coercion or schema semantics changed.

## Immutable contracts, migrations and configuration

The official exporter ran twice; each pass matched the baseline bytes and the second reproduced the first. Baseline/final hashes are identical:

```text
8dbb2dc2bfdc72f28462b365f2cf78d005ae753e86c45227a40608d00fb16dd4  docs/openapi.json
6723ea026a6cee834187e8670e374df41019fb45b5303cffdbaf6f7f3497af23  apps/web/src/api/schema.ts
```

V1–V17 were explicitly byte-compared with bc8051df; diff zero, 17 files, no V18+. Fresh schema is 17 migrations / 47 public BASE TABLES including Flyway / 46 application BASE TABLES. Historical upgrade tests retain their original targets (Phase 0/legacy, V8, V12→latest, V13→V14, V14→V15, V15→V16, V16→V17); no retargeting. Latest constraint inventory verifies Requirement singular PK, Selection NULLS NOT DISTINCT uniqueness/composite FKs, Candidate uniqueness, Reference object uniqueness and enabled transition trigger.

Final immutable-surface gate requires zero diff for API main code/resources, frontend production components/API/styles, dependencies/lockfiles, application.yml, SecurityConfiguration, infra, CI workflow, compose, generated contracts and migrations. Correction A model/test already belong to baseline and are not included in this commit.

## Validation results and release identity

Local focused/full counts, visual review and staged scan results follow. Final implementation SHA and exact-head CI URL are reported in the accompanying release result: a commit cannot embed its own SHA without changing it. Verify this document's commit with `git log -1 --format='%H %P %s'`; the expected subject is `test: harden phase 2 release gate`, exact parent bc8051df. CI must be push / phase-2-product-workspace / that implementation SHA / completed / success, with actual foundation steps inspected. Correction A CI is not substituted for the final run. No PR is created.

| Check | Result |
| --- | --- |
| Focused cumulative backend | 29 passed; failures/errors/skips 0 |
| Complete backend `./mvnw -B verify` | 578; failures/errors/skips 0 |
| Focused timestamp + cumulative frontend | 70 passed: 46 timestamp + 24 cumulative |
| Complete standalone Vitest | 1,198 passed / 29 files |
| `pnpm typecheck`, `pnpm build` | Passed |
| Official exporter pass 1 / pass 2 | Both baseline-identical; accepted SHA-256 unchanged |
| Terraform 1.14.0, repository `infra/terraform` | fmt -check, init -backend=false, validate passed |
| Same-origin complete final Playwright | 74 passed; no skips |
| Separate-origin complete final Playwright | 74 passed; no skips |
| New real-browser cumulative cases | 10 per origin, including all four single-child 500 injections |
| Fresh ignored Phase 2 responsive captures | 73 per origin / 146 total, including 18 new cumulative captures |
| Responsive widths / overflow | 1440 / 820 / 768 / 390; all capture-time document-width assertions passed, overflow 0 |
| Production/config/dependency/infra/workflow/compose diff | Zero against bc8051df |
| Migration / generated diff | Zero against bc8051df; V18+ absent |

Representative captures were directly viewed in both origin modes: integrated four-child Style at desktop/tablet/mobile; Projects/Project detail; VIEWER; denial; archive; Requirement/Selection/Candidate conflicts; all four Reference states, upload ambiguity, detach confirmation, oversize guidance and content failure. Capture inventory timestamps prove all 146 files were refreshed in the final full runs. Screenshots/storage/download artifacts remain ignored and are excluded from the commit.

Accessibility review uses actual labeled controls, existing keyboard/Tab assertions, visible focus on the upload action, textual lifecycle/upload/error/status information, explicit remove/detach confirmations, and VIEWER mutation absence with no mutation requests. Confirmations remain in-page keyboard controls without a modal focus trap. Manual visual inspection found readable wrapped identifiers and no clipped horizontal layouts. This is bounded DOM/keyboard/visual review, not formal WCAG certification.

`git diff --check` and staged whitespace checks passed. Standalone Gitleaks 8.28.0 scanned the exact staged ten-file Phase 2G changeset with zero findings; manual exact-diff inspection found synthetic fixtures only. The same baseline→implementation range scan is required before push and its actual result is reported with the final commit/CI identity. No baseline scan is mislabeled as a new scan.

Transient handling was explicit. The first full Vitest run overlapped backend verify and browser startup: one new cumulative test reached the default DOM-wait limit while the parent Project was still loading (1,197 passed / 1 failed). That exact case passed unchanged in isolation, then the entire unmodified standalone suite passed all 1,198 tests. The first same-origin browser run had two Vite dynamic StyleDetailPage module-fetch failures before the intended API assertions (72 passed / 2 failed); the error context showed the application module-load fallback, not a wrong tenant/API result. Both exact cases passed unchanged in isolation and a full clean browser run passed 74. No timeout, assertion, auth, retry or production policy was modified to accommodate either transient. Final browser runs after the capture-only synchronization improvement are reported above. No additional accepted production contract defect was found.

## Deferred work

No Phase 3, V18, RFQ, Tech Pack, Pattern, BOM, Sample, nomination/award or production workflow begins. Production IdP release setup, external/signed delivery, malware/type-specific processing, physical attachment expiry/GC, resume/idempotency, live collaboration, unproven large-workspace optimization, archived catalog discovery expansion, Material maxPrice and global binding/delete changes remain separately approved future work. After exact-head CI success this task stops for independent final Phase 2G acceptance.
