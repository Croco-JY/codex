# Phase 2C — Style Requirement workspace

## Baseline and scope

Implementation starts on `phase-2-product-workspace` at `48393906539c74b563b715b43599ca2bb6db947d` (`feat: add project and style workspace UI`), whose parent is `fa63cbc95c2e33e15448a0e60a7e97cfd26f5f94`. Main remains `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`. The accepted baseline push run `39762737470` completed successfully; the branch had exactly one commit after the correction and no open Phase 2 PR.

A Style has zero or one mutable Requirement planning sheet. Its identity is the Style UUID; an existing empty sheet is distinct from absence. Targets are preliminary product-development facts, including target **unit** cost per selected quantity unit. They are not quotations, accepted commercial terms, RFQ, BOM, Tech Pack, Pattern or production specifications. No total is calculated.

No new browser route or navigation item is introduced. The existing Style detail route owns the section. Phase 2D Material Selection, V15, Facility Candidates, Development References and all later workflows remain deferred.

## Module, tenancy and serialization spine

The top-level `stylerequirement` module declares only `style`, `audit` and `shared` dependencies. JDBC persistence and strict input deserializers remain module implementation details. There is no direct Project import, table query or repository dependency. The public parent contract is `StyleService.StyleContext`, including Style-owned `ParentStatus` and `Status` values. Neither Project nor Style depends on Requirement.

Read processing is authentication → Organization read policy through `StyleService.readContext` → scoped Project → scoped Style → Requirement. Write processing is one transaction through `StyleService.lockContextForWrite` → Project lock → Style lock → active-parent check → validated Requirement create/update → audit → commit. Update then locks the Requirement row; create uses a conditional insert. No blind upsert exists.

ORG_OWNER and ORG_ADMIN may write; VIEWER may read. Active membership is required. PLATFORM_ADMIN alone confers no private workspace access. Organization policy failure is 403, including revoked membership. Authorized requests with a wrong Project/Style hierarchy are 404. No Requirement lookup precedes the parent boundary.

Both ancestors must be ACTIVE for mutations. Archived ancestors permit reads but reject writes with 409, including create-only attempts against an existing sheet. Hierarchy resolution precedes this lifecycle check; parent lifecycle precedes Requirement state/precondition outcomes for a well-formed request. No automatic reactivation occurs.

## HTTP contract

The only path is:

`/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/requirement`

| Operation                              | Intent / state                                     | Outcome               |
| -------------------------------------- | -------------------------------------------------- | --------------------- |
| GET                                    | Valid Style, absent Requirement                    | HTTP 404              |
| GET                                    | Existing Requirement, including archived ancestors | 200 with view         |
| PUT, `If-None-Match: *`, version 0     | Absent                                             | 201; stored version 0 |
| PUT, `If-None-Match: *`, version 0     | Existing version 0 or N                            | 412                   |
| Concurrent create-only PUTs            | Same absent Style                                  | One 201; one 412      |
| PUT, `If-None-Match: *`                | Nonzero body version                               | 400                   |
| PUT, unsupported/blank/multiple header | Any                                                | 400                   |
| PUT, header entirely omitted           | Absent, including request version 0                | 404                   |
| PUT, header omitted                    | Existing version N, exact version N                | 200; stored N+1       |
| PUT, header omitted                    | Stale version                                      | 409                   |
| Concurrent version-N updates           | Existing version N                                 | One 200; one 409      |
| Well-formed PUT                        | Either ancestor archived                           | 409                   |

The existing `WritePreconditions` parser is reused unchanged; only its introductory comment no longer refers to exactly three consumers. Quoted, weak, blank and multiple preconditions remain invalid. Update never inserts. Create uses `INSERT … ON CONFLICT DO NOTHING RETURNING`, so a failed precondition does not leave PostgreSQL in an aborted constraint-error transaction. There is no POST, DELETE, collection or separate Requirement ID.

`StyleRequirementInput` contains only the seven optional facts and an explicitly required boxed integer version. Unknown ownership/Actor/timestamp/status fields are rejected. Missing/null/string/fractional/negative/unsafe/out-of-range versions are rejected; no missing-to-zero coercion exists. `StyleRequirementView` requires every property, with nullable optional facts and non-null identity/version/timestamps. It returns both successful PUT outcomes with an authoritative body.

## Values and validation

- Product type: outer-trimmed optional text, at most 160 characters. Notes: outer-trimmed optional text, at most 4000, checked with the existing private-safe `ValidationRules.notes` policy. Blank text becomes null. Notes are neither logged nor audited.
- Quantity and target unit cost: PostgreSQL `NUMERIC(19,4)`, Java `BigDecimal`, JSON/TypeScript strings. Request properties accept string tokens only with 1–15 integer digits and at most four fractional digits; no sign, exponent, empty decimal string, numeric JSON token or rounding. Range is zero through `999999999999999.9999`. Responses use the unchanged global plain-decimal serializer. Zero is preserved as a known fact.
- The Requirement-local unit enum is exactly PCS / SET. A unit may exist alone; either quantity or cost requires it.
- Cost and currency must both exist or both be absent. Currency is an uppercase, recognized Java commercial ISO code; XXX, XTS and non-commercial/unknown codes are rejected. Validation does not depend on PriceService. No currency or unit is inferred and no FX conversion occurs. Browser validation checks syntax/pairs; the server owns recognized currency validation.
- Delivery date is a strict `YYYY-MM-DD` `LocalDate`, without timezone conversion. Valid past dates and leap days are legal. Impossible dates, datetimes and empty strings are invalid. Empty optional UI fields serialize as null in the full replacement.

## V14 and integrity guards

The sole new migration is `V14__style_requirement.sql`. `style_requirement.style_id` is its PK and FK to Style; Organization and Project IDs are derived and not duplicated. The singular access path uses this PK without a redundant index.

The table stores the seven optional facts, independent nonnegative bigint version, immutable created timestamp and server-updated timestamp. Database checks enforce finite amounts in the exact zero-to-maximum range (including rejection of PostgreSQL numeric NaN), nonnegative version, PCS/SET, required units, paired cost/currency, uppercase three-letter currency syntax and nonblank optional text (including tab/newline-only values). Application validation additionally prevents input precision loss and unrecognized currencies.

An identity trigger rejects changes to `style_id` or `created_at`. Requirement-specific BEFORE DELETE and BEFORE TRUNCATE triggers reuse V13's existing `reject_workspace_destruction()` function. Clearing facts leaves the row intact. Tests use rollback/savepoints around expected PostgreSQL errors; no trigger is disabled and no destruction bypass exists.

V1–V13 were compared byte-for-byte with the accepted baseline and remain unchanged. There is no V15 or later migration. Fresh V1→V14 and a populated V13→V14 upgrade both validate. Upgrade coverage snapshots all 42 pre-existing application tables, including Project/Style/membership/audit fixtures, and verifies every row remains unchanged; the new table is empty before explicit fixtures. Final structure is **14 migrations / 44 public base tables including Flyway history / 43 application base tables**.

Existing migration metadata assertions are updated only for those structural consequences. The existing Style destruction probe now uses `TRUNCATE style CASCADE`, just as the Project probe already did: PostgreSQL's new referencing FK would otherwise reject the command before the existing destruction trigger could be tested. The assertion still requires the identical production destruction-guard error; no guard or expected behavior is relaxed.

## Audit and concurrency evidence

Successful commands emit `requirement.created` or `requirement.updated` through `AuditRecorder.organizationChanged`. Scope is ORGANIZATION with the authenticated Actor and owning Organization; entity type is StyleRequirement and entity ID is the Style UUID. Controlled state contains **only styleId and version**. Creation has null before-state and version-zero after-state. Updates record N and N+1. No DTO, planning facts, notes, dates, quantities or costs enter audit state.

Requirement version is independent: its mutations leave Project/Style versions unchanged; Project/Style metadata mutations leave Requirement version unchanged. Validation, authority, hierarchy, lifecycle, stale-version, failed-precondition and rollback outcomes produce no success audit.

Twelve focused independent-connection PostgreSQL tests cover:

1. Two overlapping create-only writers with different facts: 201/412, one row at version zero, winner values and exactly one creation audit.
2. Two overlapping version-zero updates: 200/409, version one, winner values and exactly one update audit.
3. Project archive versus create/update in both winner orders, and Style archive versus create/update in both winner orders (eight cases). A successful Requirement write commits before the archive when it wins; archive-first causes the waiting Requirement writer to reject with 409 and no child mutation/audit.
4. Two lock-chain probes use `pg_blocking_pids`, independent connections and `FOR UPDATE NOWAIT` to prove Project→Style→Requirement ordering. A writer waiting on Style already owns Project but has not locked Requirement; a writer waiting on Requirement already owns both ancestors.

Bounded latches, query/lock timeouts and future joins prevent hangs. A timeout is a test failure, never an accepted race outcome.

## Frontend states and cache ownership

The section mounts only after Organization, Project and Style resolve successfully. Its query uses retry false and the exact key:

`["workspace", sessionScope, organizationId, "project", projectId, "style", styleId, "requirement"]`

Only this singular GET maps ApiError 404, inside the validated workspace request, to a null **absent sentinel**. This is normal UI with “No Requirement sheet has been created for this Style.” It does not show a page-level Not found error or retry. A Style hierarchy 404 prevents the Requirement request; Requirement 403 still follows workspace denial, while 5xx/network failures and malformed 200 views remain unavailable/errors. Undefined/malformed data is never interpreted as absence or a version-zero baseline.

Hydration validates route identity, safe nonnegative version, timestamps, required nullable facts, text limits, exact strings, unit/currency/date syntax and pair consistency. Unsupported data blocks mutations. Generated types remain the transport authority; no handwritten duplicate DTO exists.

An active-parent writer sees create or edit controls; VIEWER sees read-only facts/absence without mutation or reconciliation actions. Archived ancestors keep facts visible and make inputs read-only/non-submittable. Forms use React Hook Form plus Zod and have an explicit Reset Requirement draft. Quantity/cost inputs remain strings with decimal keyboard hints, including zero and the exact maximum. No numeric browser coercion or total calculation exists.

Mutations use the accepted `useWorkspaceCommand` boundary, retry false, and the exact Requirement key plus create/update. Create sends generated `params.header["If-None-Match"] = "*"` and version zero. Update omits that header entirely and uses the explicit authoritative Requirement baseline, never the Project/Style version. Confirmed success installs the validated response and refreshes only the exact initiating Requirement key. No Supply, collection, other tenant or other Style invalidation occurs.

### Conflict and uncertain outcome recovery

- Create 412 retains the original draft and safe request reference, refetches the authoritative sheet, shows comparison, and requires **Use existing Requirement** or **Reconcile draft with existing**. Reconcile adopts a baseline without submitting; only a later explicit Save updates it.
- Update 409 preserves the draft and refreshes Requirement plus scoped Project/Style. Server comparison requires explicit reconciliation. If a parent is now archived, controls become read-only immediately and cannot submit the retained draft.
- Update 404 retains/refetches without inserting. If the validated singular read now reports absence, **Create from this draft** is a deliberate mode choice; it performs no request until a subsequent explicit Create with header `*` and version zero.
- Transport status zero retains/refetches for operator comparison and shows outcome unknown; no automatic create/update or automatic new-version substitution occurs. A malformed successful response also blocks blind resubmission. Cancellation from an old generation is not shown as a new Actor's ambiguity.
- Shared safe error presentation now names 412 “Precondition no longer holds”; existing status handling and safe request references are preserved. No raw server detail is displayed.

All local state is memory-only. Actor switch/logout and Organization A→B / A→B→A reuse the unchanged WorkspaceProvider generation boundary and discard old drafts/conflicts. Late reads, mutation completions and 412 callbacks cannot populate a later generation. Global Supply/catalog/commercial caches remain distinct and survive Organization switches. No browser storage or durable route-state drafts are introduced.

## Browser and responsive review

The new browser suite uses existing synthetic test-only PostgreSQL membership/Actor fixtures and real Organization/Project/Style APIs. Requirement workflow mutations run through the actual browser/API/PostgreSQL stack; controlled competing requests establish genuine server conflicts rather than mocking Requirement outcomes.

Coverage includes create/edit/clear with exact strings, independent parent versions, archived/readable/reactivated parents, a real competing-create 412 with explicit reconciliation, stale update 409, parent archive 409 refreshing read-only state, VIEWER absent/existing read-only access and PLATFORM_ADMIN-only denial before Requirement requests. Both same-origin and separately configured API origin exercise the generated header transport. No CORS change is needed.

Review artifacts are ignored under `.local/phase2c-review/{same-origin,separate-origin}`. Desktop 1440×1000, tablet 820×1180 and mobile 390×844 cover absence, create, recorded facts, archived/reactivated state, 412 comparison, parent conflict, VIEWER and denial. Every capture asserts no horizontal overflow. Labels, decimal/unit keyboard order, visible focus, textual statuses, conflict announcements and wrapping are checked. Image binaries are not committed.

## Validation record

The Phase 2C §89 Narrow Test-Assertion Amendment explicitly authorizes updating the two existing Style-entry request assertions. They now require the exact ordered Project → Style → Requirement sequence, with the same validated Organization/Project/Style IDs. No unordered containment or extra-request tolerance is used. The browser assertion also requires that switching to a PLATFORM_ADMIN without membership adds no private request. All other authorization, hierarchy, retry and timeout expectations remain unchanged.

| Gate                                                 | Observed result                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Backend `./mvnw -B verify` and build                 | 363 passed; 0 failures, 0 errors, 0 skipped                                                                          |
| Focused Requirement backend classes                  | 80 behavior + 12 concurrency + 1 persistence + 1 populated-upgrade test, all passed                                  |
| Frontend full Vitest / RTL                           | 968 passed across 24 files; 0 failed                                                                                 |
| Focused Requirement + safe-error frontend tests      | 74 passed across 2 files, including 48 Requirement cases                                                             |
| Frontend typecheck / production build                | Passed                                                                                                               |
| Same-origin full Playwright                          | 42 passed; 0 failed                                                                                                  |
| Separate-origin full Playwright                      | 42 passed; 0 failed                                                                                                  |
| New Requirement browser cases                        | All 4 passed in each origin within the full runs                                                                     |
| Responsive review                                    | 11 captures per origin, 22 total; zero horizontal-overflow assertions; 14 representative captures visually inspected |
| Fresh V1→V14 / populated V13→V14 / Flyway validation | Passed, including unchanged old-row snapshots and empty new table                                                    |
| OpenAPI / generated TypeScript                       | Two official exporter passes identical; prior paths/schemas unchanged                                                |
| Terraform fmt / init `-backend=false` / validate     | Passed locally                                                                                                       |
| Diff whitespace check                                | Passed                                                                                                               |
| Gitleaks 8.28.0                                      | Exact staged changes scanned with `git --pre-commit --staged --redact`; no leaks                                     |
| Implementation commit / push / exact-head CI         | Required post-commit gate; the completion report records the exact commit, push and CI run                           |

An initial full frontend run concurrent with Maven hit the unchanged admin-commercial lazy-page test’s default wait deadline. The exact test passed in isolation, then the complete 968-test suite passed when run without the backend workload. No timeout, retry policy, tenancy expectation or security outcome was relaxed. A direct PostgreSQL guard test also exposed numeric NaN passing a simple nonnegative check; V14 was strengthened before acceptance and the full backend suite passed again, including whitespace-only text cases.

Generated artifact SHA-256 (official backend-owned exporter, two identical passes):

- `docs/openapi.json`: `b5ae2ef332a36f99f2fbc99ace49a41096180b2080aa6554d1588942e28445b7`
- `apps/web/src/api/schema.ts`: `9715fe31685058a9653faccdca4462bbe3ef983a757c7c3ac5e8665712a9a691`

The OpenAPI delta adds exactly the hierarchical Requirement GET/PUT path and StyleRequirementInput/View schemas. All prior paths and schemas remain identical. No manual generated-file edit is used. Dependencies, infrastructure, workflows and existing Project/Style contracts are unchanged.

## Exact changed-file manifest

The implementation commit contains these 29 files. Existing frontend/browser behavioral assertions change only in the two explicitly amended request-sequence assertions; the safe-error test also adds the intentional 412 presentation cases required by Phase 2C. Historical Phase 2A/2B completion documents are unchanged.

```text
apps/api/src/main/java/com/sourceos/shared/WritePreconditions.java
apps/api/src/main/java/com/sourceos/stylerequirement/StyleRequirementController.java
apps/api/src/main/java/com/sourceos/stylerequirement/StyleRequirementService.java
apps/api/src/main/java/com/sourceos/stylerequirement/package-info.java
apps/api/src/main/resources/db/migration/V14__style_requirement.sql
apps/api/src/test/java/com/sourceos/ArchitectureTest.java
apps/api/src/test/java/com/sourceos/FoundationIntegrationTest.java
apps/api/src/test/java/com/sourceos/MigrationUpgradeTest.java
apps/api/src/test/java/com/sourceos/StyleRequirementConcurrencyTest.java
apps/api/src/test/java/com/sourceos/StyleRequirementMigrationTest.java
apps/api/src/test/java/com/sourceos/StyleRequirementPersistenceTest.java
apps/api/src/test/java/com/sourceos/StyleRequirementSupport.java
apps/api/src/test/java/com/sourceos/StyleRequirementTest.java
apps/api/src/test/java/com/sourceos/SupplierDirectoryTest.java
apps/api/src/test/java/com/sourceos/WorkspaceMigrationTest.java
apps/api/src/test/java/com/sourceos/WorkspacePersistenceTest.java
apps/web/e2e/requirement.spec.ts
apps/web/e2e/workspace.spec.ts
apps/web/src/api/errors.test.tsx
apps/web/src/api/errors.ts
apps/web/src/api/queryKeys.ts
apps/web/src/api/schema.ts
apps/web/src/features/workspace/Requirement.test.tsx
apps/web/src/features/workspace/Requirement.tsx
apps/web/src/features/workspace/Workspace.test.tsx
apps/web/src/features/workspace/requirementModel.ts
apps/web/src/pages/StyleDetailPage.tsx
docs/openapi.json
docs/phase-2c-style-requirement.md
```
