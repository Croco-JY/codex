import { test, expect } from "vitest";
import { ApiError } from "../../api/errors";
import {
  revision,
  grading,
  summary,
  S,
  GID,
  id,
} from "../../test/gradingFixture";
import {
  checkedRevision,
  checkedHistoricalRevision,
  checkedGrading,
  checkedPage,
  checkedHistory,
  checkedLifecycle,
  draftOf,
  bodyOf,
  trimBoundary,
  isZero,
} from "./model";
test("historical summary correspondence preserves exact strings, Unicode and arbitrary signed deltas", () => {
  const r = revision();
  r.name = "🧵 Historical grading";
  r.createdAt = "2026-10-26T00:00:00.123456Z";
  r.sizes[0].label = "작은 사이즈 🧵";
  r.rules[0].values[0].delta = "999999999999999.9999";
  r.rules[0].values[1].delta = "-0.0000";
  r.rules[0].values[2].delta = "-7.1250";
  expect(checkedHistoricalRevision(r, S, GID, summary(r))).toEqual(r);
});
test.each([
  "id",
  "gradeRuleSetId",
  "styleId",
  "revisionNumber",
  "name",
  "baseSizeCode",
  "unitSystem",
  "createdAt",
  "sizeCount",
  "ruleCount",
])("historical summary mismatch %s is ApiError 502", (field) => {
  const r = revision(),
    expected = summary(r);
  switch (field) {
    case "id":
      r.id = id(99);
      break;
    case "gradeRuleSetId":
      r.gradeRuleSetId = id(99);
      break;
    case "styleId":
      r.styleId = id(99);
      break;
    case "revisionNumber":
      r.revisionNumber = 999;
      break;
    case "name":
      r.name = "Contradictory name";
      break;
    case "baseSizeCode":
      r.baseSizeCode = "S0";
      r.rules.forEach((g) => {
        g.values[0].delta = "0";
      });
      break;
    case "unitSystem":
      r.unitSystem = "IN";
      break;
    case "createdAt":
      r.createdAt = "2026-10-26T00:00:00Z";
      break;
    case "sizeCount":
      r.sizes.pop();
      r.rules.forEach((g) => {
        g.values.pop();
      });
      break;
    case "ruleCount":
      r.rules.pop();
      break;
  }
  // Every counterexample remains a valid standalone snapshot.
  expect(checkedRevision(r, r.styleId, r.gradeRuleSetId)).toEqual(r);
  expect(() => checkedHistoricalRevision(r, S, GID, expected)).toThrow(
    expect.objectContaining({ name: "ApiError", status: 502 }),
  );
});
test("historical timestamp comparison retains submillisecond precision and exact serialization", () => {
  const r = revision();
  r.createdAt = "2026-10-26T00:00:00.123456Z";
  const expected = summary(r);
  for (const createdAt of [
    "2026-10-26T00:00:00.123457Z",
    "2026-10-26T09:00:00.123456+09:00",
  ]) {
    expect(() =>
      checkedHistoricalRevision({ ...r, createdAt }, S, GID, expected),
    ).toThrow(expect.objectContaining({ name: "ApiError", status: 502 }));
  }
});
test.each([
  "duplicate-size",
  "duplicate-rule",
  "position",
  "decimal",
  "base-nonzero",
  "matrix-order",
  "extra-field",
])("matching summary never bypasses structural validation: %s", (kind) => {
  const r = revision(),
    expected = summary(r);
  switch (kind) {
    case "duplicate-size":
      r.sizes[2].code = r.sizes[0].code;
      break;
    case "duplicate-rule":
      r.rules[1].code = r.rules[0].code;
      break;
    case "position":
      r.sizes[0].position = 2;
      break;
    case "decimal":
      r.rules[0].values[0].delta = 2 as never;
      break;
    case "base-nonzero":
      r.rules[0].values[1].delta = "1";
      break;
    case "matrix-order":
      r.rules[0].values.reverse();
      break;
    case "extra-field":
      Object.assign(r, { sealed: true });
      break;
  }
  expect(() => checkedHistoricalRevision(r, S, GID, expected)).toThrow(
    expect.objectContaining({ name: "ApiError", status: 502 }),
  );
});
test("exact values, arbitrary explicit order and nonfirst base survive full hydration", () => {
  const r = revision();
  r.rules[0].values[0].delta = "-999999999999999.9999";
  r.rules[0].values[1].delta = "-0.0000";
  expect(checkedRevision(r, S, GID)).toEqual(r);
  expect(checkedGrading(grading(), S)).toEqual(grading());
  expect(bodyOf(draftOf(r)).rules[0].values[0].delta).toBe(
    "-999999999999999.9999",
  );
});
test.each(["0", "0.0", "0.0000", "-0.0000", "000.0000"])(
  "mathematical zero %s",
  (v) => {
    const r = revision();
    r.rules.forEach((g) => {
      g.values[1].delta = v;
    });
    expect(checkedRevision(r, S, GID)).toEqual(r);
    expect(isZero(v)).toBe(true);
  },
);
test.each([
  1,
  null,
  "NaN",
  "Infinity",
  "1e2",
  "+1",
  ".1",
  "1.",
  "0.00001",
  "1000000000000000",
  "",
  {},
  true,
])("reject delta %s", (v) => {
  const r = revision();
  r.rules[0].values[0].delta = v as never;
  expect(() => checkedRevision(r, S, GID)).toThrow(ApiError);
});
test.each(["id", "styleId", "gradeRuleSetId"])(
  "reject foreign identity %s",
  (key) => {
    expect(() =>
      checkedRevision(
        { ...revision(), [key]: key === "id" ? "bad" : id(99) },
        S,
        GID,
      ),
    ).toThrow(ApiError);
  },
);
test.each(["2026-10-26", "2026-10-26T00:00:00", "yesterday", null])(
  "reject offsetless/invalid time %s",
  (createdAt) => {
    expect(() =>
      checkedRevision({ ...revision(), createdAt } as never, S, GID),
    ).toThrow(ApiError);
  },
);
test.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
  "reject revision number %s",
  (revisionNumber) => {
    expect(() =>
      checkedRevision({ ...revision(), revisionNumber } as never, S, GID),
    ).toThrow(ApiError);
  },
);
test.each([
  "duplicate-size",
  "duplicate-rule",
  "size-gap",
  "rule-gap",
  "base-missing",
  "base-nonzero",
  "partial",
  "wrong-order",
  "too-many-sizes",
  "empty-rules",
  "creator",
])("reject matrix corruption %s", (kind) => {
  const r = revision();
  switch (kind) {
    case "duplicate-size":
      r.sizes[1].code = r.sizes[0].code;
      break;
    case "duplicate-rule":
      r.rules[1].code = r.rules[0].code;
      break;
    case "size-gap":
      r.sizes[1].position = 2;
      break;
    case "rule-gap":
      r.rules[0].position = 1;
      break;
    case "base-missing":
      r.baseSizeCode = "OTHER";
      break;
    case "base-nonzero":
      r.rules[0].values[1].delta = "1";
      break;
    case "partial":
      r.rules[0].values.pop();
      break;
    case "wrong-order":
      r.rules[0].values.reverse();
      break;
    case "too-many-sizes":
      r.sizes = revision(1, undefined, 31).sizes;
      break;
    case "empty-rules":
      r.rules = [];
      break;
    case "creator":
      Object.assign(r, { createdBySubject: "private" });
      break;
  }
  expect(() => checkedRevision(r, S, GID)).toThrow(ApiError);
});
test.each([
  "\t",
  "\n",
  " ",
  "\u0085",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2007",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
])("exact Unicode boundary %s", (space) => {
  expect(trimBoundary(space + "Value" + space)).toBe("Value");
  const d = draftOf(revision());
  d.name = space + "Value" + space;
  expect(bodyOf(d).name).toBe("Value");
  expect(() =>
    checkedRevision({ ...revision(), name: space + "Value" }, S, GID),
  ).toThrow(ApiError);
});
test("supplementary Unicode uses code points, retaining interior whitespace", () => {
  const d = draftOf(revision());
  d.name = "🧵".repeat(160);
  d.notes = "a\u0085b\ufeffc";
  expect(bodyOf(d).name).toBe(d.name);
  d.name += "🧵";
  expect(() => bodyOf(d)).toThrow();
});
test("draft cloning and reconciliation do not change cached immutable truth", () => {
  const r = revision(),
    d = draftOf(r);
  d.rules[0].values[0].delta = "-3.75";
  d.sizes.reverse();
  expect(r.rules[0].values[0].delta).toBe("-2.5000");
  expect(r.sizes[0].code).toBe("S0");
  expect(() => bodyOf(d)).toThrow();
});
test("base change does not rebase values or invent zeros", () => {
  const d = draftOf(revision());
  d.baseSizeCode = "S0";
  expect(d.rules[0].values[0].delta).toBe("-2.5000");
  expect(() => bodyOf(d)).toThrow();
});
test.each(["", 42, "a b", "x".repeat(2049)])(
  "opaque cursor shape %s",
  (cursor) => {
    expect(() =>
      checkedPage({ items: [], limit: 25, nextCursor: cursor }, S, "ACTIVE"),
    ).toThrow(ApiError);
  },
);
test("compact collection/history/lifecycle use summary DTOs with identity", () => {
  const g = grading(),
    compact = { ...g, latestRevision: summary(g.latestRevision) };
  expect(
    checkedPage({ items: [compact], limit: 25, nextCursor: null }, S, "ACTIVE")
      .items,
  ).toHaveLength(1);
  expect(checkedLifecycle(compact, S, GID)).toEqual(compact);
  expect(() => checkedLifecycle(g, S, GID)).toThrow(ApiError);
  expect(() =>
    checkedPage(
      { items: [compact, compact], limit: 25, nextCursor: null },
      S,
      "ALL",
    ),
  ).toThrow(ApiError);
  expect(() =>
    checkedPage(
      {
        items: [{ ...compact, status: "ARCHIVED" }],
        limit: 25,
        nextCursor: null,
      },
      S,
      "ACTIVE",
    ),
  ).toThrow(ApiError);
  expect(
    checkedHistory(
      {
        items: [summary(revision(3)), summary(revision(2))],
        limit: 2,
        nextMaxRevisionNumber: 1,
      },
      S,
      GID,
      3,
      2,
    ).items,
  ).toHaveLength(2);
  for (const items of [
    [summary(revision(2)), summary(revision(3))],
    [summary(revision(4))],
    [summary(revision(3)), summary(revision(3))],
  ])
    expect(() =>
      checkedHistory(
        { items, limit: 25, nextMaxRevisionNumber: null },
        S,
        GID,
        3,
      ),
    ).toThrow(ApiError);
});
test("maximum 3000-value exact snapshot hydrates without floating arithmetic", () => {
  const r = revision(1, undefined, 30, 100),
    start = performance.now();
  const v = checkedRevision(r, S, GID);
  expect(v.rules.flatMap((g) => g.values)).toHaveLength(3000);
  console.info("GRADING_MAX_HYDRATION_MS", performance.now() - start);
});
