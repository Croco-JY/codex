# Phase 2D — Style Material Selections

## Baseline and scope

Implementation starts from `4c52d9f1c5c1eb2114dfed5b557af950c0598465`
(`feat: add style requirement workspace`) on `phase-2-product-workspace`.
Its parent is `48393906539c74b563b715b43599ca2bb6db947d`; main remains
`6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`. The clean local/remote baseline,
accepted history, absence of an open Phase 2 PR, and successful exact-head
Phase 2C push CI `39931494912` were verified before editing.

This slice adds immutable, removable private catalog-reference edges beneath
Style. A Selection is consideration during development, not a copied Material,
BOM line, RFQ item, supplier award, purchase, reservation, or commercial snapshot.
No price, quantity, currency, MOQ/MCQ, inventory, lead time, evidence, or seller
identity is copied into the relationship.

## Module and authorization boundaries

`stylematerialselection` depends only on the public `style`, `material`,
`materiallisting`, `audit`, and infrastructure `shared` contracts. It imports no
Project type, catalog repository/entity, Price, Inventory, Supplier, or ingestion
contract. Catalog modules do not depend on Product Workspace. Spring Modulith
verification and focused public-contract architecture assertions cover this graph.

List calls `StyleService.readContext`; add/remove call
`StyleService.lockContextForWrite`. Organization permission precedes scoped
Project and Style hierarchy resolution. OWNER/ADMIN write; VIEWER reads only.
Outsiders, revoked members, and PLATFORM_ADMIN without membership have no bypass.
Requested-Organization permission failures are 403; authorized wrong hierarchy
and wrong-Style Selection IDs are 404. Archived parents remain readable but block
both add and remove with 409.

## Relationship and HTTP contract

The only persisted/view fields are `id`, `styleId`, `materialId`, `variantId`,
`listingId`, and `createdAt`. Optional reference properties are required nullable
properties in the response. IDs are canonical UUIDs; Selection ID is generated
by the server. There is no version, lifecycle, update endpoint, or detail GET.

The shared path prefix is:

`/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/material-selections`

| Method | Path suffix      | Result             | Permission                           |
| ------ | ---------------- | ------------------ | ------------------------------------ |
| GET    | none             | 200 bounded page   | Organization read                    |
| POST   | none             | 201 Selection view | Organization write, active ancestors |
| DELETE | `/{selectionId}` | 204, empty body    | Organization write, active ancestors |

POST accepts only required `materialId` and optional/null `variantId` and
`listingId`. Unknown fields, empty/invalid UUID strings, and non-string UUID
tokens are rejected. No caller ownership, Actor, version, or commercial fields
are accepted. Missing optional IDs normalize to null.

All four scopes can coexist: M, M+V, M+L, M+V+L. Variant and Listing independently
belong to Material. There is no Listing-to-Variant relationship. Catalog supplier
and Listing seller may differ; seller lifecycle is not a registration condition.

| Operation / condition                                | Outcome                            |
| ---------------------------------------------------- | ---------------------------------- |
| List, empty or archived ancestors                    | 200 page; empty `items` is normal  |
| Add, any of the four active scopes                   | 201                                |
| Supplied Variant/Listing belongs to another Material | 400                                |
| Missing Material/Variant/Listing                     | 404                                |
| Material DRAFT/ARCHIVED; Variant/Listing ARCHIVED    | 409                                |
| Exact duplicate scope                                | 409                                |
| Concurrent duplicate                                 | one 201, one 409; one add audit    |
| Add/remove with archived Project or Style            | 409                                |
| Remove, own existing Selection                       | 204                                |
| Remove, missing/wrong-Style/already removed          | 404                                |
| Concurrent remove                                    | one 204, one 404; one remove audit |

There is no new 412 contract. A collection GET 404 is an error, never an empty
page; Requirement's special singular-absence mapping does not apply here.

## Provider reference contracts and locking

Material owns immutable `MaterialReference(materialId,status)` and
`VariantReference(variantId,materialId,status)` records, with narrow unlocked
`readReference`/`readVariantReference` methods. Listing owns immutable
`ListingReference(listingId,materialId,status)` and `readReference`.

Active reference methods use `Propagation.MANDATORY` and provider-owned
`SELECT ... FOR SHARE`. They require an existing caller transaction, return 404
for missing rows, 400 for optional-reference Material mismatch, and 409 for
inactive state. Listing locking neither calls Material nor locks Supplier.
No public HTTP lock API is added, and no canonical version/status is changed.

Add executes in one transaction in this exact order:

`Project → Style → Material → optional Variant → optional Listing → insert → audit`

Parent lifecycle is checked while workspace locks are held, before provider
validation. Material validation precedes Variant, then Listing, then uniqueness.
Remove locks Project and Style, then deletes only by `style_id AND id`; it does
not require active catalog references or provider locks.

Independent PostgreSQL sessions prove the five-step lock chain with blocked
writers and `FOR UPDATE NOWAIT` probes. Catalog status UPDATE conflicts with
provider SHARE locks. For Material, Variant, and Listing archive races in both
orders: add-first commits and the later archive retains the edge; archive-first
makes add return 409 without a Selection/audit. Project/Style archive races cover
both add and remove in both orders. Timeouts are test failures, not race outcomes.

## V15 and private unlink

`V15__style_material_selection.sql` creates one table with the six fields above.
Style/Material FKs have no cascading delete. Composite Variant and Listing FKs
reuse V9's `(id,material_id)` unique keys and enforce Material consistency even
for direct SQL writes. There is no duplicated organization/project/supplier state.

Named constraint `style_material_selection_scope_uq` uses
`UNIQUE NULLS NOT DISTINCT(style_id,material_id,variant_id,listing_id)`.
All four nullable scope combinations are protected atomically. Add uses
`ON CONFLICT ON CONSTRAINT ... DO NOTHING RETURNING`; no returned row means 409,
not a replay success. There is no precheck-only duplicate strategy.

An identity trigger prevents changes to every identity/reference/timestamp
column. Individual DELETE is intentionally allowed for this private draft edge;
the Project/Style/Requirement no-delete policy is not attached to this table.
TRUNCATE is forbidden using existing `reject_workspace_destruction()`.
Unlink leaves canonical records and historical audit intact; re-add receives a
new Selection UUID.

Indexes cover `(style_id,created_at DESC,id DESC)` and reverse Material, Variant,
and Listing references. List selects only the private table, ordered by
`created_at DESC,id DESC`, fetches `limit+1`, and returns `items/limit/offset/hasMore`
without total. Defaults are 25/0; accepted bounds are 1–100 and 0–100000.

V1–V14 remain byte-identical to the baseline. V15 is the only new migration;
there is no V16+. Fresh V1→V15 and populated V14→V15 are tested with Flyway
validation. Upgrade snapshots all 43 pre-existing application tables, including
Project, Style, Requirement, catalog, and audit, and compares every row after
upgrade; the new table starts empty. Final counts are 15 applied migrations,
45 public base tables including Flyway history, and 44 application base tables.
Existing metadata assertions change only for these counts/new empty table.
The historical Requirement V13→V14 test explicitly targets V14 so its original
upgrade assertions remain intact; the new test covers V14→V15.

## Audit

Successful commands record ORGANIZATION-scoped `material_selection.added` and
`material_selection.removed`, entity `StyleMaterialSelection`, entity ID equal
to the Selection UUID. State contains only `styleId/materialId/variantId/listingId`:
add has null before; remove has null after. Actor comes from authentication.
AuditRecorder is unchanged: all four scalar keys were already allowlisted.
Validation, authorization, hierarchy, inactive/duplicate conflicts, concurrency
losers, and rollback produce no success audit. Audit and edge commit together.

## Style UI, private and global cache ownership

Style detail presents metadata, Requirement, then Material Selections. No route
or sidebar entry is added. Project must resolve before Style; Style must succeed
before either child query starts. Requirement and Selections then mount as
independent siblings. Their relative network order is intentionally unspecified;
pending/error in one section does not suppress the other authorized section.
Existing exact request assertions retain the exact Project/Style prefix and
exact unordered pair of child URLs/IDs, without permitting arbitrary extra reads.

Private page keys are
`workspace/scope/org/project/P/style/S/material-selections/25/offset`.
Mutation keys add `/add` or `/{selectionId}/remove` beneath that prefix.
Both commands use unchanged `useWorkspaceCommand`, including `retry:false`,
Actor scope, and Organization generation guards. Successful commands reset
offset to zero and refresh only the initiating Style's Selection collection.
Project/Style/Requirement versions and global catalog caches are not invalidated.

The in-page picker reuses global ACTIVE Material keyword/cursor discovery,
bounded Variant and Listing pages, and independent optional choices. No manual
UUID workflow is required. Changing Material clears both optional IDs. Loaded
parent IDs/statuses are checked before constructing the body; backend locks
remain authoritative. Picker draft and conflict state are memory-only and are
discarded on Organization/Actor/logout boundaries, including ABA. Global Supply
cache survives Organization changes. No cross-route private draft is introduced.

Live hydration uses only unique canonical IDs on the currently loaded Selection
page and existing session-scoped global keys:

- `supply/scope/material/materialId`
- `supply/scope/material-variant/variantId`
- `supply/scope/listing/listingId`

Rows always retain their stored canonical IDs, Selection ID, and createdAt.
Failed live reads show `Label unavailable`; archived/DRAFT statuses are live,
not creation snapshots. Hydration does not recursively discover children,
Suppliers, Price, Inventory, Sources, or future Selection pages. Picker list
discovery is separate from row hydration. Previous/Next navigates bounded pages.

Measured component fixtures: four scopes sharing references generate one exact
Material, one Variant, and one Listing read; 25 fully distinct full-scope rows
generate 25+25+25 = 75 unique exact reads. A 26th off-page reference is not fetched.
There is no next-page prefetch. These are fixture observations, not a fixed
request count for every real Style; repeated IDs/cache reuse reduce traffic.

## Conflict, ambiguity, and removal UX

Writer controls require active parents and supported loaded private state.
VIEWER and archived-parent pages remain readable without add/remove actions.
Removal requires explicit Confirm remove/Cancel and explains that catalog
records remain. Canonical archived references can still be unlinked under active
workspace ancestors.

POST 409 retains scope, refreshes parents, first Selection page, and chosen exact
references, and shows a matching tuple/inactive status where visible. Archived
parents immediately disable submission/removal. POST 404 retains draft and
refreshes references without substitution. Network/5xx ambiguity never retries
automatically; the bounded refreshed page can reveal a matching tuple but cannot
prove failure by absence. Review/re-submit requires explicit operator action.
DELETE 404 refreshes and reports that the Selection is no longer present; 409
refreshes parents/list and disables controls if archived. Ambiguous DELETE does
not treat absence from a shifted page as proof of global absence. Late results
cannot reset or invalidate another Actor/Organization/generation's state.

The new DELETE route requires cross-origin preflight support. SecurityConfiguration
adds DELETE only for the hierarchical Selection unlink path; origins, credentials,
headers, and all other methods/paths retain existing policy. A copied independent
method list prevents widening the global policy. Existing CORS security assertions
remain unchanged, and a new focused test verifies narrow scope. No controller
lock endpoint, infrastructure, workflow, or dependency change is introduced.

## Validation

Final local results are recorded below. Desktop (1440×1000), tablet
(820×1180), and mobile (390×844) review covers 12 states per origin,
24 screenshots total. Every capture asserts zero horizontal overflow. Visual
inspection covers empty/picker/list, archived parents/catalog, confirmation,
duplicate and parent conflict, VIEWER, and denied states. UUIDs and long labels
wrap; native picker controls, keyboard traversal, confirmation and pagination
remain accessible. Screenshots stay under ignored `.local/phase2d-review`.

| Gate                                         | Result                                                   |
| -------------------------------------------- | -------------------------------------------------------- |
| Backend `./mvnw -B verify`                   | 427 tests, 0 failures, 0 errors, 0 skipped; build passes |
| Frontend `pnpm test`                         | 1,011 tests / 25 files pass                              |
| Frontend typecheck / production build        | pass / pass                                              |
| Same-origin full Playwright                  | 47 pass                                                  |
| Separate-origin full Playwright              | 47 pass                                                  |
| Fresh/upgrade/Flyway                         | pass; counts and row snapshots above                     |
| Terraform fmt/init `-backend=false`/validate | local pass, no changes                                   |
| Official exporter twice                      | identical; all prior paths/schemas unchanged             |
| Diff and standalone secret checks            | pass; standalone Gitleaks 8.28.0 staged diff, no leaks   |

Artifact SHA-256 checksums (`sha256sum` output):

```text
a78a050ae50841010409fa43ff2fb382c5888c30ca898c3c521bc397e1031945  docs/openapi.json
099d59a52cbd7540c1f00bcafb5d936a0c043deddde9f2dde77446e567df18c6  apps/web/src/api/schema.ts
```

Only the two hierarchical Selection paths and three primary Selection schemas
are added. Both artifacts are generated by `scripts/export-openapi.sh`; existing
Project/Style/Requirement/Material/Variant/Listing/commercial contracts and exact
decimal behavior remain unchanged.

Focused backend coverage includes all four scopes, strict input/hierarchy,
reference state/ownership, nullable uniqueness, composite FKs, immutable identity,
allowed unlink/forbidden truncate, rollback/audit, provider transaction contracts,
duplicate/remove concurrency, catalog/parent archive races, and real lock probes.
43 new component cases cover body scopes, picker clearing, private list errors,
read-only states, recovery without automatic retries, pagination, retained live
IDs/statuses, sibling gating, hydration limits/deduplication, ABA/Actor isolation,
and preservation of global Supply cache. Five real-browser cases extend the
existing suite, including full-scope creation, retention/unlink, parent conflict,
VIEWER/admin boundary, and both held-sibling orders against real API responses.

## Changed files

The implementation changes exactly these 33 files:

```text
apps/api/src/main/java/com/sourceos/identity/SecurityConfiguration.java
apps/api/src/main/java/com/sourceos/material/MaterialService.java
apps/api/src/main/java/com/sourceos/materiallisting/ListingService.java
apps/api/src/main/java/com/sourceos/stylematerialselection/StyleMaterialSelectionController.java
apps/api/src/main/java/com/sourceos/stylematerialselection/StyleMaterialSelectionService.java
apps/api/src/main/java/com/sourceos/stylematerialselection/package-info.java
apps/api/src/main/resources/db/migration/V15__style_material_selection.sql
apps/api/src/test/java/com/sourceos/ArchitectureTest.java
apps/api/src/test/java/com/sourceos/FoundationIntegrationTest.java
apps/api/src/test/java/com/sourceos/MigrationUpgradeTest.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionConcurrencyTest.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionMigrationTest.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionPersistenceTest.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionSupport.java
apps/api/src/test/java/com/sourceos/StyleMaterialSelectionTest.java
apps/api/src/test/java/com/sourceos/StyleRequirementMigrationTest.java
apps/api/src/test/java/com/sourceos/SupplierDirectoryTest.java
apps/api/src/test/java/com/sourceos/WorkspaceMigrationTest.java
apps/api/src/test/java/com/sourceos/identity/CorsConfigurationTest.java
apps/web/e2e/material-selections.spec.ts
apps/web/e2e/selection-fixture.ts
apps/web/e2e/workspace.spec.ts
apps/web/src/api/queryKeys.ts
apps/web/src/api/schema.ts
apps/web/src/features/materials/materialQueries.ts
apps/web/src/features/workspace/MaterialSelections.test.tsx
apps/web/src/features/workspace/MaterialSelections.tsx
apps/web/src/features/workspace/Requirement.test.tsx
apps/web/src/features/workspace/Workspace.test.tsx
apps/web/src/features/workspace/materialSelectionModel.ts
apps/web/src/pages/StyleDetailPage.tsx
docs/openapi.json
docs/phase-2d-style-material-selections.md
```

## Deferred boundary

Phase 2E Facility Candidates, V16, Facility provider selection locks, Phase 2F
Development References, and all RFQ/BOM/Pattern/Sample/commercial commitment and
later execution workflows remain unimplemented. No PR is created by this task.
Acceptance requires the exact new push HEAD's SOURCE OS CI to succeed; its run
and final commit are reported after push. Stop before Phase 2E.
