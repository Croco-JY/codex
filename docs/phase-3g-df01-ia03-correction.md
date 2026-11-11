# Measurement recovery accessibility — IA-DF01-03 correction

This records the frontend correction authorized by
`SOURCE-OS-3G-DF01-IA-03-CORRECTION-v1`, starting at
`42068788ab18d3cdf7ee444bef030a34ddef4cd3`. It supplements the
[immutable-fact correction](phase-3g-df01-ia01-correction.md) and
[authenticated failure ownership correction](phase-3g-df01-ia02-correction.md).
Correction-author verification is not independent acceptance.

## Failure and retained authority

A failed authenticated history read through revision 3 remained a write blocker
when an authenticated Spec refresh advanced the visible history head to 4. The
old window's retry was no longer visible. A healthy current window and compatible
cache replacement could not recover the old channel. That failure ownership is
intentional; the missing recovery action was the defect.

The QueryClient-owned Measurement registry remains the single authority for
immutable facts, history coverage and separate `cacheFailures` and
`networkFailures`. The final write guard is unchanged. This correction does not
clear failures on cache success, forget an inactive failed window, retire an
active context, or introduce a second failure registry.

## Registry-derived discovery and scope

`measurementRecoveries()` projects the union of existing failure channels without
creating queries or network requests. It returns at most eight deeply read-only
descriptors per presentation page, the outstanding total and the trusted head.
History descriptors preserve the original maximum and limit; exact revision
descriptors preserve the revision UUID. Spec and uncertain-mutation channels use
the existing authoritative Spec reconciliation semantics.

A private WeakMap binds each descriptor to its QueryClient, authenticated context
key, registry epoch and exact outstanding channel. The context includes Actor and
session scope, Organization, workspace generation, Project and Style. Public
fields cannot mint a recovery capability. A forged clone, another QueryClient,
a retired epoch or an old workspace cannot execute it. The request recipe is
re-derived from current registry facts immediately before issuing a receipt.

Missing trusted Spec/revision identity, invalid bounds or a history bound above
the authenticated head produces an explicit prerequisite explanation instead of
an executable request. An unknown cache key cannot bootstrap authoritative facts.
The existing registry resource budgets, owner lifetime, bounded orphan retention
and retirement behavior are preserved. No private facts are persisted in browser
storage. Descriptor bindings are weakly owned and duplicate no failure state.

## Explicit authenticated recovery

The Measurement workspace lists outstanding failures even after head advancement,
selection changes or history navigation. An already visible failed view retains
its normal retry. Hidden windows and revisions receive a labelled Reload action;
pagination keeps no more than eight recovery observers mounted per panel.

Recovery observers reuse the existing typed Spec, history and exact-revision
hooks. They are disabled until the user explicitly clicks. Their scoped query
keys append `explicit-recovery` and the channel to the existing canonical key so
that a disabled recovery observer cannot disable normal canonical refetches.
Requests use the original workspace transport, cancellation, current-generation
checks and receipt validators, with `retry: false`.

Only a fully accepted authenticated response is published to the corresponding
canonical query. That publication propagates already trusted facts; the cache
write does not authenticate recovery. The existing atomic trust commit clears
only the permitted channel, and Spec reconciliation retains its pre-existing
ambiguous-mutation rule. A failed or aborted retry neither partially registers
facts nor removes its recovery obligation.

The panel announces pending, in-progress, failed and recovered requests and
whether other blockers remain. Its bounded prior-descriptor list is presentation
state only. Pending button state follows the explicit operation, so removing a
Query cannot strand the retry in a permanently disabled state. Retired row
callbacks cannot announce into a replacement workspace.

## Drafts and reconciliation

Recovery does not submit, retry a mutation, reset a form, select another revision
or rebase a draft. Existing text and the original baseline remain intact. Any
outstanding failure continues to block editing and the final write guard. After
read recovery, a baseline different from the trusted head still requires explicit
reconciliation before submission. This gate is derived from the registry head,
not from whether a now-unmounted recovery button's callback happened to run.
Reconciliation retains user input and never submits automatically.

## Regression and delivery boundary

The original independent head-advance reproduction is preserved as RED at the
starting SHA and replayed unchanged as GREEN after correction. Focused registry
and UI tests cover exact recovery recipes, failed retries, independent windows,
concurrent completion orders, hidden exact revisions, Query eviction, StrictMode,
bounded observers, cancellation, Actor changes, Organization ABA, retirement,
stale capabilities and explicit reconciliation followed by a legitimate write.
Existing immutable-fact and cache/network ownership regressions remain required.

The correction evidence package records actual commands and counts separately
from historical independent evidence. Full backend, frontend and both-origin
browser verification, including real consent expiry, remain delivery gates.
Independent correction reacceptance remains pending after author delivery.
Phase 3G remains PAUSED / DEFECT-STOP; no G1–G6 or Phase 4 resumption is authorized.
`3E-R02` remains LOW / NON-BLOCKING / OPEN.
