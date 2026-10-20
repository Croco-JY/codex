# Phase 1A validation — 2026-10-19

Completed scope: Phase 1A-1 through 1A-3, V3–V8 only. Branch: `phase-1-supply-network`, based on main `4b33b44`. No PR or merge; no V9, Material, price, inventory or claim implementation. Previous documentation commits remain intact.

## Local validation

Commands ran in this cloud environment with Java 25.0.4.1, PostgreSQL 18.3 Testcontainers, Node 24.19, pnpm 11.25.0 and system Chromium. Existing cloud setup and ignored `.local/cloud-env.sh` activate the tools. No additional runtime or production dependency was introduced.

| Check | Observed result |
|---|---|
| Complete backend `./mvnw -B verify`, through `./scripts/test.sh` | 63 passed; 0 failed, errors or skipped |
| Frontend strict typecheck | passed |
| Vitest | 2 passed |
| Production frontend build | passed |
| Playwright against running migrated API | 1 passed |
| Java-owned OpenAPI and TypeScript generation | passed; repeated generation byte-identical |
| Modulith boundaries | passed in backend suite |
| Authentication/platform/organization policy | passed in backend suite |
| Terraform `fmt -check`, `init -backend=false -input=false`, `validate` | passed; no infrastructure deployed |
| V1/V2 bytes versus origin/main | unchanged |
| Gitleaks 8.28.0, archive checksum verified | committed history and final staged changes scanned with redaction; no leaks |
| Git whitespace validation | passed |

Existing `scripts/test.sh` exited 0. The final hardening browser run used a separate fresh V8 development database; the populated V1/V2 upgrade is verified by MigrationUpgradeTest. No Flyway repair, disabled validation, H2 fallback or test skip was used. GitHub Actions results are separate; this report claims local validation only.

## Backend test inventory

| Suite | Tests |
|---|---:|
| ArchitectureTest | 1 |
| FacilitySearchTest | 12 |
| FoundationIntegrationTest | 6 |
| GeographySourceTest | 13 |
| IdentityTest | 3 |
| MigrationUpgradeTest | 2 |
| OidcSecurityIntegrationTest | 3 |
| PersistentIdentityHardeningTest | 4 |
| PlatformFoundationTest | 5 |
| SupplierDirectoryTest | 14 |

The 13 Phase 0 backend tests remain and pass (Foundation 6, Identity 3, OIDC security 3, architecture 1). Phase 1A adds 50 tests: platform 5, migrations 2, geography/source 13, supplier 14, facility/search 12, final identity hardening 4. The existing foundation migration-count assertion now expects 8 migrations; its prior behavioral checks remain. Frontend and browser tests are unchanged.

New tests cover real PostgreSQL direct constraints, migration history preservation, audit UPDATE/DELETE/TRUNCATE guards, platform grant/revoke and organization-role isolation, source raw/normalized identities, observation retry/conflict/supersession, append-only reviews, supplier identity concurrency, link cardinalities, verification rollback when audit fails, geography and capability cycles, exact nullable quantities, stale versions and same-facility search semantics.

## Migrations and exact tables

Only existing table `audit_event` is altered. V3 adds scope/entity/state columns, scope/entity/object checks and drops organization_id NOT NULL while retaining its FK. Constant DEFAULT ORGANIZATION logically backfills prior rows without UPDATE or guard bypass. Existing organization and membership tables are unchanged. V4–V8 add exactly 21 tables:

| Migration | Added tables | Explicit indexes (in addition to PK/UNIQUE indexes) |
|---|---|---|
| `V3__audit_platform_scope.sql` | none; extends audit_event | `audit_platform_entity_idx` |
| `V4__platform_role_assignment.sql` | `platform_role_assignment` | `platform_active_grant_uq` |
| `V5__geography.sql` | `country`, `region`, `industrial_cluster` | `region_parent_idx`, `cluster_region_idx` |
| `V6__external_source_identity.sql` | `data_source`, `data_source_record`, `data_source_observation`, `data_source_observation_review` | `observation_record_time_idx`, `review_latest_idx` |
| `V7__supplier_directory.sql` | `supplier_profile`, `supplier_organization_link`, `supplier_external_record`, `supplier_role`, `supplier_alias`, `supplier_verification_event`, `supplier_source` | `supplier_country_list_idx`, `supplier_verification_idx`, `supplier_list_idx`, `supplier_one_active_account_idx`, `supplier_link_org_idx`, `supplier_external_canonical_idx`, `supplier_role_lookup_idx`, `supplier_verification_history_idx`, `supplier_source_observation_idx` |
| `V8__facility_capability.sql` | `facility`, `facility_external_record`, `facility_source`, `capability`, `facility_capability`, `facility_capability_source` | `facility_supplier_idx`, `facility_country_list_idx`, `facility_region_idx`, `facility_cluster_idx`, `facility_list_idx`, `facility_external_canonical_idx`, `facility_source_observation_idx`, `capability_parent_idx`, `capability_facility_lookup_idx`, `facility_capability_observation_idx` |

Important integrity rules: ACTIVE platform grant unique by issuer/subject/role; ACTIVE account link unique by supplier only; source identity unique by source/kind/normalized key; immutable external identity; unique observation retry key and same-record supersedes FK; typed SUPPLIER/FACILITY composite FKs; immutable observations/reviews/verification history; country-consistent composite FKs; recursive region/capability cycle guards with serialized tree writes; facility cluster-region ancestry checks; numeric coordinate ranges, nullable nonnegative quantity ranges and required units. Ordinary FK/PK/UNIQUE constraints and controlled enums apply throughout. DB comments identify bindings versus citations.

## Added API operations

All paths below are under `/api/v1`; directory reads require authentication and admin operations require PLATFORM_ADMIN. There are 42 new method/path operations. Java-generated schemas in [openapi.json](openapi.json) are authoritative. Supplier/facility search uses created_at/id keyset cursors with sort/filter identity validation and maximum page size 100. Reference/source lists use bounded limit/offset; detail child lists are bounded to 100.

| Method | Path |
|---|---|
| POST | `/api/v1/admin/capabilities` |
| PUT | `/api/v1/admin/capabilities/{id}` |
| PATCH | `/api/v1/admin/countries/{id}` |
| POST | `/api/v1/admin/facilities` |
| PUT | `/api/v1/admin/facilities/{id}` |
| PUT | `/api/v1/admin/facilities/{id}/capabilities/{capability}` |
| POST | `/api/v1/admin/facilities/{id}/external-records` |
| GET | `/api/v1/admin/facilities/{id}/sources` |
| POST | `/api/v1/admin/facilities/{id}/sources` |
| POST | `/api/v1/admin/facility-identities` |
| POST | `/api/v1/admin/industrial-clusters` |
| PUT | `/api/v1/admin/industrial-clusters/{id}` |
| POST | `/api/v1/admin/regions` |
| PUT | `/api/v1/admin/regions/{id}` |
| POST | `/api/v1/admin/source-observations` |
| GET | `/api/v1/admin/source-observations/{id}/reviews` |
| POST | `/api/v1/admin/source-observations/{id}/reviews` |
| POST | `/api/v1/admin/source-records` |
| GET | `/api/v1/admin/source-records/{id}/observations` |
| GET | `/api/v1/admin/sources` |
| POST | `/api/v1/admin/sources` |
| PUT | `/api/v1/admin/sources/{id}` |
| POST | `/api/v1/admin/supplier-identities` |
| POST | `/api/v1/admin/suppliers` |
| PUT | `/api/v1/admin/suppliers/{id}` |
| POST | `/api/v1/admin/suppliers/{id}/aliases` |
| POST | `/api/v1/admin/suppliers/{id}/external-records` |
| GET | `/api/v1/admin/suppliers/{id}/sources` |
| POST | `/api/v1/admin/suppliers/{id}/sources` |
| POST | `/api/v1/admin/suppliers/{id}/verification-events` |
| GET | `/api/v1/capabilities` |
| GET | `/api/v1/countries` |
| GET | `/api/v1/facilities` |
| GET | `/api/v1/facilities/{id}` |
| GET | `/api/v1/facilities/{id}/capabilities` |
| GET | `/api/v1/industrial-clusters` |
| GET | `/api/v1/regions` |
| GET | `/api/v1/suppliers` |
| GET | `/api/v1/suppliers/{id}` |
| GET | `/api/v1/suppliers/{id}/aliases` |
| GET | `/api/v1/suppliers/{id}/facilities` |
| GET | `/api/v1/suppliers/{id}/verification-events` |

No public/bootstrap, self-promotion, claim, account-link mutation or commercial endpoints exist. Mutations obtain Actor from server context; unexpected JSON fields are rejected. A typed identity resolver reuses an existing canonical row and appends a citation; it does not overwrite canonical fields on repeated imports. Explicit versioned admin updates change facts.

## Architecture decisions and remaining limits

No architectural deviations from the final Phase 1A specification. Supplier account-link foundation and verification history are encapsulated in the supplier module. Ordinary supplier/facility persistence uses JPA; database-centric operations use explicit SQL. PostgreSQL is the sole system of record. Only KR/JP/CN reference countries are seeded; no fake businesses or automatic production administrators.

No unresolved local validation failures. Production-scale import/search throughput has not been benchmarked; geography checks scan facilities and serialize related writes. Benchmark before importing large production datasets. Initial name search uses normalized substring LIKE without pg_trgm. Source contracts currently support PRESERVE and explicit TRIM only; other normalization requires a reviewed extension, never global case conversion. Cross-source canonical matching remains an explicit administrator decision.

The operator bootstrap runbook documents atomic grant/audit, but no production identity or database was provisioned. Live OIDC provider integration and production deployment remain unvalidated here; tests use the existing mocked decoder and isolated synthetic principals. The frontend retains the Phase 0 shell; a full directory/admin UI is deferred by scope.

Before Phase 1B/V9, explicitly review the Material architecture choice (supplier-scoped, canonical plus listing/offer, or staged hybrid), DB-enforced subtype integrity, immutable price identity/value with narrow closing rules, deterministic scope-aware resolver order, observation-based inventory idempotency/NULL uniqueness, and future raw-artifact authorization/retention. These are planning gates, not implemented placeholders; see [plan](phase-1-plan.md).

## Final Phase 1A hardening

The workflow display name is now `SOURCE OS CI` and its artifact is `source-os-test-results`. All jobs, steps, commands and validation coverage remain unchanged; the workflow diff contains only those two replacements.

Only unmerged migrations V6/V7/V8 change in this pass. V7 requires `length(trim(actor_issuer)) > 0` and `length(trim(actor_subject)) > 0` for verification events, in addition to NOT NULL. V3/V4/V5 and V1/V2 remain unchanged. No V9 or new tables are introduced.

Persistent identity protection uses the existing rejection function, without a new lifecycle or history framework:

- `data_source_record`: protect the stable UUID as well as its source/kind/raw/normalized key from UPDATE; reject physical DELETE and TRUNCATE. An unreferenced record could previously be deleted because no FK yet depended on it. Legitimate first_seen_at/last_seen_at observation updates remain allowed and are tested.
- `supplier_external_record` and `facility_external_record`: retain UPDATE/DELETE guards and explicitly reject TRUNCATE. Row mutation triggers do not fire for TRUNCATE, and these binding tables have no inbound FK that reliably prevents their independent truncation. Direct guards make their persistence independent of other history tables.
- Observations, observation reviews and verification events retain their existing UPDATE/DELETE/TRUNCATE protection. Reviews and verification actions append new facts; they do not edit old events.

The source/supplier/facility controllers and services were reviewed. No ordinary HTTP UPDATE/DELETE route modifies historical observations, reviews, verification events or bindings; no DELETE endpoint exists for source records. Regression requests reject PUT/PATCH/DELETE even for a platform administrator. Canonical supplier/facility updates and source-record observation timestamps remain distinct from immutable history. No application implementation or provenance schema was changed.

Migration validation uses new PostgreSQL 18 databases for clean V1→V8 and populated Phase 0 V1/V2→V8. Browser smoke uses a separate fresh development database. The earlier V8 development database is preserved, with no Flyway repair, checksum replacement or disabled validation. Since these migrations are unmerged, an already-applied development V6–V8 is not an upgrade baseline for the edited checksums.

The initial full run passed backend/frontend checks but browser navigation timed out while reusing an existing development server. The unchanged smoke passed a diagnostic rerun with tracing. The final full `scripts/test.sh` run exited 0 with Playwright starting a fresh web server after the build, matching CI startup order. No application code, test assertion or timeout was changed. Final counts are 63 backend, 2 frontend and 1 browser test, all passed; contract regeneration and Terraform checks also pass.
