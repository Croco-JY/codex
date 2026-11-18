# Human QA residual focus correction

Parent implementation: `7d05d836b59eee9e4b44471322b335ee22e5706d`.

## Problem and scope

Independent IR-DF02-01 review found that DOM or CSS eligibility changes without a React render could leave focus on the document body or an invisible control. Tab boundaries included hidden buttons. The ordinary dismissal and genuine archive-transition corrections remain accepted historical evidence; this follow-up preserves them.

Only [PatternQaPage.tsx](../apps/web/src/pages/PatternQaPage.tsx) changes production behavior. Backend, migrations, generated contracts, Measurement trust, PatternRelease, File Gateway and infrastructure behavior remain unchanged.

## Current focus ownership

The current editor owns its submit, heading, confirmation and Cancel references. While the confirmation is current and visible, the shared visibility/action checks preserve valid focus, otherwise prefer Cancel, another eligible local action, or the focusable confirmation region. Dismissal keeps the existing commit-aware Submit/heading return intent and exact workspace guard.

One observer watches eligibility attributes and child changes within the confirmation, plus eligibility attributes on ancestors. It does not observe the whole application subtree or poll. Current workspace and connection/visibility are checked on every callback. Cleanup disconnects the observer and removes each document/window/local listener.

## Keyboard boundary and supported limits

The local React handler remains responsible for keys inside the region. A temporary external keyboard boundary handles Tab, Shift+Tab and Escape originating outside it, including the body, without duplicate processing. Boundaries use effectively eligible current controls. Enter/Space activation of an ineligible focused action is consumed, including Space release. An already valid control is not needlessly refocused.

CSSOM changes without a DOM signal are revalidated at interaction boundaries. A wholly removed, hidden or retired region is not resurrected. This is a scoped QA correction, not a general modal framework or comprehensive accessibility certification.

## Draft and command preservation

Focus repair does not reset fields, change the assessment baseline or artifact, reconcile, submit, or retry a mutation. Escape and Cancel preserve the exact draft and make no HTTP mutation. A separate explicit eligible affirmative action retains the existing validation, concurrency and command flow.

## Verification and provenance

The 20 reviewer-authored cases reproduce RED at the parent and pass unchanged on the corrected candidate. Current source-matched results include 164 focused QA tests, 13 lifecycle tests, 59 targeted browser tests and the complete 2196-test frontend/1350-test backend verification. Both complete Chromium configurations passed: same-origin 188 and separate-origin 188, with zero failures, skips, retries or flaky cases. Their real-expiry checks lasted 903853ms and 903539ms respectively. Official contracts, infrastructure syntax and source checks also passed. Actual execution records and provenance are in the accompanying A–P report and integrity-indexed evidence.

The earlier extra-trace campaign's Grading timeout remains a failed historical execution. The unchanged 30-second test and complete canonical campaigns are separately recorded; tracing alone is not asserted as its cause, and no Grading code or assertion changed. Exact final commit/CI identity is in the external delivery metadata because this document predates its own commit identity.

## Acceptance boundary

This is correction-author evidence. Fresh independent reacceptance is required. No finding or parent is closed, and Phase 3G remains paused. Historical 3G-DF-01 closure, IA-DF01-06 qualified LOW observation and open LOW 3E-R02 remain unchanged.
