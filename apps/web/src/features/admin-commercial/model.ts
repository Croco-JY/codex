import { z } from "zod";
import type { components } from "../../api/schema";
import { uuid, safeVersion } from "../admin-sources/model";
import { exact, units } from "../admin-catalog/model";
import { scaled } from "../admin-network/model";
export { units };
export type Schemas = components["schemas"];
export type ListingContext = Required<
  Pick<Schemas["ListingView"], "id" | "materialId" | "sellerSupplierId">
>;
export function listingContext(
  v: Schemas["ListingView"] | undefined,
): ListingContext | undefined {
  if (
    !v ||
    !uuid.safeParse(v.id).success ||
    !uuid.safeParse(v.materialId).success ||
    !uuid.safeParse(v.sellerSupplierId).success
  )
    return;
  return {
    id: v.id!,
    materialId: v.materialId!,
    sellerSupplierId: v.sellerSupplierId!,
  };
}
/** Fixed-width UTC lexical ordering preserves all six microsecond digits. Date only validates the calendar second. */
export function instant(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(
    value,
  );
  if (!m) return;
  const d = new Date(m[1] + "Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 19) !== m[1])
    return;
  return m[1] + "." + (m[2] ?? "").padEnd(6, "0") + "Z";
}
export const utc = z
  .string()
  .refine(
    (v) => !!instant(v),
    "Enter a valid UTC Instant ending in Z, with at most six fractional digits and no whitespace.",
  );
const optionalUuid = z.union([z.literal(""), uuid]);
const amount = z
  .string()
  .refine(
    (v) => exact(v, 15, "positive"),
    "Use a positive exact decimal (15 whole and 4 fractional digits maximum).",
  );
const chosenUnit = z
  .union([z.literal(""), z.enum(units)])
  .refine((v): boolean => v !== "", "Choose an explicit unit.");
const quantity = z
  .string()
  .refine(
    (v) => exact(v, 15),
    "Use a nonnegative exact decimal (15 whole and 4 fractional digits maximum).",
  );
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use three uppercase ASCII letters.")
  .refine(
    (v) => !["XXX", "XTS"].includes(v),
    "Use a commercial currency, not XXX or XTS.",
  );
export const priceFields = z
  .object({
    materialVariantId: optionalUuid,
    dataSourceId: uuid,
    amount,
    currency,
    priceUnit: chosenUnit,
    minimumOrderQuantity: z.union([z.literal(""), quantity]),
    validFrom: utc,
    validTo: z.union([z.literal(""), utc]),
    observedAt: utc,
    observations: z
      .array(z.object({ observationId: uuid }))
      .min(1, "At least one supporting Observation is required.")
      .max(100, "Submit at most 100 Observation rows."),
  })
  .superRefine((v, c) => {
    if (
      v.validTo &&
      instant(v.validTo) &&
      instant(v.validFrom) &&
      instant(v.validTo)! <= instant(v.validFrom)!
    )
      c.addIssue({
        code: "custom",
        path: ["validTo"],
        message:
          "Valid to must be strictly after valid from, including microseconds.",
      });
  });
export type PriceFields = z.infer<typeof priceFields>;
export const priceDefaults: PriceFields = {
  materialVariantId: "",
  dataSourceId: "",
  amount: "",
  currency: "",
  priceUnit: "",
  minimumOrderQuantity: "",
  validFrom: "",
  validTo: "",
  observedAt: "",
  observations: [{ observationId: "" }],
};
// A unit is always an explicit choice; form defaults use an empty selection instead.
export const inventoryFields = z.object({
  materialVariantId: optionalUuid,
  facilityId: optionalUuid,
  quantity,
  unit: chosenUnit,
  observedAt: utc,
});
export type InventoryFields = z.infer<typeof inventoryFields>;
export const inventoryDefaults: InventoryFields = {
  materialVariantId: "",
  facilityId: "",
  quantity: "",
  unit: "",
  observedAt: "",
};
const priceTransport = z
  .object({
    listingId: uuid,
    materialVariantId: uuid.optional(),
    dataSourceId: uuid,
    amount,
    currency,
    priceUnit: z.enum(units),
    minimumOrderQuantity: quantity.optional(),
    validFrom: utc,
    validTo: utc.optional(),
    observedAt: utc,
    observationIds: z.array(uuid).min(1).max(100),
  })
  .strict()
  .refine((v) => !v.validTo || instant(v.validTo)! > instant(v.validFrom)!, {
    path: ["validTo"],
    message: "Invalid interval.",
  });
const inventoryTransport = z
  .object({
    listingId: uuid,
    materialVariantId: uuid.optional(),
    facilityId: uuid.optional(),
    quantity,
    unit: z.enum(units),
    captureMode: z.literal("MANUAL"),
    observedAt: utc,
    manualIdempotencyKey: uuid,
  })
  .strict();
export function priceBody(
  listing: ListingContext,
  v: PriceFields,
): Schemas["PriceInput"] {
  return priceTransport.parse({
    listingId: listing.id,
    dataSourceId: v.dataSourceId,
    amount: v.amount,
    currency: v.currency,
    priceUnit: v.priceUnit,
    validFrom: v.validFrom,
    observedAt: v.observedAt,
    observationIds: v.observations.map((r) => r.observationId),
    ...(v.materialVariantId ? { materialVariantId: v.materialVariantId } : {}),
    ...(v.minimumOrderQuantity !== ""
      ? { minimumOrderQuantity: v.minimumOrderQuantity }
      : {}),
    ...(v.validTo ? { validTo: v.validTo } : {}),
  });
}
export function inventoryBody(
  listing: ListingContext,
  v: InventoryFields,
  key: string,
): Schemas["InventoryInput"] {
  return inventoryTransport.parse({
    listingId: listing.id,
    quantity: v.quantity,
    unit: v.unit,
    observedAt: v.observedAt,
    captureMode: "MANUAL",
    manualIdempotencyKey: key,
    ...(v.materialVariantId ? { materialVariantId: v.materialVariantId } : {}),
    ...(v.facilityId ? { facilityId: v.facilityId } : {}),
  });
}
export type PriceCommand = { key: string; body: Schemas["PriceInput"] };
export type InventoryCommand = {
  key: string;
  body: Schemas["InventoryInput"];
  actor: { issuer: string; subject: string };
};
export function freezePrice(
  key: string,
  body: Schemas["PriceInput"],
): PriceCommand {
  const copy = priceTransport.parse(body);
  Object.freeze(copy.observationIds);
  return Object.freeze({ key: uuid.parse(key), body: Object.freeze(copy) });
}
export function freezeInventory(
  body: Schemas["InventoryInput"],
  actor: { issuer: string; subject: string },
): InventoryCommand {
  const copy = inventoryTransport.parse(body);
  return Object.freeze({
    key: copy.manualIdempotencyKey,
    body: Object.freeze(copy),
    actor: Object.freeze({ ...actor }),
  });
}
const nullableUuid = (v: unknown) => v == null || uuid.safeParse(v).success;
const nullableDecimal = (v: unknown) =>
  v == null || (typeof v === "string" && exact(v, 15));
const sameId = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const sameDecimal = (a: unknown, b: unknown) =>
  a == null
    ? b == null
    : typeof a === "string" &&
      typeof b === "string" &&
      exact(a, 15) &&
      exact(b, 15) &&
      scaled(a, 4) === scaled(b, 4);
export function safePrice(v: Schemas["PriceView"], l: ListingContext) {
  if (
    !v ||
    typeof v !== "object" ||
    !uuid.safeParse(v.id).success ||
    v.listingId !== l.id ||
    v.materialId !== l.materialId ||
    !uuid.safeParse(v.dataSourceId).success ||
    typeof v.amount !== "string" ||
    !exact(v.amount, 15, "positive") ||
    !currency.safeParse(v.currency).success ||
    !units.some((u) => u === v.priceUnit) ||
    !safeVersion(v.version) ||
    !instant(v.validFrom) ||
    !instant(v.observedAt) ||
    !instant(v.createdAt) ||
    !instant(v.updatedAt) ||
    !nullableUuid(v.materialVariantId) ||
    !nullableDecimal(v.minimumOrderQuantity) ||
    (v.validTo != null &&
      (!instant(v.validTo) || instant(v.validTo)! <= instant(v.validFrom)!))
  )
    return;
  return v as Schemas["PriceView"] &
    Required<
      Pick<
        Schemas["PriceView"],
        | "id"
        | "listingId"
        | "materialId"
        | "dataSourceId"
        | "amount"
        | "currency"
        | "priceUnit"
        | "validFrom"
        | "observedAt"
        | "version"
      >
    >;
}
export type SafePrice = NonNullable<ReturnType<typeof safePrice>>;
/** Mirrors PriceService.same: validTo and evidence deliberately excluded. */
export function matchesPrice(p: SafePrice, c: PriceCommand) {
  const b = c.body;
  return (
    p.id === c.key &&
    p.listingId === b.listingId &&
    sameId(p.materialVariantId, b.materialVariantId) &&
    p.dataSourceId === b.dataSourceId &&
    sameDecimal(p.amount, b.amount) &&
    p.currency === b.currency &&
    p.priceUnit === b.priceUnit &&
    sameDecimal(p.minimumOrderQuantity, b.minimumOrderQuantity) &&
    instant(p.validFrom) === instant(b.validFrom) &&
    instant(p.observedAt) === instant(b.observedAt)
  );
}
export function matchesInventory(
  v: Schemas["InventoryView"],
  l: ListingContext,
  c: InventoryCommand,
) {
  const b = c.body;
  if (!v || typeof v !== "object") return false;
  return (
    uuid.safeParse(v.id).success &&
    v.listingId === l.id &&
    v.materialId === l.materialId &&
    v.manualIdempotencyKey === c.key &&
    v.captureMode === "MANUAL" &&
    v.sourceObservationId == null &&
    sameId(v.materialVariantId, b.materialVariantId) &&
    sameId(v.facilityId, b.facilityId) &&
    nullableUuid(v.materialVariantId) &&
    nullableUuid(v.facilityId) &&
    sameDecimal(v.quantity, b.quantity) &&
    v.unit === b.unit &&
    instant(v.observedAt) !== undefined &&
    instant(v.observedAt) === instant(b.observedAt) &&
    !!instant(v.recordedAt) &&
    !!instant(v.createdAt) &&
    v.actorIssuer === c.actor.issuer &&
    v.actorSubject === c.actor.subject
  );
}
export function safeEvidence(v: Schemas["PriceEvidenceView"]) {
  return (
    !!v &&
    typeof v === "object" &&
    uuid.safeParse(v.observationId).success &&
    !!instant(v.createdAt)
  );
}
export const closeFields = (from: string) =>
  z
    .object({ validTo: utc })
    .refine((v) => instant(v.validTo)! > instant(from)!, {
      path: ["validTo"],
      message:
        "Close time must be strictly after valid from, including microseconds.",
    });
