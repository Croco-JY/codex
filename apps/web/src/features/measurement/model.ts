import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
export type Spec = components["schemas"]["MeasurementSpecView"];
export type Revision = components["schemas"]["MeasurementRevisionView"];
export type Summary = components["schemas"]["MeasurementRevisionSummary"];
export type Page = components["schemas"]["MeasurementRevisionPage"];
export type CreateInput = components["schemas"]["MeasurementSpecCreateInput"];
export type RevisionInput =
  components["schemas"]["MeasurementRevisionCreateInput"];
export const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const number = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const canonical = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v === v.trim(), "Text must be canonical.");
export const decimal = z
  .string()
  .regex(
    /^[0-9]{1,15}(\.[0-9]{1,4})?$/,
    "Use a nonnegative decimal string, at most 15 integer and 4 fractional digits.",
  );
export const code = z
  .string()
  .regex(
    /^[A-Z0-9][A-Z0-9._/-]{0,79}$/,
    "Use an uppercase POM code without spaces.",
  );
const pointSchema = z.object({
  position: z.number().int().min(0).max(499),
  code,
  label: canonical(160),
  value: decimal,
  tolerancePlus: decimal.nullable(),
  toleranceMinus: decimal.nullable(),
  notes: canonical(1000).nullable(),
});
const revisionSchema = z.object({
  id: uuid,
  measurementSpecId: uuid,
  styleId: uuid,
  revisionNumber: number,
  baseSize: canonical(40),
  unitSystem: z.enum(["MM", "CM", "IN"]),
  createdAt: timestamp,
  points: z.array(pointSchema).min(1).max(500),
});
function checked<T>(value: T, valid: boolean): T {
  if (!valid) throw new ApiError(502);
  return value;
}
export function checkedRevision(
  value: Revision,
  style: string,
  spec: string,
  id?: string,
): Revision {
  const ok = revisionSchema.safeParse(value).success;
  return checked(
    value,
    ok &&
      value.styleId === style &&
      value.measurementSpecId === spec &&
      (!id || value.id === id) &&
      value.points.every((p, i) => p.position === i) &&
      new Set(value.points.map((p) => p.code)).size === value.points.length,
  );
}
export function checkedSpec(value: Spec, style: string): Spec {
  checked(
    value,
    !!value &&
      uuid.safeParse(value.id).success &&
      value.styleId === style &&
      uuid.safeParse(value.styleId).success &&
      timestamp.safeParse(value.createdAt).success &&
      !!value.latestRevision,
  );
  checkedRevision(value.latestRevision, style, value.id);
  return value;
}
const summarySchema = z.object({
  id: uuid,
  measurementSpecId: uuid,
  styleId: uuid,
  revisionNumber: number,
  baseSize: canonical(40),
  unitSystem: z.enum(["MM", "CM", "IN"]),
  pointCount: z.number().int().min(1).max(500),
  createdAt: timestamp,
});
export function checkedPage(
  value: Page,
  style: string,
  spec: string,
  limit: number,
  max: number,
): Page {
  checked(
    value,
    !!value &&
      Array.isArray(value.items) &&
      value.items.length <= limit &&
      value.limit === limit &&
      (value.nextMaxRevisionNumber === null ||
        number.safeParse(value.nextMaxRevisionNumber).success),
  );
  let previous = max + 1;
  const ids = new Set<string>();
  for (const row of value.items) {
    checked(
      row,
      summarySchema.safeParse(row).success &&
        row.styleId === style &&
        row.measurementSpecId === spec &&
        row.revisionNumber <= max &&
        row.revisionNumber < previous &&
        !ids.has(row.id),
    );
    ids.add(row.id);
    previous = row.revisionNumber;
  }
  checked(
    value,
    value.nextMaxRevisionNumber === null ||
      (value.items.length === limit &&
        value.items.length > 0 &&
        value.nextMaxRevisionNumber < previous),
  );
  return value;
}
const optionalDecimal = z
  .string()
  .refine(
    (v) => v === "" || decimal.safeParse(v).success,
    "Enter an exact nonnegative decimal or leave empty.",
  );
export const draftSchema = z
  .object({
    baseSize: z.string().trim().min(1).max(40),
    unitSystem: z.enum(["", "MM", "CM", "IN"]).transform((v, c) => {
      if (v === "") {
        c.addIssue({ code: "custom", message: "Choose a unit system." });
        return z.NEVER;
      }
      return v;
    }),
    points: z
      .array(
        z.object({
          code,
          label: z.string().trim().min(1).max(160),
          value: decimal,
          tolerancePlus: optionalDecimal,
          toleranceMinus: optionalDecimal,
          notes: z.string().trim().max(1000),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((v, c) => {
    const seen = new Set<string>();
    v.points.forEach((p, i) => {
      if (seen.has(p.code))
        c.addIssue({
          code: "custom",
          path: ["points", i, "code"],
          message: "POM codes must be unique in this revision.",
        });
      seen.add(p.code);
    });
  });
export type Draft = z.input<typeof draftSchema>;
export const emptyPoint = () => ({
  code: "",
  label: "",
  value: "",
  tolerancePlus: "",
  toleranceMinus: "",
  notes: "",
});
export function draftOf(value?: Revision): Draft {
  return {
    baseSize: value?.baseSize ?? "",
    unitSystem: value?.unitSystem ?? "",
    points: value
      ? value.points.map((p) => ({
          code: p.code,
          label: p.label,
          value: p.value,
          tolerancePlus: p.tolerancePlus ?? "",
          toleranceMinus: p.toleranceMinus ?? "",
          notes: p.notes ?? "",
        }))
      : [emptyPoint()],
  };
}
export function bodyOf(draft: Draft): CreateInput {
  const v = draftSchema.parse(draft);
  return {
    baseSize: v.baseSize,
    unitSystem: v.unitSystem,
    points: v.points.map((p) => ({
      code: p.code,
      label: p.label,
      value: p.value,
      tolerancePlus: p.tolerancePlus || null,
      toleranceMinus: p.toleranceMinus || null,
      notes: p.notes || null,
    })),
  };
}
