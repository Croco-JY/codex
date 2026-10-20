# Phase 1C-2 material discovery

The authenticated `/materials` workspace searches canonical ACTIVE catalog materials, independently of the selected Organization. `/materials/:id` is a basic read-only destination. Both routes are lazy loaded. There is no admin editing, migration, or backend change.

## Filters and transport

The primary form contains keyword, material type, origin, fiber and color. Catalog identity has a separate supplier picker. Technical filters and commercial filters use native disclosure groups. Draft changes do not request material results: Apply validates the entire draft and writes supported filters to the URL; Clear returns to the ACTIVE baseline. History navigation remounts the draft from applied URL state. Removable chips describe applied filters. Apply/Clear sits after the primary fields and remains sticky during advanced-filter scrolling. Commercial fields return to a collapsed group after Apply, retaining an Applied indicator and the URL-backed values.

`features/materials/filters.ts` owns the URL parser/serializer and generated-contract transport boundary. Unsupported and invalid URL values are removed with a neutral notice. Lifecycle, cursor, price scope and private/authentication keys are not accepted URL state. The request always includes `status=ACTIVE`, even if the URL requests DRAFT. Search text is trimmed; backend NFKC semantics remain authoritative. Variant selection is deferred with the variant workspace.

Decimals remain strings in form state, URLs, query keys and HTTP requests. Ordinary non-negative decimals permit at most 15 whole and 4 fractional digits. Canonicalization removes insignificant leading/trailing zeros without rounding. Comparisons use scaled BigInt; percentages require a selected fiber and cannot exceed 100. Only strictly validated int32 lead-time days are converted to JavaScript numbers.

Public price filters are intentionally deferred until buyer-safe provider labels are available (B5 / 1C-3). The form and URL parser cannot send partial or complete price scope. The separately tested typed `withPriceScope` transport helper preserves the existing generated names and exact strings for later work; it is not connected to discovery UI. No best-price, stock, matched-listing projection or seller count is invented (B3 remains deferred).

## References and reads

Countries are a bounded cached reference read. Fiber choices load in explicit 100-item offset batches; further choices require Load more. Inactive references are excluded unless already selected. Catalog supplier and seller pickers separately search the real directory with a 20-result bound and explicit name search/selection; UUIDs are internal values. Narrowing the search replaces an unbounded directory dropdown.

Visible material rows resolve distinct catalog supplier IDs through session-scoped cached detail reads. Duplicate supplier IDs share a query; label failures leave rows usable. Origin absence differs from failed lookup. Composition completeness comes from the server, including explicit PARTIAL/UNKNOWN presentation. No FabricSpec, LeatherSpec, listing, price or inventory fanout occurs.

Material results use cursor pagination with 25 initial items. Load more retains previous rows, disables duplicate requests, and forwards the opaque cursor verbatim. Filter identity changes reset pagination. An empty next page preserves earlier items. Cursor HTTP 400 errors offer first-page reload with the same filters. Counts describe loaded rows only. Previous valid results remain visible while a new applied search is loading, with an explicit updating notice.

All authenticated queries include the existing opaque session scope. Actor switch/logout cancels and clears old queries and remounts the workspace; stale responses cannot refill the next Actor's cache. Nothing writes material data to localStorage/sessionStorage. API origin, redirect, CORS, memory credential and capability protections remain unchanged.

## Local browser fixtures and visual review

`e2e/material-fixture.ts` provisions synthetic records directly into the local/test PostgreSQL database after confirming local-profile identity. It creates no admin grant or bootstrap endpoint. Immutable fixture inserts use deterministic identities and `ON CONFLICT DO NOTHING`; they do not update/delete history. Local isolated databases can be selected with `SOURCE_OS_E2E_DATABASE`; CI defaults to the existing `source_os` compose database.

The real-backend browser test covers discovery, 25-to-28 cursor loading, physical and commercial filtering, detail and browser Back. The same suite runs with unset API origin and direct `VITE_API_BASE_URL=http://127.0.0.1:8080`. Review screenshots use actual React routes and these fixtures, are kept in ignored test output, and are not committed.

Run the optional visual review separately from the regression suite (with the local-profile API already running):

```sh
SOURCE_OS_E2E_DATABASE=source_os pnpm --dir apps/web exec playwright test --config playwright.review.config.ts
```

Choose the actual isolated local database when it differs from the compose default. Captures use desktop 1440×1000 and mobile 390×844, with full-page images for expanded filter groups. Loading capture holds a real request temporarily; the error capture injects a controlled HTTP 503 into the real application. Other screenshots use real PostgreSQL results. The capture test checks document overflow and verifies Apply remains in the viewport while advanced fields are scrolled into view. PNG files remain under ignored `test-results` or `.local` review output.
