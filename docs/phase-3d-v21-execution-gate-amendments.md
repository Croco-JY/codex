# SOURCE OS — Phase 3D V21 Execution Gate and Contract Amendments

**Status:** Documentation-only preparation; production implementation NOT started.
**Implementation target:** `phase-3-pattern-operations`
**Required parent SHA:** `7381303483644ba875305b413d7e3d6047f70aa1`
**Implementation commit message:** `feat: add grading revisions`

## Gate update (2026-10-26 KST)

- PR #6 `docs: correct SOURCE OS commercial architecture against Phase 3C V20` was closed **without merge**, preserving its documentation branch.
- Live repository-wide open PR count recheck: **0**.
- Live Phase 3C implementation HEAD recheck: `7381303483644ba875305b413d7e3d6047f70aa1`, unchanged.
- CI run `40185095517`: exact SHA, push, attempt 1, completed/success.
- These remotely observed facts DO NOT substitute for Codex-local clean-worktree, Flyway, migration-byte-identity, acceptance and repeated PR pre-commit/pre-push checks.
- No V21 or production source changes were made as part of this gate adjustment.

## Required contract amendments to canonical 0–27 execution spec

### Section 4.4 / 5.4 / 6.4 — exact Unicode boundary policy

No loose equivalence claims between Java `trim()`/`strip()` and PostgreSQL POSIX `[[:space:]]`. Define one fixed boundary code-point set: U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Java explicitly strips this set only at field boundaries; V21 SQL CHECK uses an equivalent explicit `btrim(value, constructed_chr_set)` and `char_length`. Java uses `codePointCount` rather than UTF-16 `String.length()`. Direct-SQL boundary input is rejected; API canonicalizes it. Test same values and Unicode supplementary length against real PostgreSQL.

### Section 5.5 / 8.9 — intentional FK cycle

Create `grade_rule_set_revision` and `grade_size` tables and keys first, then:

```sql
ALTER TABLE grade_rule_set_revision
  ADD CONSTRAINT grade_revision_base_size_fk
  FOREIGN KEY (id, base_size_code)
  REFERENCES grade_size(revision_id, code)
  DEFERRABLE INITIALLY DEFERRED;
```

Keep the reverse child→parent FK. Require direct-SQL proof of successful one-TX revision→sizes→rules→values→seal→commit, plus failed missing and cross-revision base-size commit; test `SET CONSTRAINTS ALL IMMEDIATE`.

### Section 8.15–8.17 — completeness at revision/aggregate level

Bind deferred aggregate completeness to new `grade_rule_set` rows and deferred revision completeness to new `grade_rule_set_revision` rows, **never per `grade_rule_value` row**. Enforce sealed revision1, 2–30 sizes, 1–100 rules, contiguous positions, exact Cartesian `N×R` value count under composite FKs/PK, and mathematical base zero. Normal one-revision creation performs one deferred per-revision full completeness check; any additional seal-time scan is separately counted and justified. Verify 3,000 values do not cause 3,000 full-matrix scans. Construction row events may perform cheap seal/FK checks only.

### Testing/reporting additions

Record FK/trigger definitions, valid/invalid deferred commit behavior, `SET CONSTRAINTS ALL IMMEDIATE`, completeness-check event/query counts, 30×100 snapshot insert/commit performance, Java/DB whitespace differential cases, and a fresh execution gate snapshot.

**STOP:** Do not start V21 based only on this amendment document. Use the full canonical Section 0–27 execution specification plus final directive and verify every live gate before any production edit.
