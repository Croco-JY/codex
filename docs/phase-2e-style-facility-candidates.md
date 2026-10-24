# Phase 2E — Style Facility Candidates

## Baseline and scope

Repository `Croco-JY/codex`, branch `phase-2-product-workspace`, starts at
`132de9add261a427d92e469ed44468fad9de29d4` (`feat: add style material selections`),
whose exact parent is `4c52d9f1c5c1eb2114dfed5b557af950c0598465`.
Local, origin, and live GitHub branch refs matched this clean baseline before
editing. Main remained `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`; no open Phase 2
PR existed. Exact Phase 2D push CI `39983386548` was completed/success, and Phase
2D was exactly one accepted commit over Phase 2C.

A Candidate means only that a private Style is considering a canonical Facility.
It does not represent an RFQ recipient, nomination, award, approved Supplier,
approved capability, commercial agreement, capacity reservation, or production
assignment. No Phase 2F attachment/storage work or V17 is included.

## Module and tenant boundary

`stylefacilitycandidate` depends only on `style`, `facility`, `audit`, and
infrastructure `shared`. It has no Project, Supplier, search, Material, Price, or
catalog persistence dependency. Spring Modulith verifies the acyclic graph;
focused architecture assertions check that the consumer uses public StyleService
and FacilityService rather than repositories/entities. Providers gain no reverse
workspace dependency.

Every list calls `StyleService.readContext`; every add/remove calls
`StyleService.lockContextForWrite`. Organization permission precedes scoped
Project/Style resolution. OWNER/ADMIN write; VIEWER reads only. Outsiders, revoked
members, and PLATFORM_ADMIN without membership receive no bypass. Insufficient
requested-Organization permission is 403; authorized wrong hierarchy or a
Candidate under another Style is 404. Archived private ancestors allow reads
but reject both add and unlink with 409.

## Facility-only immutable edge and V16

The table and view contain exactly `id`, `styleId`, `facilityId`, and `createdAt`.
There is no `supplier_id`, status, version, updatedAt, score, notes, capability,
quantity, price, capacity, or lead-time snapshot. Supplier ownership remains
exclusively `FacilityView.supplierId` in the global Facility read model.

`V16__style_facility_candidate.sql` adds one table with server-generated UUID
identity, Style and Facility FKs without cascading deletion, named
`UNIQUE(style_id,facility_id)`, a Style/createdAt/id pagination index, and a reverse
Facility index. Add uses atomic `ON CONFLICT ON CONSTRAINT ... DO NOTHING RETURNING`;
no returned row is 409, not replay success. No precheck-only duplicate protection.

An identity trigger rejects changes to all four columns. Individual DELETE is
intentional private unlink, leaving Style, Facility, Supplier, and historical
audit unchanged. Re-add receives a new UUID. TRUNCATE is blocked by the existing
`reject_workspace_destruction()` function. No production trigger bypass exists.

V1–V15 are byte-identical to the baseline. V16 is the only new migration, with no
V17+. Latest metadata becomes 16 applied migrations, 46 public base tables
including Flyway history, and 45 application base tables. Historical Requirement
and Material Selection upgrade tests retain explicit V14 and V15 targets.
Latest-schema tests change only required metadata/table-set expectations.

## Provider contract and registration serialization

FacilityService adds only immutable
`FacilityReference(facilityId,supplierId,status)` and
`lockActiveReference(UUID facilityId)`. It does not add unlocked `readReference`:
the existing public `read(UUID)` remains the unlocked Facility read.

The lock method is `Propagation.MANDATORY`, using provider-owned
`SELECT id,supplier_id,status FROM facility WHERE id=:id FOR SHARE`.
Missing Facility is 404; ARCHIVED is 409; ACTIVE returns the reference. The lock
is held through the caller transaction. It reads no Supplier or capability and
mutates no Facility state/version. There is no new provider HTTP endpoint.

Add locks `Project → Style → Facility`, validates active ancestors and Facility,
inserts the edge, records audit, and commits. Remove locks Project and Style,
then deletes only by `style_id AND id`; it does not lock or require active Facility
or Supplier. Parent lifecycle precedes otherwise valid child registration/unlink.

Independent PostgreSQL sessions prove the three-step lock chain with blocked
writers and NOWAIT probes. Facility SHARE locks block archive/update until the
Candidate transaction ends. Add-first yields 201, then archive succeeds with the
edge retained. Archive-first yields add 409 with no edge/success audit. Both
Project and Style archive races cover add and remove in both winner orders.
Independent duplicate adds yield 201/409; removers yield 204/404, with exactly one
winning audit. Timeouts are test failures.

A separate probe holds the Candidate transaction while successfully acquiring
Supplier `FOR UPDATE NOWAIT`; Facility `FOR UPDATE NOWAIT` is blocked. This
demonstrates the absence of a Supplier eligibility lock. A JdbcClient spy records
actual add/remove SQL and rejects Supplier/capability reads. Canonical row and
capability snapshots remain unchanged after private mutations.

## Supplier state versus directory visibility

Eligibility is only Facility ACTIVE under writable private parents. Tests cover
ACTIVE Facility with ACTIVE and ARCHIVED Supplier, empty Supplier roles, and all
six existing verification values. Supplier lifecycle/verification does not change
registration success. Existing edges survive Facility archive and Supplier
lifecycle/verification changes and can be unlinked while private parents remain
active.

The existing global Facility directory remains a bounded discovery surface,
including its existing Facility/Supplier active predicates. DirectorySearch is
unchanged. An active Facility under an archived Supplier can therefore be
backend-eligible without being newly discoverable in the directory. The browser
tests this distinction by discovering the Facility first, archiving its Supplier,
refreshing exact context, and successfully adding with Supplier ARCHIVED.

## API outcome matrix

Prefix:
`/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/facility-candidates`

| Operation               | Condition                                                       | Outcome          |
| ----------------------- | --------------------------------------------------------------- | ---------------- |
| GET prefix              | valid Style, empty or archived ancestors                        | 200 page         |
| POST prefix             | active Facility, including archived Supplier                    | 201 view         |
| POST prefix             | malformed/missing/null/non-string UUID or unknown body property | 400              |
| POST prefix             | Facility missing                                                | 404              |
| POST prefix             | Facility archived                                               | 409              |
| POST prefix             | exact duplicate                                                 | 409              |
| POST concurrent         | same absent tuple                                               | one 201, one 409 |
| DELETE `/{candidateId}` | own edge, active private ancestors                              | 204, empty body  |
| DELETE `/{candidateId}` | archived Facility or Supplier, active private ancestors         | 204              |
| DELETE `/{candidateId}` | absent/repeated/wrong-Style edge                                | 404              |
| DELETE concurrent       | same edge                                                       | one 204, one 404 |
| Any write               | Project or Style archived                                       | 409              |

POST accepts only `{facilityId}`; caller identity/ownership/audit/status/score
fields are rejected. Views have four required non-null fields. List returns
`items/limit/offset/hasMore`, no total, default 25/0, bounds 1–100/0–100000, and
orders `created_at DESC,id DESC` with `limit+1`. There is no detail GET, update,
global Candidate endpoint, or new 412 behavior. Collection 404 is an error,
unlike Requirement's scoped singular absence mapping.

## Audit

Successful actions are `facility_candidate.added` and `facility_candidate.removed`,
ORGANIZATION scope, entity `StyleFacilityCandidate`, entity ID the edge UUID.
State is only `{styleId,facilityId}`: add has null before; remove has null after.
Actor comes from authentication. Audit and edge commit/rollback together.
Failed validation, authorization, hierarchy, inactive/duplicate conflict,
concurrent loser, and rollback produce no success audit.

AuditRecorder's sole allowlist expansion is the scalar `facilityId` key. Existing
scalar type, length, newline, credential/token, and serialization restrictions
are unchanged. Candidate audits succeed; an arbitrary unsupported audit key
remains rejected.

## Style UI and canonical query reuse

Style detail order is metadata, Requirement, Material Selections, Facility
Candidates. No route/sidebar/global Candidate page is added. Project must resolve
before Style; Style must succeed before any child requests. The three children
then mount independently. Their relative order is not a security/business
contract. Held/error sibling tests ensure one section cannot suppress another.
Existing exact assertions preserve the exact Project/Style prefix followed by
exactly the three correctly scoped child URLs as an unordered sibling set.

Private keys are
`workspace/scope/org/project/P/style/S/facility-candidates/25/offset`, with command
suffixes `/add` and `/{candidateId}/remove`. Commands reuse unchanged
`useWorkspaceCommand` with `retry:false` and Actor/Organization generation guards.
Draft/filter/confirmation/conflict state is memory-only. A→B and ABA discard old
private state and reject late read/POST/DELETE effects. Actor switch/logout abort
and discard work. Global Supply cache survives Organization changes.

The picker and FacilitiesPage share the extracted behavior-identical global
directory options/key `supply/scope/facility-directory/filters/25`. Existing
country/region/cluster/type/capability/supplier filters and cursor pagination
remain unchanged. There is no Facility keyword `q` and no per-result capability
or Supplier-detail fanout. Supplier search in the human filter remains the
existing explicit discovery control, separate from Candidate-row hydration.

Choosing a directory hit exact-reads the Facility using
`supply/scope/facility/facilityId`. Runtime validation requires matching UUID,
Supplier UUID, supported lifecycle/type, and valid name before enabling Add or
deriving Supplier context. Add requires writer, active private parents and
supported ACTIVE Facility; Supplier status, verification, loading, or read failure
never supplies an additional eligibility condition. Changing choice follows only
the new Facility's supported Supplier identity. Body remains exactly `{facilityId}`.

## Dependent live hydration and bounds

Only unique Facility IDs on the current Candidate page are hydrated. Supplier
queries are constructed only from successful, supported Facility results and use
`supply/scope/supplier/supplierId`. No empty/guessed/stale fallback Supplier ID is
used. Error status with cached Facility data is excluded from derivation.
This rule applies both to rows and the chosen Facility, including conflict
refetch: dependent Supplier refresh follows only successful Facility refresh.

Measured component cases, in both row and chosen contexts:

| Facility state    | Dependent Supplier requests         |
| ----------------- | ----------------------------------- |
| Pending           | 0                                   |
| 404               | 0                                   |
| 500               | 0                                   |
| Malformed 200     | 0                                   |
| Supported success | eligible using returned Supplier ID |

Two unique Facilities sharing one Supplier produce two Facility exact reads and
one Supplier exact read. The 25-distinct-full-page fixture produces exactly 25
Facility + 25 Supplier reads, 50 unique exact identities. Row 26 is not fetched.
Capability-detail requests are 0; no next-page, Supplier-child, provenance or
speculative fanout occurs. These are measured fixture results, not a fixed count
for every real Style. Existing global cache and shared Supplier IDs reduce reads.

Candidate ID, Facility ID, and createdAt always remain visible. Failed/malformed
Facility hydration shows `Facility label unavailable` and creates no dependent
Supplier query. Supplier failure retains Facility/context ID with
`Supplier label/status unavailable`. ARCHIVED Facility/Supplier are live context,
not private edge status, and do not hide/rewrite the Candidate.

## Mutations, recovery, and CORS

Successful add/remove resets offset to zero and refreshes only the initiating
Style's Candidate prefix. No broad global/private cache invalidation occurs.
Previous/Next remains bounded; there is no all-pages preload.

POST 409 retains draft, refreshes Project/Style/first page/chosen Facility and,
only after Facility success, Supplier context. Matching duplicates and archived
references are shown; archived parents immediately disable mutation controls.
POST 404 retains draft without substitution or automatic retry. Network/5xx
uncertainty refetches a bounded first page; visible match is evidence of an edge,
but absence is not proof of failure. Re-submit requires explicit review.

Unlink requires Confirm remove/Cancel and explains that Facility/Supplier remain.
DELETE 404 refreshes and reports absence; 409 refreshes parents/list and becomes
read-only if archived. Network/5xx uncertainty never retries or treats one shifted
offset page as global absence. Late-generation callbacks cannot reset a new draft,
invalidate another workspace, navigate, or show stale messages.

DELETE CORS now covers only both legitimate private-edge unlink path families:
Material Selections and Facility Candidates. Origins, headers, credentials and
global method policy are unchanged. Tests retain Material Selection support and
deny unrelated Material, Facility, Supplier and Project DELETE. Both real origin
modes exercise Candidate DELETE.

## Validation

| Gate                                         | Actual result                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Backend verify/build                         | 465 tests, 0 failures/errors/skips; build passes                                           |
| Frontend Vitest                              | 1,068 tests / 26 files pass; 57 new Candidate cases                                        |
| Frontend typecheck/build                     | pass/pass                                                                                  |
| Same-origin full Playwright                  | 55 pass                                                                                    |
| Separate-origin full Playwright              | 55 pass                                                                                    |
| Fresh V1→V16 / populated V15→V16 / Flyway    | pass; old 44 application-table snapshots unchanged; new Candidate table empty, then usable |
| Terraform fmt/init `-backend=false`/validate | local pass, no changes                                                                     |
| Official exporter twice                      | identical; prior paths/schemas unchanged                                                   |
| Diff and standalone Gitleaks                 | pass; standalone Gitleaks 8.28.0 staged diff, no leaks                                     |

Eight new real-browser cases cover writer discovery/add/unlink, Supplier and
Facility archive retention, parent lifecycle, duplicate/parent conflicts,
VIEWER/PLATFORM_ADMIN boundaries, unavailable live references, and three held
sibling orders. Responsive review covers desktop 1440×1000, tablet 820×1180 and
mobile 390×844; 15 captures per origin, 30 total, have been visually reviewed. Every capture
asserts zero horizontal overflow. Labels/IDs wrap, keyboard filter traversal and
confirmation controls work, and archived/unavailable status is textual.
Artifacts stay in ignored `.local/phase2e-review`.

Artifact SHA-256 checksums:

```text
291a4abc00ab55410f01be61680ba871801188232997ffa2c36c7ef2a28edaed  docs/openapi.json
bc68afb5d271b19ab0e21b3ae64d84a9dec3f6ce9ae5d202de129f178244786a  apps/web/src/api/schema.ts
```

Generated changes are only the two hierarchical Candidate paths and three
Candidate schemas. FacilityReference is not an HTTP operation/schema. Existing
Supplier/Facility, Requirement, Material Selection and commercial contracts and
exact-decimal behavior remain unchanged. No dependency/infrastructure/workflow
change or DirectorySearch/SupplierService production change is included.

## Changed files

The implementation changes exactly these 36 files:

```text
apps/api/src/main/java/com/sourceos/audit/AuditRecorder.java
apps/api/src/main/java/com/sourceos/facility/FacilityService.java
apps/api/src/main/java/com/sourceos/identity/SecurityConfiguration.java
apps/api/src/main/java/com/sourceos/stylefacilitycandidate/StyleFacilityCandidateController.java
apps/api/src/main/java/com/sourceos/stylefacilitycandidate/StyleFacilityCandidateService.java
apps/api/src/main/java/com/sourceos/stylefacilitycandidate/package-info.java
apps/api/src/main/resources/db/migration/V16__style_facility_candidate.sql
apps/api/src/test/java/com/sourceos/ArchitectureTest.java
apps/api/src/test/java/com/sourceos/FoundationIntegrationTest.java
apps/api/src/test/java/com/sourceos/MigrationUpgradeTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateConcurrencyTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateMigrationTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidatePersistenceTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateSqlTest.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateSupport.java
apps/api/src/test/java/com/sourceos/StyleFacilityCandidateTest.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionMigrationTest.java
apps/api/src/test/java/com/sourceos/SupplierDirectoryTest.java
apps/api/src/test/java/com/sourceos/WorkspaceMigrationTest.java
apps/api/src/test/java/com/sourceos/identity/CorsConfigurationTest.java
apps/web/e2e/candidate-fixture.ts
apps/web/e2e/facility-candidates.spec.ts
apps/web/e2e/workspace.spec.ts
apps/web/src/api/queryKeys.ts
apps/web/src/api/schema.ts
apps/web/src/features/network/facilityQueries.ts
apps/web/src/features/workspace/FacilityCandidates.test.tsx
apps/web/src/features/workspace/FacilityCandidates.tsx
apps/web/src/features/workspace/MaterialSelections.test.tsx
apps/web/src/features/workspace/Requirement.test.tsx
apps/web/src/features/workspace/Workspace.test.tsx
apps/web/src/features/workspace/facilityCandidateModel.ts
apps/web/src/pages/FacilitiesPage.tsx
apps/web/src/pages/StyleDetailPage.tsx
docs/openapi.json
docs/phase-2e-style-facility-candidates.md
```

## Stop boundary

The single implementation commit and exact-head push CI are reported after
validation. No PR is created. Stop after its successful CI for independent 2E
review. Phase 2F, StyleDevelopmentReference, V17, storage reservation, upload,
finalization and attachment UI remain unimplemented.
