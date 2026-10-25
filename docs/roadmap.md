# Roadmap

| Phase | Product boundary | Current authority/state |
| --- | --- | --- |
| 0 | Foundation | Accepted |
| 1 | Supply Database / Discovery / Curation | Accepted through Phase 1C, merged in PR #3 |
| 2 | Product Workspace | Accepted through 2G and strict timestamp Correction A; integrated into main through [PR #4](https://github.com/Croco-JY/codex/pull/4) by merge commit `41c629cce3bcdf5abf776cf33784631a4e150667` |
| 3 | Product Development / Pattern Operations | [3A Measurement Foundation](phase-3a-measurement-foundation.md) accepted; [3B Pattern Vault](phase-3b-pattern-vault.md) accepted; [3C Pattern Artifacts](phase-3c-pattern-artifacts.md) implemented pending independent review; later slices remain separately planned under the [contract lock](phase-3-plan.md) |
| 4 | SOURCE Pattern AI | Future |
| 5 | Sourcing / RFQ / Quotations | Future |
| 6 | Contracts / Approvals | Future |
| 7 | Protected Payments | Future |
| 8 | Production / QC / Shipment | Future |
| 9 | Intelligence / Reorder | Future |

The workflow is DISCOVER → DEVELOP → SOURCE → TRANSACT → PRODUCE → LEARN. Phase 2 supplies the accepted private Organization → Project → Style workspace with Requirement, Material Selections, Facility Candidates and Development References. Its final HEAD `e79dde2becfaf15d951a924749e793b1d09313f8` remains in main ancestry. Resulting main [CI 40118844964](https://github.com/Croco-JY/codex/actions/runs/40118844964) completed successfully on attempt 2; the first backend-step failure remains undiagnosed because logs/artifacts were inaccessible. See the Phase 3 plan for the complete integration evidence.

Phase 3 reconciles the master specification's SOURCE Pattern Operations with deterministic human-controlled measurement/pattern/grading/QA/release infrastructure. AI remains Phase 4 and RFQ/quotations Phase 5. Tech Pack, BOM and Sample implementation ownership needs a separate roadmap decision; none is implicitly authorized by Phase 3. Paid Pattern Service/pricing also needs a separate decision after the deterministic spine exists.

Historical Phase 0 execution limits governed the original task; this roadmap and subsequent explicit accepted tasks establish current authority. Historical Phase 2 and Phase 3 PLAN records remain unchanged. The PLAN itself was documentation-only; the separately authorized 3A introduces V18, atomic revision 1, exact immutable POM snapshots, stale-head concurrency and a lazy Measurements route. The separately authorized 3B adds V19 metadata-only Pattern revisions and lifecycle. The separately authorized 3C adds V20 retained private artifacts only on new immutable revisions, bounded structural probes and explicit private download/recovery. No geometry, preview, grading, QA or release is implemented.
