import { test, expect } from "vitest";
import {
  assessment,
  qa,
  summary,
  revision,
  id,
} from "../../test/patternQaFixture";
import {
  checkedQa,
  checkedAssessment,
  checkedHistorical,
  checkedHistory,
  trimNotes,
  bodyOf,
} from "./model";
const rejected = expect.objectContaining({ name: "ApiError", status: 502 });
test("UNREVIEWED is null and exact current assessment is standalone complete", () => {
  expect(checkedQa(qa(), revision())).toEqual(qa());
  expect(checkedQa(qa(1), revision())).toEqual(qa(1));
});
test.each(["OBSERVED", "CHANGES_REQUESTED", "HUMAN_REVIEWED"] as const)(
  "truthful outcome %s",
  (outcome) => {
    const a = {
      ...assessment(),
      outcome,
      ...(outcome === "HUMAN_REVIEWED"
        ? { evidenceBasis: "READY_ARTIFACT" as const, artifactId: id(900) }
        : {}),
    };
    expect(checkedAssessment(a, revision())).toEqual(a);
  },
);
test.each([
  "state",
  "latest-state",
  "null-state",
  "pattern",
  "revision",
  "style",
  "number",
  "creator",
])("current QA corruption %s", (key) => {
  const q = qa(1);
  if (key === "state") q.state = "PRODUCTION_VERIFIED" as never;
  if (key === "latest-state") q.state = "CHANGES_REQUESTED";
  if (key === "null-state") q.latestAssessment = null;
  if (key === "pattern") q.patternId = id(99);
  if (key === "revision") q.patternRevisionId = id(99);
  if (key === "style") q.styleId = id(99);
  if (key === "number") q.patternRevisionNumber = 999;
  if (key === "creator") Object.assign(q, { reviewerSubject: "private" });
  expect(() => checkedQa(q, revision())).toThrow(rejected);
});
test.each([
  "id",
  "patternRevisionId",
  "styleId",
  "assessmentNumber",
  "outcome",
  "evidenceBasis",
  "artifactId",
  "reviewedAt",
] as const)("historical/cached immutable field mismatch %s", (key) => {
  const a = assessment(),
    expected = summary(a);
  if (key === "id" || key === "patternRevisionId" || key === "styleId")
    a[key] = id(99);
  if (key === "assessmentNumber") a.assessmentNumber = 999;
  if (key === "outcome") a.outcome = "CHANGES_REQUESTED";
  if (key === "evidenceBasis" || key === "artifactId") {
    a.evidenceBasis = "READY_ARTIFACT";
    a.artifactId = id(900);
  }
  if (key === "reviewedAt") a.reviewedAt = "2026-10-27T00:00:00.123456Z";
  expect(() => checkedHistorical(a, revision(), expected)).toThrow(rejected);
});
test("matching historical response accepted and timestamps compare full serialized precision", () => {
  const a = assessment();
  a.reviewedAt = "2026-10-27T00:00:00.123456Z";
  expect(checkedHistorical(a, revision(), summary(a))).toEqual(a);
  expect(() =>
    checkedHistorical(
      { ...a, reviewedAt: "2026-10-27T00:00:00.123457Z" },
      revision(),
      summary(a),
    ),
  ).toThrow(rejected);
});
test.each(["2026-10-27", "2026-10-27T00:00:00", "invalid", null])(
  "strict timestamp %s",
  (reviewedAt) => {
    expect(() =>
      checkedAssessment({ ...assessment(), reviewedAt }, revision()),
    ).toThrow(rejected);
  },
);
test.each([0, -1, 1.1, "1", Number.MAX_SAFE_INTEGER + 1])(
  "assessment integer %s",
  (assessmentNumber) => {
    expect(() =>
      checkedAssessment({ ...assessment(), assessmentNumber }, revision()),
    ).toThrow(rejected);
  },
);
test.each([
  null,
  "",
  " notes",
  "notes\u0085",
  "bad\u0000",
  "\ud800",
  "🧵".repeat(2001),
])("stored notes reject %s", (notes) => {
  expect(() =>
    checkedAssessment({ ...assessment(), notes }, revision()),
  ).toThrow(rejected);
});
test.each([
  "\t",
  "\n",
  "\u000b",
  "\u000c",
  "\r",
  " ",
  "\u0085",
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2001",
  "\u2002",
  "\u2003",
  "\u2004",
  "\u2005",
  "\u2006",
  "\u2007",
  "\u2008",
  "\u2009",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
  "\ufeff",
])("fixed boundary %s canonicalizes draft only", (edge) => {
  expect(trimNotes(edge + "Note" + edge)).toBe("Note");
  expect(
    bodyOf(
      {
        outcome: "OBSERVED",
        evidenceBasis: "METADATA_ONLY",
        notes: edge + "Note" + edge,
      },
      0,
      null,
    ).notes,
  ).toBe("Note");
});
test("human attestation needs exact READY artifact; metadata may not attach one", () => {
  const d = {
    outcome: "HUMAN_REVIEWED" as const,
    evidenceBasis: "READY_ARTIFACT" as const,
    notes: "Human review 🧵",
  };
  for (const state of ["PENDING", "FAILED"])
    expect(() => bodyOf(d, 0, { id: id(900), state })).toThrow();
  expect(() =>
    bodyOf({ ...d, evidenceBasis: "METADATA_ONLY" }, 0, null),
  ).toThrow();
  expect(bodyOf(d, 0, { id: id(900), state: "READY" })).toMatchObject({
    expectedLatestAssessmentNumber: 0,
    artifactId: id(900),
  });
});
test.each(["order", "foreign", "number", "cursor", "extra"])(
  "strict anchored history %s",
  (kind) => {
    const page = {
      items: [summary(assessment(2)), summary(assessment(1))],
      limit: 2,
      nextMaxAssessmentNumber: null as number | null,
    };
    if (kind === "order") page.items.reverse();
    if (kind === "foreign") page.items[0].patternRevisionId = id(99);
    if (kind === "number") page.items[0].assessmentNumber = 3;
    if (kind === "cursor") page.nextMaxAssessmentNumber = 1;
    if (kind === "extra")
      Object.assign(page.items[0], { notes: "private list payload" });
    expect(() => checkedHistory(page, revision(), 2, 2)).toThrow(rejected);
  },
);
