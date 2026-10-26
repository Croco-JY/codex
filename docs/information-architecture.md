# Information Architecture

## Current implemented navigation

Overview (`/`) and Organization (`/organization`) remain. Authenticated sourcing now includes Material Sourcing (`/materials`, `/materials/:id`, `/material-listings/:id`) and Supply Network (`/suppliers`, `/suppliers/:id`, `/facilities`, `/facilities/:id`). Material discovery price filtering remains disconnected.

Only a confirmed PLATFORM_ADMIN capability reveals Curation. Protected lazy routes are `/admin`, `/admin/sources`, `/admin/suppliers[/:id]`, `/admin/facilities[/:id]`, `/admin/materials[/:id]` and `/admin/listings[/:id]`. Sources & Evidence is contextual rather than a fabricated global SourceRecord browser. Price/Inventory curation stays within Listing context and typed identity controls within canonical context. Pending/error states do not mount protected workspaces; revocation removes them.

Organization selection is advisory and never grants authorization. Actor switching discards owned query/cache/draft state. Global catalog routes remain separate from the selected Organization's implemented private workspace; same-Actor Organization changes preserve global Supply cache while clearing private generations/drafts.

## Current accepted Phase 2 DEVELOP

DEVELOP exposes **Projects**. Implemented browser hierarchy: `/organizations/:organizationId/projects`, then `/:projectId`, then `/styles/:styleId`. Style detail shows metadata → Requirement → Material Selections → Facility Candidates → Development References. There are no global Selection/Candidate/Reference pages. The private route requires membership in its URL Organization and matching full hierarchy, independently of curation capability. Accepted [2B](phase-2b-product-workspace-ui.md) through [2G](phase-2g-cumulative-hardening.md) define the UI behavior and boundaries.

Direct Style entry strictly resolves Project GET → Style GET before exactly four initial child reads. Requirement, Selections, Candidates and References are unordered independent siblings. A non-403 child error remains section-local; current-generation membership 403 denies the Organization workspace. Malformed Project/Style timestamps fail closed before descendants mount. Archived parents retain read access and READY downloads, while descendant writes are unavailable.

## Measurements route and lazy Phase 3 contexts

[3A](phase-3a-measurement-foundation.md) adds a lazy `.../styles/:styleId/measurements` route and a navigation-only Measurements link on StyleDetail. Ordinary StyleDetail still issues zero Measurement requests and retains its four Phase 2 children. Direct Measurement entry resolves Project GET→Style GET→MeasurementSpec GET. Absence needs no history/detail query; an existing spec embeds its latest full snapshot and enables exactly one history read anchored to that latest revision number. Summary pages do not hydrate details; opening a historical revision is explicit. No Phase 2 child section or Pattern/Grading/Release domain is mounted on the Measurements route.

Measurements has create-only singleton/revision-1 and complete new-revision draft forms, bounded revision-number history, explicit historical reads, strict payload validation and generation isolation. VIEWER and archived parents remain read-only. 409/412 and uncertain outcomes retain the draft and require explicit non-submitting reconciliation; no automatic mutation retry or equivalent-content success attribution.

Under the unchanged [Phase 3 PLAN](phase-3-plan.md), Pattern list/detail routes are implemented by 3B below and grading routes by 3D; release routes remain proposed only. Each future route must resolve Project→Style before its own bounded domain, with no cross-domain speculative histories or fanout. No global private Pattern route or new sidebar item is implemented by 3A.

Pattern geometry/preview, BOM, Samples, RFQ/Quotes, Contracts, Payments and Production remain unavailable and must not appear as working tools. Generic development attachments must not be labelled Tech Packs or Patterns. Tech Pack/BOM/Sample implementation ownership requires a separate roadmap decision. DISCOVER → DEVELOP → SOURCE → TRANSACT → PRODUCE → LEARN is the long-term sequence, not a claim that all navigation already exists.

## Phase 3B Pattern contexts

[3B](phase-3b-pattern-vault.md) adds navigation-only Patterns on StyleDetail and lazy Style-contextual collection/detail routes. Direct entry resolves Project→Style before Pattern. List defaults ACTIVE with ARCHIVED/ALL and opaque cursor navigation; one page needs no row-detail or Measurement hydration. Detail embeds latest and enables one anchored history read, with exact historical read only on explicit action. Create/revision forms open a bounded Measurement selector only explicitly; no pin is also valid. VIEWER and archived parents remain read-only; archived Pattern permits eligible reactivation, while archive requires named confirmation. Draft and lifecycle conflicts require explicit reconciliation, without automatic mutation retries or durable draft storage. Ordinary StyleDetail retains exactly four Phase2 children, Pattern requests0 and Measurement requests0. 3B itself introduced no binary/import/quality/release UI; 3C now adds the explicit artifact controls below.

## Phase 3C — Explicit artifact inspection/import

[3C](phase-3c-pattern-artifacts.md) adds Inspect artifact on latest/explicit historical revision and Import artifact as new revision for eligible writers. No new route/sidebar/StyleDetail child is introduced. StyleDetail, Pattern list/detail/history initial artifact GET count remains zero. Only explicit inspection fetches metadata; content waits for explicit READY download. Import opening performs no Measurement lookup; the existing bounded selector is explicit. Ambiguous outcomes retain File/metadata in memory and require authoritative review plus explicit reconciliation/submission. No preview or retry-in-place is offered.

## Phase 3D — Lazy grading matrix

[3D](phase-3d-grading-foundation.md) adds `.../styles/:styleId/grading` and `.../grading/:gradeRuleSetId` under Authenticated→WorkspaceGate. StyleDetail adds navigation only, keeping four Phase 2 reads and zero grading/Pattern/Measurement/artifact requests. After Project→Style gating, list entry uses one compact collection GET; detail uses one full detail GET plus one history GET anchored to its embedded revision number. Exact older snapshots are fetched only on explicit selection.

Semantic matrix tables have captions, row/column headers, associated labels, explicit base/unit/state, keyboard controls and contained horizontal scrolling. Delta drafts remain strings and memory-only. Explicit size/rule controls preserve array order; new cells remain blank and base changes do not rebase values. Conflict or ambiguous mutation retains the complete draft and requires non-submitting reconciliation; retry:false prevents automatic resends. Lifecycle archive requires confirmation; VIEWER and archived hierarchies are read-only. Organization/Actor generations guard every read and command callback. No Pattern/Measurement picker, binary request, Delete, geometry or private browser persistence is introduced.
