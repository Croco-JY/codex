# Phase 1C-4 — Supply Network read workspace

Authenticated lazy routes `/suppliers`, `/suppliers/:id`, `/facilities` and `/facilities/:id` complete this read slice. Supply Network navigation is separate from Material Sourcing. Existing Material/Listing routes and commercial semantics remain intact. This slice adds no commands, admin UI, backend production changes, contract changes, migrations or infrastructure.

## Contracts and domain boundaries

`docs/openapi.json` and generated `apps/web/src/api/schema.ts` are authoritative for exact paths, transport fields, schemas, enums and optionality. Industrial Cluster reference reads use the existing **GET `/api/v1/industrial-clusters`**. `/api/v1/clusters` is not added or aliased.

Organization, canonical Supplier and physical Facility remain separate. Supplier roles (MILL, CONVERTER, MATERIAL_SUPPLIER, TRIM_SUPPLIER, FACTORY, PROCESSOR, QC_COMPANY, LOGISTICS_COMPANY, OTHER) describe businesses and have no invented primary role. Facility types (OFFICE, MILL, FACTORY, WAREHOUSE, SHOWROOM, PROCESSING_PLANT, QC_SITE, OTHER) describe sites. One is not inferred from the other.

Supplier verification uses DISCOVERED / CLAIMED / VERIFIED / AUDITED / TRANSACTED / PROVEN as recorded states, without scores or certification claims. Facility capability assignment verification instead uses UNVERIFIED / DOCUMENTED / AUDITED; proficiency uses SUPPORTED / EXPERIENCED / SPECIALIST. A Supplier's verification never propagates to its Facilities or capabilities.

## Directories and transport

Both directories use draft → Apply → allowlisted canonical URL → server request. Editing a draft does not run a directory request. Supplier name selection may explicitly search its own bounded picker, independently of applying Facility filters. Clear removes supported criteria. Browser Back/Forward restores applied criteria and remounts drafts. Search filters are initially collapsed on narrow screens and can be opened with the native keyboard-accessible disclosure; Apply collapses them on narrow screens. The disclosure shows the applied-filter count.

Supplier filters: keyword `q` (up to 160 characters), `country`, `role`, `verificationStatus`, `facilityCountry`, `region`, `cluster`, `capability`. Supplier `country` and `facilityCountry` are distinct ISO alpha-2 strings. A Japanese Supplier with a Chinese warehouse is valid. Region/Cluster/Capability filters describe recorded Facility relationships and are not invented Supplier geography.

Facility filters: `country`, `region`, `cluster`, `type`, `capability`, `supplier`. Country uses alpha-2; Region, Industrial Cluster, Capability and Supplier use UUIDs selected by human labels. The Supplier picker performs explicit name searches bounded to 20 results and asks for a narrower name where needed. It does not preload the directory. **There is no Facility keyword control, `q` transport, client-side filtering or new search endpoint.**

The URL parser removes unsupported parameters, invalid enums/UUIDs/country formats, duplicate/private keys and control characters, with neutral cleanup feedback. Cursor, limit, lifecycle/archive state, Actor identity and session metadata are not shareable filter state. Backend predicates remain authoritative; filtering is not reconstructed in JavaScript.

Both directories initially request `limit=25` and use opaque `nextCursor` verbatim. Load more keeps loaded records and filters. New Apply starts a fresh sequence, including previously cached filters. HTTP 400 cursor failures keep scope and offer **Reload first results**. Counts describe loaded rows, never total suppliers/sites or unsupported aggregates. Empty results mean no matching records, not proof that no real-world suppliers/sites exist.

## Reference reads and labels

Countries use the existing bounded `/countries` read. Region, Industrial Cluster and Capability references use explicit 100-row offset pages with user-controlled Load more, cached for five minutes within the opaque session scope. Repeated IDs reuse the same cached reference collections. Native/local names are preferred, then English names; country options also show alpha-2. Inactive reference choices are excluded unless selected. References are not fetched per result card.

A missing Region/Cluster reference displays “not recorded”. A supplied reference with a failed or not-yet-loaded label displays “label unavailable” and the known reference. Further labels can be loaded in bounded batches. Neither a lookup failure nor an unloaded reference is presented as absent domain data. Country label failures retain the known code/reference. Supplier directory cards use SupplierHit alone; no per-card Supplier detail is requested. Facility cards use FacilityHit alone, with deduplicated cached parent Supplier labels and no per-card Facility or capability reads.

## Supplier detail

Identity shows available legal/native/English names, country, business registration, safe website and description. Website links require absolute HTTP/HTTPS, reject embedded credentials/control characters, and use `noopener noreferrer`. UUID/version are not the primary title. Lifecycle and current Supplier verification remain visible, including direct ARCHIVED reads.

Independent child sections show aliases (alias/type/language), Facilities, Catalog materials, Seller listings and verification history. A child error preserves identity and other successful sections. Verification history shows previous/new status, UTC occurrence and reason; it does not render Actor issuer/subject or raw source payloads. Supplier detail supplies the authoritative current verification state.

**Catalog materials** means Materials for which this Supplier is canonical catalog supplier. **Seller listings** means Listings for which this Supplier is Seller, independently of catalog ownership. Supplier A can own Material X while Supplier B sells a Listing of X. The fixture also gives A a Listing of B's Material to exercise the reverse relationship. These collections and labels stay separate. Material and Listing links open the existing detail/read workspaces rather than embedding commercial tools here.

Supplier Facilities and catalog Materials initially load 25 rows with cursor continuation. Seller Listings use 25-row offset pages starting at zero. Aliases and verification history have existing server caps of 100 with no continuation contract; the UI discloses the cap at 100 rather than inventing pagination or completeness. Facilities remain physical sites with their own country, independently of Supplier country.

## Facility detail and capabilities

Facility identity shows name, type, lifecycle and a linked parent Supplier. Geography keeps Country, Region and Industrial Cluster separate. Address lines, postal code, phone/email and coordinates are displayed when recorded. Latitude and longitude remain exact decimal strings; no map, rounding or numeric coercion is introduced.

Capabilities are independently loaded via `/facilities/{id}/capabilities` and resolved against canonical Capability references. Label/category, assignment proficiency, assignment verification, minimum/maximum order quantity and quantity unit are displayed separately. Null quantities remain unknown, zero remains a recorded zero, and `999999999999999.9999` remains unchanged. Maximum order quantity is not monthly capacity. An empty read says **No capabilities recorded for this Facility**, without asserting that the Facility lacks real capabilities. The existing 100-assignment cap is disclosed when reached.

## Navigation, isolation and safe errors

Supplier → Facility → parent Supplier, Supplier → Catalog Material, Supplier → Seller Listing and Material/Listing → related Supplier/Facility links use internal route state. A validated `networkReturn` accepts only allowlisted directories and UUID detail routes; directory queries pass their canonical parser. A separate validated `networkDirectory` carries one directory context through nested details so returning to a Supplier can retain original search filters. Invalid Supplier returns fall back to `/suppliers`; invalid Facility returns to `/facilities`. External origins, arbitrary redirects, fragments, backslashes and control characters are rejected. Existing Material `discoveryReturn` validation remains unchanged and separate. Browser Back remains available. No credentials or session metadata enter navigation state/URLs.

All authenticated keys include the existing opaque session scope. The accepted central API client, AbortSignal handling, cache cancellation/clearing and actor-owned remount boundary remain unchanged. Actor switch/logout discards drafts and prevents an old completed response from repopulating the next Actor's UI/cache. No network or commercial data is persisted to localStorage/sessionStorage. Canonical reads are independent of Organization selection.

Existing safe ApiError handling preserves bounded request reference IDs for 400/401/403/404/5xx/network failures. Primary record 404 stays record-not-found; optional section failures remain local. Raw response bodies, auth headers, tokens, dev identities and stack traces are not displayed.

## Validation and review

Component tests cover allowlisted transport, independent country fields, SupplierRole vs FacilityType, draft/Apply/URL/Clear/Back, bounded cursors/offsets and recovery, no per-row detail decoration, aliases/history/archived reads, catalog-vs-Seller relationships, optional section failures, missing-vs-unresolved geography, exact coordinates/quantities, unknown-vs-zero and stale Actor responses.

Local/test PostgreSQL fixtures insert deterministic synthetic Suppliers, aliases, verification events, multiple domestic/foreign Facilities, geography, capability assignments and dual catalog/Seller relationships. Inserts are idempotent and do not update/delete immutable facts. No production fixture endpoint or admin grant exists. Browser regressions run with both same-origin and configured separate API origin, alongside accepted organization, Material and commercial journeys.

Review captures use the actual React application at 1440×1000 and 390×844. Supplier directories (default/filtered), Supplier identity/children, Facility directory/detail/capabilities and mobile filtering/detail views are stored only in ignored review/test output. Native labels, focus, wrapped long names/aliases/quantities and document overflow are checked. Long bounded collections require vertical scrolling; essential fields remain visible. Mobile filter density was improved by the disclosure, without changing domain layout or adding decorative UI.

Observed request measurements and bundle sizes are recorded after the final runs below. These fixture counts are not production benchmarks; pagination and distinct reference counts affect requests.

## Deliberately deferred

- Material price filtering stays disconnected. `maxPrice` requires `priceDataSourceId`, currency, priceUnit and an explicit `asOf`; an optional provider/current query without `asOf` is incompatible with the existing contract. No buyer-safe Source directory exists. There is no raw provider UUID input, buyer access to admin sources, new endpoint or backend price-semantic change.
- **B4:** Supplier/Facility directories remain ACTIVE-only (Facility search also requires an ACTIVE parent). Known archived detail URLs may resolve, with clear ARCHIVED display. Complete archived discovery is not supplied by the API.
- **B5:** buyer-safe friendly Source labels remain deferred; accepted commercial source-reference fallback is unchanged.
- Admin curation, source/evidence inspection and all mutations remain later slices. No Phase 1C-5 or Phase 2 workflow is implemented.

## Observed measurements

With reference caches warm, entering Supplier A detail adds **six GETs**: identity, aliases, Facilities, catalog Materials, Seller Listings and verification events. It adds no per-child detail decoration. The filtered Facility directory refresh adds **one GET** once its references/parent labels are warm.

A cold Facility directory in the combined local fixture database loads six Facilities with four distinct parent Supplier IDs: one directory GET, four shared reference GETs and four deduplicated parent Supplier GETs. Reapplying the same scope reuses references/parent labels and adds only the directory GET. No per-result Facility detail/capability reads occur. The real browser regression measures and asserts deduplication against actual returned Supplier IDs rather than assuming every site has a different parent. Supplier discovery loads 25 then 28 synthetic matching records without Supplier detail fanout.

The same-origin production build reports a 313.23 kB main JavaScript chunk (98.78 kB gzip), versus 312.00 kB (98.48 kB gzip) at the accepted 1C-3 baseline. New lazy route chunks are 2.75 kB Suppliers, 2.62 kB Supplier detail, 3.08 kB Facilities and 4.52 kB Facility detail; shared network filter/reference/child chunks load as needed. These are Vite output sizes, not complete per-route transfer totals. No dependency was added.

Twelve ignored actual-application screenshots were reviewed, including expanded mobile filters. No horizontal page overflow, clipped long names/aliases/addresses/quantities or color-only verification meanings were observed at the required viewports. Native selects retain their ordinary compact closed-control presentation; full detail values wrap. Long directories and independent detail sections require vertical scrolling. No cross-scope aggregate, map or decorative redesign was added.
