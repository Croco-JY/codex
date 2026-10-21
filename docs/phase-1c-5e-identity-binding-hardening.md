# Phase 1C-5E — Permanent typed identity and final curation hardening

## Baseline and scope

Repository `Croco-JY/codex`, branch `phase-1c-ui`, starting HEAD `b4749e088aa699dd7f57e3c11328344aee472e25`. Before editing, local HEAD, origin tracking, live `git ls-remote` and GitHub branch HTML agreed; worktree was clean. Exact-head [SOURCE OS CI 39586122417](https://github.com/Croco-JY/codex/actions/runs/39586122417) was successful. CLI authentication and git remote reads had recovered when checked for this task; no credential/settings change was made.

Production changes are frontend only. The accepted contract lock, 5P amendment, 5A–D reports, OpenAPI/generated schema, Source/Supplier/Facility/Material/Listing services/controllers and V6–V11 were reconciled before implementation. No missing API or A-class blocker was found. Backend changes are **test-only** assertions of existing behavior. Backend production, OpenAPI, generated TypeScript, V1–V12, dependencies, infrastructure and CI configuration remain unchanged; no V13.

No browser route was added. Existing protected detail pages gain separate identity panels; existing canonical create forms gain an explicit creation strategy. Material Variant stays within its Material workspace. Existing buyer reads and ordinary creates remain available.

## Identity binding is not fact provenance

A SourceRecord is persistent external identity; an Observation is an immutable observed fact; a Review evaluates that Observation. Permanent binding means **SourceRecord → canonical entity**. A citation means **Observation → controlled canonical fact**. Names, aliases, article numbers, providers and Review acceptance do not infer identity or automatically trigger commands.

| Canonical type | Required RecordKind | Standalone POST | Generated binding schema | Atomic resolve POST / generated input / nested field |
| --- | --- | --- | --- | --- |
| Supplier | SUPPLIER | `/api/v1/admin/suppliers/{id}/external-records` | SupplierBinding | `/api/v1/admin/supplier-identities` / SupplierIdentityInput / `supplier` |
| Facility | FACILITY | `/api/v1/admin/facilities/{id}/external-records` | FacilityBinding | `/api/v1/admin/facility-identities` / FacilityIdentityInput / `facility` |
| Material | MATERIAL | `/api/v1/admin/materials/{id}/external-records` | MaterialBinding | `/api/v1/admin/material-identities` / MaterialIdentityInput / `material` |
| Variant | MATERIAL_VARIANT | `/api/v1/admin/material-variants/{id}/external-records` | **MaterialBinding**, not a new VariantBinding | `/api/v1/admin/material-variant-identities` / MaterialVariantIdentityInput / `variant` |
| Seller Listing | MATERIAL_LISTING | `/api/v1/admin/material-listings/{id}/external-records` | ListingBinding | `/api/v1/admin/material-listing-identities` / ListingIdentityInput / `listing` |

The generated client types each literal endpoint and nested body. The structurally identical one-field bindings contain only `{sourceRecordId}`. Neither Observation, optimistic version, Actor identity nor Idempotency-Key is added to standalone binding. No Price/Inventory identity binding exists here.

## Standalone permanent binding

Each safe canonical detail context shows **Permanent external identity binding**, target label/UUID, expected kind, UUID input, explicit irreversible confirmation and a new-tab Sources & Evidence helper. It explains no supported reassignment/unlink and that name similarity is not proof. Merely rendering/selecting the panel issues no binding read or POST probe.

The server first checks canonical existence, locks the SourceRecord `FOR UPDATE`, checks exact kind and inserts a typed immutable association. Missing canonical is404; missing/wrong-kind SourceRecord is400 (both intentionally share lockRecord's validation semantics); another target already bound is409. Existing same-target binding succeeds without a second identity-bound audit. Current V7/V8/V9 guards reject UPDATE, DELETE and TRUNCATE for all five binding tables.

Before dispatch, the exact target type/UUID, expected kind (fixed by that type) and SourceRecord are captured in Actor-owned memory. Fields lock; no automatic retry (`useAdminMutation` explicitly sets `retry:false`). Only `ApiError.status===0` is transport ambiguity. With no passive binding read, the outcome remains unknown. **Retry exact same permanent binding** sends only that frozen command on explicit operator action. Explicit HTTP400/403/404/409/5xx remain server outcomes; AbortError is cancellation. Safe Problem Details/reference presentation is retained; no raw body/SQL/token is rendered.

Success is a memory-only confirmation of this command. It is not a binding list/count, and disappearing memory after reload does not prove absence. Binding does not change profile fields or consume profile version; it does not refetch/reset dirty profile forms merely to manufacture visible change. Explicit abandon/reset discards only the local intention, never an association on the server.

## Atomic create-or-reuse

Every Supplier/Facility/Material/Variant/Listing create flow retains **Normal create** and offers **Create or reuse from SourceRecord**. A genuine external identity and acknowledgement are required; no SourceRecord is manufactured as a generic retry key. The existing normal form/body validators remain authoritative, including Composition, physical attributes, exact coordinates and Listing quantities. There is one normal Observation field, not a duplicate identity-specific Observation field. Nested intended creates explicitly use version0.

The server locks/checks SourceRecord and requires the nested Observation to belong to that exact Record. Missing/wrong-kind Record or missing/unrelated Observation yields400. If unbound, one transaction creates canonical data, its normal RECORD citation and permanent binding. If already bound, the existing canonical wins: no draft comparison, no profile/version update, and no nested-version comparison. Only the supplied Observation's RECORD citation may be appended/deduplicated. Other canonical validation/reference/integrity errors retain existing400/404/409 semantics.

At first dispatch, the final generated nested DTO and SourceRecord are cloned and retained with opaque session scope; parent IDs are inside that exact DTO. Fields/mode lock. Status0 offers only **Retry exact same identity resolution**, never fallback to plain create, a separate bind POST, a regenerated Observation or a new Record. Explicit abandonment is needed before editing a sent intention. All five strategies use the accepted mutation helper with `retry:false`, abort-on-unmount and stale-session guards.

Existing baseline guards validate every returned canonical. Variant validation uses the **returned** Material parent. Malformed responses retain the command and show a safe failure without invented navigation. Safe results show returned ID/name/status and relevant Country/parent/Material/Seller/version facts. Wording is neutral **Identity resolved to canonical …**, never proof of new creation. A differing submitted draft shows a prominent not-applied-as-update warning. Composition comparison ignores friendly-label enrichment and decimal presentation zeros without changing transport.

Navigation is an explicit link to the returned canonical. Facility may resolve under another Supplier; Material under another catalog Supplier/type; Variant under another Material; Listing under another Material/Seller. Those actual values control navigation and invalidation. No returned Variant is inserted into the submitted Material's children, and no submitted commercial/profile fields are represented as saved on reuse. Variant links to its actual Material; no global Variant route is introduced.

Invalidation targets returned canonical/detail, returned parents/child lists, relevant directory/picker scopes and RECORD citation keys. It never increments versions or places protected Source metadata in buyer keys. Resolving an existing identity is not a profile update.

## Authority, security and dirty forms

Existing Authenticated → AdminGate remains the boundary: only `platformAdmin===true`; buyer/ORG_OWNER alone denied; PENDING/ERROR fail closed. Nested `/admin` and `/admin/...` capability refresh is unchanged. Revocation unmounts protected UI, cancels/removes admin queries/mutations and discards drafts/snapshots/results; public canonical cache does not keep protected controls mounted. Actor switch/logout cancels/clears session-owned caches and remounts local state; late prior-Actor completion cannot repopulate the next Actor's form, result, cache or navigation.

Identity state is local memory, never localStorage/sessionStorage or route metadata. Existing public projections keep public session keys; protected citations/Source/evidence use admin keys. No buyer Source label lookup was added. The helper opens a new tab with noopener/noreferrer. Native controls, visible focus, text warnings, labelled checkboxes, safe wrapped references and status/alert semantics are reused. No inaccessible custom modal or persistent draft system was introduced.

Forms remain isolated from unrelated query/child refreshes: Supplier profile/alias/verification parent-version handling, Material profile/Composition/spec, Listing profile/commercial reads, Price create/history, Close/evidence and Inventory/history retain accepted tests. Binding does not reset a dirty profile. A changed Actor or revoked authority intentionally discards local drafts instead of persisting them.

## Inactive Fiber hardening

Composition rows retain their original loaded inactive Fiber, display an explicit inactive label and a wrapped preservation notice, and round-trip the same exact Fiber UUID/percentage. Stable RHF row IDs track the preserved reference. The row may choose active alternatives and restore only its own original inactive reference. New rows and other rows offer only explicitly active Fibers; arbitrary other inactive choices are excluded. Unknown reference labels remain an explicit unavailable-label fallback for an existing reference. No inactive reference is silently dropped.

New component and real PostgreSQL-backed browser regressions verify preservation, inactive labeling, no inactive choice on a new/other row, explicit restoration, and exact UUID serialization. PARTIAL exactly100 remains PARTIAL. No floating-point Composition/coordinate/quantity arithmetic was added. Existing nine-key scalar physical-attribute validation and Fabric/Leather/Capability preconditions remain unchanged.

## PostgreSQL assertions and browser journeys

`IdentityCurationTest` adds26 existing-contract tests: five typed changed-draft/version reuse/citation tests; five replay/conflict/destructive-guard tests; five missing/wrong-kind/unrelated-Observation tests; five independent concurrent same-Record resolves with different drafts; five standalone target-first/missing/wrong-kind checks; one independent competing-target bind race.

Observed resolve races return the same canonical ID to both requests, with exactly one canonical row, one permanent association and one identity-bound audit. Competing standalone binding returns one200/one409, one winner, no reassignment and no losing audit. All five typed tables reject UPDATE/DELETE/TRUNCATE. Reuse leaves the complete canonical view/version unchanged while adding/deduplicating RECORD evidence. No backend production code or migration is changed by these tests.

Six new browser cases extend the existing26. Test-only local PostgreSQL fixtures provision prerequisites (admin/reference/inactive Fiber), without a production seed endpoint/service. The main workflow creates a Source, SourceRecord and Observation through real UI/API, resolves and permanently binds all five canonical types through UI, creates Price/MANUAL zero Inventory through accepted UI and verifies buyer reads. Further cases cover all five existing-bound reuse flows, real Facility/Variant/Listing parent divergence, wrong-kind400, mismatched Observation400, binding409, committed-but-lost responses and exact explicit replay, cross-slice buyer/owner denial, delayed Actor completion/revocation, inactive Fiber and request fanout. Both deployment origins exercise real existing CORS without a backend change.

## Performance, visual review and validation

Ignored actual React screenshots are in `.local/phase1c5e-review/{same-origin,separate-origin}`; desktop1440×1000 and mobile390×844. There are29 states per origin,58 screenshots, never committed. Every capture asserts `document.documentElement.scrollWidth<=innerWidth`. Same-origin states and separate-origin representative mobile/error/result states were visually reviewed. No observed horizontal overflow or essential scope/status clipping remains. Native long editable values scroll within controls; immutable references/results wrap outside controls. Review separated a concatenated helper/UUID label and added a fully wrapped inactive-Fiber preservation notice. Long forms require vertical scrolling; no decorative redesign or accessibility certification is claimed.

Representative same-origin and separate-origin fixture measurements (session/capability checks excluded) were Supplier9 GETs with cold references (four reference + five detail/child reads), Facility4 (including one uncached parent label), Material5 and Listing6 with already warm Material/Seller/Variant caches. These are observed scopes, not production guarantees or total counts. All four had0 POSTs and0 SourceRecord/Observation/binding probes. No per-row identity lookup is added.

Fanout logs record method/path only, no auth data. Identity panels add zero automatic identity reads/probes/row fanout. The measurement waits for the actual new typed target panel and HTTP response outcomes, rather than accepting a previous route's generic heading or waiting for global browser network-idle. Sources/Observations/Reviews remain explicit bounded contexts; no global Record scan or private buyer lookup.

Final measured request counts and observed validation are recorded below. Exact final commit, live-remote equality, clean worktree and final SOURCE OS CI are checked after push and reported in the completion message; an earlier successful run is not substituted for final-head CI.

| Gate | Observed result |
| --- | --- |
| Frontend Vitest / RTL |869 passed,22 files;30 identity workspace tests plus one Composition preservation regression added |
| Backend/PostgreSQL + build |238 passed,0 failures/errors/skipped;26 new identity tests included |
| Same-origin Playwright |32 passed (existing26 + new6), including final changed-state validation |
| Separate API-origin Playwright |32 passed, including final changed-state validation |
| Typecheck / production build |Passed after the final display refinement |
| OpenAPI / generated TypeScript |Deterministic generation/check passed; byte-identical |
| Terraform |fmt-check, init-backend=false, validate passed |
| Gitleaks |Staged scan passed; final commit scan reported after commit |
| Migrations / contract boundary |V1–V12 byte-identical; noV13; no backend production/contract/dependency/infra/CI change |

## Acceptance matrix and final deferred register

| Slice | Acceptance boundary |
| --- | --- |
|1C-0 Contract readiness |PASS, existing contracts retained |
|1C-1 secure shell/session |PASS, authority/session regressions retained |
|1C-2 discovery |PASS, price filter remains disconnected |
|1C-3 commercial reads |PASS, independent price/inventory/exact-decimal semantics |
|1C-4 Supply Network reads |PASS, Supplier/Facility and catalog/Seller distinctions retained |
|1C-5P preconditions |PASS, existing400/404/409/412 tests retained |
|1C-5A Sources & Evidence |PASS, existing provenance workflow retained |
|1C-5B Supplier/Facility |PASS, existing version chains/capability boundaries retained |
|1C-5C Material/Listing |PASS, existing Composition/spec/attributes contracts retained |
|1C-5D Price/Inventory |PASS, immutable snapshots/idempotency/one-time Close retained |
|1C-5E identity/hardening |PASS only after this final pushed HEAD's CI succeeds; observed completion is recorded in the final report |

Deferred: binding list/detail/reverse-read API; unlink/reassignment/delete; global SourceRecord browse/search; complete archived Supplier/Facility directory; buyer-friendly Source labels; Material maxPrice filtering; imported Price/Inventory creation UI; CLAIMED self-service and TRANSACTED/PROVEN workflows; reference maintenance expansion; production IdP release integration; Price edit/reopen; Inventory edit/delete; aggregate stock/ATP/reservation; FX/unit conversion; RFQ/Quote/BOM; production execution; QC/logistics extensions beyond current reads; all Phase2 scope. No PR, merge, main change or automatic next slice is part of this task.
