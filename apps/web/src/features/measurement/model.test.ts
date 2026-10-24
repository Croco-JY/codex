import { expect, test } from "vitest";
import { ApiError } from "../../api/errors";
import {
  bodyOf,
  checkedSpec,
  checkedRevision,
  checkedPage,
  draftOf,
  type Spec,
  type Revision,
  type Page,
} from "./model";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-24T09:00:00+09:00",
  style = id(1),
  spec = id(2);
const revision = (): Revision => ({
  id: id(3),
  measurementSpecId: spec,
  styleId: style,
  revisionNumber: 1,
  baseSize: "M",
  unitSystem: "CM",
  createdAt: stamp,
  points: [
    {
      position: 0,
      code: "CHEST",
      label: "Chest",
      value: "0.0000",
      tolerancePlus: null,
      toleranceMinus: "0.5",
      notes: null,
    },
  ],
});
const value = (): Spec => ({
  id: spec,
  styleId: style,
  createdAt: stamp,
  latestRevision: revision(),
});
function rejected(call: () => unknown) {
  expect(call).toThrow(ApiError);
  try {
    call();
  } catch (e) {
    expect((e as ApiError).status).toBe(502);
  }
}
test.each([
  { id: "bad" },
  { styleId: id(9) },
  { createdAt: "2026-10-24" },
  { createdAt: "2026-10-24T12:00:00" },
  { latestRevision: null },
])("spec fail-closed patch %#", (patch) =>
  rejected(() => checkedSpec({ ...value(), ...patch } as Spec, style)),
);
test.each([
  { id: "" },
  { measurementSpecId: id(9) },
  { styleId: id(9) },
  { revisionNumber: 0 },
  { revisionNumber: 1.5 },
  { revisionNumber: Number.MAX_SAFE_INTEGER + 1 },
  { baseSize: " M" },
  { baseSize: "" },
  { unitSystem: "mm" },
  { createdAt: "not-a-date" },
  { createdAt: "2026-10-24" },
  { createdAt: "2026-10-24T12:00:00" },
  { points: [] },
  {
    points: Array.from({ length: 501 }, (_, i) => ({
      ...revision().points[0],
      position: i,
      code: `P${i}`,
    })),
  },
])("revision malformed patch %#", (patch) =>
  rejected(() =>
    checkedRevision({ ...revision(), ...patch } as Revision, style, spec),
  ),
);
test.each([
  { position: 1 },
  { position: -1 },
  { position: 1.5 },
  { code: "chest" },
  { code: " CHEST" },
  { code: "CHEST " },
  { code: "A B" },
  { code: "A?" },
  { label: " Chest" },
  { label: "" },
  { value: 12 },
  { value: "-1" },
  { value: "1e3" },
  { value: ".5" },
  { value: "1." },
  { value: "0.00001" },
  { value: "1000000000000000" },
  { tolerancePlus: "-1" },
  { toleranceMinus: 1 },
  { notes: " note " },
  { notes: "" },
  { notes: undefined },
])("point malformed patch %#", (patch) => {
  const r = revision();
  r.points[0] = { ...r.points[0], ...patch } as Revision["points"][number];
  rejected(() => checkedRevision(r, style, spec));
});
test("duplicate codes, positions and wrong requested revision ID reject", () => {
  for (const duplicate of [true, false]) {
    const r = revision();
    r.points.push({
      ...r.points[0],
      position: duplicate ? 1 : 0,
      code: duplicate ? "CHEST" : "SECOND",
    });
    rejected(() => checkedRevision(r, style, spec));
  }
  rejected(() => checkedRevision(revision(), style, spec, id(99)));
});
test.each(["0", "0.0000", "12.5", "00012.5", "999999999999999.9999"])(
  "exact decimal %s stays a string",
  (value) => {
    const r = revision();
    r.points[0].value = value;
    expect(checkedRevision(r, style, spec)).toBe(r);
    expect(bodyOf(draftOf(r)).points[0].value).toBe(value);
  },
);
test.each([
  "2026-10-24T00:00:00Z",
  "2026-10-24T12:34:56.123Z",
  "2026-10-24T09:00:00+09:00",
])("timezone timestamp %s accepted", (createdAt) =>
  expect(
    checkedRevision({ ...revision(), createdAt }, style, spec).createdAt,
  ).toBe(createdAt),
);
const summary = (n: number) => {
  const { points, ...r } = revision();
  return { ...r, id: id(20 + n), revisionNumber: n, pointCount: points.length };
};
const page = (): Page => ({
  items: [summary(3), summary(2)],
  limit: 2,
  nextMaxRevisionNumber: 1,
});
test.each([
  { limit: 25 },
  { nextMaxRevisionNumber: 0 },
  { nextMaxRevisionNumber: 2 },
  { nextMaxRevisionNumber: 3 },
  { nextMaxRevisionNumber: 1.5 },
  { nextMaxRevisionNumber: "1" },
  { items: [] },
  { items: [summary(4), summary(2)] },
  { items: [summary(2), summary(3)] },
  { items: [summary(2), summary(2)] },
  { items: [{ ...summary(3), styleId: id(9) }, summary(2)] },
  { items: [{ ...summary(3), measurementSpecId: id(9) }, summary(2)] },
  { items: [{ ...summary(3), pointCount: 0 }, summary(2)] },
  { items: [{ ...summary(3), pointCount: 501 }, summary(2)] },
])("history invalid patch %#", (patch) =>
  rejected(() =>
    checkedPage({ ...page(), ...patch } as Page, style, spec, 2, 3),
  ),
);
test("history cursor is next extra row, not offset; empty final page is valid", () => {
  expect(checkedPage(page(), style, spec, 2, 3)).toEqual(page());
  expect(
    checkedPage(
      { items: [], limit: 2, nextMaxRevisionNumber: null },
      style,
      spec,
      2,
      3,
    ).items,
  ).toEqual([]);
});
test("draft clones immutable content, trims text, omits all authority and position fields", () => {
  const r = revision(),
    d = draftOf(r);
  d.baseSize = " L ";
  d.points[0].label = " New label ";
  d.points[0].notes = " \n ";
  expect(r.points[0].label).toBe("Chest");
  const b = bodyOf(d);
  expect(Object.keys(b).sort()).toEqual(["baseSize", "points", "unitSystem"]);
  expect(b.baseSize).toBe("L");
  expect(b.points[0]).toEqual({
    code: "CHEST",
    label: "New label",
    value: "0.0000",
    tolerancePlus: null,
    toleranceMinus: "0.5",
    notes: null,
  });
  d.points.push({ ...d.points[0] });
  expect(() => bodyOf(d)).toThrow();
});
