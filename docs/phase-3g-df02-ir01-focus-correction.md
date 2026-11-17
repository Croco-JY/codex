# 3G-DF-02 / IR-DF02-01 — Open Confirmation Focus Correction

## Authority and baseline

The user's `SOURCE-OS-3G-DF02-IR01-FOCUS-CORRECTION-v1` instruction is the
separate scoped follow-up correction mandate. It permits the minimal QA
frontend correction, related tests/documentation, complete verification and
conditional commit/push. It does not resume G1–G6, authorize independent
self-acceptance, formally close a finding or authorize Phase 4.

Starting source: `1a61e47396e5fe97394825999c5550c2c08ef320`, branch
`phase-3-pattern-operations`, repository `Croco-JY/codex`. Local, origin and
live GitHub heads agreed; PR count was zero. Previous exact-head CI
[44000214130](https://github.com/Croco-JY/codex/actions/runs/44000214130)
was push/attempt 1/completed/success, all 21 steps successful.

The ten uncommitted cumulative-hardening artifacts remain byte-identical,
protected by a fresh size/hash inventory, ZIP and tracked patch. An isolated
exact-baseline worktree excludes them from this correction and its full suites.
No reset, destructive cleanup or unrelated staging is used.

## Independent finding and original reproduction

The fresh automated independent reviewer blocked acceptance of the previous
[QA focus correction](phase-3g-df02-qa-focus-correction.md) on
`IR-DF02-01 — MEDIUM / BLOCKING`. Normal Escape/Cancel dismissal was fixed,
but an authoritative archive refresh disabled the focused affirmative action
while confirmation remained open. Native Chromium focus became BODY, so a
subsequent Shift+Tab bypassed the dialog-local handler and reached QA history.

The reviewer's English A–P report, 46-row matrix and 684-payload ZIP were
retrieved from `/workspace/scratch/df02-independent-reacceptance-20261117/`.
The actual sizes, SHA-256 hashes, internal/external index, outer ZIP CRC and
55 nested ZIP CRCs were verified. Hash consistency does not establish the
truth of a claim or confer independent acceptance on this correction.

Both exact original reviewer-authored browser test files are preserved
unchanged outside tracked source. External configuration selects only the
reported failing case. Before production changes, real Pattern archive,
the unchanged 31-second query stale interval, normal visibility refetch and
original assertions reproduced RED at 390 px and 1440 px: one actual failure
at each width. BODY focus, escaped containment, draft/baseline retention and
zero browser dismissal mutations are retained in JSON, screenshots and traces.

After correction, both unchanged cases pass. Their immediate active-element
attachments show Cancel attestation before a further keypress; Shift+Tab stays
inside the open confirmation. This is correction-author execution, not new
independent reacceptance.

## Minimal production change

Only [PatternQaPage.tsx](../apps/web/src/pages/PatternQaPage.tsx) changes
production behavior. The existing commit-aware local focus effect now also
responds while confirmation is open, including changes to `allowed`:

1. Local refs identify this editor's confirmation region and Cancel action.
2. A current-workspace guard and connected region are required.
3. An already focused, enabled, visible local action is left unchanged.
4. Otherwise, the current connected, enabled, visible Cancel action receives
   focus after React commits the eligibility update.

This repairs focus without waiting for another keyboard event. Existing
one-control Tab/Shift+Tab wrapping then remains effective. There is no timer,
polling loop, global document listener, independent focus registry or modal
framework. Confirmation stays mounted until explicit user action.

The original dismissal intent, exact scope/generation/current-workspace checks,
unmount cleanup, submit/heading fallback and separate affirmative command path
remain intact. Focus does not change form values, assessment baseline, prepared
artifact identity, reconciliation state or mutation authorization.

## Regression coverage

[Focus.test.tsx](../apps/web/src/features/patternqa/Focus.test.tsx) retains all
original assertions and adds real Query refetch/reset transitions for Project,
Style and Pattern archive; artifact pending/error; parent error; reactivation;
already focused Cancel; repeated updates; StrictMode; and late response after
Actor/Organization/revision replacement or unmount. No disabled attribute is
manually substituted for authoritative React eligibility in these transitions.

[qa-focus.spec.ts](../apps/web/e2e/qa-focus.spec.ts) retains all original cases
and adds native Chromium archive transitions at 390/1440 px. The tests use real
API archive commands and normal stale Query refresh, assert Cancel owns focus
without manually moving it there, exercise Tab/Shift+Tab and keyboard dismissal,
and preserve exact draft/baseline/artifact/route plus zero cancellation writes.
An already-focused Cancel is not refocused. Reactivation preserves the draft and
requires a later explicit confirmation for exactly one authorized assessment POST.
The original uncommitted Escape/Cancel assertions also execute unchanged.

This is focused confirmation interaction coverage, not general WCAG certification.

## Verification and delivery record

Fresh correction-author local verification is complete. These are new executions,
not copied historical independent results. Focused runs overlap full totals and
are not added to them.

| Check | Actual result |
| --- | --- |
| Original unchanged IR cases, 390/1440 | RED 0/2 → GREEN 2/2 |
| Original unchanged Escape/Cancel | 2 passed |
| Focused QA component/model | 151 passed |
| Focused native Chromium QA | 31 passed |
| Full frontend | 2,183 passed, 0 failed/pending |
| Typecheck / production build | PASS |
| Full Maven verify | 1,350 passed, 0 failures/errors/skips |
| Full same-origin Chromium | 160 passed, 0 failures/skips/flaky |
| Full separate-origin Chromium | 160 passed, 0 failures/skips/flaky |
| Genuine browser consent expiry | same 904,366 ms; separate 904,844 ms |
| Official OpenAPI/generated client | PASS, byte-identical |
| V1–V23 / other production source | Byte-identical |
| Terraform / source secret check | PASS |

The final external A–P handoff records exact commands/exit codes, original
RED/GREEN, failed diagnostic attempts, source identities, scoped commit and
post-push exact-head CI conclusions with SHA-256 evidence metadata. Required
real expiry is not shortened, simulated or skipped. No independent acceptance
or successful future CI is inferred from these completed local results.

The previous review's initial frontend setup timeout and same-origin Grading
30-second timeout remain preserved historical diagnostics. Their successful
unchanged reruns do not relabel those original runs as clean passes. New setup
or test failures are likewise retained with their exact disposition.

No backend, V1–V23 migration, generated API/client, Measurement trust, secure
release, File Gateway or Grading source changes are made. Independent review
and formal closure require separate decisions. `3G-DF-01` remains formally closed;
`IA-DF01-06` remains LOW / NON-BLOCKING / QUALIFIED / OPEN and `3E-R02` remains
LOW / NON-BLOCKING / OPEN. **Phase 3G remains PAUSED / DEFECT-STOP.**
