# Phase 3F-1 — Independent Technical Acceptance and Closeout

## Accepted baseline and authority

The accepted implementation is `5df832526e783cd4b7e875c8be934637b8325b6b`
on `Croco-JY/codex`, branch `phase-3-pattern-operations`, with parent
`df06ee5d391025cf705bc81b70db482b13ca7d04`. Its final correction is
[`fix: reject omitted trusted release history events`](https://github.com/Croco-JY/codex/commit/5df832526e783cd4b7e875c8be934637b8325b6b).

This new closeout record is authorized by
`SOURCE-OS-PHASE-3F-CLOSEOUT-3G-0-DISCOVERY-v1`, submitted on 2026-11-05.
It records an existing acceptance; it does not change the historical
[implementation document](phase-3f-secure-pattern-releases.md),
[Phase 3 plan](phase-3-plan.md), accepted design `3F-0E-signoff-v1`, or approval history.
The implementation specification remains `SOURCE-OS-PHASE-3F-1-IMPLEMENTATION-v1`.

## Acceptance verdict, date and independence

**PHASE 3F-1: INDEPENDENTLY ACCEPTED — NON-BLOCKING FINDINGS RECORDED**

The separately initialized automated reviewer
`/root/final_independent_reacceptance` completed its technical adjudication on
2026-11-04 at 19:33:46 +09:00 (10:33:46 UTC), under
`SOURCE-OS-PHASE-3F-1-FRA-02-FINAL-REACCEPTANCE-v1`. The final evidence package
was sealed at 19:37:33 +09:00. The reviewer used a separate exact-source checkout,
selected and executed its own counterexamples, and had no participation in the
FRA-02 correction implementation. The correction author coordinated artifact
logistics; the independent verdict was frozen before that author's artifact QA.

The reviewer reread the authenticated
[standing mandate, Issue #7 comment 6557061968](https://github.com/Croco-JY/codex/issues/7#issuecomment-6557061968).
Its clause 6 permits this scoped independent automated technical assessment.
The D13/D24 preimplementation governance substitutions did not waive production
verification. This record claims no independent human signature, legal-identity
certification, deployment approval, or authority for another phase.

## D02–D24 disposition

The final independently reconciled matrix contains exactly 23 decisions, all
PASS at the accepted SHA. PASS retains the report's operational and evidence
limitations; it does not imply exhaustive proof of arbitrary future behavior.

| Decision | Accepted requirement | Final disposition |
| --- | --- | --- |
| D02 | Distinct authenticated Organizations; out-of-band UUID exchange | PASS |
| D03 | Recipient-issued source-bound single-use consent; no source directory oracle | PASS |
| D04 | Fifteen-minute consent redemption | PASS |
| D05 | Maximum twenty-four-hour release access | PASS |
| D06 | Permanent recipient withdrawal | PASS |
| D07 | Exact immutable revision and corresponding READY artifact | PASS |
| D08 | Human QA remains informational | PASS |
| D09 | Five-parent ACTIVE/version fence | PASS |
| D10 | Exact parent-version advancement, Option B | PASS |
| D11 | Whole-version metadata invalidation and reissue consequences | PASS |
| D12 | PostgreSQL lock ordering and legacy compatibility | PASS |
| D13 | Actual concurrency acceptance obligations | PASS |
| D14 | Acyclic secure File Gateway | PASS |
| D15 | Permanent source revocation | PASS |
| D16 | Coherent physical-transaction final authorization, including F01 defenses | PASS |
| D17 | Truthful Actor, audit and consent-event provenance | PASS |
| D18 | Four-table V23 integrity and atomic creation | PASS |
| D19 | Twelve scoped HTTP operations | PASS |
| D20 | Minimal recipient projections and active VIEWER content access | PASS |
| D21 | Recipient WorkspaceGate | PASS |
| D22 | Immutable history, cache, Actor and Organization generation isolation | PASS |
| D23 | No additional permanent per-download audit; mutation/event audit retained | PASS |
| D24 | Complete implementation verification and independent acceptance | PASS |

## Corrective findings and retained history

| Finding | Original failure and correction lineage | Independent final disposition |
| --- | --- | --- |
| 3F1-IA-01 | Structurally valid timestamp replacement could rewrite displayed event history; exact immutable snapshots and comparison were added | CLOSED at the accepted SHA; exact serialized timestamp/precision, cache, network and recovery regressions retained |
| 3F1-FRA-01 | Query-owned and observer-local trust could diverge after Query eviction; a QueryClient/authenticated-context registry replaced competing authorities | CLOSED; original two-observer eviction/recreation and lifetime/isolation attacks passed |
| 3F1-FRA-02 | Known events or continuation witnesses could be omitted across windows, including false EOF; bidirectional coverage was added | CLOSED; all three original failing cases passed, with inclusive continuation, reverse coverage, atomic rejection and coherent recovery |

Original RED evidence, correction records and final GREEN executions remain in
the evidence lineage. They have not been rewritten as never-existing defects.
FRA-02 changed only `eventHistoryTrust.ts`, its unit tests, `EventHistory.test.tsx`
and the implementation documentation. Backend, migrations, File/F01, generated
contracts, transport and infrastructure were unchanged by that correction.

Historical `3F0F-F01` remains `CLOSED_FOR_DISPOSABLE_FEASIBILITY` in its original
record. Separate production transaction regressions and implementation acceptance
provide the production proof; this closeout does not relabel prototype results.

## Fresh independent execution

| Verification | Actual reviewer execution at the final SHA |
| --- | --- |
| Complete default Vitest | 1,882 passed, 42 files, zero failures/skips |
| External adversarial executions | 52 passed, including the original 36-test replay and 16 additional oracle, boundary, receipt and actual-hook cases |
| Same-origin Chromium | 21 release cases passed |
| Separate-origin Chromium | 22 release/expiry cases passed, including actual fifteen-minute expiration: 906,020 ms |
| Typecheck and production build | Passed |
| OpenAPI and TypeScript regeneration | Two independent runs matched committed bytes |
| Terraform | Formatting, backend-free initialization and validation passed |
| Secrets | Tracked-source and exact-commit Gitleaks scans: zero findings |

The finite oracle evaluated 1,089 two-window and 35,937 three-window combinations
over 33 structurally legal two-event envelopes. Those are combinations within
tests, not tens of thousands of additional test cases. A new external-harness
assertion initially rejected an allowed retained complete page alongside an error;
the reviewer preserved that failure and corrected the harness to reject only the
contradictory candidate. No tracked assertion was weakened.

## Reviewed and reused full-regression evidence

| Evidence | Provenance and result |
| --- | --- |
| Backend | Current correction-author execution: 1,350 passed in 98 suites, zero failures/errors/skips; independently parsed and reconciled with unchanged backend/test source and earlier independently executed evidence |
| Complete same-origin browser | Correction-author execution: 143 passed, zero skips/failures/flaky/retries; actual expiry 905,126 ms |
| Complete separate-origin browser | Correction-author execution: 143 passed, zero skips/failures/flaky/retries; actual expiry 904,247 ms |

The reviewer freshly built and ran its own API/database for browser verification;
the Maven build used `-DskipTests package`. It was not another execution of all
1,350 backend tests. Fresh reviewer tests, reviewed author executions and reused
prior independent proof are separate evidence categories, not one combined count.
The prior interrupted separate-origin expiration case remains recorded as
interrupted; later actual completions supply the required proof.

## Exact-head CI and raw-log limitation

[SOURCE OS CI 41801680429](https://github.com/Croco-JY/codex/actions/runs/41801680429)
is bound to the exact accepted SHA: event `push`, attempt `1`, status `completed`,
conclusion `success`, one `foundation` job with all 21 exposed steps successful.
The independent reviewer verified this at its initial and closing gates. The
2026-11-05 closeout also reread live branch/run/job/step metadata: exact SHA
unchanged, open PR count zero, and the same successful CI identity.

Raw GitHub Actions log download returned Forbidden through a redirect. The
review did not establish the numeric HTTP status/responding boundary and did not
inspect unavailable raw logs. Available run/job/step metadata and actual local
test artifacts are distinct evidence. No CI test totals are invented from job
success alone.

## Evidence identity and availability

The external handoff prefix is
`SOURCE-OS-Phase-3F-1-FRA-02-Final-Independent-Reacceptance-`.
These are artifact names, not repository files or promised permanent download URLs.

| Suffix | SHA-256 |
| --- | --- |
| `Report.md` | `cef39c14c44bcf31cf3aa5cfa19fb836eb9d48a861341779ee1262c29adfc1d5` |
| `Decisions.json` | `e7de8f4e71bec7dd86d31ed813ef10054cdd2466097035349f5c2e8403b37c69` |
| `Findings-Closure.json` | `ec11d217ecbd02064f4ee42682283daf54c3934e80ce59b31ca9a41083867576` |
| `Integrity.json` | `2c8d40eb9f52a72e7cfb871e01b138d134970f3c1acffe0eff63faa2f931d00d` |
| `Evidence.zip` | `9dab934ddc39eb60b115fbedf78963637462f2f8a619d28fd6e0977cd52fcb38` |
| `Delivery.json` | `e2c9a2a664d7db1d3b98fb1ce5084e5f2c4a051dd488037ec0f8b53fc152250e` |

At closeout the real files were accessible under `/workspace/scratch/`. The ZIP
is 17,547,023 bytes with 2,075 entries, including 2,074 indexed payloads and its
internal integrity index. This task freshly reverified outer identities, every
indexed payload's size/SHA-256, ZIP CRC and internal/external index equality.
That is a new integrity check, not a new execution of the historical tests.
Hashes identify content; they certify neither correctness nor signer identity.

The package also preserves original failure evidence, source manifests, commands,
raw test results and the independent report's limitations. Its artifact-directory
secret scan retained 21 individually triaged non-secret alerts (20 content/Git/JAR
digests and one ordinary historical report-generator phrase); this is not falsely
reported as a zero-alert artifact scan. The source/commit zero-finding scans are
separate. If these external files become unavailable, future readers must report
that limitation rather than claim to have freshly reproduced their integrity.

## Residual findings and operational limits

**3E-R02 — LOW / NON-BLOCKING / OPEN** remains the inaccurate sentence in
[the QA completion record](phase-3e-human-qa.md): its populated upgrade fixture
is described as covering artifactless and artifact-bearing Pattern revisions.
Actual `PatternQaMigrationTest` creates three artifact-bearing revisions with
PENDING/READY/FAILED artifacts, without an artifactless revision. Later separate
reviewer coverage does not correct that original description. Neither that
historical file nor its fixture is changed here.

The accepted limits include finite race/synthetic-upgrade coverage, trusted
deployment, fixed synchronous authorization providers and the tested
Linux/JDK secure-directory storage boundary. A hostile host able to replace
objects with arbitrary devices/FIFOs is not sandboxed by that boundary.
First authenticated history responses cannot reveal server facts never observed;
later contradictions fail closed without rewriting trusted history. Delivered
bytes cannot be recalled. General legacy-data coverage limits are separate from
the specific 3E-R02 documentation finding.

## Subsequent authority and final baseline

Technical acceptance does not authorize production deployment, merging protected
branches, new product capabilities, or Phase 3G/4 execution. The current task
authorizes documentation closeout and [3G-0 discovery](phase-3g-cumulative-hardening-discovery.md)
only. Its later documentation commit may advance branch HEAD while the accepted
production baseline remains the exact `5df8325` implementation tree.

Final accepted technical baseline: all D02–D24 PASS, IA-01/FRA-01/FRA-02 closed,
no blocking finding, and 3E-R02 open/non-blocking. Phase 3G cumulative hardening
requires a separate explicit execution instruction consistent with
[Phase 3 plan sections 18–20](phase-3-plan.md#18-ordered-slices-and-migration-ownership).
