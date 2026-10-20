# Phase 1C-5P — HTTP create-only precondition correction

This is a specification correction only. It does not implement or claim to validate the future API behavior. It supersedes the proposed create-only conflict outcome in [CL-A2](phase-1c-5-contract-lock.md#20-a--b--c-gap-register); the baseline implementation findings in that document remain historical evidence.

The complete Phase 1C-5P specification is not present in this checkout. The section numbers below identify the supplied replacements for that specification, rather than sections of the earlier contract-lock document. All other Phase 1C-5P requirements remain unchanged and are not reconstructed here.

Implementation follow-up: the subsequent authorized Phase 1C-5P backend correction implements this status contract and resolves CL-A1/CL-A2; see the updated [contract lock](phase-1c-5-contract-lock.md#20-a--b--c-gap-register). References below to the documentation-only pass describe this amendment's original preparation, not the later implementation or its separately reported validation results.

## HTTP precondition rule

The supported create-only request precondition is `If-None-Match: *`. For PUT, a false condition returns **412 Precondition Failed**, including a concurrent first-write loser. It must never be translated into 409 or converted into an update.

Header omission means update-only. A supplied blank or unsupported header is invalid; it must not be treated as omission. Create-only requires body `version = 0`; that version alone is not an expected-absence token. Existing project optimistic-lock and identity conflicts retain 409.

These rules apply separately to all three existing PUT operations:

- `/api/v1/admin/facilities/{id}/capabilities/{capability}`
- `/api/v1/admin/materials/{id}/fabric-spec`
- `/api/v1/admin/materials/{id}/leather-spec`

## Replacement §9 — Facility Capability create-only outcome

For `PUT /api/v1/admin/facilities/{id}/capabilities/{capability}` with `If-None-Match: *`, perform an atomic create-only operation. Keep all other requirements unchanged.

- An absent target with body version 0 may be inserted at stored version 0. Append the winner's provenance/audit and return the existing success response.
- An existing target, including stored version 0, returns 412.
- If another request creates the target first, the losing create-only request returns 412.
- Never turn a failed precondition into an update. The loser must not modify the winner or append citation, evidence, provenance or audit state.

## Replacement §13 — FabricSpec create-only outcome

For `PUT /api/v1/admin/materials/{id}/fabric-spec` with `If-None-Match: *`, an absent FabricSpec with body version 0 may be created at stored version 0, using the existing success response.

Any existing FabricSpec, including stored version 0, returns 412. A concurrent first-write loser also returns 412. The winner remains unchanged at version 0; the loser must not overwrite it or append citation, evidence, provenance or audit state.

## Replacement §15 — LeatherSpec create-only outcome

For `PUT /api/v1/admin/materials/{id}/leather-spec` with `If-None-Match: *`, an absent LeatherSpec with body version 0 may be created at stored version 0, using the existing success response.

Any existing LeatherSpec, including stored version 0, returns 412. A concurrent first-write loser also returns 412. The winner remains unchanged at version 0; the loser must not overwrite it or append citation, evidence, provenance or audit state.

## Replacement §20 — Error semantics

| Status | Required meaning |
| --- | --- |
| **400 Bad Request** | Unsupported or blank `If-None-Match`; `If-None-Match: *` with body `version != 0`; ordinary validation failure. |
| **403 Forbidden** | Non-PLATFORM_ADMIN protected access, subject to existing request validation/authentication behavior. |
| **404 Not Found** | Update-only target absent, including body version 0; targeted admin Capability read target absent; genuinely missing parent/reference according to existing semantics. |
| **409 Conflict** | Update-only stale version; existing project identity/version conflicts unrelated to the HTTP create-only precondition. |
| **412 Precondition Failed** | `If-None-Match: *` target already exists, including stored version 0; concurrent create-only first-write loser. |

Continue using the existing Problem Details machinery and preserve request/reference ID. Do not introduce a new error-code framework. Preserve existing parent/reference semantics rather than reclassifying every integrity conflict as a missing record.

## Replacement §22 — Concurrency tests

Run concurrent create-only tests separately for Facility Capability, FabricSpec and LeatherSpec. Both requests must express create intent with `If-None-Match: *` and body version 0 against the same initially absent target.

For each resource, assert the observed HTTP and committed database outcomes:

1. Exactly one request succeeds using the existing success response.
2. The losing create-only request receives 412, not 409.
3. Exactly one target exists and its stored version remains 0.
4. The loser does not modify any winning values.
5. Only the winner's expected citation/evidence/provenance/audit state exists; the loser appends none.

## Replacement §23 — Sequential and outcome tests

Apply the entire matrix to each of the three resources. `N` denotes an existing version and must include a nonzero version test case.

| Mode / header | Target / request | Expected outcome |
| --- | --- | --- |
| Create-only: `If-None-Match: *` | Absent; body version 0 | Success; stored version 0. |
| Create-only: `If-None-Match: *` | Existing stored version 0; body version 0 | 412; target unchanged. |
| Create-only: `If-None-Match: *` | Existing stored version N; body version 0 | 412; target unchanged. |
| Create-only: `If-None-Match: *` | Concurrent first-write loser; body version 0 | 412; winner unchanged at version 0. |
| Create-only: `If-None-Match: *` | Body version is nonzero | 400. |
| Invalid precondition header | Unsupported value | 400. |
| Invalid precondition header | Supplied blank value | 400; do not treat as omitted. |
| Update-only: header omitted | Existing stored version 0; body version 0 | Success; stored version becomes 1. |
| Update-only: header omitted | Existing stored version N; matching body version N | Success; stored version becomes N+1. |
| Update-only: header omitted | Existing target; stale body version | 409; no overwrite. |
| Update-only: header omitted | Target absent, including body version 0 | 404; no insert. |

For failed create-only requests, also assert that no citation/evidence/provenance/audit state is appended. A 412 must not trigger an automatic update retry.

## Completion report correction — CL-A2

After implementation and its tests, the CL-A2 completion report must explicitly report the **observed** results for each affected resource:

- 400 for invalid precondition requests, including nonzero create version and unsupported/blank header.
- 404 for a missing update-only target, including request version 0.
- 409 for stale optimistic-lock updates.
- 412 for an existing target under the create-only precondition.
- Concurrent first-write behavior: one success, one 412, winner version 0, unchanged winning values, and no losing audit/provenance state.

This documentation pass provides no runtime observations or test totals for those future behaviors. It makes no backend, frontend, test, OpenAPI, generated contract or migration changes and does not begin Phase 1C-5P execution.
