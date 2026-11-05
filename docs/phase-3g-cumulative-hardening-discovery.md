# Phase 3G-0 — Cumulative Hardening Discovery and Proposed Execution Contract

## 1. Status, source and authority

Discovery date: 2026-11-05. Specification:
`SOURCE-OS-PHASE-3F-CLOSEOUT-3G-0-DISCOVERY-v1`.
Repository: `Croco-JY/codex`; branch: `phase-3-pattern-operations`;
original inspected implementation: `5df832526e783cd4b7e875c8be934637b8325b6b`.
Local HEAD, origin tracking, actual remote and live GitHub branch agreed before
the original documentation changes; the checkout was clean and the paginated open-PR count
was zero. [Implementation CI 41801680429](https://github.com/Croco-JY/codex/actions/runs/41801680429)
was push/attempt 1/completed/success with 21 successful steps.

Phase 3G is **Cumulative Hardening**, as defined by the immutable
[Phase 3 plan sections 18–20](phase-3-plan.md#18-ordered-slices-and-migration-ownership).
The default is tests/documentation only, production diff zero, Defect-Stop, no
default migration and no new product capability. This document is a proposed
execution contract, not execution authorization or completed 3G acceptance.
The original documentation delivery created this document and the
[3F closeout](phase-3f-independent-acceptance.md), and updated the
[roadmap](roadmap.md). The reconciliation below changes only this discovery
record and the roadmap; the historical acceptance record remains unchanged.

### Live-baseline reconciliation — 2026-11-05

The repeated closeout/discovery request was reconciled against live branch HEAD
`0b1e918b0a3f1a1d55fc982aa10403f66c2343df`, rather than resetting to the
historical `5df8325`. The intervening commits are:

| Commit | Scope and verified delivery |
| --- | --- |
| `7b1734c58ffa735e7b5b4f2a5000a69ed6cd6fa6` | Original closeout/discovery: exactly three documentation files; [push CI 41972900842](https://github.com/Croco-JY/codex/actions/runs/41972900842), attempt 1, success, 21 successful steps |
| `0b1e918b0a3f1a1d55fc982aa10403f66c2343df` | Separately authorized `3G-DF-01` Measurement cache correction: two production files and two direct regression files; [push CI 41996948719](https://github.com/Croco-JY/codex/actions/runs/41996948719), attempt 1, success, 21 successful steps |

Subsequent authorized cumulative-hardening execution reproduced `3G-DF-01`, a
MEDIUM/blocking foreign-Style Measurement cache-rendering defect, and stopped.
The scoped correction now validates cached Spec/history/exact-revision data with
the existing validators, detaches validated display data from mutable cache
objects, preserves legitimate drafts read-only on errors, and checks selected
revision/summary consistency. See [selectors](../apps/web/src/features/measurement/data.ts),
[rendering guards](../apps/web/src/features/measurement/Measurements.tsx),
[the unchanged original regression](../apps/web/src/test/phase3gCacheIntegrity.test.tsx)
and [32 additional cache cases](../apps/web/src/features/measurement/MeasurementCache.test.tsx).
These tests exercise actual QueryClient replacement, foreign identities, malformed
points/pages, mutable aliases, safe recovery and Actor/Organization transitions.

**Phase 3G remains PAUSED. Independent correction acceptance is PENDING.**
The correction agent's successful tests/CI are implementation evidence, not an
independent acceptance decision. The eight interrupted Phase 3G test files and
their hash-verified safety archive remain preserved; seven unrelated files were
not included in the correction commit. G5/G6 and cumulative acceptance are not
complete. This documentation task neither reviews the correction independently
nor authorizes Phase 3G resumption, production deployment or a later phase.

The correction report records 1,350 backend tests, 1,915 Vitest tests (including
138 focused cases), and 143 Chromium cases per origin, with both actual
fifteen-minute expiry cases completed. These are reused correction-author
executions, not new discovery tests or a replacement for the earlier independent
3F acceptance executions. The current task freshly reverified the original
2,074-payload acceptance archive and live CI metadata; it did not rerun those
historical tests. Raw CI log contents are not inferred from successful metadata.

The accepted 3F baseline and its 23/23 decision disposition remain `5df8325`.
No independent acceptance is silently transferred to the later correction.
V1–V23 and generated API files are byte-identical across these commits. The
production difference between `5df8325` and `0b1e918` is the authorized Measurement
correction; **production-diff-zero for this documentation task is measured from
`0b1e918`**, with that correction preserved. The inventory and G1–G6 proposal below
retain their original discovery provenance; this status note takes precedence
over historical statements that no Phase 3G execution had yet been authorized.

### Contract inventory and precedence

| Authority | Current meaning |
| --- | --- |
| [Phase 3 plan](phase-3-plan.md), especially sections 4–6, 14–20 and 22 | Tenant/revision spine, ownership, request budgets, validation and Defect-Stop |
| [3A Measurement](phase-3a-measurement-foundation.md) | V18 complete immutable POM snapshots and decimal strings |
| [3B Pattern Vault](phase-3b-pattern-vault.md) | V19 Style-owned Pattern identities and same-Style measurement pins |
| [3C Artifacts](phase-3c-pattern-artifacts.md) | V20 new-revision-only retained artifacts and non-XA protocol |
| [3D Grading](phase-3d-grading-foundation.md) | V21 complete immutable ordered exact matrices, including its R01 correction |
| [3E Human QA](phase-3e-human-qa.md) | V22 exact-revision human observations and R01 pinned-history guarantees; 3E-R02 remains open |
| [3F Secure Releases](phase-3f-secure-pattern-releases.md), accepted `3F-0E-signoff-v1` and valid amendments | V23 event-derived consent/release lifecycle, concrete twelve routes, fixed authorization and corrected history trust |
| [3F acceptance closeout](phase-3f-independent-acceptance.md) | Final independent automated acceptance at exact 5df8325; 23/23 PASS and three independently closed findings |
| [Authorization](authorization.md), [contract security](contract-security.md), ADRs [002](adr/002-modular-monolith.md), [006](adr/006-openapi-generated-client.md), [010](adr/010-tenant-isolation.md), [012](adr/012-pattern-revision-model.md) | Public module boundaries, private tenancy, generated contracts and immutable revision identity |

Earlier completion documents retain their historical baselines/counts. Their old
future-tense implementation boundaries are not rewritten into new authority.
Concrete accepted later slice contracts prevail over illustrative earlier routes.
In particular, 3F consent administration is OWNER/ADMIN only; recipient release
metadata/content supports active OWNER/ADMIN/VIEWER. Grading is an independent
Style-owned domain, not an implicit prerequisite for QA or release.

## 2. Evidence method and current coverage status

This discovery inspected production services/providers, migrations, frontend
hooks/models/routes and named test bodies/assertions at the exact source. It did
not execute new Phase 3G tests. `SOURCE_INSPECTED` below means the identified
assertion exists and its behavior was inspected, not that merely finding a class
proves every possible case. `ACCEPTANCE_REUSED` means the actual final-SHA
execution/integrity lineage in the closeout was verified. `PROPOSED` means future
work with no PASS claim. A gap is a coverage opportunity, not a confirmed defect.

The acceptance ZIP and all 2,074 indexed payloads were available and freshly
rehashed/CRC-checked for closeout. Fresh independent acceptance executions were
1,882 Vitest, 52 external adversarial, 21 same-origin and 22 separate-origin
browser cases, including actual expiration. Reviewed full-regression evidence
was 1,350 backend and 143 browser cases per origin. These remain separate runs.
No additional full backend/browser test count is claimed for this documentation
task. The later exact-head documentation CI is a separate delivery result.

## 3. Actual domain, persistence and module inventory

All paths below refer to current code. SQL owns durable relational invariants;
services own authenticated application policy; frontend validation owns safe
presentation and generation isolation. None substitutes for another.

| Slice | Actual owned truth and source | Current enforcement and limits |
| --- | --- | --- |
| 3A | [MeasurementService](../apps/api/src/main/java/com/sourceos/measurement/MeasurementService.java); [V18](../apps/api/src/main/resources/db/migration/V18__measurement_revision.sql): measurement_spec/revision/point | 0..1 spec per Style; complete sealed revision 1 and ordered POM rows, deferred completeness, per-spec sequence lock, NUMERIC/BigDecimal/decimal-string transport; immutable owner-aware keys. `referenceContext` returns minimal same-Style facts, not points/entities. No geometry or approval state. |
| 3B | [PatternService](../apps/api/src/main/java/com/sourceos/pattern/PatternService.java); [V19](../apps/api/src/main/resources/db/migration/V19__pattern_revision.sql): pattern/revision | ACTIVE/ARCHIVED identity/version, atomic revision 1, complete immutable revisions, optional exact same-Style MeasurementRevision, scoped bounded histories and derived latest. Old artifactless revisions remain artifactless. |
| 3C | [PatternArtifactService](../apps/api/src/main/java/com/sourceos/pattern/PatternArtifactService.java), [transactions](../apps/api/src/main/java/com/sourceos/pattern/PatternArtifactTransactions.java), [probe](../apps/api/src/main/java/com/sourceos/pattern/PatternArtifactProbe.java); [V20](../apps/api/src/main/resources/db/migration/V20__pattern_artifact.sql) | Reserve new revision/PENDING artifact in TX1; create-only authorized storage outside SQL; reauthorize/finalize READY or FAILED in TX2. Immutable revision/object/hash/size; terminal states; retained partial/uncertain history. Ten-MiB limit and bounded structural PDF/DXF probes are not a geometry parser/certification. |
| 3D | [GradingService](../apps/api/src/main/java/com/sourceos/grading/GradingService.java), [models](../apps/api/src/main/java/com/sourceos/grading/GradingModels.java); [V21](../apps/api/src/main/resources/db/migration/V21__grade_rule_set.sql): grade_rule_set/revision/size/rule/value | Complete sealed 2..30-size by 1..100-rule matrices, explicit order/base, exact signed increments, owner-aware same-revision keys and deferred completeness. No geometry application or AI grading. |
| 3E | [PatternQaService](../apps/api/src/main/java/com/sourceos/patternqa/PatternQaService.java), [PatternQaContext](../apps/api/src/main/java/com/sourceos/pattern/PatternQaContext.java); [V22](../apps/api/src/main/resources/db/migration/V22__pattern_qa_assessment.sql) | Append-only exact-revision assessments, authenticated provenance, expected assessment head and winner-only audit. HUMAN_REVIEWED requires the defined READY-artifact attestation; no manufacturing permission. Assessment history is not a revision mutation. |
| 3F | [release service](../apps/api/src/main/java/com/sourceos/patternrelease/PatternReleaseService.java), [consent service](../apps/api/src/main/java/com/sourceos/patternrelease/ReleaseConsentService.java); [V23](../apps/api/src/main/resources/db/migration/V23__pattern_release.sql): consent, consent_event, release, release_event | Exactly four new tables, event-derived single-use/withdrawal/revocation, DB-owned fifteen-minute/maximum-day times, exact READY binding, five-parent versions, truthful source consumption and atomic events/audit. Option B guards add exact parent-version advancement. |

Current migrations are V1–V23. The independently verified fresh catalog has 23
successful migrations and 63 public tables including Flyway; that is reviewed
catalog evidence, not a new database execution in this task. No V24 is reserved.

### Actual public dependency and trust boundaries

- Measurement and Grading consume `StyleService.readContext` / `lockContextForWrite`
  and identity/audit/shared contracts; Grading has no invented Pattern dependency.
- Pattern consumes Style and Measurement public facts; artifact orchestration uses
  `AuthorizedStorage`, never `StoragePort`. QA consumes `PatternQaContext`.
- PatternRelease writes only its own persistence and consumes
  `ReleaseOrganizationContext`, `ReleasePatternContext` and public authorization.
  The latter reaches Style/Project through their owned providers.
- Download runtime delegation is `ReleaseDownloadFacade → ReleaseContentGateway →
  ReleaseAuthorization.Authorizer → fixed fact providers`, with File-owned
  `ReleaseObjectReader → LocalStorageAdapter.readBounded → SecureBoundedObjects`
  between initial and fresh final authorization. The authorizer/provider contracts
  are authorization-owned; implementations remain in the modules owning facts.
  No provider calls back into the requesting authorizer.
- Compile-time File depends on Authorization/Identity, with no File→PatternRelease
  or Pattern/Style/Organization→PatternRelease reverse edge. Authorization owns
  minimum immutable contracts, not foreign persistence. The fixed runtime facts
  graph is different from a compile-time reverse module dependency.

[PatternReleaseArchitectureTest][R-arch] asserts `ApplicationModules.verify()`,
private scope/binding constructors, no foreign persistence/unchecked storage, and
no unmanaged drivers/connections/asynchronous work in fixed fact leaves.
[MeasurementArchitectureTest][A-arch], [PatternArchitectureTest][B-arch],
[GradingArchitectureTest][D-arch] and [PatternQaArchitectureTest][E-arch] constrain
the earlier boundaries. These are part of existing full backend verification;
discovery proposes retaining them, not replacing them with a diagram.

Application checks authorize the actual Actor/requested Organization before
foreign private resolution. Ordinary writers lock Project→Style→aggregate.
Release writes add deterministic UUID-ordered Organization `FOR NO KEY UPDATE`
before descendants/Consent/Release/Audit; accepted legacy writes are not globally
retrofitted. FK/trigger locks remain part of race analysis. Membership must be
rechecked after relevant waits, not inferred from old frontend roles.

F01 uses the explicitly selected `JpaTransactionManager`, guarded DataSource,
read-only REPEATABLE READ owner lease and fixed MANDATORY providers. Initial and
final authorization are different completed transactions, with storage outside
both. Physical owner checks, sticky denial and before-commit completion prevent
PID/snapshot coincidence, swallowed faults or rollback-only success from producing
bytes. [transaction negatives][R-tx], [snapshot tests][R-snapshot],
[startup tests][R-startup] and [File tests][R-file] are distinct controls.

The bounded release reader uses anchored `SecureDirectoryStream`/NOFOLLOW,
server-derived UUIDs, expected+1 detection, exact length/hash and a ten-MiB ceiling.
It temporarily holds an expected+1 buffer and an expected-length copy; peak byte
arrays are bounded by roughly twice that ceiling, not one byte array alone.
Existing `AuthorizedStorage.get()` still requires source membership and its
legacy adapter uses `Files.readAllBytes`; it was not silently replaced by the
release capability path. Trusted host/storage ownership remains an explicit
deployment assumption, not a claim to sandbox arbitrary devices/FIFOs.

## 4. Cumulative integrity and test-coverage matrix

Each row names an existing executable assertion or a concrete future gap.
Referenced methods/test titles identify inspected behavior; source and prior
execution evidence are not counted as new tests here. The `G` groups below are
proposals requiring a separate instruction.

| Axis | Existing inspected assertion/evidence | Cumulative gap or proposed proof |
| --- | --- | --- |
| Actor identity | [QA tests][E-test] `allFourOperationsEnforceMembershipRolesAndInternalProvenance`; [File][R-file] `actorCannotChangeBetweenStorageAndFinalDecision` | G1: one Actor/session switch across all open domain routes, no old callbacks |
| Organization | [Measurement][A-test] `absenceHierarchyRevocationAndNoForeignFacts`; [release HTTP][R-http] `guessedIdentifiersNeverProvidePrivateRecipientAccess` | G1: replay one common hierarchy/foreign-ID corpus across six domains |
| Membership | [release race][R-race] `sourceMembershipRevokedDuringObservedConsentWaitDeniesActualWriteBoundary` and `terminalMutationRechecksMembershipAfterObservedConsentWait` | G2: combine denial with concurrent unrelated same-Style writers; preserve allowed outcomes |
| OWNER/ADMIN/VIEWER | [Measurement][A-test] `authorizationAcrossAllOperations`; [QA][E-test] all four role checks; [release HTTP][R-http] `recipientRolesSeeOnlyMinimalScopedProjectionAndValidContent` | G1: parameterized common role table, preserving stricter consent-admin policy |
| PLATFORM_ADMIN without membership | [QA component][E-ui] explicit no-bypass test; [Pattern browser][B-browser] wrong Pattern/platform test | G1: same authenticated outsider across all six lazy entry points |
| Cross-Organization foreign UUID | [QA][E-test] `actualForeignRevisionAssessmentAndArtifactRemainScoped`; [release DB][R-db] `foreignReadyArtifactAndSameOrganizationFail` | G1: same-Org foreign Style as well as foreign Org matrix |
| Archive/reactivation | [Measurement][A-test] `archivedParentReadsWritesAndReactivation`; [gateway][R-gateway] `everyParentVersionFenceDeniesAndArchiveReactivationDoesNotResurrect` | G2: shared parent archive/reactivate leaves old histories readable where allowed and old releases invalid |
| MeasurementRevision | [Measurement persistence][A-db] `invalidConstructionCannotCommit`, `everyCommittedRevisionColumnIsImmutable`; [decimal][Decimal] strict numeric transport | G3: seed maximum/legal and representative units in a cumulative historical upgrade fixture |
| PatternRevision | [Pattern persistence][B-db] `sameStylePinAndNullAreAcceptedWithoutJavaValidation`; [contract][B-contract] provider avoids points/locks | G1/G3: exact Measurement→Pattern pin survives later snapshots and upgrade |
| Artifact identity | [artifact persistence][C-db] `creationIntentAndCommitCompleteness`, `terminalAndUniqueIdentities` | G1: old artifactless revision stays empty while later READY revision is shared |
| GradingRevision | [grading DB][D-db] `sameRevisionFksCannotUseOtherRevisionsChildren`, `deferredBaseFkAndSealedHistory` | G3: populated matrix order/base/numeric values survive V23; no invented geometry link |
| QA assessment | [QA][E-test] `readyArtifactAttestationAndReassessmentIsNeverARevisionMutation`; [QA race][E-race] exact revision cannot retarget | G1: newer Pattern revision/assessment must not change old assessment or released bytes |
| PatternRelease identity | [release service][R-service] `exactHistoricalRevisionImmutableBindingAndTruthfulFiveEffectCreation`; [browser][R-browser] new revision never replaces release | G1: one end-to-end immutable lineage with independently authenticated recipient |
| Stale expected head | [Measurement race][A-race] `twoWritersCannotCreateAnEmptySpecOrSilentlyAdvanceTwoRevisions`; [QA race][E-race] `staleHeadWinnerOnlyAuditAndNoSilentNPlusTwo` | G2: common winner/loser assertions without converting stale commands into later heads |
| Atomic rollback | [grading][D-test] `testOwnedFailureAtEveryStageRollsBack`; [release][R-service] `actualDatabaseFaultAfterEachConstructionStageRollsEverythingBack` | G2/G3: shared audit/count snapshot helper, no weakening deferred commit checks |
| Duplicate command | [release concurrency][R-concurrency] `oneConsumerOneConflictOneAuditNoRetry`; [consent][R-consent] repeated current-head withdrawal no-op/stale409 | G2: distinguish existing per-command semantics; do not impose generic idempotency |
| Concurrent writer | [Pattern race][B-race] `staleRevisionOrLifecycleHasExactlyOneWinner`; [grading race][D-race] same named assertion | G2: simultaneous independent aggregates sharing the same ancestors |
| Lock order | [Measurement race][A-race] `projectThenStyleThenSpecOrderWithIndependentNowaitProbes`; [release concurrency][R-concurrency] legacy FK/root race | G2: observed `pg_blocking_pids` barriers for remaining mixed-domain schedules |
| Winner-only audit | [QA race][E-race] stale-head winner; [release service][R-service] injected-stage rollback | G2: compare business/event/audit counts for every allowed schedule outcome |
| Ambiguous mutation response | [artifact transaction][C-tx] `responseLossAfterReadyDoesNotRepeatStorage`; [grading UI][D-ui] ambiguous create/revision retain draft | G1/G4: context switch during lost responses across multiple open routes; no resubmit |
| Bounded bytes | [File][R-file] `exactlyTenMiBAndDetectionByteAreBounded`, `sparseHostileObjectReadsOnlyExpectedPlusOneAndAllocatesBoundedly` | G4: retain exact max/peak-allocation assertions; no cap increase |
| Digest mismatch | [artifact][C-test] `corruptedReadySendsNoArtifactBytesAndDoesNotMutate`; [File][R-file] storage/integrity failure | G4: shared no-byte/no-history-mutation assertions for owner and recipient paths |
| Missing object | [File][R-file] `storageFailureNeverChangesReadyHistoryAndReturnsNoBinary` parameter cases | G4: verify recorded missing-object case explicitly in new execution index, not class-name inference |
| Failed storage write | [artifact transaction][C-tx] `ioWriteFailureRetainsNoneOrPrefix`, `storageCrashRetainsReservationWithoutFalseFailure` | G4: cumulative retained PENDING/FAILED/partial histories without GC or retrofit |
| Unexpected file replacement | [File][R-file] `substitutionBetweenPreflightAndOpenCannotFollowAttackerPath`, no-follow parent test | G4: preserve service-owned filesystem threat model and fail-closed unsupported-provider case |
| Incorrect private storage access | [gateway][R-gateway] `existingAuthorizedStorageStillRejectsRecipientAndGuessingNeverGrants`; [File][R-file] zero storage reads on initial denial | G1/G4: owner artifact path and recipient release path cannot grant each other's authority |
| Actor A→B frontend | [Measurement UI][A-ui] Actor switch aborts pending create; [QA browser][E-browser] Actor switch held response | G1/G4: multi-domain selections/drafts cleared in one session transition |
| Organization A→B→A | [release UI][R-ui] `ABA uses fresh generation rather than accepting first A response`; [history UI][R-history] late previous generation cases | G4: simultaneous selected histories across Measurement, Grading, QA and Release |
| Late network response | [Pattern UI][B-ui] late success/403 cannot render or repopulate; [QA UI][E-ui] late mutation success/error | G4: mix old success, old403 and current denial; old403 cannot deny new workspace |
| Cached foreign data | [release UI][R-ui] cached foreign collection/artifact tests; [Measurement cache regressions][A-cache] and [original DF-01 regression][A-cache-original] after separately authorized correction | Prerequisite: independent DF-01 correction acceptance; then G4 common corpus across domains, preserving scope validation and safe recovery without generic blind cache trust |
| Immutable history contradiction | [history UI][R-history] IA-01 exact timestamp and FRA-01 recreated Query; [registry][R-trust] immutable overlap/atomic rejection | G4: promote selected original external oracle probes into tracked tests if not redundant |
| False continuation/EOF | [registry][R-trust] FRA-02 known omissions, reverse facts, first-excluded cursor witnesses; [history UI][R-history] recreated-window omission | G4: retain valid short/full pages, inclusive next bound, new heads above max and rejection recovery |
| Binary cancellation | [release browser][R-browser] held binary after Actor/Org/ABA/cancel; [artifact UI][C-ui] late binary no URL/click | G4: cross-route pending download cancellation with two simultaneously mounted histories |
| Object URL cleanup | [artifact UI][C-ui] READY download revokes temporary URL; [release UI][R-ui] explicit download and late invalidation | G4: count URL creation/revocation on success, abort, unmount and denied stale response |
| Unknown mutation outcome | [QA browser][E-browser] committed response loss; [release browser][R-browser] ambiguous committed creation | G1/G4: preserve user draft and exact expected head; matching history is not attribution |
| Decimal-string/timestamp fidelity | [measurement model][A-model], [grading model][D-model], [release model][R-model], [Decimal] and existing strict timestamp tests | G3/G4: exact lexical fixtures through upgrade, server response, cache and rendered fields |
| Request budget/N+1 | [Measurement UI][A-ui] four initial siblings, 25-row no-detail fanout; [release HTTP][R-http] constant bulk inbox budget; [grading browser][D-browser] lazy list/history budget | G1: ordinary StyleDetail with all six links still makes four Phase 2 siblings and zero Phase 3 calls |
| Responsive/accessibility | [Measurement browser][A-browser], [grading browser][D-browser] 30×100 matrix, [release browser][R-browser] viewport loops | G5: cumulative focus return/keyboard and narrow-screen status/conflict states, not a redesign |
| Migration and immutable schema | [Measurement migration][A-migration], [QA migration][E-migration], [release migration][R-migration] preserve historical rows/triggers; direct DB tests above | G3: one synthetic populated V17→V23 lineage, both artifactless and artifact-bearing revisions, final rows/triggers/checksums |
| Generated API compatibility | [Measurement contract][A-contract], [Pattern contract][B-contract], [release HTTP][R-http]; official exporter plus CI diff | G6: deterministic generation twice and explicit unchanged pre-3G paths/schemas; no handwritten generated edits |

## 5. Frontend performance, accessibility and trusted history

Actual lazy entry points live in [routes](../apps/web/src/app/routes.tsx) and
[WorkspaceGate](../apps/web/src/app/workspace.tsx), with Actor-aware
[query keys](../apps/web/src/api/queryKeys.ts) and the existing authenticated
[transport](../apps/web/src/api/client.ts). The six feature folders are
`measurement`, `pattern` (including artifacts), `grading`, `patternqa` and
`patternrelease`. Ordinary StyleDetail retains Project→Style→four unordered
Phase 2 sibling requests. Links trigger zero Phase 3 requests. Domain lists and
histories are bounded; exact details/downloads require explicit actions.

Inspected browser helpers iterate 1440, 820, 768 and 390 px and assert document
scroll width within the viewport. `SOURCE_OS_VISUAL_REVIEW` enables optional
screenshots, not the normal overflow assertions. Measurement/Pattern/artifact
tests include associated-label and keyboard Tab checks; the maximum grading
matrix verifies string edits, navigation and contained technical-table scrolling.
This is meaningful existing coverage, not formal accessibility certification.
No complete cross-domain keyboard/focus-return/status-announcement audit was
identified. G5 should record exact states/widths, accessible names, focus entry,
confirmation cancel/return, readable textual status and errors; include VIEWER,
archived, denied and uncertain-outcome states. Confirm no whole-document overflow.
Do not introduce new UI screens or repair production CSS under a test-only task.

The release registry is private per QueryClient/canonical authenticated context,
with immutable windows and event facts, live owner leases, cache-backed remount
provenance, epochs and single-use network receipts. Query identity/cached shape
does not mint trust. Bidirectional coverage respects first-excluded inclusive
cursors and finite ACTIVATED/optional REVOKED events. Rejected candidates consume
their receipt without partially registering facts or invalidating a separate
valid pending receipt. The final owner plus final matching cache eviction permits
cleanup; ordinary query gcTime is five minutes. G4 must keep IA/FRA regressions,
Strict Mode/lifecycle, exact timestamp strings, two clients and Actor/ABA isolation.
It must not fabricate a larger release lifecycle or add browser persistence.

## 6. Migration, generated contract and deployment compatibility

V18..V23 own respectively 3, 2, 1, 5, 1 and 4 added tables. Historical per-version
upgrade tests intentionally target their released versions; do not change their
expected inventories to the latest schema. Existing tests compare application
rows, trigger definitions/enabled states, fresh inventory, owner-aware FKs,
deferred completeness, destruction guards and malicious direct SQL.
G3 supplements those tests with one representative multi-domain upgrade; it does
not rewrite released V1–V23 or assert that synthetic fixtures cover all real data.

3E-R02 remains LOW/non-blocking/open: `PatternQaMigrationTest`'s actual original
fixture is artifact-bearing only, whereas its historical description claims both
forms. A future additional truthful fixture does not retroactively fix that
sentence. Any authorized wording correction must be explicit; neither historical
record nor fixture is changed in this discovery.

Committed generated hashes at 5df8325 are:

```text
1b13f73adfad4c6acf44e5e8a371281f49dddfd16f4999ed68849a93c59c5291  docs/openapi.json
706fc3f9d314e4a8f2ffcfa4105a9f98abd6fcbdc0fc96a734ff5345038714db  apps/web/src/api/schema.ts
```

The pipeline remains Java DTO/controller→springdoc→official exporter→OpenAPI→
openapi-typescript→openapi-fetch. Discovery verifies byte preservation; it does
not regenerate tracked files or invent V24. G6 should rerun the actual pipeline
and inspect diffs, not rely on old hashes to prove live API generation.

Deployment compatibility is bounded by current code: JDK25, Spring Boot4.1.1,
Modulith2.1.1, PostgreSQL18.3, Node24, pnpm11.25.0 and secure filesystem support.
Release startup intentionally rejects unsupported manager/DataSource/provider
wiring. Existing local auth is loopback/profile constrained; OIDC/CORS tests do
not prove an actual Cognito/ALB/S3/KMS deployment. G6 records such environment
assumptions and additive frontend/backend compatibility checks without creating
an S3 adapter, infrastructure, deployment, new manager or authorization bypass.

## 7. Risk-prioritized hardening backlog

The original backlog below described residual risks, not confirmed defects.
The later reproduced DF-01 cache defect and its delivered correction are
distinguished in the reconciliation above and the updated cache row. Remaining
likelihoods describe unverified cumulative scenarios, not new findings; no
additional production correction is established by this documentation task.

| Priority/risk | Protection and existing evidence | Unverified cumulative scenario; likelihood/impact rationale | Smallest proposed action |
| --- | --- | --- | --- |
| P0 — cross-Organization data isolation | Scoped providers/role checks; A/E/R authorization assertions in matrix | One identity corpus spanning all six domains; low likelihood after existing denial coverage, high private-IP impact | G1 parameterized requested-org/foreign-Style checks and zero-byte assertions |
| P0 — incorrect revision association | Immutable same-owner FKs; B/C/D/R direct SQL tests | Shared lineage after later Measurement/Pattern/QA revisions; low/high | G1 exact IDs/hash/old snapshots before and after later writes |
| P0 — mutable historical facts | Deferred immutable guards; IA/FRA registry and UI tests | Multiple domain selections during common generation transitions; low/high | G4 shared-context attack schedule retaining exact timestamp and membership facts |
| P0 — deadlock/lock order | Observed independent-session barriers; A/D/R race methods | Mixed Measurement/Grading writes with release/QA and parent archive; plausible contention, high availability/atomicity impact | G2 both winner orders, backend PIDs/blockers/SQLSTATE, bounded waits, winner-only audits |
| P0 — split physical authorization | F01 lease/DataSource/selected manager; snapshot/transaction/startup negatives | Future provider/config drift; low/high | G6 run complete existing negative matrix and fixed provider architecture at exact head |
| P0 — File Gateway bypass | Private binding/readers, source membership unchanged; R architecture/gateway/File tests | Owner/recipient paths used in same cumulative session; low/high | G1/G4 attempt substituted scopes/objects and assert denial-before-I/O |
| P1 — storage corruption/recovery | Size/hash/create-only storage; C retained partial-state and R bounded/symlink tests | Mixed PENDING/FAILED/READY lineage during archive and ambiguous responses; medium operational likelihood/high integrity impact | G4 reuse real fault adapters, no new storage abstraction or deletion |
| P1 — audit inconsistency | MANDATORY audit, source Actor event provenance, injected-stage rollback | One common race harness might miss loser effects across domains; low/high | G2 compare expected domain/event/audit deltas at commit and rollback |
| P1 — Actor/Organization ABA | Monotonic generation, abort/purge and late-response tests | Multi-route concurrent queries/mutations; low/high | G4 defer old successes/403s through A→B→A and Actor switch |
| P1 — cached data poisoning | Release immutable snapshot checks; Measurement selectors/rendering corrected in `0b1e918`, with original RED and new regressions retained | DF-01 is a confirmed historical defect with delivered correction awaiting independent acceptance; remaining cross-domain combinations are unverified, with high confidentiality/integrity impact | First independently accept the scoped correction; future authorized G4 retains valid-shaped foreign/contradictory corpus and safe recovery |
| P1 — false event continuation | Bidirectional known-event/witness coverage; FRA-02 tests and independent oracle | Standard CI does not include all external oracle code; low/high historical-integrity impact | G4 port only nonredundant finite boundary/oracle probes, preserve legal continuations |
| P1 — unverified upgrade combination | Fresh and per-slice populated upgrade tests, checksums/trigger snapshots | A single cumulative representative fixture is not currently a dedicated Phase 3 test; low/high data-integrity impact | G3 V17→V23 fixture with artifactless and terminal artifacts, full rows/triggers/constraints |
| P2 — accessibility/regression gaps | Existing width/label/Tab/matrix tests | Cross-route focus return and all denied/conflict states not exhaustively certified; medium/moderate usability impact | G5 bounded width/state/keyboard checklist and assertions, no redesign |
| P1 — configuration compatibility | Fail-closed startup, OIDC/CORS, exact generated contracts | Real cloud adapter/topology not deployed here; unknown environmental likelihood/high operational impact | G6 explicit tested/unsupported configuration ledger; separate deployment authority |
| P1 — CI evidence reproducibility | Default full backend/frontend/browser and artifact upload | Separate-origin and secrets checks are external runs, not dedicated CI steps; medium evidence-drift likelihood/high assurance impact | G6 propose explicit origin/secret gates and retained machine-readable summaries without modifying CI now |

## 8. Supported commands, environment and CI inventory

The actual workflow is [SOURCE OS CI](../.github/workflows/ci.yml), triggered on
push/pull_request, with one Ubuntu `foundation` job, read-only contents permission
and a 60-minute timeout. It installs Temurin25, pnpm11.25.0, Node24 and Python3.14.8.
The [Compose file](../compose.yml) pins PostgreSQL18.3 and a local development
database; tests require Docker/Testcontainers and synthetic data, never production
DB credentials. Preserve unrelated volumes/services and local work.

| Working directory | Actual command / dependency | Current CI status; future obligation |
| --- | --- | --- |
| `apps/api` | `./mvnw -B verify`; JDK25, Docker/Testcontainers/PostgreSQL; actual application/JPA/JDBC and architecture tests | Explicit CI step; keep complete suite including F01 and real expiry |
| `apps/web` | `pnpm install --frozen-lockfile` | Explicit CI step; lockfile unchanged |
| `apps/web` | `pnpm typecheck`, `pnpm test`, `pnpm build` | Explicit CI step; complete Vitest, not selected green files |
| repository root | `docker compose up -d --wait`; `SPRING_PROFILES_ACTIVE=local java -jar apps/api/target/source-os-api-0.0.1-SNAPSHOT.jar`; wait for readiness on 8080 | CI starts migrated API/database after backend build; correct local profile and storage permissions required |
| repository root | `mkdir -p .local`; `./scripts/export-openapi.sh`; `git diff --exit-code -- docs/openapi.json apps/web/src/api/schema.ts` | Explicit CI contract step; script needs live API and frontend generator |
| `apps/web` | `pnpm exec playwright install --with-deps chromium`; `pnpm e2e` | Explicit CI default same-origin suite; Vite5173 proxies `/api` to API8080 |
| `apps/web` | `VITE_API_BASE_URL=http://127.0.0.1:8080 pnpm e2e` | Supported separate-origin mode, previously complete external runs; **not an explicit second CI suite**. Stop old Vite before changing mode; do not reuse a same-origin server |
| `infra/terraform` via root | `terraform -chdir=infra/terraform fmt -check`; `init -backend=false`; `validate` | Explicit CI Terraform1.14.0 step; no provisioning/apply |
| repository root | Approved Gitleaks8.28.0 `git --log-opts='<base>..HEAD'` plus tracked-source scan with redacted JSON evidence | Existing delivery check; **no Gitleaks step in current workflow**. Future exact command/config/version and raw result/triage must be retained |

There is one Playwright config, not a separate-origin config file. `VITE_API_BASE_URL`
selects the supported frontend API origin; the fixture still talks to API8080.
`SOURCE_OS_E2E_DATABASE` optionally selects a validated synthetic `source_os...`
database for fixture SQL. Those helpers execute `docker compose exec -T postgres
psql` from the repository root; an isolated Compose override must target the same
database as the API. Preserve actual CORS/trusted-origin policy. Do not change
Request cancellation mocks or production transport to accelerate tests.

`pattern-release-expiry.spec.ts` has a 17-minute test timeout and polls the real
database-backed fifteen-minute deadline (poll budget sixteen minutes).
`PatternReleaseExpiryTest` also observes a real fixed deadline after a lock wait.
No shorter consent TTL, clock mock, skipped slow test or altered security timeout
is permitted. The browser test additionally exercises a real short *release*
duration allowed by the existing contract; it does not shorten the consent policy.

CI uploads Surefire and browser test-results directories even on failure. Raw CI
logs were unavailable in the accepted review; successful metadata alone supplies
no test counts. Local/CI summaries should carry exact SHA, command, case names,
counts, failures/errors/skips, retries/flaky status, timings and artifact hashes.
External 52-test independent harnesses are evidence inputs, not automatically
part of `pnpm test`. Porting selected probes belongs to a separately authorized G4.

### Evidence-based execution burden

Actual accepted CI step metadata records backend 1,059 seconds (~17.7 minutes),
frontend typecheck/test/build 133 seconds, browser 1,042 seconds (~17.4 minutes),
API start 13 seconds and contract generation 4 seconds. These are observed step
durations, not invented raw-log timings or a service-level guarantee. Full author
browser suites took about 17.7 minutes per mode; fresh independent Vitest was
92.66 seconds and its targeted separate-origin run still needed ~15.1 minutes.

A serial baseline plus both-origin browser modes therefore needs roughly
55 minutes before new fixtures, setup variance and evidence packaging. The current
60-minute CI budget has limited spare margin for a second serial origin run.
G6 should measure first and, if authorized, use separate isolated test jobs/origin
runs with complete results rather than shortening TTLs or disabling tests. Budget
at least two real fifteen-minute browser waits across the modes and the complete
backend deadline test. Do not promise completion in a few minutes or run competing
heavy suites against the same resources. New G1–G5 duration estimates remain
unmeasured until their tests exist.

## 9. Proposed separately executable Phase 3G contract

Recommended specification identity for later authorization:
`SOURCE-OS-PHASE-3G-CUMULATIVE-HARDENING-v1` (proposal only).
Before that task starts, verify live source/CI and reconcile the documentation
commit with the accepted production tree. Do not silently apply an old baseline
to an advanced branch. One explicit instruction may authorize all groups below;
these groups do not require six redundant approval cycles.

| Group | Smallest reviewable deliverable | Required evidence and completion criterion |
| --- | --- | --- |
| G1 — lineage, tenant and request budgets | A common synthetic source/recipient lineage spanning complete Measurement, metadata Pattern, new READY artifact revision, independent Grading, exact QA and release; shared role/foreign-ID HTTP/browser cases | Exact old/new IDs and decimals, owner-aware failures, no source oracle, no QA/Grading manufacturing gate, ordinary StyleDetail four siblings/zero eager Phase 3 calls, bounded bulk/list requests |
| G2 — cumulative transactions and races | Extend existing independent-session harnesses for mixed-domain writers and legacy parent operations; no production hooks | Controlled barriers/PIDs/blockers, both winner orders, bounded waits, explicit allowed/forbidden outcomes, no unauthorized committed effect, winner-only event/audit counts and rollback proof |
| G3 — cumulative migration integrity | One truthful populated historical upgrade fixture and byte/trigger/generated-artifact preservation checks | Fresh V23 plus V17→V23, representative artifactless/PENDING/READY/FAILED and exact matrices, all old rows/guards intact, owner-aware malicious SQL rejected; no V24 or historical migration edit |
| G4 — history, storage and workspace adversaries | Nonredundant external review probes promoted to tracked tests plus cross-domain Actor/ABA, cache, late-response, retained-storage and binary cleanup cases | IA/FRA protections unchanged, legal pagination accepted, no partial trust updates/receipt reuse, both observers converge, zero Blob/click after denial, explicit ambiguous-outcome reconciliation |
| G5 — responsive and accessibility regression | Existing routes at 1440/820/768/390 with label/keyboard/focus/status/scroll checks, including maximum matrices and denied/conflict states | Named states and widths, screenshots only where useful, contained technical scrolling, no whole-page overflow, no false WCAG certification, no UI redesign |
| G6 — reproducible delivery and independent handoff | Full supported verification, both origins, generated contracts, Terraform, secrets, source/migration hashes and exact-head CI; narrowly justified CI test/evidence additions if explicitly authorized | All required tests actually executed, no unexplained skip/failure, raw failures preserved, versioned evidence index and exact-SHA independent acceptance package |

Allowed future changes are focused tests, synthetic fixtures, nonproduction test
utilities and verification documentation. CI test-coverage/evidence additions need
an explicit rationale and review within the later mandate. Production Java/TS,
business SQL/migrations, API definitions/generated bytes, auth/storage, UI screens,
dependencies and infrastructure behavior remain unchanged by default. Changed
test expectations must reflect an actual accepted invariant; no failing assertion
may be removed, mocked away, skipped or weakened to obtain green.

Future acceptance requires an exact changed-file allowlist and a **zero production
diff**, V1–V23 preservation/no V24, unchanged generated contract unless a separately
approved correction explicitly allows it, complete backend/frontend/browser
regression, both actual expiry completions, architecture/SQL/F01/security proof,
documented gap disposition and exact-head push CI. Every new test maps to a row
above and states meaningful assertions; duplicated test counts are not the goal.

A separately initialized non-implementing reviewer must assess the actual final
SHA, new assertions, evidence and remaining limitations. Existing 3F acceptance
may support unaffected behavior after source/provenance comparison; it is not
automatic 3G acceptance or a human signature. Discovery acceptance alone cannot
authorize test/source execution, commit/push, deployment or the next phase.

## 10. Defect-Stop and excluded capabilities

No deterministic accepted production defect was reproduced during the original
`5df8325` discovery. The subsequent DF-01 finding, correction and still-pending
independent correction acceptance are recorded above; this reconciliation found
no additional production defect.
The remaining hypothetical gaps are not new findings; DF-01 retains its separate
finding record. If future testing reproduces
a defect, assign a stable `3G-DF-xx` ID with invariant, exact source, synthetic
reproduction/commands, expected/actual behavior, severity and affected boundaries.
Record the smallest correction and API/migration/security impact, then stop before
production repair. Preserve evidence; request a separately scoped correction.
An unresolved blocking HIGH/CRITICAL or mandatory-invariant MEDIUM prevents
acceptance. Do not weaken a requirement or hide a failed run in a later success.

New geometry engines, DXF/PDF parsers, visual previews, AI generation (Phase 4),
RFQ/quotations (Phase 5), contracts/payments/production orders and infrastructure
provisioning/deployment are excluded. Tech Pack/BOM/Sample ownership remains a
separate roadmap decision. Paid Pattern Service/pricing ownership remains
unresolved. No new models/tables/endpoints/business lifecycles, private storage
paths, workers, services or speculative migration may be inferred from 3G.

**Execution boundary:** the original output closed 3F acceptance and proposed
G1–G6; later execution authority was separate. The current reconciliation is
documentation only. Phase 3G remains PAUSED at the independent-correction-acceptance
gate; no remaining G1–G6 work or Phase 4 execution follows this documentation
delivery automatically.

[A-test]: ../apps/api/src/test/java/com/sourceos/MeasurementTest.java
[A-db]: ../apps/api/src/test/java/com/sourceos/MeasurementPersistenceTest.java
[A-race]: ../apps/api/src/test/java/com/sourceos/MeasurementConcurrencyTest.java
[A-contract]: ../apps/api/src/test/java/com/sourceos/MeasurementContractTest.java
[A-migration]: ../apps/api/src/test/java/com/sourceos/MeasurementMigrationTest.java
[A-arch]: ../apps/api/src/test/java/com/sourceos/MeasurementArchitectureTest.java
[A-ui]: ../apps/web/src/features/measurement/Measurements.test.tsx
[A-model]: ../apps/web/src/features/measurement/model.test.ts
[A-browser]: ../apps/web/e2e/measurements.spec.ts
[B-db]: ../apps/api/src/test/java/com/sourceos/PatternPersistenceTest.java
[B-race]: ../apps/api/src/test/java/com/sourceos/PatternConcurrencyTest.java
[B-contract]: ../apps/api/src/test/java/com/sourceos/PatternContractTest.java
[B-arch]: ../apps/api/src/test/java/com/sourceos/PatternArchitectureTest.java
[B-ui]: ../apps/web/src/features/pattern/Patterns.test.tsx
[B-browser]: ../apps/web/e2e/patterns.spec.ts
[C-db]: ../apps/api/src/test/java/com/sourceos/PatternArtifactPersistenceTest.java
[C-tx]: ../apps/api/src/test/java/com/sourceos/PatternArtifactTransactionTest.java
[C-test]: ../apps/api/src/test/java/com/sourceos/PatternArtifactTest.java
[C-ui]: ../apps/web/src/features/pattern/PatternArtifacts.test.tsx
[D-db]: ../apps/api/src/test/java/com/sourceos/GradingPersistenceTest.java
[D-race]: ../apps/api/src/test/java/com/sourceos/GradingConcurrencyTest.java
[D-test]: ../apps/api/src/test/java/com/sourceos/GradingTest.java
[D-arch]: ../apps/api/src/test/java/com/sourceos/GradingArchitectureTest.java
[D-ui]: ../apps/web/src/features/grading/Gradings.test.tsx
[D-model]: ../apps/web/src/features/grading/model.test.ts
[D-browser]: ../apps/web/e2e/grading.spec.ts
[E-test]: ../apps/api/src/test/java/com/sourceos/PatternQaTest.java
[E-race]: ../apps/api/src/test/java/com/sourceos/PatternQaConcurrencyTest.java
[E-migration]: ../apps/api/src/test/java/com/sourceos/PatternQaMigrationTest.java
[E-arch]: ../apps/api/src/test/java/com/sourceos/PatternQaArchitectureTest.java
[E-ui]: ../apps/web/src/features/patternqa/PatternQaPage.test.tsx
[E-browser]: ../apps/web/e2e/pattern-qa.spec.ts
[R-arch]: ../apps/api/src/test/java/com/sourceos/PatternReleaseArchitectureTest.java
[R-tx]: ../apps/api/src/test/java/com/sourceos/authorization/PatternReleaseTransactionTest.java
[R-snapshot]: ../apps/api/src/test/java/com/sourceos/PatternReleaseSnapshotTest.java
[R-startup]: ../apps/api/src/test/java/com/sourceos/PatternReleaseStartupTest.java
[R-file]: ../apps/api/src/test/java/com/sourceos/file/PatternReleaseFileTest.java
[R-race]: ../apps/api/src/test/java/com/sourceos/PatternReleaseLifecycleRaceTest.java
[R-http]: ../apps/api/src/test/java/com/sourceos/PatternReleaseHttpTest.java
[R-db]: ../apps/api/src/test/java/com/sourceos/PatternReleaseDatabaseTest.java
[R-gateway]: ../apps/api/src/test/java/com/sourceos/PatternReleaseGatewayTest.java
[R-service]: ../apps/api/src/test/java/com/sourceos/PatternReleaseServiceTest.java
[R-concurrency]: ../apps/api/src/test/java/com/sourceos/PatternReleaseConcurrencyTest.java
[R-consent]: ../apps/api/src/test/java/com/sourceos/PatternReleaseConsentTest.java
[R-migration]: ../apps/api/src/test/java/com/sourceos/PatternReleaseMigrationTest.java
[R-ui]: ../apps/web/src/features/patternrelease/Workspaces.test.tsx
[R-history]: ../apps/web/src/features/patternrelease/EventHistory.test.tsx
[R-trust]: ../apps/web/src/features/patternrelease/eventHistoryTrust.test.ts
[R-model]: ../apps/web/src/features/patternrelease/model.test.ts
[R-browser]: ../apps/web/e2e/pattern-releases.spec.ts
[Decimal]: ../apps/api/src/test/java/com/sourceos/ExactDecimalTransportTest.java

[A-cache]: ../apps/web/src/features/measurement/MeasurementCache.test.tsx
[A-cache-original]: ../apps/web/src/test/phase3gCacheIntegrity.test.tsx
