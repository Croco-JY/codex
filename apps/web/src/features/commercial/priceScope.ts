import type { operations } from "../../api/schema";
import { decimal } from "../materials/decimal";
export type PriceScope = Omit<
  NonNullable<operations["effective"]["parameters"]["query"]>,
  "cursor" | "limit"
>;
export type HistoryScope = Pick<
  PriceScope,
  "currency" | "priceUnit" | "dataSourceId"
>;
export type PriceDraft = {
  mode: "current" | "historical";
  requestedVariantId: string;
  requestedQuantity: string;
  currency: string;
  priceUnit: NonNullable<PriceScope["priceUnit"]> | "";
  asOf: string;
  allowMaterialFallback: boolean;
  dataSourceId: string;
};
export const initialPriceDraft = (): PriceDraft => ({
  mode: "current",
  requestedVariantId: "",
  requestedQuantity: "",
  currency: "",
  priceUnit: "",
  asOf: "",
  allowMaterialFallback: false,
  dataSourceId: "",
});
export function validUtc(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value))
    return false;
  const date = new Date(value);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
export function validatePrice(draft: PriceDraft) {
  const errors: Partial<Record<keyof PriceDraft, string>> = {};
  const quantity = draft.requestedQuantity.trim();
  const parsed = quantity ? decimal(quantity) : undefined;
  if (quantity && (parsed === undefined || parsed === "0"))
    errors.requestedQuantity =
      "Use a positive exact decimal, with at most 15 whole and 4 fractional digits; leave blank for base prices.";
  const currency = draft.currency.trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency))
    errors.currency = "Use a three-letter currency code.";
  const asOf = draft.asOf.trim();
  if (draft.mode === "historical" && !validUtc(asOf))
    errors.asOf =
      "Enter a valid UTC instant, for example 2025-06-01T00:00:00Z (up to 6 fractional seconds).";
  const scope: PriceScope = {
    allowMaterialFallback: draft.allowMaterialFallback,
    ...(draft.requestedVariantId
      ? { requestedVariantId: draft.requestedVariantId }
      : {}),
    ...(parsed !== undefined ? { requestedQuantity: parsed } : {}),
    ...(currency ? { currency } : {}),
    ...(draft.priceUnit ? { priceUnit: draft.priceUnit } : {}),
    ...(draft.dataSourceId ? { dataSourceId: draft.dataSourceId } : {}),
    ...(draft.mode === "historical" ? { asOf } : {}),
  };
  return { scope, errors };
}
