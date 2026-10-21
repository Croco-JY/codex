# Phase 1C-5B — Supplier and Facility curation

Implemented on `phase-1c-ui` from `41f70b4ca4ff056dc20eae4904a5c2e18e40fa1b`. Before implementation, branch/HEAD, clean worktree, local/origin/live GitHub equality and successful [SOURCE OS CI 39542008801](https://github.com/Croco-JY/codex/actions/runs/39542008801) were verified.

This slice adds protected frontend Supplier/Facility curation using existing contracts. It preserves Organization ≠ Supplier ≠ Facility, SupplierRole ≠ FacilityType and Supplier verification ≠ Facility Capability verification. Fact provenance remains separate from persistent external identity binding. Backend production code, backend tests, OpenAPI, generated TypeScript, migrations, dependencies, infrastructure and CI configuration are unchanged.

Exact transport comes from `docs/openapi.json` and generated `apps/web/src/api/schema.ts`. SupplierService/FacilityService, V7/V8, the accepted [contract lock](phase-1c-5-contract-lock.md), [precondition amendment](phase-1c-5p-precondition-amendment.md), [5A workspace](phase-1c-5a-admin-sources.md) and [1C-4 read workspace](phase-1c-4-supply-network-reads.md) were reconciled. Runtime citation keys, generated header structure, empty Capability PUT response and shared Supplier parent-version behavior were specifically verified before implementation.

## Routes, authority and state boundaries

New lazy routes are `/admin/suppliers`, `/admin/suppliers/:id`, `/admin/facilities` and `/admin/facilities/:id`. Each uses the existing Authenticated → AdminGate boundary. `/admin` now links only to the implemented Sources & Evidence, Suppliers and Facilities tools. No later curation or Identity Binding action is exposed.

Only `GET /api/identity/capabilities` with `platformAdmin === true` mounts these pages. PENDING, ERROR and NON_ADMIN fail closed without mounting child queries. Organization ownership/administration, membership, Supplier/Facility relationships and URL knowledge do not grant access. The existing nested `/admin/...` capability refresh, background refresh policy and server authorization remain intact.

Canonical buyer-readable views reuse existing opaque-session query namespaces: SupplierView, FacilityView, Supplier directory/search/picker, aliases, verification events, Supplier Facilities and public Capability summary. Protected citations use `queryKeys.adminCitations`; protected notes/assignment state use `queryKeys.adminAssignment`. Both begin with `['admin', opaqueSessionScope, ...]`. Protected assignment data is never inserted into a buyer summary cache.

ADMIN → NON_ADMIN immediately unmounts the curation workspace, removes navigation, cancels/removes protected queries and removes protected mutation-cache entries using the accepted 5A boundary. Drafts, Observation selections, command modes and conflict/ambiguity comparisons disappear. Ordinary public Supplier/Facility caches may remain as buyer-readable authenticated data. Protected 403 reads/commands request a capability refresh.

Actor switch/logout uses the existing cancellation/cache-clear/remount boundary. Mutations reuse 5A's abortable, session-guarded command hook; asynchronous refresh callbacks check the captured Actor scope. Detail state is additionally keyed by canonical route ID so a Supplier/Facility change cannot retain another entity's form. Contextual Facility creation is keyed by parent Supplier. No drafts/evidence/notes enter web storage or URLs.

## Directories and archived records

Admin directories reuse the accepted 1C-4 components, allowlisted URL filters, Apply/Clear behavior and opaque cursor pagination, initially 25 rows. Supplier filters remain q, country, role, verificationStatus, facilityCountry, region, cluster and capability. Facility filters remain country, region, cluster, type, capability and supplier. **Facility has no q input or parameter.** No archived directory or duplicate admin browse API is added.

Directory Country transport remains ISO alpha-2. Mutation `countryId` is instead a Country UUID. Region/Cluster/Capability/Supplier references remain UUIDs selected by human labels. Existing `/api/v1/industrial-clusters` is used, without a `/clusters` alias.

Known archived detail URLs remain usable without a directory hit. ACTIVE ↔ ARCHIVED is an ordinary profile PUT. After archiving, detail remains mounted and displays **This record is archived and may no longer appear in active directories.** Directory disappearance is not deletion or proof of failed creation. Supplier Facilities context retains its existing active-search projection; the admin empty wording describes that bounded view rather than asserting that no Facility is recorded. Existing buyer detail links remain available.

## Supplier profile and shared parent version

| Command                                                 | Existing schema / behavior                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/admin/suppliers`                          | SupplierInput; countryId/displayName/status/roles/observationId, explicit version 0; optional strings omitted when empty     |
| `PUT /api/v1/admin/suppliers/{id}`                      | SupplierInput; full replacement of mutable profile fields and roles, exact current Supplier version and explicit Observation |
| `POST /api/v1/admin/suppliers/{id}/aliases`             | SupplierAliasInput; append, current **Supplier parent version**                                                              |
| `POST /api/v1/admin/suppliers/{id}/verification-events` | SupplierVerificationInput; current **Supplier parent version**                                                               |

Supplier fields include legal/native/English names, business registration number, website, description, Country, lifecycle and roles. Exact roles are MILL, CONVERTER, MATERIAL_SUPPLIER, TRIM_SUPPLIER, FACTORY, PROCESSOR, QC_COMPANY, LOGISTICS_COMPANY and OTHER. Multiple roles or an explicitly empty collection are legal; there is no primary-role inference. Lifecycle ACTIVE/ARCHIVED is independent of verification.

Create states **New Suppliers begin at DISCOVERED verification status.** No initial verification selector is present. The backend supplies DISCOVERED and the Initial discovery event. Confirmed create is defensively validated before navigation to its direct admin detail; relevant directories/pickers are invalidated.

Website validation reuses the 5A original-text strategy: optional empty values are omitted; supplied values require HTTP(S), hostname, maximum 2000 characters, no credentials/authority user-info and no raw fragment delimiter, including empty `#`. Accepted case, path, port and query text are not replaced with browser URL serialization. Optional blanks in full-replacement edits intentionally clear values through omitted properties and existing Spring binding; no blanket-null serializer is used.

Edit hydration requires valid ID, Country UUID, nonblank displayName, lifecycle, actual roles array, verification state and safe nonnegative integer version. Missing roles are not converted to `[]`. Optional mutable state must be known and type-safe: current runtime views supply absent optional fields as explicit null. An omitted/unknown mutable property in an incomplete response blocks safe edit hydration instead of silently turning it into an empty replacement. Null becomes a visibly blank optional control and serializes as absence; required missing state never becomes a fabricated value. The same defensive policy applies to Facility and protected Capability edit state.

Supplier profile, Alias and Verification all consume and advance the **same Supplier version**. After success the UI refetches SupplierView before a subsequent versioned command is enabled. It never calculates oldVersion+1 as an authoritative baseline. Only one Supplier command form is open at a time; switching requires explicit draft discard. Commands remain disabled during a pending parent command/refetch. Citations are independent and versionless.

On profile 409, the draft remains unchanged, SupplierView is refetched and current server fields/version are shown. **The Supplier changed or conflicts with the current server state.** does not pretend that every conflict is a stale-version error. Adopting the refreshed version requires an explicit action, and does not submit. Existing drafts survive an incomplete conflict-refresh response; unsafe refreshed state cannot authorize another write.

## Aliases and manual verification

Aliases use the existing public `/suppliers/{id}/aliases` read, capped at 100 with no invented continuation. At the cap the UI discloses the bound. Alias append requires original alias text (nonblank, maximum 160), aliasType, Observation and current Supplier version. Types are ORIGINAL, ENGLISH, ROMANIZED, COMMERCIAL and OTHER. Optional language uses `[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8})*`. No alias case folding, transliteration or uniqueness normalization is performed client-side. No edit/delete/reorder action exists.

Confirmed Alias append refreshes SupplierView, aliases and protected citations (the backend adds ALIAS provenance). Ambiguity preserves the draft, refetches parent/history and highlights visible exact alias matches for comparison. Bounded absence is not proof that append failed. Duplicate/stale conflicts use the bounded generic Supplier conflict recovery.

Verification history uses `/suppliers/{id}/verification-events`, capped at 100. It shows previous/new status, reason, occurredAt and Observation. Actor issuer/subject are secondary protected audit context, not Supplier identity. Existing events have no edit/delete action.

Manual targets are exactly **DISCOVERED / VERIFIED / AUDITED**, excluding the currently loaded state. CLAIMED / TRANSACTED / PROVEN are never offered as manual actions. Transitions are non-monotonic: DISCOVERED → AUDITED, AUDITED → VERIFIED and VERIFIED → DISCOVERED are supported. A target equal to current state conflicts. Reason is required, maximum 1000, with sensitive-content validation; Observation and current Supplier parent version are required.

Confirmed Verification refreshes SupplierView, events, protected citations and relevant directory scopes. Network ambiguity preserves the draft and compares visible matching target/reason/Observation events without repeating the command. Tests exercise both Alias → Verification → Profile and Verification → Alias using refetched versions, including explicit non-monotonic transitions.

## Fact citations and runtime map boundary

| Entity   | Existing GET / POST                     | Legal fieldName values                                                                                                    |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Supplier | `/api/v1/admin/suppliers/{id}/sources`  | RECORD, DISPLAY_NAME, LEGAL_NAME, NATIVE_NAME, ENGLISH_NAME, COUNTRY, WEBSITE_URL, DESCRIPTION, ROLE, ALIAS, VERIFICATION |
| Facility | `/api/v1/admin/facilities/{id}/sources` | RECORD, NAME, TYPE, COUNTRY, REGION, CLUSTER, ADDRESS, COORDINATES, PHONE, EMAIL                                          |

POST sends only explicit observationId and fieldName. It consumes no parent version, and refetches the citation read after confirmed success. No citation edit/delete or identity-binding action is provided. A citation supports a canonical fact; it is not a claim, verification approval, license approval or external SourceRecord binding.

Generated GET data remains `Array<Record<string, unknown>>`. Before coding, local API responses confirmed actual JDBC labels **source_observation_id / field_name / created_at**, each a string; created_at was an ISO timestamp. The allowlist parser validates UUID shape, entity-specific fact enum and ISO timestamp before rendering only those fields. Unknown extra keys are ignored when the known keys are valid. Missing/wrong/arbitrary values yield **Citation data is unavailable in a supported format.** There is no raw JSON/object dump or blind cast. Real browser tests also assert current runtime key names.

The read is capped at 100; empty text says **No fact citations recorded in this bounded view.** Append success does not replace or increment a Supplier/Facility profile version baseline.

## Facility profile, geography and exact coordinates

`POST /api/v1/admin/facilities` and `PUT /api/v1/admin/facilities/{id}` use generated FacilityInput. Create explicitly sends version 0. Required state is Supplier parent, facilityType, name, Country UUID, lifecycle and Observation. Edit requires safe current Facility version; optional strings/geography/coordinates must be known and correctly typed. Name and contact/address limits follow the current contract, with optional email validation.

Types are OFFICE, MILL, FACTORY, WAREHOUSE, SHOWROOM, PROCESSING_PLANT, QC_SITE and OTHER, separate from Supplier roles. A standalone create uses the accepted bounded ACTIVE Supplier name picker. **Add Facility** from a known Supplier detail fixes that Supplier as parent and can therefore use a known archived Supplier. No raw Supplier UUID field is the normal selection UX.

**supplierId is immutable after creation.** Edit displays it read-only and resends the safely loaded canonical parent, regardless of form transport changes. Profile update cannot reassign it. Facility profile version is separate from Supplier and Capability assignment versions.

Country labels come from `/countries`; scoped Region and Industrial Cluster options use `/regions?country=<Country UUID>&limit=100&offset=...` and `/industrial-clusters?country=<Country UUID>&limit=100&offset=...`. Country changes clear both child selections and ask for compatible geography again. Selected labels retain their values while async options arrive. Reference reads remain bounded/cached; DB hierarchy/country integrity remains authoritative.

Latitude/longitude remain original strings in form state and transport. Both are absent or both present. Syntax is signed plain decimal with at most six fractional digits, without exponent notation. Exact range validation splits integer/fraction, pads to six places and compares BigInt values against ±90000000 / ±180000000. Neither Number nor parseFloat is used for coordinates. Explicit `"0"` is sent as zero, not omitted; database response scale can be `"0.000000"` without a client-side float conversion or rounding.

Facility edit replaces mutable fields; deliberately blank optional fields clear through omitted properties and current binding. On 409 the draft stays intact, current fields/version are refetched for comparison and explicit reconciliation is required. The form's original parent remains fixed. Archived detail stays mounted with the archive notice. Creation uncertainty never triggers a duplicate automatic POST and active-directory absence is not proof of failure.

## Capability assignments and accepted create preconditions

Capability references use bounded `/api/v1/capabilities?limit=100&offset=...` pages and human-readable labels. The public `/facilities/{id}/capabilities` list remains a capped 100-item summary without notes. Absence from that list does not select create mode or hydrate edit state.

Selection reads exactly `GET /api/v1/admin/facilities/{id}/capabilities/{capability}`. A valid 200 hydrates the matching Facility/Capability IDs, protected notes, optional proficiency/quantities/unit, required assignment verification and safe current assignment version. Missing/malformed IDs, version, decimals or unknown editable state block mutation. A 404 permits initial create mode only with an independently successfully loaded parent Facility. After a failed update, parent and target are explicitly rechecked before absence can authorize a manual create-mode switch.

| Mode / result | Frontend behavior                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create        | Generated client `params.header["If-None-Match"] = "*"`; body version 0                                                                                 |
| Create 200    | Empty PUT response; targeted admin GET is mandatory and supplies authoritative state/version, normally stored 0                                         |
| Create 412    | Preserve draft and safe requestId; targeted GET shows competing/existing state; explicit **Switch to edit mode** adopts its baseline without submitting |
| Update        | Same PUT, header omitted entirely, exact current **assignment** version                                                                                 |
| Update 200    | Empty response; targeted GET supplies new state/version, normally N+1; no client version arithmetic                                                     |
| Update 404    | Preserve draft; refetch parent/target; no automatic create fallback                                                                                     |
| Update 409    | Preserve draft; targeted GET/comparison; explicit version reconciliation, no automatic overwrite                                                        |
| Status 0      | Preserve draft, read target for comparison, do not infer whether original write succeeded or switch mode automatically                                  |
| 400           | Ordinary safe input/precondition validation error; not transport ambiguity                                                                              |

Create sends neither unsupported ETags nor a custom expectedAbsent body field. Update does not send an empty header. The persistence/precondition/412 contracts from 5P are unchanged. Every successful PUT refreshes the targeted private view, public summary, Facility detail and affected Supplier/Facility directory/parent-child scopes. No local assignment is fabricated or spliced into the buyer summary. Capability selection/mode changes require explicit draft discard and are disabled while a Capability write is pending. There is no unassign/delete action.

Proficiency is optional SUPPORTED / EXPERIENCED / SPECIALIST. Assignment verification is required UNVERIFIED / DOCUMENTED / AUDITED, independently of Supplier verification. Units are exactly **PCS / METER / YARD / KG / GRAM / MM / CM / M2**. Broader Material units are not offered. Notes are optional, maximum 1000, and are hydrated only from the protected read; deliberately clearing notes clears the full-replacement value.

Quantities remain strings with at most 15 integer and four fractional digits, nonnegative, without exponent notation. Zero is legal; unknown remains absent. Four-place BigInt scaling compares minimum <= maximum exactly. Either quantity requires an explicit unit; when both are absent no unit is invented. The value `999999999999999.9999` survives input and transport unchanged. Assignment version never comes from the parent Facility version. Maximum order quantity is not monthly capacity.

## Retry, error and draft behavior

Every Supplier create/update, Alias, Verification, Supplier citation, Facility create/update, Facility citation and Capability create/update uses the shared admin mutation hook with **explicit `retry: false`**. No automatic conflicting or ambiguous write retry occurs.

Only `error instanceof ApiError && error.status === 0` is transport uncertainty. Explicit 400/403/404/409/412/5xx are HTTP outcomes and use safe error handling. AbortError/session cancellation is not an ambiguous completion. Request references survive error presentation; raw Problem Details bodies, tokens, auth headers and stack traces are never rendered. Context-specific Supplier/Facility conflict copy avoids inventing machine-readable causes.

Forms have labelled controls, connected validation errors, visible focus, status/alert announcements, native enum/multi-role controls, Reset/Cancel and explicit command/context discard. The evidence helper opens `/admin/sources` in a new tab with noopener/noreferrer, preserving the current page draft without storing it or creating an Observation automatically. Existing navigation has no global draft-blocking router; deliberately leaving a page discards in-memory drafts. Actor/session/revocation transitions always discard them.

## Read-after-write and measured request fanout

Invalidation is scoped, not a global application-cache clear. Supplier profile refreshes detail/directories/pickers and shared name labels. Alias/Verification refresh the parent and corresponding history (plus visible automatic citations). Citation append refreshes only citations. Facility changes invalidate relevant Facility detail/directory, parent Supplier Facilities and Supplier geography/capability directory predicates. Capability success refreshes the exact protected assignment and relevant public Facility/summary/directory data. Existing buyer views observe server changes after these refreshes.

Representative final local fixture measurements, excluding identity/capability session checks:

| Context                                     | Observed requests                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier directory, reference caches cold   | One directory GET plus Countries/Regions/Industrial Clusters/Capabilities; no row-detail/history/citation fanout                                         |
| New Supplier detail, references warm        | Five detail GETs: Supplier, aliases, events, protected citations, bounded Facilities; the preceding create also refreshes the active directory read once |
| New Facility detail, labels/references warm | Three GETs: Facility, protected citations, public Capability summary; create also refreshes the active directory once                                    |
| Select one Capability                       | One protected targeted GET; no request per summary row                                                                                                   |
| Confirm Capability PUT                      | One targeted GET, one public Facility GET and one public summary GET in the active detail workspace                                                      |
| Facility directory parent labels            | Existing deduplicated Supplier reads only: one per uncached distinct parent, with no Facility-detail/citation/Capability fanout                          |

The final same-origin journey's populated Facility directory had 13 uncached distinct parent labels and 13 Supplier GETs; separate-origin had 12 and 12 as the bounded fixture window and warm cache changed between runs. Repeated parents reused cache. Both had zero per-row Facility/citation/Capability detail requests. These fixture counts are not production benchmarks or directory totals. Each collection remains bounded and explicit pagination is retained. No batch endpoint, all-catalog preload, virtualization or caching infrastructure was added.

## Real browser fixtures and validation

`e2e/curation-fixture.ts` follows the accepted test-only direct local Docker PostgreSQL pattern. It provisions synthetic PLATFORM_ADMIN, revocable admin, buyer and ORG_OWNER-only Actors, evidence prerequisites, geography/Capability references, existing Supplier/Facility context and a fresh race Facility. It checks the local identity profile and database-name boundary. No production fixture endpoint/service, admin seed or migration is introduced.

The primary journey obtains a new real Observation through Sources & Evidence, then uses UI/API Supplier create/update, a real competing profile update/409 reconciliation, Alias, manual Verification, Supplier citation, contextual Facility create/update, Facility citation and Capability create/update. It checks targeted GET after empty PUT, exact decimal transport, current versions, citation runtime keys, public notes exclusion and updated buyer read views. The tested mutation results are not pre-seeded.

A separate actual first-write scenario starts from an unassigned Capability, retains a create draft, creates a competing assignment through the existing protected API and submits the original UI create. Both origin modes observe 412, safe server request reference, unchanged draft, retrieved winner version 0/notes, explicit Switch to edit mode and no automatic overwrite. The full backend regression independently verifies Problem Details/requestId and losing audit/provenance behavior. Browser error-stream consumption is not used to dump raw errors.

Buyer and ORG_OWNER-only Actors are denied on all four routes before protected reads. Other browser cases hold a real protected response across Actor switch and revoke the live platform grant while notes/evidence are open, verifying content/navigation/drafts disappear. Same-origin and configured separate API-origin runs include the 5A and earlier sourcing regressions. No CORS modification was required.

Twenty-four actual React visual states were captured per origin at desktop 1440×1000 and mobile 390×844: landing/directories, Supplier create/edit/Alias/Verification/citations, Facility create/edit, Capability create/edit/412, Supplier 409, mobile forms/access denial and long identity/geography/role displays. All 24 same-origin states were reviewed, with separate-origin Verification/geography/412 spot checks. All 48 captures assert no horizontal document overflow. Long displayed names, URLs, IDs, reasons, notes and addresses wrap; decimal strings remain readable. Native single-line inputs scroll long editable values internally, and long pages require vertical scrolling. Review corrected inherited narrow desktop form widths; remaining layout has no observed clipped labels or obvious unreadable contrast. Screenshots/request logs are ignored review artifacts under `.local/phase1c5b-review/`, not repository binaries. No broad product redesign or automated accessibility certification is claimed.

| Final local gate                               | Observed result                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Frontend Vitest / RTL                          | 526 passed across 17 files                                                    |
| Backend / real PostgreSQL `./mvnw -B verify`   | 212 passed, 0 failures/errors/skips; backend build passed                     |
| Accepted 5P regression within backend suite    | 17 CurationPreconditions tests passed, including real concurrent first writes |
| Same-origin Playwright                         | 17 passed, including five new curation scenarios                              |
| Separate API-origin Playwright                 | 17 passed, including actual If-None-Match / 412 flow                          |
| Frontend typecheck and production build        | Passed                                                                        |
| Deterministic OpenAPI export/check             | Passed; docs/openapi.json unchanged                                           |
| Deterministic generated TypeScript check       | Passed; schema.ts unchanged                                                   |
| Terraform fmt / init -backend=false / validate | Passed                                                                        |
| Gitleaks staged scan with redaction            | Passed; no leaks found                                                        |

V1–V12 remain byte-identical and V13 is absent. Commit Gitleaks scanning and exact pushed-HEAD SOURCE OS CI are completion gates; their final observed results and CI run link are reported with the implementation commit instead of predicting a future run here.

## Deferred boundaries

Not implemented: Phase 1C-5C Material/Listing/Composition/spec/Variant curation; 5D Price/Inventory; 5E Identity Binding/final hardening; Supplier CLAIMED/TRANSACTED/PROVEN workflows; reference-data mutation; buyer Source labels (B5); buyer Material price filtering; complete archived directory discovery (B4); delete/unlink/unassign or Alias/event editing; Phase 2 and its RFQ/Quote/BOM/Sample/Production/QC/Shipment workflows. Existing read-only Material/Listing routes remain intact. No PR or merge is part of this slice.
