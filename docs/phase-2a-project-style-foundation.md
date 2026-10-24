# Phase 2A — Project and Style domain foundation

## Baseline and scope

Repository `Croco-JY/codex`, branch `phase-2-product-workspace`, starting HEAD `9eefc27fd5d4029b2c219bf2d777ab2f866b7987` (`docs: lock phase 2 product workspace contracts`). Local/origin/GitHub branch equality, clean worktree, accepted main `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`, successful exact Phase 2-PLAN CI39652263745 and absence of a Phase 2 PR were verified before editing. The [accepted plan](phase-2-plan.md) is unchanged.

Implemented: V13, Project and Style JDBC application modules, eight tenant-scoped operations, immutable public contexts, lifecycle/version/lock contracts, tenant-rich audit and PostgreSQL regression tests. No React Product Workspace, DEVELOP navigation, workspace query keys, Organization-context generation boundary or descendant domain is implemented. Style UUID is canonical design identity.

## V13 schema and database protection

The only new migration is [V13__project_and_style.sql](../apps/api/src/main/resources/db/migration/V13__project_and_style.sql). Its exact table DDL is:

```sql
CREATE TABLE project (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organization(id),
 name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(4000) CHECK (description IS NULL OR length(btrim(description)) > 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE style (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES project(id),
 style_code varchar(100) CHECK (style_code IS NULL OR length(btrim(style_code)) > 0),
 name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
 description varchar(4000) CHECK (description IS NULL OR length(btrim(description)) > 0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
```

There is no Style-code or Project-name uniqueness and no cascading delete. Indexes are exactly:

- project_org_page_idx: `(organization_id,created_at DESC,id DESC)`
- project_org_status_page_idx: `(organization_id,status,created_at DESC,id DESC)`
- style_project_page_idx: `(project_id,created_at DESC,id DESC)`
- style_project_status_page_idx: `(project_id,status,created_at DESC,id DESC)`

`protect_project_identity` rejects changes to id/organization_id/created_at; `protect_style_identity` rejects id/project_id/created_at changes. Dedicated `reject_workspace_destruction` guards DELETE and TRUNCATE on both tables. No unrelated source/provenance function is reused, and no trigger is disabled for tests. Names and optional text have explicit blank checks; NULL description/style_code remains legal. V1–V12 are byte-identical to the starting commit; V14+ is absent.

Fresh PostgreSQL18 validation observed13 applied migrations and43 base tables including Flyway history, with Project/Style both empty. The explicit V12→V13 test snapshots all40 pre-existing non-Flyway tables, including synthetic Organization/membership/audit, external identity/Observation, Supplier/Material/Listing and exact Price/Inventory facts. All legacy rows remain identical; only empty Project/Style tables are added, then proven usable. Existing migration expectations were updated in FoundationIntegrationTest, MigrationUpgradeTest and SupplierDirectoryTest; no coverage was deleted. The Supplier test now describes absence of transactional workflows rather than wrongly labelling all Phase 2 as forbidden.

## Modules and public contexts

Actual allowed dependencies:

| Module | Providers |
| --- | --- |
| project | authorization, audit, shared |
| style | project, audit, shared |

The existing ArchitectureTest retains ApplicationModules.verify() and also verifies that StyleContext.projectStatus() returns a type owned by `com.sourceos.style`. Style→Project is allowed; Project→Style is absent. Neither module accesses OrganizationEntity/Repository or membership SQL. JdbcClient handles only its own table. No JPA entities/repositories or mutable persistence objects are exported.

Public application signatures:

```java
ProjectContext ProjectService.readContext(UUID org, UUID id);
ProjectContext ProjectService.lockContextForWrite(UUID org, UUID id);
// ProjectContext(UUID projectId, UUID organizationId, Status status)

StyleContext StyleService.readContext(UUID org, UUID project, UUID id);
StyleContext StyleService.lockContextForWrite(UUID org, UUID project, UUID id);
// StyleContext(UUID organizationId, UUID projectId, UUID styleId,
//              ParentStatus projectStatus, Status styleStatus)
```

`ParentStatus` is `StyleService.ParentStatus` and contains `ACTIVE` / `ARCHIVED`. Style internally depends on Project, but its public StyleContext does not leak Project-module types to future descendant modules. The Project status is mapped explicitly inside Style; `styleStatus` remains `StyleService.Status` because Style owns that lifecycle.

Read contexts are read-only transactions. Both write-lock contracts require an existing transaction (MANDATORY); they return actual lifecycle states, including ARCHIVED, rather than a fake404 or just a writable boolean. Future descendants must inspect both parent states while retaining these locks through their write. Calling a lock context without a transaction fails; no descendant implementation is added here.

## Authorization and lookup ordering

Authentication resolves Actor; OrganizationAuthorization runs before any private identity lookup. Project predicates include id AND organization_id. Style first establishes the authorized scoped Project, then matches id AND project_id. The Style module owns the Project's child collection endpoint, without embedding mutable Styles in Project detail.

| Principal/request | Actual result |
| --- | --- |
| Active ORG_OWNER / ORG_ADMIN | Read and write |
| Active VIEWER | Read; writes403 |
| Outsider / revoked member |403, including unknown resource IDs |
| PLATFORM_ADMIN without tenant membership |403, no bypass |
| No authentication |401 |
| Member of requested Organization, foreign/missing Project |404 |
| Style under another Project, same or foreign Organization |404 |

Hierarchy404 precedes Project archive409 for Style update. Parent archive then precedes Style version/lifecycle checks. Parsing/type errors are400 with no private lookup. The existing Problem Details/requestId machinery is reused; errors do not reveal foreign names, SQL or constraint details. No new roles, support impersonation or PlatformAuthorization change.

## Project and Style contracts

Schemas are explicitly named ProjectCreateInput, ProjectUpdateInput, ProjectView, ProjectPage, StyleCreateInput, StyleUpdateInput, StyleView and StylePage.

| Operation | Input/result semantics |
| --- | --- |
| Project create | name, optional description; server UUID, ACTIVE, version0 |
| Project replacement | name, optional description, status, explicitly required version |
| Style create | optional styleCode, name, optional description; path-derived Project, server UUID, ACTIVE/version0 |
| Style replacement | optional styleCode, name, optional description, status, required independent Style version |
| Views | IDs/parent/status/version/UTC createdAt+updatedAt required; description and Style styleCode explicitly nullable |
| Collections | items/limit/offset/hasMore; no total or count query |

Text is normalized with strip(): required nonblank name≤160, optional description≤4000 and Style code≤100, blank optional text→NULL. Code case is preserved and duplicate codes are legal. Missing optional replacement fields clear their old values. Names never become canonical identity. Existing strict unknown-property binding rejects caller IDs, ownership, status/version on create and Actor fields. Local scalar readers reject non-string text, fractional/string version coercion and numeric enum ordinals; missing/null/negative update version400 rather than defaulting0. Required status accepts only ACTIVE/ARCHIVED.

Lists default limit25/offset0, allow limit1..100 and offset0..100000, and order created_at DESC,id DESC. Omitted status includes both states; explicit ACTIVE/ARCHIVED filters one. Bound SQL fetches limit+1 to compute hasMore. No global directory, keyword search, cursor, total or bulk/delete operation is added.

## API inventory

The following are the exact eight new business operations:

| Method | Path | Success |
| --- | --- | --- |
| GET | /api/v1/organizations/{organizationId}/projects |200 ProjectPage |
| POST | /api/v1/organizations/{organizationId}/projects |201 ProjectView |
| GET | /api/v1/organizations/{organizationId}/projects/{projectId} |200 ProjectView |
| PUT | /api/v1/organizations/{organizationId}/projects/{projectId} |200 ProjectView |
| GET | /api/v1/organizations/{organizationId}/projects/{projectId}/styles |200 StylePage |
| POST | /api/v1/organizations/{organizationId}/projects/{projectId}/styles |201 StyleView |
| GET | /api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId} |200 StyleView |
| PUT | /api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId} |200 StyleView |

400 invalid input/mixed lifecycle metadata;401 existing authentication;403 requested-Organization policy;404 scoped hierarchy;409 stale version, archived same-state or archived parent. No new412. Explicit unique operationIds prevent renumbering existing API operations. Unscoped Project/Style routes are absent; DELETE on detail is405.

## Lifecycle, versions and locking

| Current→requested | Rule / success audit |
| --- | --- |
| ACTIVE→ACTIVE | Metadata replacement, including identical PUT; versionN→N+1; project.updated/style.updated |
| ACTIVE→ARCHIVED | Lifecycle-only; normalized name/description/code unchanged, mixed edit400; *.archived |
| ARCHIVED→ACTIVE | Lifecycle-only, metadata unchanged; *.reactivated; Style additionally requires ACTIVE Project |
| ARCHIVED→ARCHIVED |409 even when identical |

All successful updates explicitly increment their own version and return the database's refreshed view. Stale409 does not overwrite or emit another success audit. Project and Style versions are independent. Project archive/reactivation never rewrites Style states; authorized archived reads remain available. Archived Project blocks all Style creates/updates/archive/reactivation409.

Persistence is JdbcClient with scoped FOR UPDATE and conditional versioned UPDATE RETURNING, not dirty checking. Project is the descendant serialization root. Style create locks Project; existing Style changes lock **Project→Style** and retain both through mutation/audit/commit. Public write contexts use the same order. No unlocked ACTIVE check is reused after another writer archives the parent.

Nine PostgreSQL concurrency cases prove: archive vs create/update/reactivation in both winner orders (six); two stale writers for Project/Style (two); and actual Project-before-Style row acquisition (one). The test first holds the Style row, observes the worker blocked on it, and proves a third session cannot acquire Project NOWAIT—then releases Style and verifies success.

Observed serialization: child-first commits, then archive commits (both succeed); archive-first commits and the waiting child409 without mutation/audit. Two versionN writers yield one200/one409 and only one success audit. Timeouts are fixed: DB lock5s, statement8s, Java latch5s, PID future3s, lock-observation poll3s, result future10s and executor termination10s. Coordination uses independent transactions/connections and actual pg_blocking_pids, not arbitrary long sleeps. Finally blocks release latches, close/rollback connections and shut down executors. No timeout is counted as a valid race outcome or increased to hide a failure.

## Tenant audit and rollback

New helper:

```java
@Transactional(propagation = MANDATORY)
void organizationChanged(UUID organizationId, String action, String entityType,
    UUID entityId, String requestId, Map<String, ?> before, Map<String, ?> after);
```

IdentityService.current() supplies Actor. ORGANIZATION scope/owning organizationId and Project/Style entity target persist in existing audit columns. Actual servlet requestId is forwarded unchanged. No platform()/changed() call is used for private mutations. Only projectId/styleId are added to the existing scalar allowlist; emitted state contains IDs/status/version, never name, code, description, DTO/request dump or binary data.

Actions are project.created/updated/archived/reactivated and style.created/updated/archived/reactivated. Creation has NULL before_state and controlled after_state. Mutation and audit share one transaction. Tests prove failed versions/lifecycle/parent state add no success audit, forced rollback restores both domains and their audits, and unsupported/nonscalar audit state rolls back an associated successful business update. Calling the helper outside a transaction fails.

## Test isolation

Inspection found no pre-existing generic @Sql/DELETE/TRUNCATE cleanup convention. Existing destructive SQL appears in negative immutable-history tests, not general cleanup. New integration fixtures use unique UUIDs/Actors/Organizations; migration tests use disposable PostgreSQL18 databases. No Project/Style DELETE/TRUNCATE is introduced as cleanup.

Direct guard tests use a dedicated transaction and rollback to a savepoint after each expected SQL failure, then verify the connection is usable. The whole transaction rolls back at the end. TRUNCATE project CASCADE includes its referencing Style table so the intended workspace trigger, rather than PostgreSQL's FK precheck, is proven to reject destruction; TRUNCATE style and targeted DELETE on each table are also checked. Production triggers/replication role are never disabled or altered for cleanup. Direct SQL tests cover immutable IDs/parents/createdAt, blank optional text, NULL legality, lifecycle/version checks and intended guard messages.

## Generated contracts

Java DTOs remain authoritative. With the exact built backend running, only the repository command `./scripts/export-openapi.sh` was used, twice; it internally invoked pnpm generate:api. There was no separate manual TypeScript generation or handwritten frontend DTO. Only docs/openapi.json and apps/web/src/api/schema.ts changed as tracked generator outputs.

| Output | First pass SHA-256 = second pass SHA-256 |
| --- | --- |
| docs/openapi.json |46c1d0b8c2934adace31b36580f15fdeefd4d737ead06ec35ce6d89145cee804 |
| apps/web/src/api/schema.ts |55409b89953c4aa0e8424bc36af9ad44172ce4998d75f3604af518044e29e2f8 |

The diff adds four hierarchical paths/eight operations and exactly the eight named schemas. Existing paths and schemas are unchanged. Update version is required integer/int64 with minimum0, never nullable/default0; nullable optional fields generate string|null. All page/view identity/status/version/timestamp fields are explicitly required. There is no global /api/v1/projects/{id}. Existing exact-decimal contracts remain unchanged; Project/Style introduce no decimal field.

## Validation and stop boundary

Local final results are recorded here before the implementation commit; exact final SHA, pushed local/origin equality and final-head CI are verified afterward and reported in the completion message. The accepted PLAN CI is not substituted for implementation CI.

| Gate | Actual result |
| --- | --- |
| Full backend/PostgreSQL + build |267 passed;0 failures/errors/skipped;29 new cases, existing ArchitectureTest intact |
| Frontend Vitest |869 passed /22 files |
| Frontend install/typecheck/production build |Frozen install and checks passed |
| Existing same-origin browser regression |32 passed (56.1s) |
| Existing separate-origin browser regression |32 passed (53.7s) |
| OpenAPI / generated TS |Two official exports, identical hashes; intentional additions only |
| Fresh V1→V13 / populated V12→V13 / Flyway |Passed;13 migrations/43 base tables; empty Project/Style on fresh install |
| Terraform |fmt-check, init -backend=false, validate passed; no edits |
| Released history/scope/diff/secret checks |V1–V12 byte-identical; allowed scope only; diff-check and staged Gitleaks passed |

No new Phase 2 browser case or screenshot is required because no Product Workspace UI exists; the accepted browser suites are regression coverage. All screenshot binaries remain outside version control.

Deferred and unimplemented:2B React Projects/Styles/DEVELOP/context generation/query keys;2C Requirement/V14;2D Material Selection/provider locks/V15;2E Facility Candidate/provider locks/V16;2F Development Reference/storage changes/V17;2G final workspace hardening and all later RFQ/Pattern/Measurement/Tech Pack/BOM/Sample/Contract/Payment/Production/QC/Shipment scope. No catalog, membership/role, decimal, file, dependency, infrastructure or workflow production change. No PR or merge; stop after exact-head implementation CI and wait for independent2A review.
