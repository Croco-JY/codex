# Measurement final write guard and bounded history progress — IA-DF01-05/07

This scoped correction implements `SOURCE-OS-3G-DF01-IA-05-07-CORRECTION-v1`
from `1d978c1fd1b2b7becfa4bb54fd07016463cbc1f4`. It supplements the
[IA-DF01-04 correction](phase-3g-df01-ia04-correction.md). Correction-author
verification is not independent reacceptance or authorization to close the
parent defect or resume Phase 3G.

## Independent findings and original evidence

The fresh IA-DF01-04 reviewer reproduced two blocking defects. A mutable active
history Query with a NaN maximum was skipped when its request parser returned
undefined; a synchronous final check and forced form submission reached one
POST. The unchanged pre-IA-DF01-04 parent blocked that identical attack with zero
POSTs. Separately, 256 cancelled, unaccepted history attempts could consume the
entire attempt budget. A subsequent history read failed before transport while
a legitimate draft remained blocked and the separate history workflow was
closed. Every visible failure already had an eligible descriptor, so the UI did
not expose the prerequisite workflow that could release capacity.

The original reviewer tests, failure records, parent control, traces and integrity
index remain in the external correction evidence. Their historical assertions
are preserved. The corrected progress test repeats all 256 actual typed
cancellations and retains the draft/baseline and forced-submit protections. It
now requires the next authenticated read to proceed: expecting transport to stay
blocked after safely reclaiming redundant records would contradict the newly
authorized lifecycle. No security TTL, resource limit or protected retry is
weakened to obtain that result.

## One synchronous active-query condition

The registry distinguishes Measurement-family namespace membership from a valid
request recipe. Canonical Spec, history and exact-revision keys and their exact
explicit-history/explicit-recovery variants are recognized. Unsupported suffixes,
invalid identities, nonnumeric or unsafe bounds, a maximum above the trusted
head, and invalid limits cannot fall through as unrelated queries.

The same synchronous predicate gates editing availability and final mutation
authorization. It examines active raw Query state, full key shape, key/hash
consistency and authenticated provenance. Undefined raw data cannot authorize an
unknown window or unknown full revision. Error state, contradictory data and
unproven content deny the write. Existing channel failures remain separate and
blocking. No disabled button, previously selected object or success status can
replace the final guard immediately before HTTP.

Each actual application hook also registers a lifetime-bound declaration of its
expected key and native QueryObserver target. These declarations own no immutable
facts and authenticate no cache contents. They prevent a mutable namespace, hash
or evicted Query from hiding the actual reader. Unmount removes the declaration;
workspace retirement removes its registry. Query identity still does not own
immutable Measurement truth. Ordinary healthy eviction does not cause a new
refetch merely to announce a guard condition.

Unrelated workspaces/resources and inactive malformed entries do not block a
write. A malformed active alias is a volatile authorization condition, not a new
persistent failure channel. Out-of-head history aliases cannot mint an
unrequestable recovery obligation through cache events or selectors. Removing
the unsafe observer and recreating valid authenticated reads permits legitimate
work again; it does not clear a genuine network failure.

## Bounded attempt lifecycle

The same QueryClient/context/epoch registry retains at most 256 history-attempt
records. Each record contains frozen typed target identity and a scalar count of
outstanding receipt lifecycles. It is not a second provenance store. Dispatch
increments that count; cancellation or receipt acceptance/rejection settles it
once. Receipt processing and AbortSignal ownership remain single use. No strong
registry collection of outstanding receipt objects is added.

Before refusing a new unknown window at full capacity, admission deterministically
reclaims settled records with neither a cache failure nor a network failure.
It never reclaims a pending receipt's record or an unresolved retry obligation,
never removes trusted facts and never clears a failure. Accepted windows remove
only their own now-redundant attempt metadata. Context retirement still ends its
old provenance; it is not used as a capacity workaround.

When all records protect pending reads or outstanding failures, admission stops
before invoking transport. The rejected receipt is consumed and cannot later be
replayed or accepted. This local capacity condition does not manufacture a
server/network rejection. The safe message explains that the user can retry an
existing failed window, or wait for/cancel an outstanding read, then retry the
original request. Existing exact retries reuse their existing slot. Recovery
rows remain reachable through the existing bounded pagination even with the
separate workflow closed. Accepting one such response frees that slot without
clearing unrelated channels. When no failures or in-flight receipts remain,
settled metadata cannot permanently strand the next authorized history read.

## Drafts, context and regression boundary

No guard check, admission, reclamation or read recovery resets draft values,
notes, tolerances, POM order, mode or baseline. Head advancement still requires
explicit reconciliation before a stale draft can submit. Recovery sends no
POST/PUT, and no ambiguous mutation is replayed. The combined regressions retain
independent failure channels while resolving capacity and reject a concurrent
malformed active Query. Genuine explicit submission remains possible after the
applicable blockers and baseline restrictions are resolved.

Actor/session, Organization, generation, Project, Style, QueryClient and epoch
boundaries, immutable facts, inclusive pagination coverage, descriptors,
cancellation-safe transport, and existing receipt checks remain in force.
Backend, V1–V23, generated contracts, PatternRelease, File Gateway and deployment
are unchanged. Original Phase 3G interrupted tests and safety archives remain
preserved.

IA-DF01-06 remains LOW / NON-BLOCKING / QUALIFIED. Its reviewer narrative concerns
a deliberately side-effecting current-context provider reentering synchronous
staged acceptance; no ordinary remote production path was established. The
production provider remains pure. This correction does not redesign that
provider/acceptance boundary or relabel the observation closed. Changed admission
and guard boundaries receive focused cancellation, concurrent-slot and epoch
regressions; the original LOW diagnostic remains in the evidence.

The external A–P delivery report records actual RED/GREEN, full verification,
both browser origins including real expiry, preservation hashes and exact-head
CI. A fresh independent reviewer must assess the delivered SHA. IA-DF01-05/07,
the other DF-01 regressions and parent closure require their separate decisions.
Phase 3G remains PAUSED / DEFECT-STOP. No G1–G6 or Phase 4 resumption follows.
`3E-R02` remains LOW / NON-BLOCKING / OPEN.
