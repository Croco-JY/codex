# ADR 012: Style-owned Pattern identity and immutable revisions

Status: Accepted planning decision; implementation remains future and requires separately approved Phase 3 slices.

## Context

The accepted Phase 2 workspace supplies the canonical Organization → Project → Style hierarchy. Downstream decisions must identify the exact immutable development revision that existed at the time, rather than reconstruct history from latest or a replaced file. See the [Phase 3 contract lock](../phase-3-plan.md) for integration provenance, slice ownership and validation requirements. The master specification's SOURCE Pattern Operations is deterministic Phase 3; AI remains Phase 4.

## Decision

- Style.id remains canonical design identity. A Style may own zero or many Patterns; there is no independent/global private Pattern project tree. All IP inherits Organization membership and full scoped hierarchy authorization, with no PLATFORM_ADMIN bypass.
- Pattern is stable business identity. PatternRevision is an exact immutable full snapshot with server-generated identity and parent-unique server-assigned revisionNumber 1,2,3,... . Pattern creation atomically commits Pattern + complete revision 1 + revision children + Organization audit. No normal zero-revision Pattern shell; any first-revision failure rolls back the aggregate.
- Initial revision history is linear, independently reconstructable and durable, with no substantive in-place edit, ordinary hard delete, DAG/fork/merge or overwrite. Current/latest is derived by descending revision number; no duplicated mutable currentRevisionId pointer.
- Creating a later revision locks Project → Style → Pattern before latest determination and requires expectedLatestRevisionNumber. Two writers based on N yield one N+1 and one 409, never a silent N+2 from stale input. Losing or ambiguous commands require explicit refetch/reconciliation; retry:false.
- An optional MeasurementRevision reference must belong to the same Style. Authorize/request-scope before resolving it; foreign Style is 404. 3A/3B must establish a practical DB-enforceable ownership constraint and direct DB tests, not an unchecked UUID protected only by Java.
- A 3B metadata-only revision is permanently artifactless. 3C cannot retrofit a file into it. Introducing/replacing an artifact creates a new PatternRevision with immutable artifact association/object identity/metadata. Create-only AuthorizedStorage prevents overwrite; operational PENDING→READY/FAILED does not mutate revision content. Exact protocol/schema belongs to 3C.
- QA assesses an immutable revision; bounded quality transitions require truthful evidence and audit. PatternRelease pins an exact revision/recipient/context and grants only authorized access, not latest/public sharing, production approval, commercial award or IP transfer.

## Consequences

The aggregate lock and stale-head precondition deliberately prefer explicit conflicts over silent branching. Complete snapshots use more storage but preserve independent historical meaning. Artifact upload needs separate reservation/storage/finalization transactions and retained failure tracking; it cannot be modeled as a single SQL/storage atomic commit. No physical GC or larger file limit is authorized here.

StyleDetail keeps its four existing Phase 2 child reads. Future Pattern/Measurement/Grading/Release screens use lazy private contextual routes, strict runtime validation and Actor/Organization/route generation isolation. Phase 3 PLAN creates no table, endpoint, enum, parser or UI. Tech Pack/BOM/Sample and paid Pattern Service/pricing remain separate roadmap decisions. Future slices must test revision-1 atomicity, stale-head races, immutability, scoped references, archive/revocation and binary authorization before they implement this decision.
