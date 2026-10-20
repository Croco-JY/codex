import type { operations } from "../../api/schema";
import { compareDecimal, decimal } from "./decimal";

type Search = NonNullable<operations["search"]["parameters"]["query"]>;
export const materialTypes = [
  "FABRIC",
  "LEATHER",
  "LINING",
  "INTERLINING",
  "ZIPPER",
  "BUTTON",
  "SNAP",
  "BUCKLE",
  "THREAD",
  "TAPE",
  "LABEL",
  "ELASTIC",
  "FILLING",
  "PACKAGING",
  "OTHER",
] as const satisfies readonly NonNullable<Search["materialType"]>[];
export const units = [
  "PCS",
  "METER",
  "YARD",
  "KG",
  "GRAM",
  "MM",
  "CM",
  "M2",
  "FT2",
  "ROLL",
  "HIDE",
  "SET",
  "PACK",
] as const satisfies readonly NonNullable<Search["quantityUnit"]>[];
export const filterLabels = {
  q: "Keyword",
  materialType: "Material type",
  originCountryId: "Origin",
  fiberTypeId: "Fiber",
  color: "Color",
  catalogSupplierId: "Catalog supplier",
  minFiberPercentage: "Minimum fiber %",
  maxFiberPercentage: "Maximum fiber %",
  minGsm: "Minimum GSM",
  maxGsm: "Maximum GSM",
  minWidthMm: "Minimum width (mm)",
  maxWidthMm: "Maximum width (mm)",
  minThicknessMm: "Minimum thickness (mm)",
  maxThicknessMm: "Maximum thickness (mm)",
  sellerSupplierId: "Seller",
  maxMoq: "Maximum MOQ",
  maxMcq: "Maximum MCQ / minimum color quantity",
  quantityUnit: "Quantity unit",
  minLeadTimeDays: "Minimum standard lead time (days)",
  maxLeadTimeDays: "Maximum standard lead time (days)",
  listingStatus: "Listing status",
} as const;
export type FilterKey = keyof typeof filterLabels;
export type Draft = Record<FilterKey, string>;
export type Filters = Pick<Search, FilterKey>;
export const filterKeys = Object.keys(filterLabels) as FilterKey[];
export const commercialKeys: FilterKey[] = [
  "sellerSupplierId",
  "maxMoq",
  "maxMcq",
  "quantityUnit",
  "minLeadTimeDays",
  "maxLeadTimeDays",
  "listingStatus",
];
const decimalKeys: FilterKey[] = [
  "minFiberPercentage",
  "maxFiberPercentage",
  "minGsm",
  "maxGsm",
  "minWidthMm",
  "maxWidthMm",
  "minThicknessMm",
  "maxThicknessMm",
  "maxMoq",
  "maxMcq",
];
const ranges = [
  ["minFiberPercentage", "maxFiberPercentage"],
  ["minGsm", "maxGsm"],
  ["minWidthMm", "maxWidthMm"],
  ["minThicknessMm", "maxThicknessMm"],
  ["minLeadTimeDays", "maxLeadTimeDays"],
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const emptyDraft = (): Draft =>
  Object.fromEntries(filterKeys.map((key) => [key, ""])) as Draft;
export function draftFrom(filters: Filters): Draft {
  const draft = emptyDraft();
  for (const key of filterKeys)
    draft[key] = filters[key] === undefined ? "" : String(filters[key]);
  return draft;
}
export function validateDraft(draft: Draft) {
  const values: Partial<Record<FilterKey, string>> = {};
  const errors: Partial<Record<FilterKey, string>> = {};
  for (const key of filterKeys) {
    let value = draft[key].trim();
    if (!value) continue;
    if (decimalKeys.includes(key)) {
      const parsed = decimal(value);
      if (parsed === undefined) {
        errors[key] =
          "Use a non-negative decimal with at most 15 whole and 4 fractional digits.";
        continue;
      }
      value = parsed;
      if (
        (key === "minFiberPercentage" || key === "maxFiberPercentage") &&
        compareDecimal(value, "100") > 0
      ) {
        errors[key] = "Use a percentage from 0 to 100.";
        continue;
      }
    } else if (key === "minLeadTimeDays" || key === "maxLeadTimeDays") {
      if (!/^\d{1,10}$/.test(value) || BigInt(value) > 2147483647n) {
        errors[key] = "Use whole days from 0 to 2147483647.";
        continue;
      }
      value = BigInt(value).toString();
    } else if (key.endsWith("Id")) {
      if (!uuid.test(value)) {
        errors[key] = "Choose a valid reference.";
        continue;
      }
      value = value.toLowerCase();
    } else if (
      key === "materialType" &&
      !materialTypes.some((type) => type === value)
    ) {
      errors[key] = "Choose a material type.";
      continue;
    } else if (
      key === "quantityUnit" &&
      !units.some((unit) => unit === value)
    ) {
      errors[key] = "Choose a quantity unit.";
      continue;
    } else if (
      key === "listingStatus" &&
      value !== "ACTIVE" &&
      value !== "ARCHIVED"
    ) {
      errors[key] = "Choose a listing status.";
      continue;
    } else if (
      (key === "q" && value.length > 200) ||
      (key === "color" && value.length > 100)
    ) {
      errors[key] = `Use ${key === "q" ? 200 : 100} characters or fewer.`;
      continue;
    }
    values[key] = value;
  }
  for (const [min, max] of ranges) {
    if (
      values[min] !== undefined &&
      values[max] !== undefined &&
      compareDecimal(values[min], values[max]) > 0
    )
      errors[max] = "Maximum must be at least the minimum.";
  }
  if (
    (values.minFiberPercentage !== undefined ||
      values.maxFiberPercentage !== undefined) &&
    !values.fiberTypeId
  ) {
    errors.minFiberPercentage = "Choose a fiber to filter its percentage.";
    delete values.minFiberPercentage;
    delete values.maxFiberPercentage;
  }
  // Values enter this typed boundary only after validation against each generated field's domain.
  const filters: Filters = {
    ...values,
    materialType: values.materialType as Filters["materialType"],
    quantityUnit: values.quantityUnit as Filters["quantityUnit"],
    listingStatus: values.listingStatus as Filters["listingStatus"],
    minLeadTimeDays:
      values.minLeadTimeDays === undefined
        ? undefined
        : Number(values.minLeadTimeDays),
    maxLeadTimeDays:
      values.maxLeadTimeDays === undefined
        ? undefined
        : Number(values.maxLeadTimeDays),
  };
  for (const key of filterKeys)
    if (filters[key] === undefined) delete filters[key];
  return { filters, errors };
}
export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  for (const key of filterKeys)
    if (filters[key] !== undefined) params.set(key, String(filters[key]));
  return params.toString();
}
export function parseFilters(search: string) {
  const params = new URLSearchParams(search);
  const draft = emptyDraft();
  for (const key of filterKeys) draft[key] = params.get(key) ?? "";
  const parsed = validateDraft(draft);
  for (const key of Object.keys(parsed.errors) as FilterKey[])
    delete parsed.filters[key];
  const canonical = serializeFilters(parsed.filters);
  return {
    filters: parsed.filters,
    canonical,
    cleaned: canonical !== params.toString(),
  };
}
export function searchParams(
  filters: Filters,
  limit: number,
  cursor?: string,
): Search {
  return { ...filters, status: "ACTIVE", limit, ...(cursor ? { cursor } : {}) };
}
export function removeFilter(filters: Filters, key: FilterKey): Filters {
  const next = { ...filters };
  delete next[key];
  if (key === "fiberTypeId") {
    delete next.minFiberPercentage;
    delete next.maxFiberPercentage;
  }
  return next;
}
/** Future typed transport boundary only; never sourced from the 1C-2 form or URL parser. */
export type PriceScope = Required<
  Pick<
    Search,
    "maxPrice" | "priceDataSourceId" | "currency" | "priceUnit" | "asOf"
  >
> &
  Pick<Search, "requestedQuantity" | "allowMaterialFallback">;
export function withPriceScope(query: Search, price: PriceScope): Search {
  return {
    ...query,
    maxPrice: price.maxPrice,
    priceDataSourceId: price.priceDataSourceId,
    currency: price.currency,
    priceUnit: price.priceUnit,
    asOf: price.asOf,
    ...(price.requestedQuantity === undefined
      ? {}
      : { requestedQuantity: price.requestedQuantity }),
    ...(price.allowMaterialFallback === undefined
      ? {}
      : { allowMaterialFallback: price.allowMaterialFallback }),
  };
}
