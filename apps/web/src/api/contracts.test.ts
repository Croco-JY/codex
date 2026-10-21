import { describe, expect, expectTypeOf, it } from "vitest";
import openapi from "../../../../docs/openapi.json";
import type { components, operations } from "./schema";

type Schemas = components["schemas"];

describe("backend-owned exact decimal contract", () => {
  it("generates string types across commercial, physical and facility values", () => {
    expectTypeOf<Schemas["PriceInput"]["amount"]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["PriceView"]["amount"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["ListingInput"]["minimumOrderQuantity"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["ListingView"]["minimumColorQuantity"]>>().toEqualTypeOf<string>();
    expectTypeOf<Schemas["InventoryInput"]["quantity"]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["InventoryView"]["quantity"]>>().toEqualTypeOf<string>();
    expectTypeOf<Schemas["MaterialPart"]["percentage"]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["MaterialPartView"]["percentage"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["MaterialFabricInput"]["gsm"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["MaterialFabricView"]["widthMm"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["MaterialLeatherInput"]["averageHideAreaM2"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["MaterialLeatherView"]["thicknessMinMm"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["FacilityInput"]["latitude"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["FacilityView"]["longitude"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["FacilityCapabilityInput"]["minimumOrderQuantity"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Schemas["FacilityCapabilityView"]["maximumOrderQuantity"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<NonNullable<operations["effective"]["parameters"]["query"]>["requestedQuantity"]>>().toEqualTypeOf<string>();
    expect(openapi.components.schemas.PriceInput.properties.amount).toEqual({
      type: "string", format: "decimal",
    });
  });

  it("preserves large decimal strings through JavaScript JSON parse and serialization", () => {
    const amount = "999999999999999.9999";
    const quantity = "0.0001";
    const wire = JSON.stringify({ amount, quantity });
    const parsed: unknown = JSON.parse(wire);
    expect(parsed).toEqual({ amount, quantity });
    expect(JSON.stringify(parsed)).toBe(wire);
    expect(wire).toContain('"amount":"999999999999999.9999"');
  });
});
