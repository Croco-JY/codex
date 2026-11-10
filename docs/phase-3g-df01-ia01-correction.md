# Measurement immutable trust correction — IA-DF01-01

This record describes the narrowly authorized follow-up to the DF-01 correction. It does not resume Phase 3G cumulative hardening or constitute independent acceptance. The starting implementation is `8eeb12e131af088e97c7ce55f235e29aace248a7`, whose parent `0b1e918b0a3f1a1d55fc982aa10403f66c2343df` corrected foreign-Style cache selection. The subsequent commit changed documentation only.

## Finding and scope

The independent review reproduced three additional failures: a same-ID Spec could replace immutable latest-revision POMs and initialize an editable draft; a same-ID history row could relabel trusted summary metadata; and a same-ID exact revision could replace complete POM facts. Structural/scope validation and detached copies prevent malformed, foreign or alias-mutated selections, but cannot prove that a new valid-shaped cache object agrees with earlier authenticated observations.

The correction changes only Measurement frontend provenance, immutable comparison, rendering/draft safety and directly associated tests. Backend authorization, migrations V1–V23, generated API contracts, storage, PatternRelease and infrastructure remain outside the correction.

## One shared authority

`measurementTrust.ts` owns an in-memory `WeakMap<QueryClient, Store>`. A registry key includes the authenticated session scope, Organization, workspace generation, Project and Style. The first authenticated Spec or revision observation binds its MeasurementSpec ID. Individual Query objects and hook observers do not own alternate immutable baselines.

The registry stores detached, deeply frozen projections of:

- Stable Spec identity and exact creation timestamp.
- Revision UUID/number indexes, exact summary fields and complete ordered POM snapshots.
- The most recently authenticated Spec head, independent of historical immutable facts.
- Pinned history windows with exact ordered membership, page limit and continuation.

Values, tolerances and timestamps are compared as exact serialized strings. No floating-point or lossy JavaScript Date conversion determines immutable equality. Summary and full-revision observations must agree in either order. Revision UUID and number collisions fail closed.

## Network provenance and atomic registration

Each request obtains a single-use opaque receipt bound to the current registry epoch, authenticated context, request identity and AbortSignal. Only a response obtained through the existing workspace transport, with current generation and uncancelled signal, can register unknown facts, absence, a head or a history window. Retired or consumed receipts cannot register data.

Existing structural validators remain the first validation layer. All identity, full-content, cross-window coverage and resource-budget checks run against staged maps before any live snapshot is replaced. A rejected response consumes its receipt but does not partially register its candidate facts or invalidate another compatible in-flight receipt.

Selectors validate cache candidates against those registered snapshots and return the private immutable projection. An unknown valid-shaped cache object, including `null`, is unavailable until authenticated revalidation establishes its provenance. Query remounts use network revalidation when provenance is absent. Measurement queries retain their existing scoped keys, caching and `retry: false`; local structural sharing is disabled so a mutable raw cache alias cannot alter trusted selected objects.

## Head advancement and pagination

An authenticated Spec response may advance from revision N to N+k, allowing intervening writes by other authorized users. It must preserve stable Spec identity and every previously known revision's immutable meaning. Cache data alone cannot introduce a new head; authenticated older-head regression and UUID/number substitution are rejected. A newer authenticated summary or exact revision also prevents an older Spec from authorizing edits until the Spec comparison catches up.

History windows remain immutable. Known revision numbers and inclusive continuation witnesses constrain every accepted window in both directions. A full page can exclude older facts only with a continuation that can still reach them; short pages, false EOF, changed prefixes and contradictory pagination envelopes are rejected. Different legitimate page sizes, lower requested maxima and newly created heads above an older window remain valid.

## Rendering and drafts

The Spec, history and exact-detail selectors enforce the same registry. Rejected history has no enabled selection rows, and contradictory exact POMs never become selected facts. The Spec view revalidates retained selected data instead of treating `query.data` presence as authority.

A legitimate user draft can remain visible and unchanged during a contradiction or outage, but editing, submission and rebasing require a valid current comparison. Network failures and cache failures are tracked separately: restoring a cache entry cannot clear a rejected-network condition. Explicit authenticated recovery clears that condition. The final write guard also checks active raw query values and query errors immediately before sending a command, closing the interval between a cache update and React's batched rendering.

Normal stale-head conflict handling and explicit reconciliation remain intact. No ambiguous mutation is automatically resent.

## Lifetime, eviction and isolation

Hooks retain owners for their authenticated Measurement context. Query removal, pagination and one observer's unmount do not erase facts while another current owner remains. Query recreation consults the same registry. Workspace invalidation makes old receipts unusable; a new generation receives a separate epoch. Separate QueryClients never share private facts.

After the final owner ends, a context can survive only for matching cached queries and ordinary remounts, with a maximum orphan retention of five minutes. Removal of the last matching cached query retires an unowned context immediately. Strict Mode effect replay can reuse a compatible cached context without creating competing truth. Cleanup never drops an active context's facts to make room.

Per QueryClient budgets are 16 contexts, 4,096 revision facts, 8,192 full POM rows and 256 windows. Exceeding an active budget fails closed without partially registering data. Private snapshots are never persisted to browser storage. These limits can require ending an exhausted context and authenticated revalidation; they do not weaken backend authorization.

## Regression preservation and evidence

The original three independent reproductions are retained externally as RED baseline evidence. The correction adds registry unit tests and actual React Query/workspace integration tests for immutable substitutions, reverse observation order, head advancement, atomicity, shared observers, Query recreation, cancellation, Strict Mode, cleanup and recovery. The original foreign-Style regression and eight interrupted Phase 3G files/safety archives are preserved.

The earlier cache test that expected contradictory history metadata to render before selecting it now requires rejection before rendering or selection, retaining its attack setup. The Measurement test fixture now retains each previously served immutable revision when its mock head advances; previously it could drop an already observed revision and falsely claim EOF. Existing application assertions are preserved.

Execution counts, original failure logs, final-source verification, browser origins, exact-head push CI and artifact SHA-256 values belong in the correction evidence report. Correction-author regression is not independent reacceptance. Independent correction reacceptance remains required; Phase 3G remains paused and `3E-R02` remains LOW / NON-BLOCKING / OPEN.
