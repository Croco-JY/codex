import { z } from "zod";
import type { components } from "../../api/schema";
import { ApiError } from "../../api/errors";
import { decimal } from "../materials/decimal";
import { safeVersion } from "./model";
export type Requirement = components["schemas"]["StyleRequirementView"];
export type RequirementInput = components["schemas"]["StyleRequirementInput"];
export const exactRequirementDecimal = (v: string) =>
  /^[0-9]{1,15}(\.[0-9]{1,4})?$/.test(v) && decimal(v) !== undefined;
export function isoDate(v: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) || v.startsWith("0000"))
    return false;
  const date = new Date(`${v}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
  );
}
const currency = (v: string) =>
  /^[A-Z]{3}$/.test(v) && v !== "XXX" && v !== "XTS";
export const requirementSchema = z
  .object({
    productType: z.string().trim().max(160),
    targetQuantity: z
      .string()
      .refine(
        (v) => !v || exactRequirementDecimal(v),
        "Use a nonnegative decimal with at most 15 integer and 4 fractional digits.",
      ),
    quantityUnit: z.enum(["", "PCS", "SET"]),
    targetCost: z
      .string()
      .refine(
        (v) => !v || exactRequirementDecimal(v),
        "Use a nonnegative decimal with at most 15 integer and 4 fractional digits.",
      ),
    currency: z
      .string()
      .refine(
        (v) => !v || currency(v),
        "Enter an uppercase commercial currency code, such as USD or KRW.",
      ),
    targetDeliveryDate: z
      .string()
      .refine(
        (v) => !v || isoDate(v),
        "Enter a valid date in YYYY-MM-DD format.",
      ),
    notes: z.string().trim().max(4000),
  })
  .superRefine((v, ctx) => {
    if ((v.targetQuantity || v.targetCost) && !v.quantityUnit)
      ctx.addIssue({
        code: "custom",
        path: ["quantityUnit"],
        message: "Choose a unit when quantity or unit cost is present.",
      });
    if (!!v.targetCost !== !!v.currency)
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message:
          "Target unit cost and currency must both be present or both be empty.",
      });
  });
export type RequirementDraft = z.infer<typeof requirementSchema>;
export function requirementDraft(v: Requirement | null): RequirementDraft {
  return {
    productType: v?.productType ?? "",
    targetQuantity: v?.targetQuantity ?? "",
    quantityUnit: v?.quantityUnit ?? "",
    targetCost: v?.targetCost ?? "",
    currency: v?.currency ?? "",
    targetDeliveryDate: v?.targetDeliveryDate ?? "",
    notes: v?.notes ?? "",
  };
}
export function requirementBody(
  d: RequirementDraft,
  version: number,
): RequirementInput {
  return {
    productType: d.productType || null,
    targetQuantity: d.targetQuantity || null,
    quantityUnit: d.quantityUnit || null,
    targetCost: d.targetCost || null,
    currency: d.currency || null,
    targetDeliveryDate: d.targetDeliveryDate || null,
    notes: d.notes || null,
    version,
  };
}
export function checkedRequirement(
  v: Requirement,
  styleId: string,
): Requirement {
  const nullable = (value: unknown, validate: (text: string) => boolean) =>
    value === null || (typeof value === "string" && validate(value));
  const text = (max: number) => (s: string) =>
    !!s && s === s.trim() && s.length <= max;
  const time = (value: unknown) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    isoDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value));
  if (
    !v ||
    v.styleId !== styleId ||
    !safeVersion(v.version) ||
    !time(v.createdAt) ||
    !time(v.updatedAt) ||
    !nullable(v.productType, text(160)) ||
    !nullable(v.notes, text(4000)) ||
    !nullable(v.targetQuantity, exactRequirementDecimal) ||
    !nullable(v.targetCost, exactRequirementDecimal) ||
    !nullable(v.quantityUnit, (s) => s === "PCS" || s === "SET") ||
    !nullable(v.currency, currency) ||
    !nullable(v.targetDeliveryDate, isoDate) ||
    ((v.targetQuantity !== null || v.targetCost !== null) &&
      v.quantityUnit === null) ||
    (v.targetCost === null) !== (v.currency === null)
  )
    throw new ApiError(502);
  return v;
}
