import { describe, expect, test } from "vitest";
import { compareDecimal, decimal } from "./decimal";
import {
  draftFrom,
  parseFilters,
  searchParams,
  serializeFilters,
  validateDraft,
  withPriceScope,
  type Draft,
} from "./filters";
const id = "00000000-0000-0000-0000-000000000001";
describe("exact decimal validation", () => {
  test.each(["999999999999999.9999", "99.9999", "0.0001", "0"])(
    "preserves %s without number conversion",
    (value) => expect(decimal(value)).toBe(value),
  );
  test.each([
    "",
    "1e3",
    "NaN",
    "Infinity",
    "-1",
    ".5",
    "1.",
    "1.00001",
    "1000000000000000",
    "+1",
  ])("rejects %s", (value) => expect(decimal(value)).toBeUndefined());
  test("canonicalizes equivalent decimals with exact comparisons", () => {
    expect(decimal("000000001.2300")).toBe("1.23");
    expect(compareDecimal("9", "10")).toBe(-1);
    expect(compareDecimal("999999999999999.9998", "999999999999999.9999")).toBe(
      -1,
    );
    expect(compareDecimal("0", "0.0000")).toBe(0);
  });
});
test("all supported filters round-trip through a single typed transport boundary", () => {
  const filters = {
    q: "wool",
    materialType: "FABRIC",
    catalogSupplierId: id,
    originCountryId: id,
    fiberTypeId: id,
    minFiberPercentage: "0.0001",
    maxFiberPercentage: "99.9999",
    minGsm: "1",
    maxGsm: "999999999999999.9999",
    minWidthMm: "1.0001",
    maxWidthMm: "2",
    minThicknessMm: "0",
    maxThicknessMm: "0.0001",
    color: "blue",
    sellerSupplierId: id,
    maxMoq: "999999999999999.9999",
    maxMcq: "0",
    quantityUnit: "METER",
    minLeadTimeDays: 0,
    maxLeadTimeDays: 21,
    listingStatus: "ACTIVE",
  } as const;
  const parsed = parseFilters(serializeFilters(filters));
  expect(parsed.filters).toEqual(filters);
  const query = searchParams(parsed.filters, 25);
  expect(query).toEqual({ ...filters, status: "ACTIVE", limit: 25 });
  expect(typeof query.maxMoq).toBe("string");
  expect(query.maxGsm).toBe("999999999999999.9999");
});
test("blank is omitted and zero remains an explicit value", () => {
  const result = validateDraft({
    ...draftFrom({}),
    q: "   ",
    maxMoq: "0",
    maxMcq: "",
  });
  expect(result.filters).toEqual({ maxMoq: "0" });
  expect(result.errors).toEqual({});
});
test("only supported valid state enters URL or requests, including manipulated lifecycle and price scope", () => {
  const result = parseFilters(
    "q=%20wool%20&status=DRAFT&maxPrice=20&priceDataSourceId=" +
      id +
      "&currency=USD&priceUnit=METER&asOf=2026-01-01&requestedQuantity=10&allowMaterialFallback=true&token=private&cursor=opaque&variantId=" +
      id,
  );
  expect(result.filters).toEqual({ q: "wool" });
  expect(result.canonical).toBe("q=wool");
  expect(result.cleaned).toBe(true);
  expect(searchParams(result.filters, 25)).toEqual({
    q: "wool",
    status: "ACTIVE",
    limit: 25,
  });
});
test.each([
  { minGsm: "10", maxGsm: "9" },
  { minWidthMm: "2", maxWidthMm: "1" },
  { minThicknessMm: "1", maxThicknessMm: "0.1" },
  { fiberTypeId: id, minFiberPercentage: "10", maxFiberPercentage: "9" },
  { fiberTypeId: id, maxFiberPercentage: "100.0001" },
  { minFiberPercentage: "10" },
  { minLeadTimeDays: "3", maxLeadTimeDays: "2" },
  { maxLeadTimeDays: "1.5" },
  { minLeadTimeDays: "-1" },
  { maxLeadTimeDays: "2147483648" },
  { q: "x".repeat(201) },
  { color: "x".repeat(101) },
  { originCountryId: "not-a-reference" },
])("invalid draft blocks Apply: %j", (values) => {
  expect(
    Object.keys(validateDraft({ ...draftFrom({}), ...values } as Draft).errors)
      .length,
  ).toBeGreaterThan(0);
});
test("equivalent filter states produce the same applied identity without backend text normalization", () => {
  expect(parseFilters("maxMoq=01.2300&q=%20ＷＯＯＬ%20").filters).toEqual({
    q: "ＷＯＯＬ",
    maxMoq: "1.23",
  });
  expect(serializeFilters(parseFilters("color=&q=").filters)).toBe("");
});
test("future complete price scope preserves generated names and exact values, independently of public URL state", () => {
  const price = {
    maxPrice: "999999999999999.9999",
    priceDataSourceId: id,
    currency: "USD",
    priceUnit: "METER",
    asOf: "2026-10-20T00:00:00Z",
    requestedQuantity: "0.0001",
    allowMaterialFallback: false,
  } as const;
  expect(withPriceScope(searchParams({}, 25), price)).toEqual({
    status: "ACTIVE",
    limit: 25,
    ...price,
  });
});
