# Phase 1C-5D — Listing-scoped Price and Inventory curation

## Baseline, boundary and authority

Repository `Croco-JY/codex`, branch `phase-1c-ui`, starting HEAD `d7f83e86840096cd74e04e1647eac6a87d0578db`. Local HEAD, origin tracking and the live GitHub branch matched, the worktree was clean, and [SOURCE OS CI 39576495550](https://github.com/Croco-JY/codex/actions/runs/39576495550) was successful for that exact SHA before implementation.

This is frontend production work only. Backend production and tests, `docs/openapi.json`, generated `schema.ts`, V1–V12, dependencies, infrastructure and CI configuration remain unchanged. There is no V13. Contracts were reconciled against PriceController/PriceService, InventoryController/InventoryService, DecimalValues, V10/V11, OpenAPI/generated types and the accepted 5A/5B/5C/1C-3 documents. Generated transport optionality does not override service requirements such as manual Price evidence count.

The existing lazy `/admin/listings/:id` is the only commercial curation route. No global Price/Inventory route, arbitrary Price UUID management or new endpoint exists. Listing detail must first confirm valid Listing, Material and Seller UUIDs; child commercial logic does not mount from a failed/unsafe parent. Later incomplete/refetch errors retain already open drafts but block commands. Known ARCHIVED Listings remain usable and labeled; the server does not impose an ACTIVE-only Price/Inventory command rule.

Authenticated → AdminGate remains authoritative: only `platformAdmin === true`; buyer/ORG_OWNER alone denied; PENDING/ERROR fail closed. Nested admin capability rechecks, command-403 rechecks and runtime revocation are preserved. Revocation unmounts command forms, selected Price, snapshots/keys and protected evidence; public authenticated commercial cache can remain. Actor change/logout cancels requests, clears Actor-owned caches and remounts form/key state. Late prior-Actor responses cannot restore success/drafts. No credentials, command state or commercial draft is persisted to localStorage/sessionStorage or URLs.

## Reads, discovery and cache ownership

Existing buyer `PriceReads` and `InventoryReads` supply resolver, history, current knowledge and stock truth semantics. PriceReads has an optional history renderer used only inside the protected workspace; buyer behavior and B5 Source UUID labels are unchanged. It does not call admin Sources for buyer labeling.

| Context | Existing read / boundary |
| --- | --- |
| Price history | `/api/v1/material-listings/{id}/prices`, limit25, opaque cursor; existing provider/currency/unit filters; loaded facts, no total |
| Effective Price | `/api/v1/material-listings/{id}/effective-prices`; accepted independent match/fallback/eligibility/current/historical semantics |
| Selected Price | Only a safely validated create result or loaded history row; no Price-by-ID GET or free UUID lookup |
| Price evidence | `/api/v1/admin/material-prices/{id}/sources`, limit25/offset0; only after explicit Manage selection |
| Inventory current | `/api/v1/material-listings/{id}/inventory`, limit25/cursor; latest within Variant/Facility/unit/mode/provider scope |
| Inventory history | `/api/v1/material-listings/{id}/inventory-snapshots`, limit25/cursor; immutable observations, not movements |

Public commercial keys reuse `queryKeys.commercial(scope, listingId, kind, filters)` including the opaque session scope. Protected Price evidence is under `['admin', scope, 'price', priceId, 'evidence', 25]`. Source selection reuses protected 5A Source keys and limit25 offset pages. Variant choices reuse the bounded Material Variant list and include archived labels. Facility discovery is bounded, has no q, and does not fetch details per row. A known archived Facility is explicitly resolved through the existing detail GET before selection; Seller ownership is not inferred. Long selected Source/Variant/Facility names and references are displayed outside native selectors so their full values wrap.

No evidence is fetched per Price row, or automatically merely because Price creation returned. **Manage this Price** is explicit. Changing selected Price requires confirmation before discarding evidence/close drafts. No SourceRecord/Observation/Review detail fanout, global directory scan, stock sum or new cache infrastructure is introduced.

## Manual Price creation and exact transport

`POST /api/v1/admin/material-prices` uses generated `PriceInput`, with `params.header['Idempotency-Key']` always a generated UUID. That UUID becomes the Price primary ID. Listing is fixed; Material is derived by the server and is not submitted. Optional Variant must come from the current Material. Provider is explicitly selected by protected Source name/code; inactive Sources remain selectable/labeled because the service permits them. Provider is distinct from Seller/catalog Supplier. Unit is an explicit choice, not inferred from Listing.

Required amount is a positive exact string, max15 whole/four fractional digits; zero is invalid. Optional tier MOQ is nonnegative, zero is retained and blank omitted; it is not copied from mutable Listing terms. Units are exactly PCS/METER/YARD/KG/GRAM/MM/CM/M2/FT2/ROLL/HIDE/SET/PACK. Currency is visibly trimmed/uppercased before final validation; three ASCII letters required, XXX/XTS rejected, recognized commercial currency remains server authoritative. No FX or unit conversion.

validFrom/observedAt are required strict UTC Instants; validTo is optional and must be strictly later than validFrom. A validTo at creation records an already closed historical fact with version0; no later Close is offered. The shared helper accepts only `YYYY-MM-DDTHH:mm:ss[.1-6 digits]Z`, rejects whitespace/invalid calendar values/offset-only/local strings/excess fractions, validates the calendar second and compares fixed-width six-digit UTC fractions. Date is used only for calendar validation, never millisecond-only ordering. Decimal values never pass through Number/parseFloat; exact comparisons use scaled BigInt and transport remains JSON strings.

Supporting Observations are stable RHF field-array rows, minimum1/maximum100. Only `string[] observationIds` enters transport; row IDs/labels never do. Submitted duplicates are not silently deduplicated or allowed to hide an over-100 list. UUID syntax cannot prove provider identity. UI shows provider name/code/UUID and links to Sources & Evidence in a new tab; V10 `material_price_source_provider` remains the same-provider integrity boundary. No active Source or ACCEPTED Review gate is invented.

Final request objects are validated after UI metadata is stripped. On success the returned `PriceView` is checked for command ID, current Listing/Material, Variant/provider, exact numerical facts, currency/unit, safe version and timestamps. Unsafe/incompatible success state retains the command reference and refreshes history without enabling unsafe Close/evidence management. No assertion is made that a new fact is the effective/cheapest/replacement Price; overlapping facts are legal.

## Price intention snapshots and retry equality

Before first network send a draft is editable. At dispatch, one immutable in-memory snapshot freezes the actual complete request body and UUID, including optional validTo and the original evidence array. Rerender/refetch never rebuilds that snapshot. Sent fact fields are locked for the intention. All commands use the shared admin hook with explicit `retry: false`.

Actual `PriceService.same()` compares Listing, derived Material, optional Variant, provider, amount by numeric equality, currency, unit, optional tier MOQ by numeric equality, validFrom and observedAt after microsecond truncation. **Evidence and validTo are excluded.** A valid matching same-key retry may append missing valid evidence but does not create another Price-created audit event. A valid retry changing only validTo returns the existing Price unchanged, including an intervening closure; it is not edit/close/reopen semantics. The UI deliberately resends the frozen original evidence and validTo; later evidence uses the dedicated command.

Only `ApiError.status === 0` is transport ambiguity; AbortError is cancellation and explicit HTTP outcomes are separate. Ambiguity retains key/body, locks fields, restarts/refetches bounded Listing history and compares visible Price ID with the command UUID. Found state is displayed with actual server validity, never fabricated requested validTo. Absence is **The creation outcome is still unknown in this bounded history view.** Explicit **Retry same Price intention** resends the exact snapshot/key. **Start a new Price intention** discards the old memory-only intention, generates a fresh UUID and re-enables editing. No automatic POST or reuse for a distinct fact.

Price create 409 uses the bounded wording **The Price intention conflicts with an existing Price fact or its evidence/reference constraints.** No invented conflict code or cause attribution.

## Selected Price evidence

A safe loaded Price requires matching Listing/Material, valid IDs, exact amount/unit/currency/timestamps, safe nonnegative integer version and safe optional fields. Unsafe loaded history rows render a controlled management-unavailable state, not raw JSON. Selection retains a loaded snapshot; a recovery panel separately displays refreshed state while preserving the intended close draft.

Evidence GET returns typed PriceEvidenceView. Each rendered row requires valid Observation UUID and Instant createdAt; malformed rows show a controlled unavailable-format message, no arbitrary keys. Offset pagination ends on a short page; exactly25 allows another page. Counts mean **N supporting observations loaded**.

`POST /api/v1/admin/material-prices/{id}/sources` sends only `{ observationId }`, no version/key. It is append-only; duplicate edges are deduplicated by the backend and Price version is unchanged. Provider mismatch/reference integrity can be409: **The supporting Observation conflicts with this Price's provider or current integrity constraints.** Request references remain safe. No edit/delete action.

Status0 preserves the UUID, refreshes evidence and reports a visible association or bounded uncertainty without automatic append. There is no Review approval gate.

## One-time Price Close

Only a safely known open Price (runtime validTo null) offers Close. Omitted/unknown validity does not authorize closure. Closed Price has no edit/reopen/second-close control.

`POST /api/v1/admin/material-prices/{id}/close` sends `PriceCloseInput {validTo, version}` with the exact current **Price** version, never Material/Listing version. An accessible explicit confirmation explains the one-way closure and immutable values. validTo must be strictly after validFrom using the microsecond helper. Backend performs the null-to-validTo CAS and version N→N+1; returned safe `PriceView` is authoritative, no version is synthesized.

| Outcome | Recovery |
| --- | --- |
| 400 | Invalid request/interval; preserve intended time, not network ambiguity |
| 404 | Price/reference missing; preserve context and refresh bounded history; no replacement creation |
| 409 | **The Price changed or is already closed.** Refresh history and compare visible selected ID |
| status0 | Preserve intended time; refresh history; never automatically repeat Close |
| Refreshed same intended normalized end | **The Price is already closed at the requested time.** No authorship claim |
| Refreshed different end | Display actual competing/current closure, retain intended draft; no overwrite |
| Refreshed still open | Explicitly confirm that server version, then confirm/retry manually |
| Not visible/unsafe response | Outcome unresolved in bounded view; further Close blocked until explicit safe-open confirmation |

Close recovery searches freshly refetched active filtered/cursor pages as well as a bounded unfiltered history read; it does not ignore a selected older fact that is visible only in a filtered scope or trust stale inactive cache. A regression first reproduced that missing-row recovery error and then passed with this correction.

All attempted unresolved Close commands require recovery before another POST, including malformed success responses. Evidence refresh does not reset the close draft. V10 immutable identity/value, one-close and evidence guards are unchanged.

## MANUAL Inventory append and retry identity

`POST /api/v1/admin/material-inventory-snapshots` uses generated InventoryInput with fixed Listing, optional current-Material Variant, optional resolved Facility, mandatory exact quantity/unit/observedAt, `captureMode:'MANUAL'` and a generated UUID `manualIdempotencyKey` in the **body**. No sourceObservationId, Actor fields, Material ID or version is submitted. No capture-mode selector/imported-create control exists. Existing IMPORTED observations remain honestly visible in read views with source references.

Quantity is nonnegative exact15+4; zero is known zero, blank invalid. Unit is one of the same13 explicit choices. Facility can be third-party or archived; absence means no Facility recorded, not Seller location. UTC uses the same strict microsecond helper.

At first send, exact body/key and current Actor ownership are frozen in memory. Database identity is `(listing_id, manual_idempotency_key)`, not globally unique key. An exact same Listing/key/Actor retry returns the existing Snapshot only if optional Variant, optional Facility, numeric quantity, unit and microsecond observedAt all match. Different Actor issuer/subject or any different fact, including null↔UUID, conflicts409. Same key on another Listing is distinct server identity; UI generates new keys on Listing context changes and never deliberately reuses them.

Status0 locks facts, retains the snapshot/key, resets/refetches current/history and compares visible same-key rows including safe Actor identity. Matching state is shown; incompatible context reports conflict; bounded absence remains unknown. **Retry same Inventory intention** uses the exact frozen body. **Record a new observation** generates a new key and fresh editable draft. Corrections are new immutable Snapshots, never in-place edits. Success InventoryView is validated against Listing/Material, MANUAL/key, decimal/unit/time/context, safe returned timestamps and authenticated Actor. V11 immutability remains authoritative.

409 copy: **This Inventory command key conflicts with an existing Snapshot, Actor, or submitted fact context.** No automatic retry, identity reassignment or invented optimistic version.

## Stock truth, invalidation and drafts

No current row means stock unknown; quantity0 is known zero; failed read is unavailable. Current rows are latest independent observation scopes; history is not a movement ledger. Quantities are never summed, delta-computed, converted or treated as ATP/reservation/allocation.

| Command | Session/Listing-scoped read-after-write |
| --- | --- |
| Price create | Restart/refetch Price history and effective-price scopes; retain validated returned fact |
| Evidence append | Refresh protected evidence only; no Price version change |
| Close | Refetch loaded history scope and effective-price scopes; createdAt ordering identity unchanged |
| Inventory append | Refresh/restart current knowledge and history for this Listing |

Shared public keys refresh existing buyer commercial reads without a full browser reload. There is no unrelated global cache clear. Isolated RHF forms do not reset on commercial or Listing refetch; field-array row IDs remain stable. Draft/key state is reset only by explicit Reset/new intention/context discard or a security boundary. Sources & Evidence opens in another tab rather than persisting drafts.

## Tests, visual artifacts and measurements

Test-only `commercial-curation-fixture.ts` reuses established direct local Docker PostgreSQL fixture patterns and validates the local database-name boundary. It provisions synthetic admin/other-admin/revocable/buyer/owner prerequisites, multiple providers/observations without an ACCEPTED Review, and an archived third-party Facility. Existing APIs create prerequisite Material/archived Variant/Listing. The main tested Price/Inventory/evidence/Close results are created through real UI/API, not preseeded. No production seed endpoint/service/migration.

Five new real browser cases cover buyer/owner denial; Sources & Evidence → new Observation → Price create/header/ID → actual changed-validTo-only retry → same/cross-provider evidence → one-time Close → zero/new MANUAL snapshots → exact retry/changed Variant/Facility/quantity/unit/time/different Actor409 → buyer read-after-write; committed response-loss/exact explicit deduplicated retry for both command families; archived Listing and competing Close409; late Actor response and runtime revocation. Same-origin and separate API-origin runs exercise the real existing Idempotency-Key CORS support without backend changes.

Frontend pure/model tests cover strict decimals/Instants, immutable snapshots, exact equality sets, null/zero, defensive views and evidence bounds. Component tests cover dispatch transport, exact retries, unsafe/ambiguous responses, Close recovery states, dirty draft preservation, row identity, key replacement on Listing/Actor changes, gate/revocation and late responses. Existing Listing unit-option assertions are scoped to its own form now that commercial selectors are present. Existing Source E2E selection waits for initial pagination completion and uses bounded pagination before asserting a newly created row; no assertion, timeout or suite is weakened/skipped.

Ignored actual React screenshots live under `.local/phase1c5d-review/{same-origin,separate-origin}` at1440×1000 and390×844, with a width assertion on every capture. Review covers25 states per origin: Price/provider/evidence/history/open/closed/confirmation/status0/409; Inventory form/known zero/current/history/status0; archived Listing; mobile forms/rows/close/history/ambiguity/denial. No binary is committed. Long native select labels can truncate within the control, so full selected Source/Variant/Facility labels/references are additionally wrapped outside it. Long editable text scrolls within native inputs; no essential fact is hidden to shorten the page.

Final request measurements and validation results are recorded below after completing the full gate. Final pushed SHA, clean/local-origin equality and exact-head SOURCE OS CI result are reported in the completion message.

## Observed final validation

| Gate | Observed result |
| --- | --- |
| Frontend Vitest / RTL | 838 passed,21 files;104 new model cases +45 new workspace cases |
| Backend PostgreSQL / build | 212 passed,0 failures/errors/skipped; Maven verify BUILD SUCCESS |
| Price / Inventory backend regressions | Price15 + PriceProvenance13 + Inventory10 =38 passed (included in212) |
| Exact Decimal / accepted5P | ExactDecimalTransport7 and CurationPreconditions17 passed (included in212) |
| Same-origin Playwright | 26 passed (existing21 + new5) |
| Separate API-origin Playwright | 26 passed; real Idempotency-Key and existing CORS exercised |
| Visual review / overflow | 25 same-origin states reviewed plus separate-origin spot checks;50 ignored PNGs; every captured state passed width assertion |
| Frontend typecheck / build | Passed |
| OpenAPI / generated TypeScript | Deterministic generation/check passed; byte-identical to baseline |
| Terraform | fmt-check, init-backend=false, validate passed |
| Gitleaks | Staged scan passed; final commit scan and exact-head CI reported after commit/push |
| Migration / protected boundary | V1–V12 byte-identical; no V13; backend/contracts/dependencies/infra/CI unchanged |

Representative request measurements exclude session identity/capability checks and are fixture observations, not production benchmarks:

| Interval | Observed GETs in each origin |
| --- | --- |
| Fresh Listing entry through initial draft setup |9: Listing, Material label, Seller label, Listing citations, Material Variants, provider Sources, effective prices, Facility directory, inventory current |
| Explicit selected Price + opened cached history |1 protected evidence GET; no evidence request before explicit selection |

Pagination remains bounded: Source/Variant helpers use25-row offset pages; Price/Inventory forward opaque cursors; evidence offset25 is exercised by the component suite. Repeated Variant/Source/Facility references reuse the session cache. There are no per-Price Observation/Review calls or per-Inventory provenance calls. The production build remains lazy; final build reports a267.79kB main JS chunk (83.10kB gzip) and30.53kB lazy AdminListingDetail chunk (9.01kB gzip). Review corrected clipped native-picker labels with full wrapped selected references and changed commercial ambiguity guidance to the Listing/evidence history rather than a Source-list lookup. Long forms need vertical scrolling; no observed page-width overflow, clipped essential scope information or color-only state remains. No automated accessibility certification is claimed.

## Deferred

Not implemented: imported Price creation UI, IMPORTED Inventory creation UI, generic Price value edit/reopen/delete, Inventory update/delete/correction-in-place, aggregate stock/ATP/reservation/allocation, FX/unit conversion, 1C-5E Identity Binding/final hardening, buyer Source labels, buyer Material price filtering, reference mutation, delete/unlink or Phase2. No PR or merge is part of this task.
