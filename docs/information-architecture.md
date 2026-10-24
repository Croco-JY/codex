# Information Architecture

## Current implemented navigation

Overview (`/`) and Organization (`/organization`) remain. Authenticated sourcing now includes Material Sourcing (`/materials`, `/materials/:id`, `/material-listings/:id`) and Supply Network (`/suppliers`, `/suppliers/:id`, `/facilities`, `/facilities/:id`). Material discovery price filtering remains disconnected.

Only a confirmed PLATFORM_ADMIN capability reveals Curation. Protected lazy routes are `/admin`, `/admin/sources`, `/admin/suppliers[/:id]`, `/admin/facilities[/:id]`, `/admin/materials[/:id]` and `/admin/listings[/:id]`. Sources & Evidence is contextual rather than a fabricated global SourceRecord browser. Price/Inventory curation stays within Listing context and typed identity controls within canonical context. Pending/error states do not mount protected workspaces; revocation removes them.

Organization selection is advisory and never grants authorization. Actor switching discards owned query/cache/draft state. Current global catalog routes are separate from the selected Organization's future private workspace.

## Planned Phase 2, not yet routed

DEVELOP initially exposes **Projects** only. Planned browser hierarchy: `/organizations/:organizationId/projects`, then `/:projectId`, then `/styles/:styleId`; requirements, selections, candidates and generic development references are contextual Style sections. The full planned URLs and Organization-switch isolation contract are in [phase-2-plan.md](phase-2-plan.md). A private route requires membership in its URL Organization and a matching full hierarchy, independently of curation capability.

SOURCE Pattern, BOM, Samples, RFQ/Quotes, Contracts, Payments and Production remain unavailable and must not appear as working tools. Generic development attachments must not be labelled Tech Packs or Patterns. DISCOVER → DEVELOP → SOURCE → TRANSACT → PRODUCE → LEARN is the long-term sequence, not a claim that all navigation already exists.
