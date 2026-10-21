import { expect, test } from "vitest";
import {
  instant,
  priceFields,
  inventoryFields,
  priceBody,
  inventoryBody,
  priceDefaults,
  inventoryDefaults,
  freezePrice,
  freezeInventory,
  safePrice,
  matchesPrice,
  matchesInventory,
  safeEvidence,
  closeFields,
  listingContext,
  units,
} from "./model";
const id = (n: number) =>
  `1c5d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const listing = { id: id(1), materialId: id(2), sellerSupplierId: id(3) },
  actor = { issuer: "fixture", subject: "operator" };
const fields = () => ({
  ...priceDefaults,
  dataSourceId: id(4),
  amount: "999999999999999.9999",
  currency: "USD",
  priceUnit: "METER" as const,
  validFrom: "2026-10-21T00:00:00.000001Z",
  observedAt: "2026-10-21T00:00:00.123456Z",
  observations: [{ observationId: id(5) }],
});
const stock = () => ({
  ...inventoryDefaults,
  quantity: "0",
  unit: "KG" as const,
  observedAt: "2026-10-21T00:00:00.123456Z",
});
function view() {
  const b = priceBody(listing, fields());
  return {
    ...b,
    id: id(6),
    materialId: listing.materialId,
    materialVariantId: null,
    minimumOrderQuantity: null,
    validTo: null,
    version: 0,
    createdAt: "2026-10-21T00:00:01Z",
    updatedAt: "2026-10-21T00:00:01Z",
  } as unknown as Parameters<typeof safePrice>[0];
}
test.each([
  "2026-10-21T00:00:00Z",
  "2026-10-21T00:00:00.1Z",
  "2024-02-29T23:59:59.123456Z",
  "0000-01-01T00:00:00Z",
])("UTC accepts %s", (v) => expect(instant(v)).toMatch(/\.\d{6}Z$/));
test.each([
  "2025-02-29T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-13-01T00:00:00Z",
  "2026-01-01T24:00:00Z",
  "2026-01-01T00:00:60Z",
  "2026-01-01T00:00:00.1234567Z",
  "2026-01-01T00:00:00+00:00",
  "2026-01-01T00:00:00",
  " 2026-01-01T00:00:00Z",
  "2026-01-01T00:00:00Z ",
  "bad",
])("UTC rejects %s", (v) => expect(instant(v)).toBeUndefined());
test("microsecond ordering and scale equivalence survive Date millisecond limits", () => {
  expect(
    instant("2026-01-01T00:00:00.000002Z")! >
      instant("2026-01-01T00:00:00.000001Z")!,
  ).toBe(true);
  expect(instant("2026-01-01T00:00:00.1Z")).toBe(
    instant("2026-01-01T00:00:00.100000Z"),
  );
});
test.each([
  "0",
  "0.0000",
  "-1",
  "1e2",
  "1000000000000000",
  "1.00001",
  "1 ",
  ".2",
])("Price amount rejects %s", (amount) =>
  expect(priceFields.safeParse({ ...fields(), amount }).success).toBe(false),
);
test.each(["0", "0.0000", "999999999999999.9999"])(
  "MOQ and Inventory accept exact %s",
  (n) => {
    expect(
      priceFields.safeParse({ ...fields(), minimumOrderQuantity: n }).success,
    ).toBe(true);
    expect(inventoryFields.safeParse({ ...stock(), quantity: n }).success).toBe(
      true,
    );
  },
);
test.each(["", "-0.1", "1e4", "1000000000000000", "0.00001"])(
  "Inventory rejects %s",
  (quantity) =>
    expect(inventoryFields.safeParse({ ...stock(), quantity }).success).toBe(
      false,
    ),
);
test.each(["XXX", "XTS", "usd", "US", "ABCD", "12A"])(
  "currency rejects %s",
  (currency) =>
    expect(priceFields.safeParse({ ...fields(), currency }).success).toBe(
      false,
    ),
);
test.each(units)("exact commercial unit %s", (unit) => {
  expect(priceFields.safeParse({ ...fields(), priceUnit: unit }).success).toBe(
    true,
  );
  expect(inventoryFields.safeParse({ ...stock(), unit }).success).toBe(true);
});
test("no unit inferred or preselected", () => {
  expect(priceDefaults.priceUnit).toBe("");
  expect(inventoryDefaults.unit).toBe("");
  expect(inventoryFields.safeParse({ ...stock(), unit: "" }).success).toBe(
    false,
  );
  expect(priceFields.safeParse({ ...fields(), priceUnit: "" }).success).toBe(
    false,
  );
});
test.each([0, 101])("evidence submitted count %i rejected", (n) =>
  expect(
    priceFields.safeParse({
      ...fields(),
      observations: Array.from({ length: n }, () => ({ observationId: id(5) })),
    }).success,
  ).toBe(false),
);
test.each([1, 100])(
  "evidence submitted count %i retained including duplicates",
  (n) => {
    const f = {
      ...fields(),
      observations: Array.from({ length: n }, () => ({ observationId: id(5) })),
    };
    expect(priceFields.safeParse(f).success).toBe(true);
    expect(priceBody(listing, f).observationIds).toHaveLength(n);
  },
);
test.each(["2026-10-21T00:00:00.000001Z", "2026-10-21T00:00:00Z"])(
  "equal/earlier validTo rejected: %s",
  (validTo) =>
    expect(priceFields.safeParse({ ...fields(), validTo }).success).toBe(false),
);
test("historical closed Price and one-microsecond interval supported", () =>
  expect(
    priceFields.safeParse({
      ...fields(),
      validTo: "2026-10-21T00:00:00.000002Z",
    }).success,
  ).toBe(true));
test("transport strips row IDs and metadata, retains exact decimals, omits optional empties", () => {
  const b = priceBody(listing, fields());
  expect(b.amount).toBe("999999999999999.9999");
  expect(b.observationIds).toEqual([id(5)]);
  for (const k of [
    "materialId",
    "version",
    "materialVariantId",
    "validTo",
    "minimumOrderQuantity",
    "observations",
  ])
    expect(b).not.toHaveProperty(k);
});
test("command snapshot is frozen independently of form/evidence edits", () => {
  const b = priceBody(listing, fields()),
    c = freezePrice(id(6), b);
  b.amount = "1";
  b.observationIds!.push(id(7));
  expect(c.body.amount).toBe("999999999999999.9999");
  expect(c.body.observationIds).toEqual([id(5)]);
  expect(Object.isFrozen(c.body.observationIds)).toBe(true);
  expect(Object.isFrozen(c.body)).toBe(true);
});
test("Price same comparison excludes validTo and evidence, compares exact numeric/microsecond values", () => {
  const p = safePrice(view(), listing)!;
  const c = freezePrice(id(6), {
    ...priceBody(listing, fields()),
    validTo: "2026-10-22T00:00:00Z",
    observationIds: [id(8)],
  });
  expect(matchesPrice(p, c)).toBe(true);
  expect(
    matchesPrice(
      { ...p, amount: "1.0000" },
      { ...c, body: { ...c.body, amount: "1" } },
    ),
  ).toBe(true);
  expect(
    matchesPrice(
      { ...p, validFrom: "2026-10-21T00:00:00.1Z" },
      { ...c, body: { ...c.body, validFrom: "2026-10-21T00:00:00.100000Z" } },
    ),
  ).toBe(true);
});
test.each([
  "listingId",
  "materialVariantId",
  "dataSourceId",
  "amount",
  "currency",
  "priceUnit",
  "minimumOrderQuantity",
  "validFrom",
  "observedAt",
])("Price same comparison detects %s change", (key) => {
  const c = freezePrice(id(6), priceBody(listing, fields()));
  const other: Record<string, unknown> = {
    listingId: id(9),
    materialVariantId: id(9),
    dataSourceId: id(9),
    amount: "1",
    currency: "JPY",
    priceUnit: "KG",
    minimumOrderQuantity: "0",
    validFrom: "2026-10-21T00:00:00.000002Z",
    observedAt: "2026-10-21T00:00:00.123457Z",
  };
  expect(
    matchesPrice(safePrice(view(), listing)!, {
      ...c,
      body: { ...c.body, [key]: other[key] },
    }),
  ).toBe(false);
});
test.each([
  "id",
  "listingId",
  "materialId",
  "dataSourceId",
  "amount",
  "currency",
  "priceUnit",
  "validFrom",
  "observedAt",
  "version",
  "createdAt",
  "updatedAt",
])("unsafe loaded Price %s blocks management", (key) =>
  expect(safePrice({ ...view(), [key]: undefined }, listing)).toBeUndefined(),
);
test.each([-1, Number.MAX_SAFE_INTEGER + 1, null, "0"])(
  "unsafe Price version %s rejected",
  (version) =>
    expect(safePrice({ ...view(), version } as never, listing)).toBeUndefined(),
);
test("typed evidence requires UUID and valid Instant, extra fields ignored", () => {
  expect(
    safeEvidence({
      observationId: id(5),
      createdAt: "2026-10-21T00:00:00Z",
      unknown: { bad: true },
    } as never),
  ).toBe(true);
  expect(safeEvidence({ observationId: "bad", createdAt: "bad" })).toBe(false);
  expect(safeEvidence(null as never)).toBe(false);
});
test("Inventory frozen command contains MANUAL/key and no Actor/evidence/version fields", () => {
  const body = inventoryBody(listing, stock(), id(9)),
    c = freezeInventory(body, actor);
  expect(body.quantity).toBe("0");
  expect(body.captureMode).toBe("MANUAL");
  for (const k of [
    "sourceObservationId",
    "actorIssuer",
    "actorSubject",
    "version",
    "materialId",
  ])
    expect(body).not.toHaveProperty(k);
  expect(Object.isFrozen(c.body)).toBe(true);
});
const inventoryView = () => ({
  ...inventoryBody(listing, stock(), id(9)),
  id: id(10),
  materialId: listing.materialId,
  actorIssuer: actor.issuer,
  actorSubject: actor.subject,
  recordedAt: "2026-10-21T00:00:01Z",
  createdAt: "2026-10-21T00:00:01Z",
});
test("Inventory equality accepts numeric scale and microsecond-equivalent timestamps", () => {
  const c = freezeInventory(inventoryBody(listing, stock(), id(9)), actor);
  expect(
    matchesInventory({ ...inventoryView(), quantity: "0.0000" }, listing, c),
  ).toBe(true);
});
test.each([
  "listingId",
  "materialId",
  "manualIdempotencyKey",
  "actorIssuer",
  "actorSubject",
  "materialVariantId",
  "facilityId",
  "quantity",
  "unit",
  "observedAt",
  "captureMode",
  "sourceObservationId",
])("Inventory retry comparison rejects changed %s", (key) => {
  const changes: Record<string, unknown> = {
    listingId: id(99),
    materialId: id(99),
    manualIdempotencyKey: id(99),
    actorIssuer: "other",
    actorSubject: "other",
    materialVariantId: id(99),
    facilityId: id(99),
    quantity: "1",
    unit: "METER",
    observedAt: "2026-10-21T00:00:00.123457Z",
    captureMode: "IMPORTED",
    sourceObservationId: id(99),
  };
  expect(
    matchesInventory(
      { ...inventoryView(), [key]: changes[key] },
      listing,
      freezeInventory(inventoryBody(listing, stock(), id(9)), actor),
    ),
  ).toBe(false);
});
test("Listing context requires exact valid IDs, malformed optional parent does not fabricate context", () => {
  expect(listingContext({ id: listing.id })).toBeUndefined();
  expect(listingContext(listing)).toEqual(listing);
});
test("close strictly compares microseconds", () => {
  const f = closeFields("2026-10-21T00:00:00.000001Z");
  expect(f.safeParse({ validTo: "2026-10-21T00:00:00.000002Z" }).success).toBe(
    true,
  );
  expect(f.safeParse({ validTo: "2026-10-21T00:00:00.000001Z" }).success).toBe(
    false,
  );
});
