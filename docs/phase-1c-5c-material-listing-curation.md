# Phase 1C-5C — Material and Seller Listing curation

## Baseline and scope

Implemented on `phase-1c-ui` from `32dd05b0b7b03de45974c3b0925a516c25ec14b1`. Local HEAD, origin tracking and live GitHub HEAD matched; the worktree was clean. SOURCE OS CI [39560091402](https://github.com/Croco-JY/codex/actions/runs/39560091402) succeeded for that exact baseline.

This is frontend production work using existing contracts. Backend production code/tests, OpenAPI, generated schema, V1–V12, dependencies, infrastructure and CI configuration are unchanged. No V13 exists. Exact paths/parameters/schema come from OpenAPI and `schema.ts`; backend services and V9 establish mutation and integrity behavior.

New lazy protected routes: `/admin/materials`, `/admin/materials/:id`, `/admin/listings`, `/admin/listings/:id`. `/admin/variants` does not exist. Admin landing adds Materials and Listings beside the accepted Sources, Suppliers and Facilities tools. Supplier detail offers contextual Add Material / Add Listing; Material detail offers Add Listing. Existing buyer routes retain their accepted behavior.

## Authority, cache and session boundary

All four routes mount through Authenticated → AdminGate. Only `platformAdmin === true` grants access. Buyer and ORG_OWNER alone are denied; PENDING/ERROR do not mount protected pages or start their queries. The accepted nested `/admin/...` capability refresh remains in force.

Public Material/Variant/Listing detail and child projections reuse session-scoped canonical keys. Status-specific admin search uses an explicit admin namespace. Material/Variant/Listing citations are protected admin-scoped keys. There is no buyer access to protected citations or admin Source labels.

Revocation unmounts protected UI, cancels/removes protected caches and drops drafts, comparisons and Observation context. Actor change/logout cancels and clears Actor-owned queries and remounts page state. Delayed old-Actor reads cannot populate the next Actor's UI. Mutation callbacks check their captured scope and abort boundary; the Spec refresh also rechecks its active boundary after asynchronous cancellation. No curation state is persisted to localStorage/sessionStorage.

Every command inherits explicit `retry: false` from `useAdminMutation`. AbortError is cancellation. Only ApiError status 0 is transport uncertainty: preserve draft, refresh bounded/current context, require an operator decision. Explicit HTTP outcomes are handled separately, retaining safe request references and excluding raw bodies, headers and credentials.

## Material discovery and identity

The admin directory sends one explicitly selected DRAFT / ACTIVE / ARCHIVED status through existing Material search. It offers applied keyword/type/status filters, URL restoration and bounded opaque-cursor Load more, with first-results recovery retaining scope. It never sends maxPrice or scans child collections per row. The buyer ACTIVE-only directory and its richer accepted search filters are unchanged.

Material creation uses a human-readable Supplier selector, initial Composition, explicit version 0 and required Observation. Contextual Supplier creation can retain a known archived Supplier. Optional origin uses Country UUID, never alpha2 or inferred Supplier country. Display name is nonblank/max160; catalog article max160; description max4000. Optional blank fields are omitted; full-replacement binding clears intentionally blank mutable values.

`catalogSupplierId` and `materialType` are immutable after creation. They are read-only and resent from the safe canonical baseline. Material type has the existing fifteen values, without inference from names/roles. DRAFT is visibly distinct; known DRAFT and ARCHIVED detail remain usable. Archived detail explains that the record may disappear from active buyer discovery.

## Shared parent version and Composition preservation

| Command | Version owner | Creation / update |
| --- | --- | --- |
| Material Profile PUT | Material | Exact current parent version |
| Composition PUT | The same Material | Exact current parent version |
| Fabric PUT | FabricSpec | Create 0; update exact own version |
| Leather PUT | LeatherSpec | Create 0; update exact own version |
| Variant PUT | Variant | POST 0; update exact own version |
| Listing PUT | Listing | POST 0; update exact own version |
| All citation POSTs | None | Versionless append |

Only one Profile/Composition command opens at a time. Opening captures a safe parent baseline. While a command is open the other command cannot independently own a stale draft. Success validates the returned MaterialView and refetches authoritative MaterialView before closing the command and enabling another parent command. No client version increment is treated as authoritative.

Profile PUT is full replacement, including Composition. It resends the exact current safe completeness/parts unchanged. Missing/malformed/unsafe Composition blocks Profile mutation; it is never replaced with an invented empty list. The Composition → Profile test proves the subsequent Profile sends the newly refetched version and percentages. The reverse chain is tested as well.

409 preserves the draft, blocks writes, reads current server Profile/Composition/version and presents explicit reconciliation. Adopting the displayed server version/Composition does not submit. Another writer's newer Composition cannot silently be overwritten using the old parent version. A malformed refresh does not discard the open draft.

## Composition editor

Composition uses stable React Hook Form field-array IDs. Removing a row preserves its neighbor's DOM/control identity and value. Nested validation paths are connected to their actual controls by the minimal shared form-helper correction.

| Completeness | Rules |
| --- | --- |
| UNKNOWN | Empty parts only |
| PARTIAL | Nonempty, positive parts, exact total <=100; exactly100 remains PARTIAL |
| COMPLETE | Nonempty, exact total100 |

Every percentage remains a string: positive, <=100, at most three integer/four fractional digits, no whitespace/exponent/rounding. Duplicate Fiber IDs are rejected. Four-place scaled BigInt performs exact sum/comparison; no Number/parseFloat arithmetic is used.

Fiber reads are bounded 100-row reference pages with explicit Load more. Labels include name/code and inactive state. Existing inactive Fiber references are retained; missing labels keep the known reference instead of dropping/replacing it. Fiber mutation is absent.

## Fabric and Leather specification state machines

Only confirmed FABRIC mounts Fabric logic/GET; only LEATHER mounts Leather logic/GET. Every other Material type mounts neither. A subtype 404 authorizes initial create mode only with independently confirmed matching parent.

| Intent / response | Behavior |
| --- | --- |
| Create | Generated `params.header["If-None-Match"] = "*"`, body version0 |
| Success | Fabric returns MaterialFabricView; Leather returns MaterialLeatherView, not an empty body. Validate matching parent/type where present, safe version and all editable values; refetch Spec and refresh relevant Material/search/citation/physical reads |
| Create 412 | Explicit precondition-failed message, safe requestId, preserved draft and competing server state; explicit Switch to edit mode adopts its version without submitting |
| Update | Header omitted entirely, exact own Spec version; returned/refetched state is authoritative |
| Update 404 | Preserve draft, refresh parent and Spec; no implicit create. Reopen a confirmed context before choosing creation |
| Update 409 | Preserve draft, show current server state/version, explicit reconciliation; no automatic retry |
| Status0 | Preserve draft and compare target state; never infer success or automatically switch intent |

Opened Spec drafts survive unsafe/unavailable later refreshes, with writes blocked. Full-replacement hydration does not fabricate missing optional server state: explicit null represents known absence; omitted or malformed editable properties cannot silently become blanks. Backend subtype/DB constraints remain authoritative and unchanged.

Fabric construction WOVEN allows weave only; KNIT allows knit only; NONWOVEN/OTHER/absent allows neither. Changes clear incompatible dependent values immediately. Weave/knit max80; finish/surface/handfeel/drape/luster max300.

| Exact decimal | Constraint / integer + fractional digits |
| --- | --- |
| GSM / thicknessMm | >0; 6+4 |
| widthMm | >0; 8+4 |
| Warp/weft stretch | >=0; 5+4; zero retained |
| Warp/weft shrinkage | Inclusive -100..100; signed 3+4 |
| Leather thicknessMinMm / thicknessMaxMm | >0; 6+4; exact min<=max when both present |
| Leather averageHideAreaM2 | >0; 8+4 |

Leather hide types: BOVINE/OVINE/CAPRINE/PORCINE/OTHER. Tanning: CHROME/VEGETABLE/COMBINATION/OTHER. Both optional. Finish/surface/handfeel/luster max300. All decimal controls keep original strings; no float conversion, exponent, whitespace normalization or rounding.

## PhysicalAttributes and CL-B7

Controlled stable-ID rows support exactly abrasionCycles, pillingGrade, careInstruction, testMethod, finishCode, textureCode, size, lengthMm, patternCode. Duplicate/unknown keys are rejected. There is no raw JSON editor.

Values are String, Boolean or safe integer Number. Decimal-like values use String. Only validated safe integer attributes and validated Int32 lead times convert to JSON Number; BigDecimal domain fields never do. String values have maximum255 and existing sensitive-text checks. Null/arrays/nested objects are unsupported.

Loaded numbers must be finite safe integers. Noninteger floats, unsafe integers, unknown keys or any unsupported loaded value block full-replacement Spec/Variant writes. They are never rounded, truncated, silently stringified or dropped. Undefined Attributes cannot be fabricated; known null can be represented as an empty controlled collection.

The final controlled object is serialized and measured with TextEncoder UTF-8 bytes. <=8192 is permitted; >8192 blocks submit. Tests exercise exactly8192 and8193 bytes plus multibyte text, rather than using JavaScript character count as a proxy. Backend/DB integrity checks still apply independently.

## Variants

Variants live inside Material detail. The existing offset endpoint starts limit25/offset0 with explicit Load more; both ACTIVE/ARCHIVED are supported. There is no global Variant route or deletion.

Create sends version0 and body materialId equal to the path. Update resends immutable canonical parent and the Variant's own safe version. Name is nonblank/max160; SKU/color name max160; color code max80; batch max100. Optional fields clear by full replacement. Attributes use the same guarded editor.

Success uses returned/refetched Variant state and refreshes the parent Variant collection, relevant search, citations and Material detail. 409/status0 preserve draft and fetch direct Variant for comparison without automatic resubmission. Later incomplete state blocks the write rather than destroying an existing draft.

## Seller Listings

`/admin/listings` is a context workspace, never a global directory. Choose one Material or Seller and load exactly its existing offset collection, limit25. No enumeration of every Supplier/Material, per-row detail, Price, Inventory or citation fanout occurs. Once context is selected, its picker is hidden until explicit change; changing context is disabled while a create form owns a draft.

Contextual Add Listing can fix Material or Seller, including known archived parents. Standalone creation uses human-readable Material and Seller selection. Material labels use a bounded cached canonical detail read for selected context only. Known archived direct Listing detail stays editable independently of discovery.

Material and Seller IDs are immutable on edit and resent unchanged. Catalog article and seller article remain distinct. Seller can differ from catalog Supplier. Optional terms are full replacement; intentional blanks omit properties so Spring binds absent values to null. Unsafe/missing loaded commercial values block editing, rather than clearing them.

MOQ/MCQ stay strings: nonnegative, at most15 integer/four fractional digits. `"0"` remains known zero; absence is unknown. A quantity requires unit; a unit-only state is legal. Units are exactly PCS/METER/YARD/KG/GRAM/MM/CM/M2/FT2/ROLL/HIDE/SET/PACK.

Lead times use strict nonnegative integer syntax and BigInt range validation for 0..2147483647, then JSON Number. No permissive parseInt, decimal, exponent or suffix parsing. Zero is a known zero-day value.

Create sends version0; update uses Listing's independent safe version. Success refetches Listing, material/seller child scopes, relevant Material search, citations and buyer commercial cache. 409 preserves draft/current server comparison and requires explicit reconciliation. No automatic overwrite or unknown-to-zero conversion exists.

## Fact citations

Material/Variant/Listing reads use their actual typed CitationView, not the Supplier/Facility JDBC map parser. Optional generated fields are guarded: valid Observation UUID, exact entity fact allowlist, valid ISO date-time. Malformed rows show a controlled unavailable-format message; arbitrary map/object JSON is never rendered.

| Entity | Exact facts |
| --- | --- |
| Material | RECORD, CATALOG_ARTICLE_NUMBER, NAME, DESCRIPTION, ORIGIN, COMPOSITION, FABRIC_SPEC, LEATHER_SPEC |
| Variant | RECORD, CATALOG_VARIANT_SKU, NAME, COLOR, BATCH, ATTRIBUTES |
| Listing | RECORD, SELLER_ARTICLE_NUMBER, MOQ, MCQ, UNIT, STANDARD_LEAD_TIME, REPRODUCTION_LEAD_TIME |

Collections use limit25 plus offset, count loaded rows only and permit continuation after a full page. Append is versionless/retryfalse and refreshes citations. No edit/delete or automatic per-field citation generation exists. An Observation supports a canonical fact; it does not bind persistent external identity. Observation UUID input links to Sources & Evidence in a new tab without storing the draft or inventing global Observation search.

## Accessibility, visual review and performance

Forms reuse existing primitives/styles, semantic headings, fieldsets/legends, explicit labels, connected errors, native keyboard controls and visible focus. Status/error/conflict messages include text and safe references. Layout stacks on narrow screens. Dynamic rows use stable IDs and retain neighbor state on deletion. Reset/Cancel is explicit; leaving the workspace discards memory-only drafts, as in accepted curation. No persistent draft or new navigation framework was added.

Review artifacts are ignored under `.local/phase1c5c-review/{same-origin,separate-origin}`. Twenty desktop and seven mobile states per origin cover directory statuses, Material/Profile/Composition, both Spec types, real412/409, Variants, citations, Listing context/forms and denied access. Viewports are 1440×1000 and390×844. Captures use the actual React/API application, after settled state; every capture asserts no document horizontal overflow. No PNG is committed.

Review corrected misleading generic412 presentation and code-style physical-field labels. Selected Listing context no longer displays a redundant Material result list above the fixed-context create form. UUIDs, names, descriptions and decimal values remain usable at narrow width. Long forms/history need vertical scrolling; no essential field is hidden to compress them. No obvious clipped labels, inaccessible color-only state or page-width overflow was observed.

Directory rows issue no subtype/Variant/Listing/citation reads. Listing child rows issue no commercial-history reads. Child collections and reference pages are bounded. After mutation, invalidation targets the owning detail/child/reference scopes; unrelated child collections are not refetched merely because the parent detail changes. No new cache infrastructure, backend batch endpoint or virtualization was introduced. Representative measurements from the real same-origin fixture journey, excluding identity/capability checks:

| Settled workflow interval | Observed GETs |
| --- | --- |
| One applied Material directory status | One search; no row detail/Spec/Variant/Listing/citation fanout |
| Material POST confirmation → opened detail before first Profile PUT | Seven: two Material reads, one directory refresh, one each Spec/Variants/Listings/citations. Supplier/reference caches were warm |
| Listing POST confirmation → opened detail before first terms PUT | Five: two Listing reads, one Material read, one Material Listings refresh, one citation collection; Seller label cache was warm |
| First explicit Variant open | One direct Variant read and one protected citation collection |
| Citation Load more | One additional limit25/offset25 read, covered in component tests |

These include deliberate command confirmation/refetch and route-entry reads, not per-row fanout or production benchmarks. No Price/Inventory reads decorate Listing rows.

## Test fixtures and observed validation

The new Playwright spec reuses established synthetic local PostgreSQL prerequisites from `curation-fixture.ts`: PLATFORM_ADMIN, buyer, ORG_OWNER, SourceRecord/Observation and Supplier. Test-controlled existing APIs create distinct prerequisite lifecycle records and competing Specs. No production seed endpoint, backend fixture service or migration was added. The actual main workflow creates and edits its own Material, Composition, FabricSpec, Variant and Listing through the UI/API, then checks buyer reads. Leather create/update and a real competing Material update cover the second subtype and409. Both origin modes exercise a real first-writer412 and retain the winner at version0 without automatic overwrite. Backend5P concurrency tests remain authoritative for transactional audit/provenance loser integrity.

| Validation | Observed result |
| --- | --- |
| Frontend Vitest / RTL | 685 passed, 19 files; includes159 new focused cases |
| Backend PostgreSQL / build | 212 passed, 0 failures/errors/skipped; Maven verify BUILD SUCCESS |
| Accepted5P regression | 17 CurationPreconditionsTest cases passed, including real Fabric/Leather/Capability concurrency and public notes exclusion |
| Same-origin browser | 21 passed (existing17 + new4) |
| Separate API-origin browser | 21 passed |
| Visual capture / overflow | 27 states per origin,54 ignored PNGs; width assertions passed |
| Typecheck / production frontend build | Passed |
| OpenAPI / generated TypeScript | Deterministic generation/check passed; both byte-identical to baseline |
| Terraform | fmt-check, init-backend=false, validate passed |
| Secret scan | Staged Gitleaks scan passed with no leaks; final one-commit scan is reported with final HEAD |
| Protected history | All12 migrations byte-identical; no V13 |

The exact pushed HEAD, final one-commit secret scan and final SOURCE OS CI result are reported in the completion message after commit/push; no speculative CI result is recorded here.

## Deferred

Not implemented: Phase1C-5D Price/Inventory, Phase1C-5E Identity Binding/final hardening, Fiber/reference mutation, Material/Variant/Listing identity resolution, external-record binding, buyer-friendly Source labels, buyer Material price filtering, delete/unlink and Phase2. No PR or merge is part of this slice.
