# Phase 1C-3 — Material and commercial read views

This slice expands authenticated `/materials/:id` and adds lazy `/material-listings/:id`. It preserves the React shell, session boundary, generated contracts and central API client. All application requests are reads. No admin command, supplier/facility directory, backend production change, migration, infrastructure or Phase 2 workflow is included.

## Material and navigation

The Material header and catalog identity render independently of optional sections. Physical specification reads only FabricSpec for FABRIC or LeatherSpec for LEATHER; an optional subtype 404 is “not entered”, while Material 404 is “Material not found”. Named physical fields retain their exact decimal strings; untyped attribute maps are not exposed as raw JSON. Server COMPLETE/PARTIAL/UNKNOWN composition remains authoritative, including PARTIAL that happens to total 100.

Variants and Seller Listings use independent offset collections, initially 25. Load more advances offset by 25 only after a full page. A short/empty page ends continuation without erasing loaded records. Counts mean loaded variants/listings, never total sellers. No Variant is chosen automatically. The price resolver and inventory forms independently choose explicit Variant context from this same cached bounded collection.

Catalog supplier/article describe Material identity. Seller/seller article and MOQ, MCQ, unit, standard/reproduction lead time and status describe a Listing. Seller can differ from the catalog supplier. Missing terms stay unknown; known zero remains zero. Listing detail separately shows its catalog Material and Seller terms.

Discovery links carry only a validated `discoveryReturn` route state. The navigation boundary accepts `/materials` plus the existing allowlisted canonical filter parser, stripping unsupported/private keys. External targets, other routes, fragments, backslashes and control characters fall back to `/materials`. Material → Listing → Material/search retains the validated context, and ordinary browser Back continues to work. Tokens, actors and session metadata never enter route state or URLs.

## Price resolution

Current mode omits `asOf` on every request. The first response's `asOf` is displayed as the server evaluation time. Effective-price pagination forwards the server cursor verbatim with the unchanged query; its encoded evaluation time remains server-owned. The frontend neither decodes the cursor nor sends its returned time as a historical request. Refresh resets the entire current cursor sequence.

Specified-time mode requires an explicit valid UTC timestamp (up to six fractional second digits), transported unchanged as `asOf`. Historical matching does not reconstruct old mutable Listing terms. `listingTermsScope` remains separate: CURRENT_TERMS_ONLY versus HISTORICAL_TERMS_NOT_RECONSTRUCTED. The response's `currentListingTerms` can be inspected separately, clearly labeled as current terms returned for that evaluation.

`requestedQuantity` stays an exact decimal string. Blank means omitted/base-only, never zero. The existing backend requires a positive quantity, so zero, exponent/negative notation and excess precision are rejected before request. No tier selection, rounding, currency conversion or unit conversion occurs in JavaScript.

The resolver uses `requestedVariantId`, independently of Material search's `variantId`. Variant choice is explicit and initially absent. `allowMaterialFallback` starts false. Applying a new Variant/quantity/provider/currency/unit/time/fallback scope resets pagination. Enabled fallback and returned MATERIAL_FALLBACK each have visible text; fallback never masquerades as VARIANT_EXACT. MATERIAL_EXACT remains distinct from both.

Every result preserves independent `priceMatch`, `matchScope` and `commercialEligibility`. MATCHED + UNKNOWN_TERMS remains valid. INELIGIBLE is not substituted for NOT_EVALUATED_FOR_HISTORICAL_QUERY. A match is not an orderability guarantee; the existing current-terms eligibility checks MOQ and does not evaluate MCQ. No matching price in one loaded scope does not establish absence across every unloaded source scope.

Price facts display amount, currency, unit, material/Variant context, tier minimum, valid interval, observation time and source reference. Omitted validTo means no end recorded. Price history is a separate, initially collapsed read with independent provider/currency/unit filters and 25-row cursor pagination. It does not merge scopes into a trend or recompute old prices from current terms. No Price mutation is exposed.

### B5 provider-label limitation

There is no general buyer-safe provider directory. The UI does not call admin APIs, invent names or infer providers from inventory evidence. It shows `Source reference: <UUID>` with a concise explanation. Source choices are limited to scopes already returned by the bounded effective/history reads. Currency and unit scopes remain explicit and independent. This is an honest bounded fallback, not a blocker to correct scoped reads. Friendly provider labels remain deferred.

Material-discovery price filtering remains deferred. The existing `withPriceScope` helper stays disconnected from `/materials` URL/form transport.

## Inventory knowledge and history

`/inventory` is latest knowledge within each Variant/facility/unit/capture-mode/provider scope. `/inventory-snapshots` is separate immutable history. The form scopes both reads by supported `variantId`, `facilityId`, `unit`, `captureMode` and optional `asOf`; it is independent of price scope and does not rename Variant transport fields. An observation cutoff restricts observed times, without claiming a historical reconstruction of commercial terms.

Successful empty current read means “No stock observation / stock unknown within this scope”. A returned quantity of zero means known zero for that observation scope. A failed read means “Inventory information unavailable”, with safe request reference/retry. These states have separate UI and tests. Quantities are never summed across facilities, variants, units, capture modes, providers or history.

Rows show exact quantity/unit, Variant context, facility, capture mode, observed/recorded/created times and sourceObservationId when supplied. Manual observations do not invent imported evidence. Actor fields and manual idempotency keys are not rendered. InventoryView does not supply provider identity/name; no such value is inferred.

Facility labels use existing authorized detail reads, cached/deduplicated for about five minutes over the loaded set. Missing facility is “not recorded”; failed label lookup is “label unavailable” with the known reference. Facility filters offer references in loaded observations; the buyer directory remains outside this slice. No ownership restriction is inferred between Seller and a third-party Facility.

Both current and history use 25-row cursor reads. Current Refresh starts a new sequence; changed applied scope resets current/history cursors. Invalid cursor errors preserve scope and offer Reload first results. Other section errors preserve unrelated page content.

## Session, freshness and bounded requests

All detail, children, label, price and inventory keys include the opaque session scope. Signal cancellation, cache clearing and actor-owned remounting remain the accepted shell's responsibility. Actor change/logout discards commercial form/result state; old responses cannot populate the new Actor's UI. No commercial data is written to localStorage/sessionStorage or offline caches. Organization selection does not scope canonical data.

Details retain modest caching; labels use approximately five minutes; price/inventory reads use ten seconds with explicit Refresh. Their focus refetch is disabled to keep evaluation sequences understandable. Cache freshness never claims an availability guarantee.

Price/inventory histories load only after explicit Show history. Variant label resolution uses loaded Variant facts/reference fallback, with no per-price-row calls. Facility reads are bounded and shared by reference. There are no full-directory, all-Listing, price-per-row or inventory-per-row fanouts.

## Verification and review

Component tests cover subtype/404 independence, composition and terms, bounded offset/cursor reads, exact decimals, current/historical/fallback/match/eligibility scopes, stock truth states, facility fallback and stale Actor responses. Real PostgreSQL fixtures exercise the accepted APIs with catalog supplier A, Seller B, Variants, base/exact/tier/historical prices, source evidence, independent inventory scopes and known zero. Test fixture inserts are local-only, immutable/idempotent and add no HTTP seed endpoint or admin grant.

The real browser journey runs in same-origin and configured API-origin modes. Optional `playwright.review.config.ts` captures actual React screens for Material, Listings, price/history and inventory/history at 1440×1000 and 390×844. Screenshots remain ignored review artifacts, not repository binaries. Actual counts, request measurements, bundle sizes and final CI status are reported after verification.

Deferred: B5 friendly provider labels, broader source/evidence inspection, supplier/facility directory, admin mutations/curation, Material-discovery price filtering, production IdP integration and every Phase 2 workflow.

## Observed implementation measurements

In the synthetic search → Material → Listing journey, after discovery/reference caches are warm, Material entry adds five GETs: Material, one FabricSpec, Variants, Listings and one distinct Seller label. Listing entry adds five GETs: Listing, effective prices, inventory and two distinct Facility labels. Authentication/capability reads and prior discovery reads are excluded. These are fixture measurements, not a universal request count or production benchmark. Histories add their own explicitly requested pages; duplicate Facility IDs reuse cached detail reads. Price rows cause no individual network requests.

The same-origin Vite production build reports a 312.00 kB main JavaScript chunk (98.48 kB gzip), 6.02 kB Material detail chunk (2.15 kB gzip), and a new lazy 26.20 kB Listing detail chunk (6.56 kB gzip). The accepted 1C-2 build's main chunk was 311.53 kB (98.36 kB gzip). No new dependency or UI framework was added.

Visual review uses 18 ignored captures, including current/historical matching, known quantity/zero/unknown/unavailable stock, complete Material context and mobile sections. Page-width assertions pass at both viewport sizes. Long references wrap rather than clip. Price and inventory scope labels remain visible, and keyboard traversal uses native labeled controls. Optional histories and long child collections require vertical scrolling; no essential scope fields are hidden to shorten them. Controlled HTTP 503 is used only for the unavailable-stock review capture; other commercial captures use the real local API/database.
