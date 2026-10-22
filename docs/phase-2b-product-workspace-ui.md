# Phase 2B — Project / Style UI and Organization context boundary

## Baseline and authority

Repository: `Croco-JY/codex`; branch: `phase-2-product-workspace`; implementation parent: `fa63cbc95c2e33e15448a0e60a7e97cfd26f5f94` (`fix: isolate style context from project types`). Its parent is the accepted Phase 2A foundation `1454506913155b41e6c5cbd6fbddd4e43baad12a`. Main remains `6eacb4e8d96fabc6b2c03d7d2e6a295db8196283`.

The approved §0 synchronization amendment was applied before editing: fetched exact refs, verified a clean checkout with zero local-only / one remote-only commit and proven ancestry, then ran `git merge --ff-only origin/phase-2-product-workspace`. This created no commit. Local/origin/GitHub equality at fa63cbc, clean tree, no open Phase 2 PR and exact correction SOURCE OS CI `39752857928` completed/success were verified.

[Phase 2 PLAN](phase-2-plan.md) and [Phase 2A](phase-2a-project-style-foundation.md) remain unchanged and authoritative. This slice consumes the existing eight operations, without backend, migration or HTTP contract changes.

## Routes, membership and navigation

Exactly three lazy authenticated route shapes are added:

- `/organizations/:organizationId/projects`
- `/organizations/:organizationId/projects/:projectId`
- `/organizations/:organizationId/projects/:projectId/styles/:styleId`

The Style collection lives inside Project detail. DEVELOP contains only Projects; no active context links to Organization selection. No global Project/Style shortcut or future descendant control exists. Breadcrumbs use scoped IDs.

> Product Workspace requests use the Organization ID from the hierarchical route. The selected Organization is display/context state and never authorization authority.

Entry resolves fresh authenticated `/api/organizations` data, using the existing session-scoped key, staleTime 0 and refetchOnMount always. Cached membership alone cannot mount children: the gate waits for a successful fetch after mount. Pending/error states mount no Project/Style queries. Missing/invalid current membership presents 403 semantics even for PLATFORM_ADMIN. Parent Project must successfully resolve before mounting Style detail or its collection. Scoped hierarchy 404 never triggers a foreign lookup to enrich the error.

> When an authorized direct Product Workspace route resolves a different Organization, the route Organization becomes the active display/workspace context only after membership validation and the standard generation boundary transition.

Thus selected A + valid nested B URL resolves B first, clears old private state, synchronizes the topbar and Projects link to B, and preserves the nested B URL. Unauthorized B is never adopted; resolving/unavailable routes show neutral Organization context rather than A as the owner. Explicit Organization selection instead navigates to B's Projects collection, dropping old Project/Style IDs.

Organization listing/create/rename and role display remain available. Confirmed creation establishes its context while remaining on the Organization page; explicit selection enters Projects. Same-ID rename updates display metadata without a generation transition.

## Session and Organization boundary

`WorkspaceProvider` is inside the existing Actor-owned SessionProvider subtree. It owns memory-only `{organizationId, generation}` state nested under the opaque session scope. Accepted A→B→A transitions use distinct increasing generations; returning to A cannot revive first-A work. Same-Organization Project/Style navigation does not advance the generation.

Transition ordering:

1. Invalidate the synchronous old-token guard so settling callbacks cannot apply effects.
2. Abort old command controllers.
3. Cancel and remove the old `workspace / session / org` queries.
4. Remove obsolete mutations with that private prefix.
5. Publish the new generation and synchronize selected display metadata.
6. Remount private content; explicit selection navigates to the new collection, deep-link adoption retains its URL.

Every workspace query consumes its abort signal. Every workspace command owns an AbortController registered to its initiating token. The common command hook explicitly sets retry:false. It checks current Actor scope, Organization ID, generation and route context before dispatch and completion; success/error handlers are guarded, and awaited follow-up invalidation/refetch chains recheck before subsequent effects. Component unmount and Actor reset abort commands as well.

The API client has only a tiny shared cancellation correction: recheck signal/scope after transport and after safe error-body parsing, before 401 expiry handling. This prevents a cancelled old-workspace response from ending the still-current Actor session. A focused test deliberately delivers a late 401 despite abort. AbortError is cancellation, never a business or outcome-unknown warning.

Existing `beforeSessionReset`, opaque session renewal and Actor-owned remount/cache clear remain authoritative. No change to the session adapter or SessionProvider was needed.

> Organization switches invalidate only private workspace state. Global Phase 1 supply caches remain available within the same Actor session.

There is no Organization-triggered global cache clear. Logout/Actor switch continues to clear all Actor-owned state. No private form, conflict, description or context is persisted in localStorage, sessionStorage, IndexedDB, query strings or durable route state.

## Keys and bounded reads

Private query identities are:

```text
workspace / scope / org
workspace / scope / org / projects / status-or-null / limit / offset
workspace / scope / org / project / projectId
workspace / scope / org / project / projectId / styles / status-or-null / limit / offset
workspace / scope / org / project / projectId / style / styleId
```

Mutation keys extend the corresponding parent identity with create, update or lifecycle. Durable query identity omits generation because old-prefix cancellation/removal and keyed remount isolate the cache; asynchronous guards independently validate generation for ABA safety.

Collections use limit 25, explicit Previous/Next offsets and ACTIVE/ARCHIVED/ALL. Project default is ACTIVE; Style default is ALL so recorded archived Styles remain reachable in Project context. ALL omits status. The generated request contract types the limit/offset transport parameters as strings; the client sends `"25"` and the exact integer offset string. No unsupported q, total, sorting control, infinite preload or per-row detail fanout is added. Offset pages are explicitly described as mutable sequences.

Confirmed create resets that collection's offset to zero, resets the create draft and invalidates only its collection prefix. A success link opens the returned scoped record even when the active filter excludes it.

## Forms, versions and lifecycle

Generated Project/Style CreateInput, UpdateInput, View and Page types are used directly. Form-only draft fields use existing React Hook Form and Zod. Name trims and requires 1..160 characters; description trims with max 4000; Style code trims with max 100, preserves case and permits duplicates. Create omits blank optional text and sends no caller ID, parent, status, version or Actor. Replacement deliberately clears optional text with null.

Critical response identity/parent/status/version/text/timestamp state is checked before rendering a mutable baseline. Missing, negative, noninteger or unsafe version never defaults to zero. Unknown lifecycle does not become ACTIVE; malformed state fails safely and cannot submit.

Owner/Admin can create and mutate; VIEWER receives readable metadata with no functional mutation controls. Platform capability is irrelevant to this decision. Only the membership-resolved Organization supplies role authority; advisory selected metadata is never substituted into that authorization context. Same-Organization membership refresh can remove writer controls without a tenant switch. Project and Style versions remain independent.

Metadata editing is separate from lifecycle commands. ACTIVE metadata saves use the exact loaded baseline version and ACTIVE status. Archive/reactivate uses the current confirmed server metadata unchanged and its current version. Dirty metadata must be explicitly reset before a lifecycle command. Archived metadata is read-only; Project reactivation remains available to writers; Style reactivation additionally requires ACTIVE Project. Archived parents disable all Style mutations without hiding recorded children. No automatic child activation occurs.

Every workspace mutation uses retry:false, including create and both update command types. No idempotency key or automatic replay is invented. Transport status0 preserves draft and explains that the outcome is unknown; bounded collection absence does not prove create failure. Explicit HTTP outcomes remain ordinary safe ApiError states.

## Errors and conflict reconciliation

403 aborts/removes that Organization's private context/cache/mutations, clears its selected display if applicable and unmounts drafts/conflicts immediately. The route shows access denied and a link to Organization selection. It neither retries continuously nor clears global supply data. Membership disappearance also invalidates the active context.

404 is a bounded missing-resource/hierarchy result with no foreign labels. Existing ApiErrorState and safe requestId rendering are reused; SQL, constraint names, raw bodies and credentials are never shown.

Metadata 409 preserves the original draft and baseline, refetches server state and displays comparison. Use latest explicitly discards the draft; Reconcile draft with latest explicitly adopts the compared version while retaining draft text for a **later separate Save**. The failed request is never replayed automatically. Latest role/entity/parent lifecycle is reevaluated before enabling submission. Failed comparison refetch retains the draft and blocks stale reconciliation.

Lifecycle 409 is separate command reconciliation: refresh current status/version, show a conflict notice and require an explicit new action if still permitted. It fabricates no metadata-draft comparison.

Every Style 409 on detail refreshes **both Project and Style**. A newly archived parent immediately makes Style read-only while preserving any metadata draft for comparison. Refetches and their UI effects remain generation-guarded, including A→B→A. Switching Organization removes the old conflict panel.

## Read-after-write and fanout

Project create/update invalidates only its initiating Organization's Project collection and relevant detail. Style create/update invalidates only the initiating Project's Style collection and relevant Style detail. Parent detail is refreshed for Style conflicts, without fabricating a Project version increment. No global workspace/supply invalidation occurs.

Representative requests confirmed by component/browser coverage:

| Context | Private GET fanout |
| --- | --- |
| Projects entry | 1 collection GET, after 1 membership GET |
| Next/Previous | 1 collection GET at requested offset |
| Project detail | 1 Project GET + 1 Style collection GET |
| Direct Style detail | 1 Project GET, then 1 Style GET, after membership |
| Directory with 25 mocked rows | 1 collection GET, 0 row detail GETs |
| Style 409 reconciliation | 1 Project refetch + 1 Style refetch |

Fresh nested-route tests assert parent-before-child ordering. No batch API, virtualization, storage framework, new dependency or infrastructure is introduced.

## Regression, fixtures and visual review

Focused tests cover direct/deferred/invalid membership and selected→URL adoption; scoped keys; A→B and ABA reads/mutations/conflict refetch; controller abort; memory-only drafts; Actor/logout isolation; global supply preservation; owner/admin/viewer; archived reads; invalid versions; explicit pagination/create reset; and distinct metadata/lifecycle 409 recovery with parent refresh.

Existing Organization tests retain their assertions and add return navigation because selection now enters Projects. No existing frontend or browser regression is removed. Backend tests, including accepted Phase 2A correction/Modulith coverage, are unchanged.

Browser prerequisites use existing test-only local PostgreSQL fixture provisioning for VIEWER membership and PLATFORM_ADMIN-only identity. Organization/Project/Style prerequisites use real APIs. The principal writer test creates its own Organization, Project and Style through the UI, edits metadata and exercises archive/reactivate/read-only behavior. Other real-browser cases cover VIEWER/admin-only denial, delayed A read and ABA, authorized deep-link display synchronization, genuine metadata/lifecycle conflicts, concurrent parent archival and scoped wrong-parent 404.

Same-origin and configured separate API-origin suites run against the final baseline backend in an isolated local synthetic database. There is no production seed API or backend fixture code. Ignored review images cover 13 new states per origin (desktop/mobile/tablet, profile, lifecycle, viewer, access denied and conflicts); screenshots are not committed. Horizontal overflow assertions accompany all captures; keyboard Organization selection and existing route-focus/skip-link regressions are exercised.

## Validation and stop boundary

| Gate | Actual observed result |
| --- | --- |
| Local backend `./mvnw -B verify` |268 passed; failures/errors/skips 0; build successful |
| Local frontend typecheck / Vitest / build |Passed; 918 tests / 23 files |
| Same-origin Playwright |38 passed |
| Separate-origin Playwright |38 passed |
| Official export-openapi.sh |Passed; OpenAPI and generated TS zero diff |
| Migrations / protected files |V1–V13 byte-identical to fa63cbc; no V14+; backend/dependencies/infra/workflows unchanged |
| Terraform fmt / init -backend=false / validate |Passed locally; no edits |
| Diff / standalone Gitleaks |Passed; staged changeset scanned by standalone Gitleaks, no leaks found |

One preliminary unit run overlapped browser/visual execution and hit the existing curation lazy-page wait deadline while still showing Loading page. No existing test, timeout or production curation behavior was changed; the final isolated full unit run passed all 918 tests.

Exact final implementation SHA, clean local/origin equality and exact-head push SOURCE OS CI are verified after the single implementation commit and reported in the completion message. Baseline correction CI is not substituted for implementation CI.

Not implemented: Phase 2C Requirement/V14, Material Selection, Facility Candidate, Development Reference, Pattern, Measurement, Tech Pack, BOM, RFQ/quotations, contracts, payments, production/QC/shipment or other future workflows. No PR, merge or Phase 2C begins in this task. Stop for independent Phase 2B review after exact-head CI succeeds.
