import { z } from "zod";
import type { components } from "../../api/schema";
import { uuid, safeVersion } from "../admin-sources/model";
import { safeNotes, scaled } from "../admin-network/model";
import { materialTypes, units } from "../materials/filters";
export { materialTypes, units };
export type Schemas = components["schemas"];
export const lifecycle = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const childLifecycle = ["ACTIVE", "ARCHIVED"] as const;
export const completeness = ["UNKNOWN", "PARTIAL", "COMPLETE"] as const;
export const attributeKeys = [
  "abrasionCycles",
  "pillingGrade",
  "careInstruction",
  "testMethod",
  "finishCode",
  "textureCode",
  "size",
  "lengthMm",
  "patternCode",
] as const;
export const materialFacts = [
  "RECORD",
  "CATALOG_ARTICLE_NUMBER",
  "NAME",
  "DESCRIPTION",
  "ORIGIN",
  "COMPOSITION",
  "FABRIC_SPEC",
  "LEATHER_SPEC",
] as const;
export const variantFacts = [
  "RECORD",
  "CATALOG_VARIANT_SKU",
  "NAME",
  "COLOR",
  "BATCH",
  "ATTRIBUTES",
] as const;
export const listingFacts = [
  "RECORD",
  "SELLER_ARTICLE_NUMBER",
  "MOQ",
  "MCQ",
  "UNIT",
  "STANDARD_LEAD_TIME",
  "REPRODUCTION_LEAD_TIME",
] as const;
export const constructions = ["WOVEN", "KNIT", "NONWOVEN", "OTHER"] as const;
export const hides = [
  "BOVINE",
  "OVINE",
  "CAPRINE",
  "PORCINE",
  "OTHER",
] as const;
export const tannings = [
  "CHROME",
  "VEGETABLE",
  "COMBINATION",
  "OTHER",
] as const;
const required = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !!v.trim(), "Enter a value.");
const optionalUuid = z.union([z.literal(""), uuid]);
const version = z.custom<number>(
  safeVersion,
  "A safe current server version is required.",
);
export function exact(
  value: string,
  digits: number,
  mode: "positive" | "nonnegative" | "signed" = "nonnegative",
  bound?: bigint,
) {
  if (
    !new RegExp(
      `^${mode === "signed" ? "-?" : ""}(?:0|[1-9]\\d{0,${digits - 1}})(?:\\.\\d{1,4})?$`,
    ).test(value)
  )
    return false;
  const n = scaled(value, 4);
  return (
    (mode === "positive" ? n > 0n : mode === "nonnegative" ? n >= 0n : true) &&
    (bound === undefined || (n <= bound && n >= -bound))
  );
}
const decimal = (
  digits: number,
  mode: "positive" | "nonnegative" | "signed" = "nonnegative",
  bound?: bigint,
) =>
  z
    .string()
    .refine(
      (v) => !v || exact(v, digits, mode, bound),
      "Enter an exact plain decimal within this field’s range and precision.",
    );
export const part = z.object({
  fiberTypeId: uuid,
  percentage: z
    .string()
    .refine(
      (v) => exact(v, 3, "positive", 1000000n),
      "Use a positive percentage up to 100 with at most four fractional digits.",
    ),
});
export const compositionFields = z
  .object({
    completeness: z.enum(completeness),
    parts: z.array(part),
    observationId: uuid,
  })
  .superRefine((v, c) => {
    const total = v.parts.reduce(
      (s, p) =>
        s +
        (exact(p.percentage, 3, "positive", 1000000n)
          ? scaled(p.percentage, 4)
          : 0n),
      0n,
    );
    if (new Set(v.parts.map((p) => p.fiberTypeId)).size !== v.parts.length)
      c.addIssue({
        code: "custom",
        path: ["parts"],
        message: "Duplicate Fiber identities are not allowed.",
      });
    if (
      (v.completeness === "UNKNOWN" && v.parts.length !== 0) ||
      (v.completeness !== "UNKNOWN" && v.parts.length === 0) ||
      total > 1000000n ||
      (v.completeness === "COMPLETE" && total !== 1000000n)
    )
      c.addIssue({
        code: "custom",
        path: ["parts"],
        message:
          "Composition parts and exact total must match the selected completeness.",
      });
  });
export type CompositionFields = z.infer<typeof compositionFields>;
export const materialFields = z.object({
  catalogSupplierId: uuid,
  materialType: z.enum(materialTypes),
  displayName: required(160),
  catalogArticleNumber: z.string().max(160),
  description: z.string().max(4000),
  originCountryId: optionalUuid,
  status: z.enum(lifecycle),
  observationId: uuid,
});
export type MaterialFields = z.infer<typeof materialFields>;
export const materialDefaults: MaterialFields = {
  catalogSupplierId: "",
  materialType: "FABRIC",
  displayName: "",
  catalogArticleNumber: "",
  description: "",
  originCountryId: "",
  status: "DRAFT",
  observationId: "",
};
// Java views emit explicit null for absent values. Undefined is not proof of an empty field.
const loadedText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => v ?? "");
const loadedUuid = uuid.nullable().transform((v) => v ?? "");
const materialState = materialFields
  .omit({ observationId: true })
  .extend({
    id: uuid,
    version,
    catalogArticleNumber: loadedText(160),
    description: loadedText(4000),
    originCountryId: loadedUuid,
    compositionCompleteness: z.enum(completeness),
    composition: z.array(part),
  })
  .superRefine((v, c) => {
    const r = compositionFields.safeParse({
      completeness: v.compositionCompleteness,
      parts: v.composition,
      observationId: v.id,
    });
    if (!r.success)
      c.addIssue({ code: "custom", message: "Unsafe Composition." });
  });
export function materialBaseline(value: unknown) {
  const r = materialState.safeParse(value);
  return r.success ? { ...r.data, observationId: "" } : undefined;
}
export type MaterialBaseline = NonNullable<ReturnType<typeof materialBaseline>>;
export function materialBody(
  v: MaterialFields,
  parts: CompositionFields,
  currentVersion: number,
): Schemas["MaterialInput"] {
  return {
    catalogSupplierId: v.catalogSupplierId,
    materialType: v.materialType,
    displayName: v.displayName,
    status: v.status,
    compositionCompleteness: parts.completeness,
    composition: parts.parts.map((p) => ({
      fiberTypeId: p.fiberTypeId,
      percentage: p.percentage,
    })),
    observationId: v.observationId,
    version: currentVersion,
    ...(v.catalogArticleNumber
      ? { catalogArticleNumber: v.catalogArticleNumber }
      : {}),
    ...(v.description ? { description: v.description } : {}),
    ...(v.originCountryId ? { originCountryId: v.originCountryId } : {}),
  };
}
export const attributeRow = z.object({
  key: z.enum(attributeKeys),
  type: z.enum(["String", "Boolean", "Integer"]),
  value: z.string(),
});
export type AttributeRow = z.infer<typeof attributeRow>;
export function attributes(
  rows: AttributeRow[],
): Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  for (const row of rows) {
    if (!attributeKeys.includes(row.key) || Object.hasOwn(result, row.key))
      throw Error("Choose unique supported attribute keys.");
    if (row.type === "String") {
      if (row.value.length > 255 || !safeNotes(row.value))
        throw Error(
          "Attribute text is too long or contains sensitive content.",
        );
      result[row.key] = row.value;
    } else if (row.type === "Boolean") {
      if (!["true", "false"].includes(row.value))
        throw Error("Choose true or false.");
      result[row.key] = row.value === "true";
    } else {
      if (
        !/^-?(0|[1-9]\d*)$/.test(row.value) ||
        BigInt(row.value) > 9007199254740991n ||
        BigInt(row.value) < -9007199254740991n
      )
        throw Error("Use a safe integer; use String for decimal-like values.");
      result[row.key] = Number(row.value);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 8192)
    throw Error("Attributes exceed 8192 UTF-8 bytes.");
  return result;
}
export function loadedAttributes(value: unknown): AttributeRow[] | undefined {
  if (value === null) return [];
  if (typeof value !== "object" || Array.isArray(value) || value === undefined)
    return undefined;
  const rows: AttributeRow[] = [];
  for (const [key, v] of Object.entries(value)) {
    if (
      !attributeKeys.some((k) => k === key) ||
      !(
        typeof v === "string" ||
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v) && Number.isSafeInteger(v))
      )
    )
      return undefined;
    rows.push({
      key: key as AttributeRow["key"],
      type:
        typeof v === "string"
          ? "String"
          : typeof v === "boolean"
            ? "Boolean"
            : "Integer",
      value: String(v),
    });
  }
  try {
    attributes(rows);
    return rows;
  } catch {
    return undefined;
  }
}
const attr = z.array(attributeRow).superRefine((v, c) => {
  try {
    attributes(v);
  } catch (e) {
    c.addIssue({ code: "custom", message: (e as Error).message });
  }
});
const common = {
  finish: z.string().max(300),
  surface: z.string().max(300),
  handfeel: z.string().max(300),
  luster: z.string().max(300),
  attributes: attr,
  observationId: uuid,
};
export const fabricFields = z
  .object({
    ...common,
    construction: z.union([z.literal(""), z.enum(constructions)]),
    weaveType: z.string().max(80),
    knitType: z.string().max(80),
    gsm: decimal(6, "positive"),
    widthMm: decimal(8, "positive"),
    thicknessMm: decimal(6, "positive"),
    stretchWarpPercentage: decimal(5),
    stretchWeftPercentage: decimal(5),
    shrinkageWarpPercentage: decimal(3, "signed", 1000000n),
    shrinkageWeftPercentage: decimal(3, "signed", 1000000n),
    drape: z.string().max(300),
  })
  .superRefine((v, c) => {
    if (
      (v.construction !== "WOVEN" && v.weaveType) ||
      (v.construction !== "KNIT" && v.knitType)
    )
      c.addIssue({
        code: "custom",
        path: ["construction"],
        message: "Clear incompatible weave/knit values.",
      });
  });
export const leatherFields = z
  .object({
    ...common,
    hideType: z.union([z.literal(""), z.enum(hides)]),
    tanningMethod: z.union([z.literal(""), z.enum(tannings)]),
    thicknessMinMm: decimal(6, "positive"),
    thicknessMaxMm: decimal(6, "positive"),
    averageHideAreaM2: decimal(8, "positive"),
  })
  .superRefine((v, c) => {
    if (
      v.thicknessMinMm &&
      v.thicknessMaxMm &&
      exact(v.thicknessMinMm, 6, "positive") &&
      exact(v.thicknessMaxMm, 6, "positive") &&
      scaled(v.thicknessMinMm, 4) > scaled(v.thicknessMaxMm, 4)
    )
      c.addIssue({
        code: "custom",
        path: ["thicknessMaxMm"],
        message: "Maximum thickness must be at least minimum thickness.",
      });
  });
export type FabricFields = z.infer<typeof fabricFields>;
export type LeatherFields = z.infer<typeof leatherFields>;
export const fabricDefaults: FabricFields = {
  construction: "",
  weaveType: "",
  knitType: "",
  gsm: "",
  widthMm: "",
  thicknessMm: "",
  stretchWarpPercentage: "",
  stretchWeftPercentage: "",
  shrinkageWarpPercentage: "",
  shrinkageWeftPercentage: "",
  finish: "",
  surface: "",
  handfeel: "",
  drape: "",
  luster: "",
  attributes: [],
  observationId: "",
};
export const leatherDefaults: LeatherFields = {
  hideType: "",
  tanningMethod: "",
  thicknessMinMm: "",
  thicknessMaxMm: "",
  averageHideAreaM2: "",
  finish: "",
  surface: "",
  handfeel: "",
  luster: "",
  attributes: [],
  observationId: "",
};
export function specBaseline(
  value: unknown,
  type: "FABRIC" | "LEATHER",
  id: string,
) {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (
    v.materialId !== id ||
    !safeVersion(v.version) ||
    (v.materialType !== undefined && v.materialType !== type)
  )
    return undefined;
  const rows = loadedAttributes(v.attributes);
  if (!rows) return undefined;
  const defaults = type === "FABRIC" ? fabricDefaults : leatherDefaults;
  const fields: Record<string, unknown> = {
    attributes: rows,
    observationId: id,
  };
  for (const key of Object.keys(defaults))
    if (key !== "attributes" && key !== "observationId") {
      if (v[key] === undefined) return undefined;
      fields[key] = v[key] === null ? "" : v[key];
    }
  const r = (type === "FABRIC" ? fabricFields : leatherFields).safeParse(
    fields,
  );
  return r.success
    ? { version: v.version, fields: { ...r.data, observationId: "" } }
    : undefined;
}
export function specBody(
  v: FabricFields | LeatherFields,
  currentVersion: number,
) {
  const { attributes: rows, ...rest } = v;
  return {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== "")),
    attributes: attributes(rows),
    observationId: v.observationId,
    version: currentVersion,
  };
}
export const variantFields = z.object({
  materialId: uuid,
  catalogVariantSku: z.string().max(160),
  variantName: required(160),
  colorName: z.string().max(160),
  colorCode: z.string().max(80),
  batchNumber: z.string().max(100),
  status: z.enum(childLifecycle),
  attributes: attr,
  observationId: uuid,
});
export type VariantFields = z.infer<typeof variantFields>;
export const variantDefaults: VariantFields = {
  materialId: "",
  catalogVariantSku: "",
  variantName: "",
  colorName: "",
  colorCode: "",
  batchNumber: "",
  status: "ACTIVE",
  attributes: [],
  observationId: "",
};
export function variantBaseline(value: unknown, parent: string) {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const a = loadedAttributes(v.attributes);
  if (
    !a ||
    v.materialId !== parent ||
    !safeVersion(v.version) ||
    !uuid.safeParse(v.id).success
  )
    return undefined;
  const r = variantFields.safeParse({
    ...v,
    attributes: a,
    observationId: v.id,
    ...Object.fromEntries(
      ["catalogVariantSku", "colorName", "colorCode", "batchNumber"].map(
        (k) => [k, v[k] === null ? "" : v[k]],
      ),
    ),
  });
  return r.success
    ? {
        id: v.id as string,
        version: v.version,
        fields: { ...r.data, observationId: "" },
      }
    : undefined;
}
export function variantBody(
  v: VariantFields,
  currentVersion: number,
): Schemas["MaterialVariantInput"] {
  return {
    materialId: v.materialId,
    variantName: v.variantName,
    status: v.status,
    observationId: v.observationId,
    version: currentVersion,
    attributes: attributes(v.attributes),
    ...(v.catalogVariantSku ? { catalogVariantSku: v.catalogVariantSku } : {}),
    ...(v.colorName ? { colorName: v.colorName } : {}),
    ...(v.colorCode ? { colorCode: v.colorCode } : {}),
    ...(v.batchNumber ? { batchNumber: v.batchNumber } : {}),
  };
}
export const int32 = (v: string) =>
  /^(0|[1-9]\d*)$/.test(v) && v.length <= 10 && BigInt(v) <= 2147483647n;
export const listingFields = z
  .object({
    materialId: uuid,
    sellerSupplierId: uuid,
    sellerArticleNumber: z.string().max(160),
    minimumOrderQuantity: decimal(15),
    minimumColorQuantity: decimal(15),
    quantityUnit: z.union([z.literal(""), z.enum(units)]),
    standardLeadTimeDays: z
      .string()
      .refine((v) => !v || int32(v), "Use whole days from 0 to 2147483647."),
    reproductionLeadTimeDays: z
      .string()
      .refine((v) => !v || int32(v), "Use whole days from 0 to 2147483647."),
    status: z.enum(childLifecycle),
    observationId: uuid,
  })
  .superRefine((v, c) => {
    if ((v.minimumOrderQuantity || v.minimumColorQuantity) && !v.quantityUnit)
      c.addIssue({
        code: "custom",
        path: ["quantityUnit"],
        message: "Choose a unit when quantity is entered.",
      });
  });
export type ListingFields = z.infer<typeof listingFields>;
export const listingDefaults: ListingFields = {
  materialId: "",
  sellerSupplierId: "",
  sellerArticleNumber: "",
  minimumOrderQuantity: "",
  minimumColorQuantity: "",
  quantityUnit: "",
  standardLeadTimeDays: "",
  reproductionLeadTimeDays: "",
  status: "ACTIVE",
  observationId: "",
};
export function listingBaseline(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!safeVersion(v.version) || !uuid.safeParse(v.id).success)
    return undefined;
  const fields: Record<string, unknown> = { ...v, observationId: v.id };
  for (const k of [
    "sellerArticleNumber",
    "minimumOrderQuantity",
    "minimumColorQuantity",
    "quantityUnit",
  ])
    fields[k] = v[k] === null ? "" : v[k];
  for (const k of ["standardLeadTimeDays", "reproductionLeadTimeDays"]) {
    if (v[k] === null) fields[k] = "";
    else if (
      typeof v[k] === "number" &&
      Number.isSafeInteger(v[k]) &&
      v[k] >= 0 &&
      v[k] <= 2147483647
    )
      fields[k] = String(v[k]);
    else return undefined;
  }
  const r = listingFields.safeParse(fields);
  return r.success
    ? {
        id: v.id as string,
        version: v.version,
        fields: { ...r.data, observationId: "" },
      }
    : undefined;
}
export function listingBody(
  v: ListingFields,
  currentVersion: number,
): Schemas["ListingInput"] {
  return {
    materialId: v.materialId,
    sellerSupplierId: v.sellerSupplierId,
    status: v.status,
    observationId: v.observationId,
    version: currentVersion,
    ...(v.sellerArticleNumber
      ? { sellerArticleNumber: v.sellerArticleNumber }
      : {}),
    ...(v.minimumOrderQuantity
      ? { minimumOrderQuantity: v.minimumOrderQuantity }
      : {}),
    ...(v.minimumColorQuantity
      ? { minimumColorQuantity: v.minimumColorQuantity }
      : {}),
    ...(v.quantityUnit ? { quantityUnit: v.quantityUnit } : {}),
    ...(v.standardLeadTimeDays
      ? { standardLeadTimeDays: Number(v.standardLeadTimeDays) }
      : {}),
    ...(v.reproductionLeadTimeDays
      ? { reproductionLeadTimeDays: Number(v.reproductionLeadTimeDays) }
      : {}),
  };
}
export function citation(value: unknown, facts: readonly string[]) {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  return uuid.safeParse(v.observationId).success &&
    typeof v.fieldName === "string" &&
    facts.includes(v.fieldName) &&
    typeof v.createdAt === "string" &&
    /^\d{4}-\d\d-\d\dT/.test(v.createdAt) &&
    Number.isFinite(Date.parse(v.createdAt)) &&
    z.iso.datetime({ offset: true }).safeParse(v.createdAt).success
    ? {
        observationId: v.observationId as string,
        fieldName: v.fieldName,
        createdAt: v.createdAt,
      }
    : undefined;
}

export const fieldLabels: Record<string, string> = {
  gsm: "GSM",
  widthMm: "Width (mm)",
  thicknessMm: "Thickness (mm)",
  stretchWarpPercentage: "Warp stretch (%)",
  stretchWeftPercentage: "Weft stretch (%)",
  shrinkageWarpPercentage: "Warp shrinkage (%)",
  shrinkageWeftPercentage: "Weft shrinkage (%)",
  thicknessMinMm: "Minimum thickness (mm)",
  thicknessMaxMm: "Maximum thickness (mm)",
  averageHideAreaM2: "Average hide area (m²)",
  finish: "Finish",
  surface: "Surface",
  handfeel: "Handfeel",
  luster: "Luster",
  drape: "Drape",
  variantName: "Variant name",
  catalogVariantSku: "Catalog Variant SKU",
  colorName: "Color name",
  colorCode: "Color code",
  batchNumber: "Batch number",
};
