# Measurement authenticated failure ownership — IA-DF01-02 correction

Specification: `SOURCE-OS-3G-DF01-IA-02-CORRECTION-v1`.
Starting implementation: `028074942d914d67fed66a06ea7331b8f15b50e8`.
Finding: `IA-DF01-02`, MEDIUM / BLOCKING.

## Failure and scope

The previous registry mixed cache-validation and authenticated-request failures.
A cache failure followed by a valid cache replacement could remove the network
failure for that channel. The independent reproduction reached a revision POST
without a successful authenticated recovery. Cloning and validating the cache
did not authorize that recovery.

The correction separates `cacheFailures` and `networkFailures` inside the existing
QueryClient-owned, authenticated Measurement registry. Actor/session,
Organization, workspace generation, Project and Style scope, immutable facts,
receipt ownership, history coverage and existing resource limits are preserved.
No backend, database, migration, storage or generated contract change is required.

## Ownership and recovery

| Operation                                                                   | Cache failures                                  | Authenticated failures                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Query-cache event or selector validation                                    | Sets or clears only the matching cache channel  | Cannot change them                                             |
| Current authenticated request rejection or rejected authoritative candidate | Does not recover cache failures                 | Sets the matching request channel                              |
| Fully validated authenticated acceptance                                    | Clears the accepted channel                     | Clears only the accepted channel                               |
| Authenticated Spec reconciliation                                           | Clears Spec and ambiguous-mutation channels     | Clears Spec and ambiguous-mutation channels                    |
| Query deletion, recreation, observer remount, rerender                      | May revalidate cache provenance                 | Cannot recover them                                            |
| Legitimate registry retirement                                              | Removes the retired registry with all its facts | Removes the same retired registry; old receipts remain invalid |

History channels include their maximum and page limit; exact-revision channels
include the revision UUID. A successful Spec read does not recover an unrelated
history or exact-revision failure. There is no blanket failure reset. Acceptance
performs its identity, full-content, coverage and resource checks before
committing facts and clearing the permitted channel.

The final write guard still examines all blocking failure channels immediately
before issuing HTTP. A previously selected valid object or a successful raw
Query status cannot bypass that guard.

## Presentation, drafts and explicit recovery

Query hooks expose channel-specific authenticated recovery state separately
from React Query's cache status. A valid cache replacement can make a raw Query
successful while its authenticated failure remains unresolved. The affected
view continues to expose its safe error and explicit retry action.

The recovery signal is added through a transparent observer-result wrapper.
Other properties still use TanStack's original tracked reads: the wrapper does
not eagerly spread every result property or mutate the underlying result.
Existing consumers, including the Pattern workspace's Measurement picker, keep
their error and selection behavior. Raw cache aliases remain revalidated.

Read navigation and recovery remain available while editing and submission are
blocked. An existing legitimate draft is retained read-only. A successful retry
recovers only its own channel; another failed channel keeps editing blocked.
An ambiguous mutation retains the existing explicit reconciliation workflow:
authenticated Spec recovery does not silently rebase or resend the draft.

No new automatic retries, protected downloads, persistent browser storage or
global cache clearing are introduced.

## Regression evidence and acceptance boundary

The original independent three-case reproduction is retained outside the source
tree and rerun against both the vulnerable and corrected implementations.
`NetworkFailureOwnership.test.ts` exercises separate channel ownership, both
failure orders, cache removal/recreation, concurrent response order, final write
authorization, retirement and orphan retention. The accompanying `.test.tsx`
exercises actual Measurement views and transport: retained drafts, no POST
before recovery, successful explicit recovery, independent channels, ambiguous
mutation and shared observers including Strict Mode.

The delivery evidence report records actual focused/full verification results,
browser origins including real expiry, preservation hashes and exact-head CI.
Correction-author verification is not independent acceptance. Independent
correction reacceptance remains required. Phase 3G stays PAUSED / DEFECT-STOP;
G1–G6 and Phase 4 are not resumed. `3E-R02` remains LOW / NON-BLOCKING / OPEN.
