# Phase 1C final pre-merge integration audit

## Baseline and decision boundary

Audit date: 2026-10-21 UTC. Repository: `Croco-JY/codex`; branch: `phase-1c-ui`.

| Baseline | Verified value |
| --- | --- |
| Audited live main / merge base | `3e0940674bacec355a4f2d4c273bddf11c228508` |
| Phase 1C implementation HEAD | `2a9fcf413688ac52907512bf413f09ca72d72c8a` |
| Implementation subject | `feat: add identity binding and harden curation` |
| Main-only / branch-only commits | 0 / 18; main is an ancestor |
| Cumulative changed files, main...implementation | 170 |
| Local, origin tracking and GitHub branch HEAD | Equal to the implementation HEAD |
| Worktree before audit | Clean |
| Exact implementation CI | [SOURCE OS CI 39593327299](https://github.com/Croco-JY/codex/actions/runs/39593327299), completed/success |
| Existing open head/base PR | None at baseline and pre-document recheck |
| Branch protection | Both main and phase-1c-ui report `protected: false` |

Live refs were fetched before inspection and checked again after validation. Main remained unchanged. No history was rewritten. This audit covers the complete main...implementation delta, not only 5E. Only this new document is authorized to change during this task. No implementation correction was necessary.

The audit commit will add one documentation file beyond this implementation baseline. Before PR creation its exact pushed HEAD must have successful SOURCE OS CI, local/origin equality and a clean worktree. Main must be fetched again and still equal the audited SHA, with zero main-only commits. Check again for a duplicate PR. These are manual gates because branch protection does not enforce them. The publication SHA, new CI URL and PR are recorded in the completion report rather than invented before this commit exists. Do not merge or enable auto-merge.

## Cumulative history and accepted slices

The following 18 commits are present in this exact order:

| Commit | Subject |
| --- | --- |
| ee0150a | docs: plan Phase 1C sourcing and admin UI |
| 0a15d61 | docs: resolve Phase 1C contract readiness decisions |
| 4f987ef | fix: stabilize Phase 1 API contracts for UI |
| 6e94896 | feat: add secure Phase 1C application shell |
| 72fb41b | test: harden shell errors and browser authorization flows |
| f3a326e | fix: harden shell deployment portability |
| f9c48e1 | feat: add material discovery workspace and basic detail |
| 565254f | feat: add material commercial detail and read views |
| c2652b3 | feat: add supply network directory and detail views |
| 6e027c2 | docs: lock phase 1c-5 curation contracts |
| eb06e82 | fix: enforce safe curation write preconditions |
| 41f70b4 | feat: add admin source provenance workspace |
| 32dd05b | feat: add supplier and facility curation |
| 927c0fa | feat: add material and listing curation |
| f0a9091 | fix: preserve material filter drafts during navigation |
| d7f83e8 | fix: retain filter edits through pending navigation |
| b4749e0 | feat: add price and inventory curation |
| 2a9fcf4 | feat: add identity binding and harden curation |

| Accepted slice | Cumulative result |
| --- | --- |
| 1C-0 | Contract readiness: exact decimal strings, distinct schemas, authority read |
| 1C-1 | Authenticated shell, protected routes, Actor/session ownership, safe errors and deployment portability |
| 1C-2 | ACTIVE Material discovery, applied URL filters and basic destination; price filtering disconnected |
| 1C-3 | Full Material/Variant/Listing context and bounded current/history Price/Inventory reads |
| 1C-4 | Supplier/Facility directories, detail, reference context and safe contextual navigation |
| 1C-5P | Exact protected Capability read and atomic create-only/update-only preconditions |
| 1C-5A | Sources, contextual SourceRecords, immutable Observations and appended Reviews |
| 1C-5B | Supplier/Facility profiles, aliases, manual verification, citations and Capability assignments |
| 1C-5C | Material/Composition/subtype/Variant/Listing curation with immutable parent identities |
| 1C-5D | Manual Price creation/evidence/one-time Close and manual Inventory append |
| 1C-5E | Five typed permanent bindings and atomic create/reuse; cross-slice session/concurrency hardening |

No Phase 2 transaction workflow is present in the cumulative implementation scope.

## Complete diff and authorized backend contracts

The 170-file implementation delta consists of 12 backend production files, 12 backend test files, 90 frontend production files, 42 frontend/browser test and test-support files, 12 documentation files, OpenAPI and generated TypeScript. Generated schema is counted separately from frontend production; test support includes browser/review configuration and fixture scripts.

Frontend scope is the accepted shell, buyer reads, protected provenance/curation, typed identity workflows and shared form/error/query utilities. Tests cover unit/component behavior and real PostgreSQL/browser journeys, including the two accepted filter-navigation corrections. Documentation records planning, contract decisions and slice completion. No unexpected production category was introduced.

Every changed file under `apps/api/src/main/` was inspected:

| Java file (under com/sourceos) | Authorized cumulative change |
| --- | --- |
| authorization/IdentityCapabilitiesController.java | Authenticated live PLATFORM_ADMIN capability read |
| authorization/PlatformAuthorization.java | Reusable active issuer+subject platform grant check |
| capability/CapabilityService.java | Distinct OpenAPI schema naming |
| facility/FacilityController.java | Distinct DTO schemas, protected targeted assignment GET, PUT header contract |
| facility/FacilityService.java | Complete protected assignment projection including notes; atomic create/update intent |
| identity/SecurityConfiguration.java | Explicit validated configured-origin CORS for local/OIDC chains, including accepted If-None-Match header |
| material/MaterialController.java | Fabric/Leather PUT precondition header contract |
| material/MaterialService.java | Atomic independent-spec creation/update with existing subtype/Observation rules |
| shared/DecimalJsonConfiguration.java | BigDecimal JSON strings using plain decimal notation and matching schema description |
| shared/WritePreconditions.java | Strict request precondition parsing and 412 mapping through existing Problems machinery |
| supplier/SupplierController.java | Distinct binding schema naming |
| supplier/SupplierService.java | Distinct Supplier DTO schema naming |

No backend production file changed after the accepted 5P commit `eb06e82`; 5A–5E reused existing business APIs. Existing typed binding/resolve services were inspected and regression-tested, not introduced as a hidden new backend workflow in this delta.

Compared with main, OpenAPI intentionally adds the identity capability path and the targeted admin Capability GET operation, disambiguates Supplier/Facility/Capability schemas, exposes the three If-None-Match PUT parameters and specifies exact decimal strings. No path was removed. Backend-generated current Phase 1C contracts, rather than main's older snapshot, are authoritative for determinism.

There are no cumulative changes to package manifests/lock files, Maven dependencies/configuration/wrappers, runtime-version files, `.github/workflows`, Terraform, compose configuration, validation scripts or production infrastructure. Application-level deployment portability does not add infrastructure or change AWS topology.

## Security, session and cache audit

Only an active PLATFORM_ADMIN grant for the authenticated issuer+subject authorizes curation. Organization membership, ORG_OWNER and ORG_ADMIN do not. Backend authorization remains independent of UI hiding. Identity capability regression tests cover owner/admin denial, active grants and revocation.

All nested admin routes mount through authentication and the capability gate. PENDING and ERROR fail closed without protected child requests; NON_ADMIN renders denial. Capability refresh includes nested `/admin/...` entry, polling and protected-command denial. Revocation unmounts the workspace, removes protected admin queries/mutations and discards drafts/context. No stale protected content remains behind an overlay.

User-owned query keys include the opaque session scope. Admin Sources, citations, reviews, evidence and assignment notes have protected admin namespaces. Public canonical projections are reused only where buyer-readable. The sole unscoped health key contains public health state, not Actor data. Buyer routes do not fetch admin Sources for labels.

Actor change/logout cancels queries and clears owned cache before credentials change, generates a new scope and remounts owned UI. Requests and mutation callbacks verify their initiating scope, including after asynchronous work; late old-Actor responses and old 401s cannot populate or expire the next Actor's state. Admin mutations abort on unmount. No curation data/drafts are persisted in localStorage/sessionStorage. Trusted API-origin checks precede credential attachment; redirects and return targets are constrained. Errors preserve safe request references without exposing raw body/SQL/stack/token data.

Unit and real-browser regressions passed for buyer/owner denial, pending/error, nested entry, revocation, delayed reads/writes and Actor switching. ORG_ADMIN-only denial is also covered by the backend authority suite.

## Data and mutation integrity

All curation mutations use the shared admin hook with explicit `retry: false`. Network ambiguity is specifically ApiError status 0; cancellation is separate and known HTTP outcomes remain HTTP outcomes. No automatic recovery generates a new key or identity. Explicit retries retain the frozen exact intent for Observation identity/facts, Price UUID, manual Inventory key, permanent binding and typed resolution. Ordinary creates/reviews retain drafts and require an explicit operator decision after bounded read inspection.

| Boundary | Verified semantics |
| --- | --- |
| Optimistic versions | Safe nonnegative integer hydration; no missing-to-zero defaults or automatic conflict overwrite. Supplier profile/Alias/Verification share parent version and refetch; Composition uses Material version; Facility, Variant, Listing and assignments/specs retain their proper independent owners. |
| Create-only | If-None-Match: * plus body version 0; atomic insertion; existing target or concurrent loser 412. Winner stays 0; loser writes no audit/citation. |
| Update-only | Header absent; target must exist; matching N becomes N+1; missing 404 and stale 409. Never silently insert or convert create to update. |
| Invalid precondition | Blank/unsupported/multiple values or nonzero create version 400. |
| Capability edit | Protected exact GET includes notes/version; public capped summary excludes notes. Empty-body PUT success is followed by authoritative targeted GET. |
| Conflict recovery | Generic 409 is not asserted to mean only stale version. Draft and requestId retained; explicit comparison/refresh. A 412 remains distinct, with deliberate switch-to-edit. |
| Immutable parents | Facility Supplier; Material catalog Supplier/type; Variant Material; Listing Material/Seller are not reassigned. |
| Composition | UNKNOWN empty; PARTIAL positive parts, unique fibers, total <= 100 even when exactly 100; COMPLETE total exactly 100. No inferred completeness. |
| Subtypes | Fabric only FABRIC and Leather only LEATHER, enforced by existing DB relationships; no generic unsupported subtype write. |

Decimal paths were searched and inspected: prices, inventory, coordinates, Capability quantities, composition and physical specifications remain strings and use scaled BigInt/string comparisons where arithmetic is needed. Explicit zero is retained separately from absence; no parseFloat, floating decimal arithmetic, silent rounding or exponent serialization was found in these paths. Integer-only lead times/allowlisted integer physical attributes use explicit bounded integer validation; metadata lengths and dates do not coerce domain decimals. HTTP BigDecimal serialization uses toPlainString.

Price facts remain immutable except one versioned null-to-validTo closure, with no edit/reopen/second close. Manual creation requires 1..100 supporting Observations; V10 enforces evidence's same DataSource as Price. Retained Price key retries compare core facts and may append missing evidence without duplicate creation audit. The accepted exception remains: validTo is excluded from retry equality, so a changed validTo alone returns the unchanged existing Price; the UI freezes the original body and uses dedicated Close.

Inventory snapshots remain append-only. A retained MANUAL key deduplicates only the matching Listing, Actor and payload. Zero is known zero; empty successful scope means no observation/unknown, while failed reads mean unavailable. Rows are not summed across Facility/Variant/unit/source scopes. Imported creation UI remains absent.

Buyer Price reads retain explicit Variant/fallback scope, current versus historical evaluation, match scope separate from commercial eligibility, and immutable historical facts. Catalog Material is distinct from Seller Listing. Supplier country differs from Facility country, and SupplierRole differs from FacilityType. Material maxPrice search remains disconnected; protected Source data is not used as a buyer workaround.

## Provenance and identity concurrency

SourceRecord is persistent external identity; Observation is immutable observed fact; Review evaluates it; citation supports a canonical fact; binding permanently identifies a canonical entity. These concepts remain separate in UI and documentation. Standalone binding sends only SourceRecord ID to its typed target, with no Observation, Actor, profile version or fabricated idempotency key.

The fresh backend suite includes 26 IdentityCurationTest cases. Independent PostgreSQL transactions reran all five typed resolve races:

| Record kind | Concurrent result |
| --- | --- |
| SUPPLIER | Same canonical ID; one canonical row, binding and identity-bound audit |
| FACILITY | Same canonical ID; one canonical row, binding and identity-bound audit |
| MATERIAL | Same canonical ID; one canonical row, binding and identity-bound audit |
| MATERIAL_VARIANT | Same canonical ID; one canonical row, binding and identity-bound audit |
| MATERIAL_LISTING | Same canonical ID; one canonical row, binding and identity-bound audit |

Existing canonical reuse ignores differing incoming profile draft/version without mutating the canonical state; only valid RECORD evidence is added/deduplicated. Wrong kind/missing typed Record and unrelated Observation are rejected according to existing semantics. Same-target standalone replay adds no duplicate binding audit. Competing standalone targets return one 200 and one 409, with no losing binding audit or reassignment. All five identity-binding tables reject UPDATE/DELETE/TRUNCATE.

The 17 CurationPreconditionsTest cases also passed, including independent first-writer races for Facility Capability, FabricSpec and LeatherSpec: one 200/one 412, stored winner version 0, exact winner values and no losing provenance/audit.

## Migration and generated-contract integrity

Each file was compared byte-for-byte against audited main with git object bytes:

| Migration | Main versus implementation |
| --- | --- |
| V1__foundation.sql | Identical |
| V2__audit_truncate_guard.sql | Identical |
| V3__audit_platform_scope.sql | Identical |
| V4__platform_role_assignment.sql | Identical |
| V5__geography.sql | Identical |
| V6__external_source_identity.sql | Identical |
| V7__supplier_directory.sql | Identical |
| V8__facility_capability.sql | Identical |
| V9__material_catalog_and_listings.sql | Identical |
| V10__material_price.sql | Identical |
| V11__material_inventory_snapshot.sql | Identical |
| V12__material_search_indexes.sql | Identical |

No migration deletion/modification and no V13. A new empty PostgreSQL 18 database validated and applied all 12 to v12; full integration tests also cover the populated Phase 0 upgrade path. Flyway validation passed.

The accepted exporter regenerated OpenAPI from the running freshly built backend and normalized the server as usual. Repeated TypeScript generation/check passed. Both committed `docs/openapi.json` and `apps/web/src/api/schema.ts` remained byte-identical; no manual generated edits or unexplained drift.

## Fresh cumulative validation

Validation ran from a new detached worktree at the exact implementation SHA. It began without node_modules, target, dist, review screenshots or developer-generated files. Dependencies were installed using the frozen lock file, backend built from source and a new empty PostgreSQL 18 database used for the real browser fixtures. No developer `.local` setup script or ignored credential file was sourced. Installed tool/dependency caches were used normally; tests did not depend on unstaged files, browser storage or review artifacts.

| Gate | Actual observed result |
| --- | --- |
| Frontend Vitest / RTL | 869 passed, 22 test files |
| Full backend/PostgreSQL Maven verify | 238 passed; 0 failures, 0 errors, 0 skipped; BUILD SUCCESS |
| Same-origin Playwright | 32 passed |
| Separate configured API-origin Playwright | 32 passed |
| Frontend typecheck |Passed |
| Frontend production build |Passed |
| Backend build/package/module checks |Passed as part of Maven verify |
| OpenAPI deterministic export/check |Passed; no diff |
| Generated TypeScript regeneration/check |Passed, including repeat generation; no diff |
| Flyway |12 migrations validated/applied on fresh DB; integration upgrade regressions passed |
| Terraform |fmt-check, init -backend=false and validate passed |
| Gitleaks cumulative implementation range |18 commits scanned, no leaks |
| Implementation SOURCE OS CI |Exact 2a9fcf4 run 39593327299 success |

These local gates cover the SOURCE OS CI-equivalent steps, with an additional separate-origin browser run and cumulative secret scan. Local browser runs used installed system Chromium via the accepted executable override; GitHub CI independently uses its Playwright browser installation. No dependency/configuration was changed for this environment. The exact audit-head CI is a required post-commit publication gate, not replaced by the implementation run above.

The documented 5E visual evidence was verified: 29 ignored PNGs per origin, 58 total, desktop 1440x1000/mobile 390x844, with documented horizontal overflow 0 and capture-time page-width assertions. No new full visual review was required because this task changes no UI. Both real-browser regression suites were rerun from the fresh checkout without the visual flag or those artifacts.

## Documentation reconciliation and findings

The implementation was cross-checked with the readiness decisions, contract lock, HTTP precondition amendment and 5A–5E completion documents. Earlier statements such as “no UI implemented” and “future slice” are scoped to their original decision passes; subsequent completion documents establish the cumulative implemented state. The final state has no unresolved semantic contradiction requiring a correction. Exact paths follow OpenAPI, including `/api/v1/industrial-clusters`; no shorthand endpoint was invented.

**A blockers: none.** No failing gate, authority/cache leak, migration mismatch, decimal loss, generated nondeterminism, secret finding, unauthorized workflow or unexpected dependency/infrastructure change was found.

| B — accepted bounded debt | Retained boundary |
| --- | --- |
| CL-B1: Record/Observation/binding browse | No global Record search/detail, Observation-by-ID or binding reverse read; known IDs/context and bounded history only |
| CL-B2: Source edit/read | Edit loaded list rows; sourceCode and normalizationPolicy read-only; no invented Source-by-ID read |
| CL-B3: archived discovery/hard caps | ACTIVE-only Supplier/Facility directories; known archived detail; early lists capped 100 and not claimed complete |
| CL-B4: generated optionality/errors | Defensive runtime hydration, deliberate omission/zero rules and generic safe conflict recovery |
| CL-B5: Price validTo retry exception | Frozen exact intention and dedicated Close; no claim that every changed field conflicts |
| CL-B6: ordinary create/review ambiguity | No automatic retries; bounded inspection and explicit operator resubmission |
| CL-B7: attributes/version envelope | Allowlisted scalar attributes, exact decimal strings, safe-integer versions; unsupported state blocks mutation |
| CL-B8: known assignment read | Resolved for PLATFORM_ADMIN targeted GET; public 100-item projection still limited and excludes notes |
| CL-B9: early citation protection/maps | Supplier/Facility APIs append only, but their DB citation edges lack the equivalent V9/V10 mutation guards. Defensive allowlist rendering; no destructive API. Do not claim all citation tables have identical DB protection. |
| Service size / bounded projections | Existing large read/service files and asymmetric reads remain reviewable technical debt; no redesign in this audit |

C — future/deferred scope: binding global list/detail/reverse lookup, unlink/reassignment/deletion; global SourceRecord search; complete archived Supplier/Facility directories; buyer-safe Source labels and Material maxPrice filtering; imported Price/Inventory creation UI; CLAIMED self-service, TRANSACTED and PROVEN workflows; broad reference maintenance; production IdP release integration; Price edit/reopen; Inventory edit/delete; stock aggregation/ATP/reservations; FX/unit conversion; RFQ/Quotation/Sample/BOM/Production Order/QC/logistics execution and Phase 2. None was partially enabled as an unaccepted workaround.

## Merge recommendation

PASS — Phase 1C is ready for Pull Request review.

This is a cumulative merge-readiness audit, not production deployment approval. Publish only after successful exact audit-head CI and the final unchanged-main/no-duplicate checks. Human review and the merge strategy are separate decisions. No merge, main modification, release, deployment or Phase 2 work is authorized by this result.
