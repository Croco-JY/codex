import { expect, test } from "vitest";
import { initialPriceDraft, validUtc, validatePrice } from "./priceScope";
test("current scope omits time and quantity, explicitly disables fallback", () => {
  const result = validatePrice({
    ...initialPriceDraft(),
    asOf: "2025-06-01T00:00:00Z",
  });
  expect(result.errors).toEqual({});
  expect(result.scope).toEqual({ allowMaterialFallback: false });
});
test("historical scope uses the explicit UTC instant and resolver-specific names", () => {
  const scope = validatePrice({
    ...initialPriceDraft(),
    mode: "historical",
    asOf: "2025-06-01T00:00:00.000001Z",
    requestedVariantId: "variant-reference",
    requestedQuantity: "999999999999999.9999",
    allowMaterialFallback: true,
  }).scope;
  expect(scope).toEqual({
    allowMaterialFallback: true,
    asOf: "2025-06-01T00:00:00.000001Z",
    requestedVariantId: "variant-reference",
    requestedQuantity: "999999999999999.9999",
  });
  expect(scope).not.toHaveProperty("variantId");
});
test.each(["0", "1e3", "-1", "NaN", "1.00001"])(
  "rejects unsupported requested quantity %s",
  (value) =>
    expect(
      validatePrice({ ...initialPriceDraft(), requestedQuantity: value }).errors
        .requestedQuantity,
    ).toBeTruthy(),
);
test.each([
  "2025-02-30T00:00:00Z",
  "2025-06-01",
  "2025-06-01T00:00:00+09:00",
  "2025-06-01T25:00:00Z",
  "2025-06-01T00:00:00.0000001Z",
])("rejects invalid/ambiguous UTC instant %s", (value) =>
  expect(validUtc(value)).toBe(false),
);
