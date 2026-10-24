# Information Architecture

## Current implemented navigation

Overview (`/`) and Organization (`/organization`) remain. Authenticated sourcing now includes Material Sourcing (`/materials`, `/materials/:id`, `/material-listings/:id`) and Supply Network (`/suppliers`, `/suppliers/:id`, `/facilities`, `/facilities/:id`). Material discovery price filtering remains disconnected.

Only a confirmed PLATFORM_ADMIN capability reveals Curation. Protected lazy routes are `/admin`, `/admin/sources`, `/admin/suppliers[/:id]`, `/admin/facilities[/:id]`, `/admin/materials[/:id]` and `/admin/listings[/:id]`. Sources & Evidence is contextual rather than a fabricated global SourceRecord browser. Price/Inventory curation stays within Listing context and typed identity controls within canonical context. Pending/error states do not mount protected workspaces; revocation removes them.

Organization selection is advisory and never grants authorization. Actor switching discards owned query/cache/draft state. Global catalog routes remain separate from the selected Organization's implemented private workspace; same-Actor Organization changes preserve global Supply cache while clearing private generations/drafts.

## Current accepted Phase 2 DEVELOP

DEVELOP exposes **Projects**. Implemented browser hierarchy: `/organizations/:organizationId/projects`, then `/:projectId`, then `/styles/:styleId`. Style detail shows metadata → Requirement → Material Selections → Facility Candidates → Development References. There are no global Selection/Candidate/Reference pages. The private route requires membership in its URL Organization and matching full hierarchy, independently of curation capability. Accepted [2B](phase-2b-product-workspace-ui.md) through [2G](phase-2g-cumulative-hardening.md) define the UI behavior and boundaries.

Direct Style entry strictly resolves Project GET → Style GET before exactly four initial child reads. Requirement, Selections, Candidates and References are unordered independent siblings. A non-403 child error remains section-local; current-generation membership 403 denies the Organization workspace. Malformed Project/Style timestamps fail closed before descendants mount. Archived parents retain read access and READY downloads, while descendant writes are unavailable.

## Planned Phase 3 contextual routes — not implemented

[Phase 3 PLAN](phase-3-plan.md) preserves StyleDetail's existing four-child budget. Lightweight future navigation triggers zero Phase 3 API requests until a lazy contextual sub-route is entered. Proposed routes are `.../styles/:styleId/measurements`, `.../patterns`, `.../patterns/:patternId`, and `.../patterns/:patternId/revisions/:revisionId`, plus explicitly selected grading/release contexts in 3D/3F. Every prefix retains Organization/Project/Style ownership; no global private Pattern route.

Each route first resolves Project → Style and then its own bounded domain. Measurements does not load Patterns/Grading/Releases. A Pattern list does not preload measurement histories, grading or releases. Do not mount all Phase 3 domains or prefetch all revision/artifact histories from StyleDetail. Each slice reports its actual request budget, generation isolation and accessibility/responsive results. This PLAN adds no working route or navigation item.

SOURCE Pattern, BOM, Samples, RFQ/Quotes, Contracts, Payments and Production remain unavailable and must not appear as working tools. Generic development attachments must not be labelled Tech Packs or Patterns. Tech Pack/BOM/Sample implementation ownership requires a separate roadmap decision. DISCOVER → DEVELOP → SOURCE → TRANSACT → PRODUCE → LEARN is the long-term sequence, not a claim that all navigation already exists.
