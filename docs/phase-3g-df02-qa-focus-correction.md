# 3G-DF-02 — Human QA Attestation Dismissal Focus Correction

## Authority, baseline and protected work

Date: 2026-11-17. Specification:
SOURCE-OS-3G-DF-02-QA-FOCUS-CORRECTION-v1. The user's separate correction
instruction authorizes the minimal QA frontend correction, directly necessary
tests/documentation, complete verification and scoped commit/push. It does not
resume cumulative G1–G6 or authorize independent acceptance, finding closure,
deployment or Phase 4.

Repository Croco-JY/codex; delivery branch phase-3-pattern-operations;
starting SHA d18d4c4243863d9d7eeeade9c5385eccb4b61b19. Local branch, origin,
actual remote and live GitHub HEAD agreed; paginated open PR count was zero.
The canonical worktree contained the ten reported uncommitted hardening files.
Their filenames, sizes, SHA-256 values and tracked patch were archived before
production modification. A separate exact-baseline worktree isolates this
correction from that unfinished work; it is not included in the correction commit.

The original defect-stop archive was accessible: 183 indexed payloads, external/
internal index equality, all sizes/SHA-256 and ZIP CRC verified. Its SHA-256 is
10043173b890a7bfb72dd1a1af5c1690011a809cd7e2892472caf33dc148c519.
The original eight interrupted tests, earlier safety archive, historical reports
and [formal DF01 closure](phase-3g-df01-formal-closure.md) are preserved.

## Original RED and unchanged GREEN

The original uncommitted phase3g-cumulative.spec.ts remains unchanged. An
external Playwright configuration selects only its two G5 focus tests, uses the
original test runtime and fixtures, and serves the isolated correction source.
Before any QA production edit, both tests failed their original toBeFocused
assertions. Escape and Cancel left BODY focused, while draft/baseline and
zero-mutation assertions passed. Both unchanged tests passed after correction.
The original source hash, commands, JSON, error contexts and screenshots are
retained separately for RED and GREEN. These new runs are correction-author
evidence, not a fresh independent acceptance decision.

## Minimal implementation

Only [PatternQaPage.tsx](../apps/web/src/pages/PatternQaPage.tsx) changes production
behavior, within Editor:

- A local submit-button ref identifies the initiating control. An editor heading
  with tabIndex -1 provides a meaningful local fallback.
- Explicit Escape/Cancel records a return-focus intent bound to the authenticated
  workspace generation and exact QA scope, then closes confirmation.
- A layout effect consumes that intent after React commits removal/re-enabling.
  It checks the captured and current workspace, scope, connection, visibility
  and disabled state before focusing. It does not schedule a timer or retain an
  asynchronous focus callback. Unmount cleanup clears the intent.
- A disabled/hidden initiating control falls back to the current visible editor
  heading. No eligible connected local target means no stale focus operation.
- Escape prevents default and propagation. Cancel remains an explicit non-submit
  button. Neither path resets form state, baseline, queries or failures.
- Affirmative confirmation clears cancellation intent and retains the existing
  one explicit command path, request body, authorization and concurrency behavior.

The requested baseline containment check also reproduced Tab leaving the open
confirmation after Cancel. Under specification section F, a local Tab/Shift+Tab
boundary now wraps the existing enabled action buttons. It creates no global
listener, focus manager, modal framework, new UI or general accessibility claim.
Accessible role/name, initial affirmative focus and truthful qualification remain.

## Direct regression coverage

[Focus.test.tsx](../apps/web/src/features/patternqa/Focus.test.tsx) exercises actual
QA rendering with the established synthetic transport: repeated Escape/Enter/
Space cancellation, StrictMode, propagation, Tab boundaries, unmount, Actor,
Organization and exact revision transitions, disabled/hidden trigger fallback,
stale baseline retention and one explicit affirmative assessment. A deferred
Router transition may follow a valid dismissal focus while the original editor
is still current; tests record connected-node/current-route facts and forbid
old-node calls after retirement. Actor/unmount retirement requires zero such calls.

[qa-focus.spec.ts](../apps/web/e2e/qa-focus.spec.ts) uses real Chromium, authenticated
HTTP/PostgreSQL and synthetic QA-only fixtures. At 390/1440 it verifies three
open/dismiss/reopen cycles per Escape, mouse Cancel, Enter and Space. Assertions
require the actual connected, enabled, visible initiating button to equal
document.activeElement, with visible keyboard focus indication. Exact form
snapshots, artifact/revision identities, baseline and URL remain unchanged;
cancelled cycles issue zero mutations. It verifies local Tab containment, one
explicit affirmative POST with the original body and an Actor replacement during
Escape with zero retired-node focus calls or mutations.

The complete existing pattern-qa browser suite and QA model/component suites are
retained, including pinned-history, stale assessment head, ambiguity, explicit
reconciliation, truthful READY attestation and private workspace boundaries.
No original RED assertion, existing test, timeout, TTL or fixture was weakened.

## Verification and evidence provenance

Focused executed results:

| Check | Actual result |
| --- | --- |
| Original two focus cases, unchanged baseline | 0 PASS / 2 FAIL; focus assertions only |
| Same original two cases, corrected source | 2 PASS / 0 FAIL |
| Baseline local Tab containment | 0 PASS / 1 FAIL; retained before the local correction |
| QA component/model/focus suites | 137 PASS / 0 FAIL |
| Complete targeted QA browser suites before final Actor addition | 24 PASS / 0 FAIL |
| Final added Actor-transition browser case | 1 PASS / 0 FAIL; no retired focus or mutation |

The last 24-case run and Actor check are overlapping focused evidence, not a
combined full campaign. Full frontend/backend/both-origin, expiry, OpenAPI,
Terraform, secrets, source preservation and exact-head CI results are supplied
in the final external A–P report. Delivery may be declared complete only after
those mandatory gates succeed. No earlier accepted test totals substitute for
these executions.

The full correction campaign subsequently completed on the frozen candidate
code, which is compared byte-for-byte with the delivered commit:

| Full check | Fresh correction-author result |
| --- | --- |
| Typecheck and production build | PASS |
| Complete Vitest | 2,169 PASS / 58 files; zero failures/skips |
| Complete Maven verify | 1,350 PASS / 98 suites; zero failures/errors/skips; real expiry 900.238 seconds |
| Same-origin Chromium | 154 PASS; zero failures/skips/retries/flaky; real expiry 905314 ms |
| Separate-origin Chromium | 154 PASS; zero failures/skips/retries/flaky; real expiry 903982 ms |
| Official OpenAPI and TypeScript generation | PASS; generated bytes unchanged |
| Terraform fmt/init without backend/validate | PASS |
| Tracked-source secret scan | PASS; zero findings |
| V1–V23 and non-QA production/contracts/infrastructure | Byte-identical to the baseline |

The exact correction commit, successful push CI and final integrity identities
are recorded in the external A–P delivery report after publication. A successful
implementation campaign is not independent correction acceptance.

All diagnostic failures are retained. An initial external config mixed two
Playwright installations and ran no tests. New unit fixtures initially copied a
primitive instead of the original transport object; two new lifecycle assertions
also confused a requested Router transition with its completed retirement.
Those new tests now observe the actual state at focus time. A new Actor browser
check initially left keyboard focus in the identity field; it now explicitly
focuses the confirmation before Escape. Typecheck required a button type guard
in a new browser assertion. These changes correct new test setup/type assumptions;
they do not relax either original focus regression or production authorization.

External evidence root: /workspace/scratch/3g-df02-qa-focus-correction-20261117/.
It retains authority, original handoff/intake integrity, protected-worktree ZIP,
RED/GREEN bodies, focused/full execution logs, source identity, CI metadata and
the final correction-author A–P report. The final evidence index/archive supplies
SHA-256/size/CRC identity; hashes do not establish reviewer identity or correctness.
Unavailable raw CI logs are reported separately from inspected step metadata.

## Preservation and acceptance boundary

No backend, V1–V23, generated contract, Measurement trust/recovery/budget/reader,
Grading, PatternRelease, File Gateway, authentication policy, dependency,
infrastructure or deployment topology changes. Only the QA page, two direct
regression files and this document belong to the correction commit. Unrelated
uncommitted hardening work remains hash-preserved in its original workspace.

3G-DF-02 remains subject to fresh independent reacceptance and separate formal
closure. The correction author does not independently accept or close it.
3G-DF-01 remains formally closed. IA-DF01-06 remains LOW / NON-BLOCKING /
QUALIFIED / OPEN; 3E-R02 remains LOW / NON-BLOCKING / OPEN.
**Phase 3G remains PAUSED / DEFECT-STOP.** This correction does not resume G1–G6,
accept cumulative hardening, deploy production or begin Phase 4.
