# Phase 1C-5A — Protected Sources & Evidence workspace

Implemented on `phase-1c-ui`, starting from `eb06e82ca8d1b5978356a60d0b9d522eae132d2b`. The starting local/origin HEADs matched, the worktree was clean, and SOURCE OS CI run [39487106675](https://github.com/Croco-JY/codex/actions/runs/39487106675) was green for that exact commit.

This slice adds frontend curation for existing Source, SourceRecord, Observation and Review APIs. Backend production code, tests, OpenAPI, generated TypeScript contracts, migrations, infrastructure and dependencies are unchanged. Accepted Phase 1C-5P contracts remain unchanged; this workspace does not call the three create-precondition PUT endpoints.

## Routes and authority

`/admin` remains the lazy curation landing page. Its only actionable tool is **Sources & Evidence**, linking to the new lazy `/admin/sources` route. Both routes require an authenticated session and the existing capability gate. The admin page component and its queries are not mounted before that gate succeeds.

Only `GET /api/identity/capabilities` returning `platformAdmin === true` produces `ADMIN`. Organization ownership, organization administration, membership and business relationships confer no curation authority. `PENDING` and `ERROR` do not mount protected children or start protected reads; `ERROR` retains the existing safe capability retry. `NON_ADMIN` renders access denied. The backend independently enforces PLATFORM_ADMIN on the protected endpoints.

Entry refresh now covers `pathname === "/admin" || pathname.startsWith("/admin/")`. The accepted shell behavior keeps an already established ADMIN view mounted during a background capability refresh. A returned false capability immediately changes the state to NON_ADMIN, unmounts the workspace and removes Curation navigation. An error fails closed as well. Protected queries are cancelled and removed; protected mutation-cache entries are removed, and unmount aborts pending commands. Selected Sources, Record/Observation contexts, all drafts, comparisons and ambiguous-outcome messages disappear. Previously loaded data is not left beneath an overlay.

Admin query keys use their own `admin` prefix and the existing opaque session scope, followed by the relevant Record/Observation ID and page size. They do not reuse buyer `supply` keys. The existing SessionProvider Actor boundary cancels/clears queries and remounts Actor-owned state. Command handlers also check their AbortSignal and captured session scope before accepting a completion. Delayed old-Actor queries and commands cannot restore drafts, display warnings or populate the next Actor's cache. No curation data is stored in localStorage or sessionStorage.

## Existing APIs and bounded reads

| Workflow           | Existing endpoint                                     | Read/write behavior                                  |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------- |
| Sources            | `GET /api/v1/admin/sources`                           | Offset pages of 25, initially offset 0               |
| Source create      | `POST /api/v1/admin/sources`                          | Explicit operator command                            |
| Source update      | `PUT /api/v1/admin/sources/{id}`                      | Loaded Source only, exact current version            |
| SourceRecord       | `POST /api/v1/admin/source-records`                   | Explicit register/reuse command                      |
| Observations       | `GET /api/v1/admin/source-records/{id}/observations`  | Known Record context, offset pages of 25             |
| Observation create | `POST /api/v1/admin/source-observations`              | Immutable fact registration                          |
| Reviews            | `GET /api/v1/admin/source-observations/{id}/reviews`  | Loaded/just-returned Observation, offset pages of 25 |
| Review append      | `POST /api/v1/admin/source-observations/{id}/reviews` | Append-only evaluation                               |

Sources, Observations and Reviews use `useInfiniteQuery` with page parameters representing requested offsets. A full 25-row page permits another request, including a valid empty next page. A shorter page ends the currently observed sequence. The sequence respects the existing maximum supported offset of 100000. There is no invented total, cursor or global Record directory. Counts say **N sources/observations/reviews loaded**. Duplicate IDs across moving offset boundaries are displayed once.

Opening a Source row does not register a Record or fetch children. Child histories are fetched only after the operator establishes their context. Read failures remain local to the relevant history. The existing central API client, query policy and safe error UI are reused.

## Sources

The list uses `name · sourceCode` when both are known, with UUID as a secondary reference. It exposes Source type, namespace, base URL, access method, normalization policy, active state and version. Incomplete generated `SourceView` values display defensively. Editing requires a valid ID, sourceCode, sourceType, name, accessMethod, normalizationPolicy, explicit boolean active, and a safe nonnegative integer version. Missing or unsafe state disables edit rather than supplying invented defaults.

Create uses generated `SourceInput`, explicitly sending `version: 0` and the visible active checkbox value. Source type, access method and normalization policy have visible controls. Source codes follow `[A-Za-z0-9][A-Za-z0-9._-]{0,99}` and retain their original case and spelling. Optional empty namespace/base URL are omitted.

Base URL validation requires an absolute HTTP(S) URL with a hostname. Credentials, explicit authority user-info syntax (including empty user-info), raw fragment delimiters (including trailing `#`), whitespace and invalid URL syntax are rejected. Paths and queries are allowed. The accepted original string is sent unchanged, including host case, explicit port and percent-encoded path/query; the browser's canonicalized URL is not substituted.

There is no Source-by-ID GET or direct edit route. Only a loaded row can open edit. `sourceCode` and `normalizationPolicy` are read-only and are resent from the safely loaded baseline. The UI never infers that a Source has no dependent Records from the visible history. Editable fields are name, namespace, baseUrl, sourceType, accessMethod and active. Versions are not editable and must satisfy `typeof version === "number" && Number.isSafeInteger(version) && version >= 0`.

Confirmed create clears the create draft, announces the returned UUID and resets the collection to a fresh first-page sequence: sorted insertion can move offset boundaries. The new Source may require Load more. Confirmed update refetches the existing loaded sequence, preserving loaded page scope. The edit baseline/version is replaced only with safely refreshed server state. If that row cannot be safely recovered, another update is disabled until it can be loaded again. No arbitrary Source UUID lookup or all-Source scan is introduced.

On update 409, the draft remains intact while the loaded pages refresh. The banner says **The Source changed or conflicts with the current server state.** Available refreshed server values are shown for comparison. The operator can explicitly adopt the new version while keeping the draft, or replace the draft with server values. Neither action automatically submits. A generic 409 is not labelled as a proven stale-version conflict.

## SourceRecord context

Registration starts from a deliberately selected loaded Source. `active === false` disables normal registration with **New/reused SourceRecord registration requires an active Source.** An absent active value also prevents registration. The Source is not automatically reactivated.

RecordKind choices are exactly SUPPLIER, FACILITY, MATERIAL, MATERIAL_VARIANT and MATERIAL_LISTING. `externalRecordKey` is checked for nonblank input and sent unchanged: no trimming, case folding or Unicode normalization. The backend applies the selected Source's normalization policy. **Register / reuse record** is an audited command, not an existence search, and selection never invokes it automatically.

A confirmed `RecordView` is retained only in Actor-scoped page memory. Returned kind, original/normalized keys and first/last-seen values are displayed when provided. A friendly Source label is used only when the returned Source identity agrees with the known selected Source. A missing/invalid Record ID or contradictory returned Source identity cannot open an Observation context. Missing optional metadata is not fabricated.

This retained Record metadata is a snapshot of the registration response. Later Observation writes may advance server timestamps; there is no passive Record detail GET to refresh them. The UI does not register again merely to refresh metadata. Reload discards this transient context. Selecting another Source requires explicit confirmation before clearing incompatible Record/Observation/Review context and drafts, including an existing UUID-only workflow.

An operator may enter an already-known syntactically valid SourceRecord UUID to read its bounded Observation history. This does not establish existence or load Source/kind/key metadata. The persistent notice is **An empty observation result does not prove whether this SourceRecord exists.** Its empty state is **No observations returned. This read does not confirm whether the SourceRecord exists.** A confirmed returned Record instead uses **No observations recorded for this SourceRecord.** No global Record search, autocomplete or Record-by-ID endpoint is invented.

## Immutable Observations

Observation identity is the stable `sourceRecordId + observationKey`. The key is required and sent without semantic transformation. The form never creates a replacement retry key automatically. `observedAt` is required; optional retrieved time and supersession are omitted when empty. Controls are explicitly labelled UTC and serialize validated ISO-8601 Instants ending in `Z`, rather than browser-local strings. Native controls accept milliseconds; the serializer can preserve up to six fractional digits and relies on no precision beyond the backend's microsecond preservation.

Hash state is either entirely absent or a 64-character lowercase hexadecimal `contentHash` plus fixed `hashAlgorithm: "SHA-256"`. Uppercase hashes, invalid length/characters and half-pairs cannot be submitted. The algorithm is read-only when a hash is entered; no hash is computed or lowercased. The multiline hash control and displayed history wrap without changing the value.

Supersession is deliberate. Loaded same-Record Observations provide suggestions, with no automatic latest selection. A manually entered UUID is allowed, leaving same-Record integrity to the server. Observations have no edit/delete action.

Exact repeated supplied facts may return the existing Observation after backend timestamp normalization. Different facts for the same identity conflict. The UI retains the confirmed draft for an explicit exact retry and does not describe registration as generally idempotent. A 409 preserves the draft and uses:

> An Observation with this identity conflicts with the submitted facts.
>
> An Observation with this identity exists but does not match the submitted facts, or another integrity conflict occurred.

Confirmed creation restarts the Observation history sequence. The just-returned Observation can open Reviews even if it is outside the bounded loaded history. It is labelled separately and does not inflate the loaded-row count.

## Append-only Reviews

Review actions start only from a loaded or just-returned Observation. Status choices are ACCEPTED, REJECTED and NEEDS_REVIEW. Optional license/terms choices are UNKNOWN, PERMITTED, RESTRICTED and PROHIBITED; an unset control is omitted instead of silently sending UNKNOWN. Notes are optional with a 1000-character maximum.

Reviewer identity comes from the authenticated server Actor, not the mutation body. Protected history may show issuer/subject as secondary audit context. Review history displays status, permission assessments, reviewed time and notes. There is no edit/delete action, version or idempotency key. Repeating an explicit submission can append another Review. ACCEPTED is an assessment and does not introduce a new gate for future provenance/binding commands. A missing parent can surface as an integrity 409; this UI does not promise 404.

## Serialization, retries and recovery

| Input                    | Absent value        | Present value                                           |
| ------------------------ | ------------------- | ------------------------------------------------------- |
| Source namespace/baseUrl | Omitted when empty  | Validated original text                                 |
| Source active/version    | Required by this UI | Explicit boolean / exact safe integer; create version 0 |
| Record external key      | Blank rejected      | Original input; server normalization only               |
| Observation retrievedAt  | Omitted             | Valid UTC Instant ending in `Z`                         |
| Hash/algorithm           | Both omitted        | Lowercase 64-hex hash plus fixed SHA-256                |
| Supersedes Observation   | Omitted             | Explicit valid UUID                                     |
| Review license/terms     | Omitted             | Explicit selected permission, including UNKNOWN         |
| Review notes             | Omitted when empty  | Original text, maximum 1000 characters                  |

All five mutation families explicitly use `retry: false`: Source create/update, Record register/reuse, Observation create and Review append. There is no automatic write retry. Source and Review creation have no idempotency key; Record registration remains a command even on reuse. No identity value is case-folded or Unicode-normalized. No unknown numeric data is serialized as zero, and no absent enum is serialized as an empty string. This slice introduces no decimal-domain conversion or arithmetic and preserves accepted buyer decimal behavior.

Only `error instanceof ApiError && error.status === 0` is treated as transport uncertainty. The draft remains visible and an outcome-unknown warning requires inspection before explicit resubmission. Source create offers list refresh; no invented idempotency key or automatic duplicate create is used. Observation uncertainty refetches the current Record's loaded history and highlights visible matching observation keys for operator comparison. A bounded absence is explicitly not proof that creation failed. Review uncertainty refetches recent Reviews and asks the operator to inspect before appending again.

Explicit HTTP 400/403/404/409/5xx outcomes use safe error handling, without transport-ambiguity copy. SourceRecord 409 says **Registration conflicts with the existing source identity.** Review integrity conflicts use the generic safe conflict view. Request references are retained; raw bodies, stack traces, credentials and tokens are not rendered. A protected 403 also refreshes capability. AbortError/session cancellation is not ambiguous completion and cannot leave an old Actor's warning behind. Existing 401/session-expiry behavior is preserved. No new 412 workflow is needed here.

Forms use the existing React Hook Form, Zod and TanStack Query. Reset/Cancel controls are explicit. Opening another dirty Source form or changing active Record context requires confirmation before discarding drafts. There is no existing global navigation-block pattern to extend; navigating away discards page memory. Labels, error associations, focus on newly opened forms/context, status/alert announcements and text statuses support keyboard/screen-reader use.

## Request fanout and bundle observation

Measured in both real-browser origin modes; these are fixture observations, not production performance guarantees:

| Action                                     | Additional protected reads                          |
| ------------------------------------------ | --------------------------------------------------- |
| Initial Sources workspace                  | 1 Source GET, limit 25 / offset 0; no child reads   |
| Load more Sources                          | 1 Source GET at offset 25                           |
| Confirm Source create                      | 1 fresh Source GET at offset 0                      |
| Confirm Source update with one loaded page | 1 Source GET at offset 0                            |
| Open confirmed Record context              | 1 scoped Observation GET at offset 0                |
| Confirm Observation create or exact replay | 1 refreshed Observation GET at offset 0 per command |
| Open Review context                        | 1 scoped Review GET at offset 0                     |
| Append Review                              | 1 refreshed Review GET at offset 0                  |

The complete main journey, including reload and UUID-only reopening, made five Source GETs, four Observation GETs and two Review GETs in each origin mode. It made seven explicit mutations: Source create, Source update, Record registration, three Observation submissions (create/exact replay/conflict) and one Review append. No per-Source Record/Observation/Review fanout occurred. Component coverage separately verifies that an update refreshes both pages when two Source pages are loaded.

The production build reports a lazy `AdminSourcesPage` chunk of 32.26 kB (9.38 kB gzip); the shared main chunk is 264.86 kB (82.39 kB gzip). Shared schema/form chunks also contribute when the workspace opens, so the route chunk is not its complete transfer size. No dependency or preloading infrastructure was added. The capability gate controls when the lazy admin boundary mounts.

## Tests and visual review

Frontend model/component tests cover gate states, nested refresh, loaded Source edit safety, code/URL preservation and edge cases, offset continuation, create-reset versus update-refresh behavior, explicit 409 recovery, raw Record keys, UUID-only uncertainty, UTC/hash/supersession serialization, optional permissions, append semantics and network/abort distinctions. Delayed reads and pending commands are tested across Actor switch and capability revocation/regrant; protected query and mutation caches are checked for removal.

Playwright prerequisites are deterministic synthetic PLATFORM_ADMIN, buyer and ORG_OWNER-only Actors, active/inactive Sources, paginated Source fixtures, a Record, an Observation and a Review. Test-only TypeScript provisions them directly into local Docker PostgreSQL, following the existing fixture pattern. No production seed endpoint, migration or backend fixture code is added. The main journey creates its own new Source through the real UI/API, edits it, registers a Record, creates/replays/conflicts an Observation, and appends a Review; those tested results are not pre-seeded. Other tests verify buyer/ORG_OWNER denial before protected reads, real capability revocation, transient reload context and a delayed real-backend history response after Actor switch.

Thirty ignored screenshots were captured from the actual React application, fifteen in each origin mode, at 1440×1000 and 390×844. The fifteen same-origin states were visually reviewed, with separate-origin Source/Observation/Review spot checks. They include landing, Sources, create/edit, Record workflow, Observation and Review create/history, a preserved conflict draft, mobile forms/history and access denial. Capture assertions checked document horizontal overflow in all thirty screenshots. Long names, URLs, UUIDs, hashes and notes wrap; mobile fields stack and remain labelled. Hash wrapping, uniform control height and focus placement were improved after review. No remaining page overflow, clipped status labels or obvious unreadable contrast was observed. Ordinary single-line inputs scroll their long editable value within the control; bounded lists and the complete evidence workflow require vertical scrolling. This is functional review, not a new product redesign or an automated accessibility certification.

Artifacts and per-origin request logs are temporary ignored files under `.local/phase1c5a-review/`; image binaries are not committed.

| Final local validation                                     | Observed result                                           |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Frontend Vitest / RTL                                      | 364 passed, 15 files                                      |
| Backend / real PostgreSQL `./mvnw -B verify`               | 212 passed; 0 failures/errors/skips; backend build passed |
| Same-origin Playwright                                     | 12 passed, including four new provenance/authority tests  |
| Separate API-origin Playwright                             | 12 passed, including the full provenance workflow         |
| Frontend typecheck                                         | Passed                                                    |
| Frontend production build                                  | Passed                                                    |
| OpenAPI export + generated TypeScript deterministic checks | Passed; both tracked contracts unchanged                  |
| Terraform fmt / init -backend=false / validate             | Passed                                                    |
| Gitleaks staged scan with redaction                        | Passed; no leaks found                                    |

The backend regression includes the accepted Phase 1C-5P precondition/admin-read tests, migration checks, authorization and module boundaries. All V1–V12 migrations remain byte-identical and V13 is absent. Exact pushed-HEAD SOURCE OS CI is a completion gate; its observed final result and run link are reported with the implementation commit rather than predicting a future commit/run here.

## Deliberately deferred

- Phase 1C-5B Supplier/Facility curation and capability mutation.
- Phase 1C-5C Material/Composition/spec/Variant/Listing curation.
- Phase 1C-5D Price creation/evidence/closure and Inventory append.
- Phase 1C-5E typed canonical identity bindings and final cross-workspace hardening.
- Any global SourceRecord browse/search, arbitrary Source-by-ID lookup, archive management or reference-data mutation.
- Buyer-friendly Source labels (B5): buyer screens retain the accepted UUID/reference fallback and never call protected Source APIs.
- Buyer Material price filtering: it remains disconnected under the accepted provider/currency/unit/explicit-asOf contract decision.
- Phase 2 and RFQ/Quote/BOM/Sample/Production/QC/Shipment workflows.

SourceRecord identity, immutable Observation facts and append-only Review evaluations remain separate concepts. No canonical identity binding or later curation command is actionable in this slice.
