import { expect, test } from "vitest";
import * as m from "./model";
const id = (n: number) =>
  `1c5c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const c = (
  completeness: m.CompositionFields["completeness"],
  values: string[],
) => ({
  completeness,
  parts: values.map((percentage, i) => ({
    fiberTypeId: id(i + 1),
    percentage,
  })),
  observationId: id(9),
});
test.each([
  ["UNKNOWN", [], true],
  ["UNKNOWN", ["1"], false],
  ["PARTIAL", [], false],
  ["PARTIAL", ["80"], true],
  ["PARTIAL", ["50", "50"], true],
  ["PARTIAL", ["50.0001", "50"], false],
  ["COMPLETE", ["33.3333", "66.6667"], true],
  ["COMPLETE", ["99.9999"], false],
] as const)("composition %s %j", (state, values, valid) =>
  expect(m.compositionFields.safeParse(c(state, [...values])).success).toBe(
    valid,
  ),
);
test.each(["0", "-1", "100.0001", "1.00001", "1e2", " 5", "5 ", "0001", ""])(
  "percentage rejects %s",
  (v) =>
    expect(
      m.part.safeParse({ fiberTypeId: id(1), percentage: v }).success,
    ).toBe(false),
);
test("duplicate fiber rejected and PARTIAL exactly 100 preserved", () => {
  const v = c("PARTIAL", ["50", "50"]);
  v.parts[1]!.fiberTypeId = id(1);
  expect(m.compositionFields.safeParse(v).success).toBe(false);
  expect(m.compositionFields.parse(c("PARTIAL", ["100"])).completeness).toBe(
    "PARTIAL",
  );
});
test.each(["0", "-0", "1e1", "1.00001", "1000000", " 1"])(
  "positive fabric gsm rejects %s",
  (gsm) =>
    expect(
      m.fabricFields.safeParse({
        ...m.fabricDefaults,
        observationId: id(1),
        gsm,
      }).success,
    ).toBe(false),
);
test.each(["-100", "-0.0001", "0", "100.0000"])(
  "signed shrinkage accepts %s",
  (v) =>
    expect(
      m.fabricFields.safeParse({
        ...m.fabricDefaults,
        observationId: id(1),
        shrinkageWarpPercentage: v,
      }).success,
    ).toBe(true),
);
test.each(["-100.0001", "100.0001", "1e2"])("shrinkage rejects %s", (v) =>
  expect(
    m.fabricFields.safeParse({
      ...m.fabricDefaults,
      observationId: id(1),
      shrinkageWarpPercentage: v,
    }).success,
  ).toBe(false),
);
test("stretch zero legal, positive widths and construction constraints", () => {
  expect(
    m.fabricFields.safeParse({
      ...m.fabricDefaults,
      observationId: id(1),
      stretchWarpPercentage: "0",
    }).success,
  ).toBe(true);
  expect(
    m.fabricFields.safeParse({
      ...m.fabricDefaults,
      observationId: id(1),
      widthMm: "0",
    }).success,
  ).toBe(false);
  expect(
    m.fabricFields.safeParse({
      ...m.fabricDefaults,
      observationId: id(1),
      construction: "KNIT",
      weaveType: "stale",
    }).success,
  ).toBe(false);
});
test.each(["0", "-1", "1e1", "1.12345", "1000000"])(
  "leather thickness rejects %s",
  (v) =>
    expect(
      m.leatherFields.safeParse({
        ...m.leatherDefaults,
        observationId: id(1),
        thicknessMinMm: v,
      }).success,
    ).toBe(false),
);
test("leather min max compared exactly", () => {
  expect(
    m.leatherFields.safeParse({
      ...m.leatherDefaults,
      observationId: id(1),
      thicknessMinMm: "1.0001",
      thicknessMaxMm: "1.0000",
    }).success,
  ).toBe(false);
  expect(
    m.leatherFields.safeParse({
      ...m.leatherDefaults,
      observationId: id(1),
      averageHideAreaM2: "0",
    }).success,
  ).toBe(false);
});
test.each(["0", "2147483647", "12"])("Int32 accepts %s", (v) =>
  expect(m.int32(v)).toBe(true),
);
test.each(["-1", "2147483648", "1.0", "1e2", "12x", " 1", "01"])(
  "Int32 rejects %s",
  (v) => expect(m.int32(v)).toBe(false),
);
test.each(["999999999999999.9999", "0", "0.0000"])(
  "Listing exact quantity preserved %s",
  (v) => {
    const f = {
      ...m.listingDefaults,
      materialId: id(1),
      sellerSupplierId: id(2),
      observationId: id(3),
      minimumOrderQuantity: v,
      quantityUnit: "METER" as const,
      standardLeadTimeDays: "0",
    };
    expect(m.listingFields.safeParse(f).success).toBe(true);
    expect(m.listingBody(f, 7)).toMatchObject({
      minimumOrderQuantity: v,
      standardLeadTimeDays: 0,
      version: 7,
    });
  },
);
test.each(["1000000000000000", "1.12345", "-1", "1e3"])(
  "Listing quantity rejects %s",
  (v) =>
    expect(
      m.listingFields.safeParse({
        ...m.listingDefaults,
        materialId: id(1),
        sellerSupplierId: id(2),
        observationId: id(3),
        minimumOrderQuantity: v,
        quantityUnit: "PCS",
      }).success,
    ).toBe(false),
);
test.each(m.units)("exact 13 units accept unit-only %s", (quantityUnit) =>
  expect(
    m.listingFields.safeParse({
      ...m.listingDefaults,
      materialId: id(1),
      sellerSupplierId: id(2),
      observationId: id(3),
      quantityUnit,
    }).success,
  ).toBe(true),
);
test("quantity requires unit, blank optional fields omitted", () => {
  const f = {
    ...m.listingDefaults,
    materialId: id(1),
    sellerSupplierId: id(2),
    observationId: id(3),
  };
  expect(
    m.listingFields.safeParse({ ...f, minimumOrderQuantity: "0" }).success,
  ).toBe(false);
  expect(m.listingBody(f, 0)).not.toHaveProperty("quantityUnit");
  expect(m.listingBody(f, 0)).not.toHaveProperty("minimumOrderQuantity");
});
test("attributes exact nine keys scalar round trip", () => {
  const rows: m.AttributeRow[] = m.attributeKeys.map((key, i) => ({
    key,
    type: i === 0 ? "Integer" : i === 1 ? "Boolean" : "String",
    value:
      i === 0 ? "9007199254740991" : i === 1 ? "false" : "1.234567890123456789",
  }));
  expect(m.loadedAttributes(m.attributes(rows))).toEqual(rows);
});
test.each([
  { size: 2.5 },
  { size: 9007199254740992 },
  { size: Infinity },
  { size: null },
  { size: [] },
  { size: {} },
  { unknown: "x" },
  { size: "x".repeat(256) },
  undefined,
])("unsafe loaded attributes block %j", (v) =>
  expect(m.loadedAttributes(v)).toBeUndefined(),
);
test("attribute duplicate/sensitive/new unsafe integer blocked", () => {
  expect(() =>
    m.attributes([
      { key: "size", type: "String", value: "a" },
      { key: "size", type: "Boolean", value: "true" },
    ]),
  ).toThrow();
  expect(() =>
    m.attributes([{ key: "size", type: "String", value: "password=abc" }]),
  ).toThrow();
  expect(() =>
    m.attributes([{ key: "size", type: "Integer", value: "1.5" }]),
  ).toThrow();
});
test("UTF8 bytes not characters enforce attribute payload limit", () => {
  const rows: m.AttributeRow[] = m.attributeKeys.map((key) => ({
    key,
    type: "String",
    value: "漢".repeat(255),
  }));
  expect(m.attributes(rows)).toBeDefined();
  const over = rows.map((r) => ({ ...r, value: "\u0001".repeat(255) }));
  expect(() => m.attributes(over)).toThrow("8192");
});
const material = {
  id: id(1),
  catalogSupplierId: id(2),
  materialType: "FABRIC",
  displayName: "Catalog",
  catalogArticleNumber: null,
  description: null,
  originCountryId: null,
  compositionCompleteness: "PARTIAL",
  composition: [{ fiberTypeId: id(3), percentage: "100.0000" }],
  status: "ACTIVE",
  version: 4,
};
test("profile preserves exact current composition/immutable identity", () => {
  const v = m.materialBaseline(material)!;
  expect(v).toBeDefined();
  expect(
    m.materialBody(
      { ...v, displayName: "Changed", observationId: id(4) },
      {
        completeness: v.compositionCompleteness,
        parts: v.composition,
        observationId: id(4),
      },
      v.version,
    ),
  ).toMatchObject({
    composition: [{ fiberTypeId: id(3), percentage: "100.0000" }],
    compositionCompleteness: "PARTIAL",
    catalogSupplierId: id(2),
    materialType: "FABRIC",
    version: 4,
  });
});
test.each([
  "composition",
  "version",
  "catalogSupplierId",
  "materialType",
  "description",
])("missing loaded Material %s blocks write", (k) => {
  const v = { ...material } as Record<string, unknown>;
  delete v[k];
  expect(m.materialBaseline(v)).toBeUndefined();
});
test.each([undefined, null, -1, 1.5, 9007199254740992, "0"])(
  "unsafe Material version blocks %s",
  (version) =>
    expect(m.materialBaseline({ ...material, version })).toBeUndefined(),
);
test.each(m.materialTypes)("Material type %s", (materialType) =>
  expect(
    m.materialFields.safeParse({
      ...m.materialDefaults,
      catalogSupplierId: id(1),
      displayName: "Test",
      observationId: id(2),
      materialType,
    }).success,
  ).toBe(true),
);
test("Spec baseline checks matching IDs/type/version and optional state", () => {
  const view = {
    ...m.fabricDefaults,
    attributes: null,
    materialId: id(1),
    materialType: "FABRIC",
    version: 0,
  };
  expect(m.specBaseline(view, "FABRIC", id(1))).toBeDefined();
  expect(
    m.specBaseline({ ...view, attributes: { size: 2.2 } }, "FABRIC", id(1)),
  ).toBeUndefined();
  expect(m.specBaseline(view, "FABRIC", id(2))).toBeUndefined();
  expect(
    m.specBaseline({ ...view, gsm: undefined }, "FABRIC", id(1)),
  ).toBeUndefined();
});
test.each(
  [m.materialFacts, m.variantFacts, m.listingFacts].map((facts) => ({ facts })),
)("typed citation allowlist guards all facts", ({ facts }) => {
  for (const fieldName of facts)
    expect(
      m.citation(
        {
          observationId: id(1),
          fieldName,
          createdAt: "2026-10-21T12:00:00Z",
          extra: "ignore",
        },
        facts,
      ),
    ).toBeDefined();
  expect(
    m.citation(
      { observationId: id(1), fieldName: "arbitrary", createdAt: "now" },
      facts,
    ),
  ).toBeUndefined();
  expect(
    m.citation({ observationId: 3, fieldName: "RECORD", createdAt: {} }, facts),
  ).toBeUndefined();
});

test("attributes accept exactly 8192 encoded bytes and block 8193", () => {
  const rows: m.AttributeRow[] = m.attributeKeys.map((key) => ({
    key,
    type: "String",
    value: "",
  }));
  let remaining =
    8192 -
    new TextEncoder().encode(
      JSON.stringify(Object.fromEntries(rows.map((r) => [r.key, r.value]))),
    ).length;
  for (const row of rows) {
    while (row.value.length < 255 && remaining) {
      const bytes = remaining >= 6 ? 6 : 1;
      row.value += bytes === 6 ? "\u0001" : "x";
      remaining -= bytes;
    }
  }
  expect(remaining).toBe(0);
  const v = m.attributes(rows);
  expect(new TextEncoder().encode(JSON.stringify(v)).length).toBe(8192);
  rows.at(-1)!.value += "x";
  expect(() => m.attributes(rows)).toThrow("8192");
});
