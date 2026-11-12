# Measurement cancellation-safe history recovery — IA-DF01-04

This correction is authorized by `SOURCE-OS-3G-DF01-IA-04-CORRECTION-v1`, starting
at `02d12a1640763f4951c41f033c8adcb4bdfcc83b`. It supplements the
[IA-DF01-03 correction](phase-3g-df01-ia03-correction.md). Author verification and
delivery do not constitute independent reacceptance or parent-defect closure.

## Defect and authority distinction

A legitimately dispatched first history read could be cancelled while its raw
cache contained an unproven page. That window then had a cache failure, no
accepted envelope, and no network failure. After head/cursor advancement, the
recovery recipe required the very envelope that the user needed to authenticate.
The independently reproduced cases used head 3→4/window 3 and a retained draft
at head 30→31/window 5. Normal pagination through window 6 did not recover 5.

The registry still owns separate cache/network failures and all immutable facts.
Cancellation is not a server rejection or response acceptance. Request intent,
retry eligibility, and authenticated response validation are separate controls.

## Bounded legitimate request provenance

The existing typed history hook invokes `runMeasurementHistoryRequest()` inside
its workspace transport, immediately before its existing API GET. This function
requires an opaque live receipt, current registry epoch/context, trusted Spec
identity, exact matching Spec UUID, a positive safe maximum no greater than the
trusted head, and page limit 1–100. A receipt dispatches at most once. Its request
fields are copied and frozen when issued, preventing later alias substitution.

An unknown window's authorized invocation records only its Spec UUID, maximum and
limit in the existing registry. It does not register history, manufacture a
network failure, recover a cache failure or allow rendering. A QueryClient-wide
256-attempt limit bounds these records without evicting active facts or attempts.
Accepted windows no longer need their attempt record; successful acceptance
removes that exact redundant record. All records disappear with their owning
registry on legitimate retirement, Actor/session/Organization/generation change,
or the existing bounded orphan lifecycle. No browser persistence is introduced.

An invocation recorded just before physical HTTP dispatch proves application
request intent only. Cancellation immediately afterward can prevent any server
request or response. A signal already aborted before invocation records nothing.
Neither case authenticates history. In-flight cancellation and Query eviction
preserve legitimate attempt eligibility in the active registry. New retries still
require their own current, single-use receipt and the original transport.

## Exact recovery and cache-only prerequisites

A currently failed history channel may expose its exact authenticated retry when
it has an accepted envelope, a matching network failure, or a legitimate request
attempt. The original context, Spec, maximum and limit are revalidated before the
request. Descriptors remain weakly bound to QueryClient/context/epoch/channel;
clones, stale descriptors and cached objects cannot mint that binding.

An injected, requestable cache-only window without matching attempt provenance
still receives no recovery capability. Its attainable prerequisite is a separate
explicit **Request authoritative history** workflow. The user chooses bounds
against the trusted Spec, then separately clicks **Load selected history window**.
Choosing bounds creates no request provenance, facts or GET. Only the actual
normal typed request invocation records intent. Its validated response uses the
same acceptance path as ordinary history and recovery; cache contents are never
promoted. The fields default to the authenticated head and limit 25, rather than
a target supplied by an arbitrary cache entry. An explicit existing Spec refresh
is available if Spec identity/head must first be authenticated.

Keys with malformed, unrequestable bounds do not identify an application history
request and create neither a failure channel nor a retry capability. Unobserved
future cache keys outside the authenticated head likewise cannot manufacture
request authority or an unreachable channel. They remain untrusted: mounted
selectors, typed-request target validation and the synchronous final write guard
continue checking actual application requests. Valid-shaped unknown windows
within the trusted head remain rejected until their exact authoritative read.
The existing untrusted-cache regression retains its attacks and all capability
rejection assertions; it now explicitly asserts malformed-key exclusion instead
of counting that non-request as a third failure channel.

## Atomic response acceptance and cancellation

All ownership, immutable summary/full-POM, timestamp, pagination coverage and
resource checks remain on the existing acceptance path. A final live-receipt
check after synchronous validation prevents a cancellation or retirement fault
during validation from committing any partial facts. A cancelled validation does
not become a synthetic network rejection. Existing failure mutation ownership is
otherwise unchanged: only a fully accepted response clears the permitted slot;
Spec reconciliation retains its existing uncertain-mutation rule. Canonical cache
publication follows acceptance, rather than authorizing it.

Concurrent reads share the same immutable authority. A late cancelled completion
cannot accept facts or restore a cleared failure, and a consumed receipt cannot
be reused. Failed valid responses retain their exact blocker and retry path.
No automatic read retry, mutation resend, failure reset or registry retirement
workaround is added.

## UI lifetime, drafts and budgets

The panel labels the exact failed history window even while its prerequisite is
pending. Previously cancelled windows remain reachable after head changes,
pagination, selection, Query eviction and observer remount. The independent read
workflow remains mounted during its own request-provenance notification; that
notification cannot abort its request by replacing the prerequisite UI.

While the independent read observer is open, the panel uses seven recovery rows,
reserving its eighth observer slot. All remaining channels remain reachable by
bounded pagination. Mounting, choosing bounds and paging cause no recovery GET.
Stale actions and callbacks cannot operate or announce into a replacement
workspace. Failed or cancelled explicit reads remain retryable.

Recovery never resets a form, changes POM order/values/notes, changes a baseline,
reconciles, submits or repeats an ambiguous command. Any remaining blocker keeps
the draft read-only and the final write guard closed. A stale baseline still
requires explicit reconciliation, preserving user input, before one explicitly
requested write can proceed.

## Verification and remaining gate

Both original protective independent reproductions are preserved as RED before
production edits and GREEN afterward. New unit/UI regressions cover real typed
request invocation, no cache bootstrap, dispatch/transport/validation cancellation,
mutable request aliases, forgery, epochs, independent channels, failed retry,
Query eviction, StrictMode, Actor/Organization ABA, bounded attempts/observers,
retained drafts and explicit reconciliation followed by a valid write. The old
independent diagnostic that expected the now-removed missing action is preserved
unchanged in intake; its copied current-contract replay now uses the available UI
retry instead of a test-only programmatic refetch.

The correction report records actual focused/full frontend, backend, both-origin
Chromium and real-expiry results, generated-contract/migration preservation,
Terraform, secrets and exact-head CI. Historical independent reports remain
historical; their interrupted packaging is not relabelled as final acceptance.
A separately initialized reviewer must reaccept the delivered exact SHA.
IA-DF01-03 and parent 3G-DF-01 remain unclosed. Phase 3G remains PAUSED /
DEFECT-STOP, no G1–G6 or Phase 4 is authorized, and 3E-R02 remains LOW /
NON-BLOCKING / OPEN.
