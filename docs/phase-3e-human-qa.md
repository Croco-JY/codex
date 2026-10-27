# Phase 3E — Human Pattern QA

Implementation baseline: `3326bcc3ffd5a6a2b2187eaf8ffbc7cbea44e463` on `phase-3-pattern-operations`. Phase 3E is implemented for independent acceptance review. Phase 3F remains separately authorized future work.

## Meaning and ownership

`PatternQaAssessment` belongs to one exact immutable `PatternRevision`, with zero or more independently numbered assessments. A Pattern revision requires no assessment to exist. The latest assessment number determines current state; there is no mutable QA state, quality field, latest pointer, or new QA aggregate on Pattern, PatternRevision, PatternArtifact, Measurement, or Grading.

Stored outcomes are exactly `OBSERVED`, `CHANGES_REQUESTED`, and `HUMAN_REVIEWED`. Before assessment 1, the API derives `UNREVIEWED` with `latestAssessment: null`. Repeated outcomes are legal new observations. A later assessment may request changes after a human-reviewed outcome. No event overwrites earlier assessments or creates a replacement Pattern revision. A newer Pattern revision always starts unreviewed, while an older exact revision can receive an explicit assessment while its ancestors remain active.

`METADATA_ONLY` requires a null artifact reference and permits only observation or changes requested. `READY_ARTIFACT` requires the artifact of that exact revision and Style to be READY. `HUMAN_REVIEWED` requires the latter basis. The server validates that reference and state; it cannot prove that the authenticated reviewer inspected the content. The UI asks for explicit confirmation and displays:

> Human review recorded. This is not automated validation, sample approval, production verification, or authorization to manufacture.

READY remains the Phase 3C storage-finalization fact. QA neither parses geometry nor establishes CAD correctness, grading conformance, physical fit, production readiness, release permission, IP transfer, or commercial acceptance. It grants no binary download privilege. A later failed integrity check does not rewrite an assessment of what was attested earlier.

## V22 and immutable history

`V22__pattern_qa_assessment.sql` adds exactly one table, `pattern_qa_assessment`. Its columns are assessment UUID, exact revision UUID, Style UUID, assessment number, outcome, evidence basis, nullable artifact UUID, required notes, private reviewer issuer/subject, and server-generated `reviewed_at`. There are no retroactively populated QA rows or defaults on old business records.

The composite `(pattern_revision_id, style_id)` FK references `pattern_revision(id, style_id)`. A separate artifact FK preserves artifact identity. The insert trigger additionally checks the artifact's exact revision, Style, and READY state. Basis/outcome/nullability CHECKs prohibit metadata-only human review and invalid artifact combinations. Assessment numbers are safe positive integers; `(pattern_revision_id, assessment_number)` is unique.

The BEFORE INSERT guard resolves the exact revision's owning Pattern, locks that Pattern, requires ACTIVE, and only then reads the per-revision latest number and requires `latest + 1`, including overflow rejection. It acquires no Project or Style locks. Ordinary UPDATE, DELETE, and TRUNCATE are rejected at statement level, including empty targets and cascading truncation attempts. Construction is one complete row; there is no mutable construction phase or seal flag.

The notes boundary set is explicitly U+0009–000D, U+0020, U+0085, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF. Java `QaText`, frontend validation, and SQL `pattern_qa_text_is_canonical` use that policy independently of Grading. The application trims only boundary characters, preserves interior text, rejects NUL and unpaired surrogates, and requires 1–2,000 Unicode code points. SQL independently rejects noncanonical boundaries, empty/null notes, and invalid stored length; PostgreSQL UTF-8 rejects NUL/invalid scalar encodings. Notes render as text.

Fresh and populated-upgrade validation observed **22 migrations, 59 public tables including Flyway, and 58 application tables**. PostgreSQL catalog inspection found 21 QA-table constraints (including PostgreSQL NOT NULL catalog entries), two indexes, two new functions, and four noninternal triggers, all enabled. The two indexes are the PK and revision/number unique index. The measured latest plan used the latter backward; PostgreSQL chose a small sequential scan and sort for bounded history on the small fixture. The same key supports descending bounded history without another index. No duplicate speculative history index was added. V1–V21 bytes are unchanged; V23+ is absent.

The populated V21→V22 test preserves all 57 old application tables by canonical row comparison and retains old trigger definitions/enabled states. Its fixtures include Measurement revisions, artifactless and artifact-bearing Pattern revisions, PENDING/READY/FAILED artifacts, Grading snapshots, and audits. Flyway validate succeeds before and after; the newly migrated QA table is empty. Earlier version-specific migration tests retain their historical targets.

## Public boundary, authorization, and transactions

`com.sourceos.patternqa` depends only on `pattern`, `identity`, `audit`, and `shared`. Its SQL queries only `pattern_qa_assessment`. The additive Pattern-owned `PatternQaContext` exposes scoped exact-revision resolution and a mandatory-transaction write context; it performs no QA persistence or storage IO. Pattern has no reverse dependency on PatternQA. Existing revision and artifact workflows are unchanged.

Read authorization proceeds through Actor, requested Organization membership, Project, Style, Pattern, exact revision, and optional assessment. OWNER/ADMIN/VIEWER can read; only OWNER/ADMIN can write. PLATFORM_ADMIN has no private-workspace membership bypass. After Organization authorization, wrong or foreign hierarchy returns scoped 404. Archived Project, Style, or Pattern permits reads and rejects assessment writes with 409. Revoked membership is denied before the next authorized private lookup.

Writes acquire **Project → Style → Pattern**, through the existing Style public lock contract inside the new Pattern provider. The held Pattern lock serializes assessment sequencing, Pattern lifecycle, and Pattern revision construction. `expectedLatestAssessmentNumber` is compared after that lock; zero means no prior assessment, and stale input returns 409. Two stale writers produce one assessment N+1 and one 409, with no implicit N+2 or retry. Project, Style, and Pattern lifecycle versions remain unchanged by QA.

One transaction includes reference checks, assessment insertion, and audit. The audit action is `pattern_qa.assessment_recorded` in ORGANIZATION scope, with authenticated Actor. Previous state is UNREVIEWED or the prior committed outcome. Metadata contains only Style/Pattern/revision identifiers, revision number, assessment number, outcome, and evidence basis. Only the three missing scalar QA keys were added to the audit allowlist. Notes, raw reviewer identifiers, artifact content, and arbitrary payloads are excluded. A late audit failure rolls back both business and audit writes; failed and stale commands emit no success audit.

## HTTP and generated contract

The resource root is:

`/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}/revisions/{revisionId}/qa`

| Method | Suffix | Operation ID | Result |
| --- | --- | --- | --- |
| GET | root | `readPatternQa` | `PatternQaView` |
| GET | `/assessments` | `listPatternQaAssessments` | `PatternQaAssessmentPage` |
| POST | `/assessments` | `createPatternQaAssessment` | 201 `PatternQaAssessmentView` |
| GET | `/assessments/{assessmentId}` | `readPatternQaAssessment` | `PatternQaAssessmentView` |

The exact create body contains required `expectedLatestAssessmentNumber`, `outcome`, `evidenceBasis`, nullable `artifactId`, and `notes`. A QA-local strict parser rejects unknown/duplicate properties, missing required properties, trailing JSON, incorrect token types, and caller identity/timestamp/sequence fields. Expected head is a JSON integer token from 0 to 9007199254740991; strings, decimals, exponents, booleans, negatives, and overflow are rejected. Invalid request shape/basis/text is 400, foreign scoped reference 404, and a not-yet-READY artifact or archived/stale state is 409. Existing bounded safe Problem Details handling is retained.

Summary fields are `id`, `patternRevisionId`, `styleId`, `assessmentNumber`, `outcome`, `evidenceBasis`, nullable `artifactId`, and `reviewedAt`. Detail adds only `notes`. Current QA includes Pattern/revision/Style identities, Pattern revision number, derived state, and nullable complete latest assessment. Issuer, subject, and storage identity are never public fields. The QA-only OpenAPI customizer represents the required nullable latest assessment as the explicit JSON Schema reference/null union; generated TypeScript includes `| null`.

History defaults to 25 and accepts 1–100. It queries descending assessment numbers bounded by inclusive `maxAssessmentNumber`, with limit+1 lookahead. The continuation is the first unreturned number, never the last returned row. Zero is a valid empty initial bound for an unreviewed revision. Opening history anchors it to the head from current QA. Summary rows exclude notes and need no detail hydration. Exact historical reads remain fully scoped.

The official exporter was run twice with byte-identical output. Compared with the exact parent, the addition consists of three path keys, four operations, and eight schemas. Existing path/schema removals and modifications are all zero. Generated contracts were not edited by hand. Final hashes:

| Artifact | SHA-256 |
| --- | --- |
| `docs/openapi.json` | `bdfa68d0e7911e53d9fb47b247dbc9444a19989e2ccab6b11547c724909e58b9` |
| `apps/web/src/api/schema.ts` | `f468a38a3ff733f48d3d465db0ac16c4cf66c86fc489cab41122a29b1ab7f572` |

## Lazy frontend and private drafts

The lazy authenticated WorkspaceGate route is `/organizations/:organizationId/projects/:projectId/styles/:styleId/patterns/:patternId/revisions/:revisionId/qa`. Pattern latest and historical revision views add navigation links only. They do not prefetch QA, and Pattern lists remain unchanged. Ordinary StyleDetail still loads its four accepted Phase 2 children and makes zero QA, Pattern, Measurement, Grading, or artifact-content requests.

Direct QA navigation gates Project → Style → Pattern → exact PatternRevision → current QA. After valid parents, entry makes one exact revision GET and one current-QA GET; history, artifact binary, Grading, Measurement history, and Release requests are zero. Opening history makes one bounded history GET. Selecting an older assessment makes one exact GET, without per-row fanout. Artifact **metadata** is requested only when a writer explicitly opens the editor; a 404 is normal absence, and no content request is made. READY basis is unavailable for absent, PENDING, or FAILED metadata.

The editor uses existing RHF/Zod/React Query infrastructure. Draft outcome, basis, notes, and captured assessment baseline remain in memory. Human review requires explicit confirmation of the exact READY artifact. A 409 or ambiguous network/5xx/malformed-success result preserves the draft, refreshes authorized parents/current QA and active bounded history, and requires explicit reconciliation. Refreshed archived parents become read-only. A failed parent refresh retains the draft but disables submission until context is available. Reconciliation changes only the explicit baseline, never submits or attributes a matching server event to the caller. Mutations use existing workspace commands with `retry:false`.

Every successful response is runtime checked for exact ownership, UUIDs, safe sequence numbers, strict offset timestamp, outcome/basis/artifact relation, canonical notes, and bounded descending history. Historical selection pins the complete validated summary. Network hydration and cached-result selection compare all eight shared immutable fields, including the exact serialized timestamp, before render. This carries forward R01 without modifying Grading validation. Pagination clears selection; background history refresh cannot replace a pinned expectation.

Query keys include Actor/workspace generation, Organization, Project, Style, Pattern, exact revision, and resource identity/bounds. Existing generation guards prevent A→B, A→B→A, Actor switches, late mutation/read success/failure, and old 403 from affecting a replacement workspace. Current-generation 403 denies the Organization workspace. No private QA data, drafts, or credentials are persisted in browser storage or URL state.

## Validation evidence

The required start identity, clean-tree, paginated repository-wide PR=0, PR #6 closed/unmerged, exact parent push-attempt-1 CI, migration identity, and fresh/populated baseline gates were independently checked before implementation. Tests use isolated PostgreSQL/Testcontainers and a separately named local E2E database with owned synthetic data/storage. Production data is not used; no guard bypass, cleanup role, or production failure switch was added.

| Verification | Observed result |
| --- | --- |
| Full backend `./mvnw -B verify` | 1,118 tests; failures/errors/skips 0 |
| New QA backend coverage | 89 tests across HTTP/service, direct SQL, concurrency, migration, and Modulith suites |
| Focused frontend QA | 113 tests, two files |
| Full Vitest | 1,695 tests, 38 files |
| TypeScript and frontend production build | Passed |
| Full same-origin Playwright | 120 passed |
| Full separate-origin Playwright | 120 passed |
| New shared QA Playwright scenarios | 13 per origin mode |
| Terraform fmt/init without backend/validate | Passed; infrastructure unchanged |
| Exporter passes | Identical bytes; additive QA-only contract |

Direct SQL covers owner mismatch, missing revisions/artifacts, wrong-revision and PENDING/FAILED evidence, invalid state/basis combinations, noncanonical/null notes, sequence gaps/duplicates/overflow, archived Pattern insertion, and all destructive statements. Valid artifactless metadata assessments and exact READY-artifact assessments commit. Java/PostgreSQL notes behavior was differentially checked across all 63,487 valid non-NUL BMP scalar values, declared boundary characters, supplementary limits, and invalid input cases.

Independent connection/latch tests use actual `pg_blocking_pids` evidence rather than sleep-only timing. They prove the HTTP stale-head 201/409 winner-only audit, direct-SQL sequence serialization, Project/Style/Pattern archive races in both orders, exact-old-revision targeting during Pattern revision races, and both artifact readiness orders. Upload is held outside SQL while PENDING: QA returns 409, emits no audit, and is not implicitly retried after upload becomes READY. Finalization-first blocks QA on the Pattern lock until READY commits, then permits assessment. Audit-spy failure occurs after assessment insertion inside the actual transaction and proves complete rollback.

Browser flows cover artifactless observation, changes requested, immutable history, READY human attestation, PENDING/FAILED rejection, real stale-head reconciliation, archived parents, VIEWER, summary/detail contradiction, response loss, Actor and Organization switching, and request budgets in both origin modes. Responsive assertions and captures cover 1440/820/768/390; document overflow is zero. Labels, text status, notes, keyboard confirmation/cancel, loading/error announcements, and focus are exercised; this is not a claim of formal WCAG certification. Existing complete browser suites retain the maximum 30×100 Grading matrix and accepted R01 coverage.

A separate owned-fixture retention probe uploaded a READY artifact, recorded human review, verified a 200 content read, then damaged only that probe's retained bytes. Download returned 409 while current/exact assessment reads remained 200 with the identical immutable assessment. This confirms that historical attestation is not presented as present-day storage integrity proof.

During development, newly authored strict-token, transaction-spy setup, nullable-schema representation, asynchronous test synchronization, and a test locator were corrected. The first full backend run exposed one existing latest-inventory test still expecting 21; its expectation now advances to 22. Historical version-specific tests remain frozen. QA parent-refresh behavior was strengthened before delivery and full frontend/browser verification rerun. No assertion was disabled, timeout increased, accepted-phase defect silently patched, or production guard weakened.

## Delivery and deferred work

Final delivery separately records the one implementation commit, exact parent, complete manifest, paginated pre-commit/pre-push/final PR gates, migration byte comparison, staged and parent-to-final Gitleaks 8.28.0 results, clean local/origin/GitHub equality, and exact new push-attempt-1 CI with exposed job steps. This document does not substitute historical CI for the final exact-head run.

Deployment is additive: migrate V22 with the compatible backend, verify health, then expose the frontend route. Old frontend and accepted Pattern/Artifact/Measurement/Grading contracts continue to function. No dependency, security-policy, infrastructure, workflow, Compose, binary transport, or historical migration change is required.

**STOP — Phase 3E independent acceptance review pending.** No PatternRelease, V23, CAD/AI validation, sample/production verification, RFQ, Billing, or next slice is implemented or authorized here.
