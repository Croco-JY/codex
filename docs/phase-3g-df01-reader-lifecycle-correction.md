# Measurement reader lifecycle — targeted correction

This correction starts from `ed7728296976c9e3f52d36681012ab1baf42939f`
under the user's Targeted React Query Reader Lifecycle Correction mandate.
It changes only Measurement reader registration and synchronous write
validation, with directly associated regression tests. Implementation-author
verification is not independent reacceptance.

## Original failure and scope

The preserved focused regression demonstrated a declaration referencing an
inactive Query while its native observer referenced another active Query.
Registration had failed to locate the hook's observer and captured a fixed
cache Query instead. Once that captured Query had zero observers, the guard
skipped it. An evicted active Query whose namespace/hash had changed could also
escape the additional cache scan. The synchronous guard returned successfully.
That reproduction issued no POST or PUT and retained its legitimate draft;
it must not be described as an observed unauthorized HTTP mutation.

The original test and evidence remain outside tracked source, with SHA-256
metadata and unchanged assertions. An import/output-path adaptation reproduced
RED against the immutable starting archive before production changes and GREEN
against the correction. Earlier diagnostic fixtures that failed to establish
the intended native-observer state are retained separately.

## Actual observer ownership and fail-closed validation

`useMeasurementReadBoundary` binds the hook's matching native QueryObserver
using its private per-hook metadata token. If registration initially cannot
find that observer, it returns no Query until the observer can be identified.
It may resolve that same owner later through the expected cache entry, so an
ordinary replacement does not permanently disable editing. Once found, the
native observer's `getCurrentQuery()` follows replacement and eviction. The
returned Query must still contain that observer. A cache entry alone never
stands in for a native reader, and this declaration authenticates no facts.

The synchronous shared predicate rejects every live declaration that cannot
resolve an observed Query, including a stale zero-observer target. The separate
cache scan still ignores harmless inactive entries and independently checks
active matching Queries. The existing full key/hash, scope, status, provenance,
immutable-fact and failure-channel checks remain in force. No failure is cleared
and no snapshot, receipt, budget or draft is reset by reader resolution.

Cleanup removes only the exact declaration created by its lifecycle. StrictMode
effect replay, remount and workspace-generation replacement use the existing
owner/context lifetime. Old cleanup cannot remove a newer declaration for the
same owner.

## Regression obligations

The dedicated rendered tests exercise registration-time eviction/replacement
with and without StrictMode. They verify the actual missing-observer condition,
native replacement, synchronous rejection, and zero POST/PUT during forced
submission while the unsafe reader remains active. Draft values and baseline
remain unchanged. After restoring actual ownership and authenticated reads,
explicit reconciliation preserves the draft and exactly one explicit valid
revision write succeeds with the expected baseline and user value.

Direct guard tests require unresolved and zero-observer declarations to remain
blocking until their own cleanup, and protect replacement declarations from
stale cleanup. Existing remount, generation/Actor/Organization isolation,
immutable-trust, recovery ownership and history-budget regressions remain
required. The external delivery report records actual focused and full results,
both browser origins, integrity checks and exact-new-head CI.

## Acceptance boundary

No backend, V1–V23 migration, generated API contract, immutable-fact validator,
history-attempt budget, protected recovery policy, PatternRelease or File
Gateway change is included. The five historical harness failures remain open
for their separate evidence-based disposition. IA-DF01-06 remains LOW /
NON-BLOCKING / QUALIFIED; 3E-R02 remains LOW / NON-BLOCKING / OPEN.

A fresh independent reviewer must assess the original reader-lifecycle
regression at the delivered SHA. This correction does not close 3G-DF-01,
complete the interrupted independent acceptance, or resume Phase 3G. Phase 3G
remains PAUSED / DEFECT-STOP; no Phase 4 work is authorized.
