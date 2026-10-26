import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";

export type Grading = components["schemas"]["GradeRuleSetView"];
export type Revision = components["schemas"]["GradeRuleSetRevisionView"];
export type Summary = components["schemas"]["GradeRuleSetRevisionSummary"];
export type Page = components["schemas"]["GradeRuleSetPage"];
export type History = components["schemas"]["GradeRuleSetRevisionPage"];
export type Lifecycle = components["schemas"]["GradeRuleSetLifecycleView"];
export type Filter = "ACTIVE" | "ARCHIVED" | "ALL";
const boundary =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/gu;
export const trimBoundary = (v: string) => v.replace(boundary, "");
const canonical = (max: number) =>
  z
    .string()
    .refine(
      (v) =>
        v.length > 0 &&
        [...v].length <= max &&
        trimBoundary(v) === v &&
        !/[\u0000\ud800-\udfff]/u.test(v),
    );
const uuid = z.uuid().refine((v) => v === v.toLowerCase());
const integer = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const time = z.iso.datetime({ offset: true });
const unit = z.enum(["MM", "CM", "IN"]);
export const decimal = z.string().regex(/^-?[0-9]{1,15}(\.[0-9]{1,4})?$/);
export const isZero = (v: string) => /^-?0+(\.0+)?$/.test(v);
const sizeCode = z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/);
const ruleCode = z.string().regex(/^[A-Z0-9][A-Z0-9._/-]{0,79}$/);
const size = z
  .object({
    position: z.number().int().min(0).max(29),
    code: sizeCode,
    label: canonical(80),
  })
  .strict();
const value = z.object({ sizeCode, delta: decimal }).strict();
const rule = z
  .object({
    position: z.number().int().min(0).max(99),
    code: ruleCode,
    label: canonical(160),
    notes: canonical(1000).nullable(),
    values: z.array(value).min(2).max(30),
  })
  .strict();
const meta = {
  id: uuid,
  gradeRuleSetId: uuid,
  styleId: uuid,
  revisionNumber: integer,
  name: canonical(160),
  baseSizeCode: sizeCode,
  unitSystem: unit,
  createdAt: time,
};
const revision = z
  .object({
    ...meta,
    notes: canonical(1000).nullable(),
    sizes: z.array(size).min(2).max(30),
    rules: z.array(rule).min(1).max(100),
  })
  .strict();
const summary = z
  .object({
    ...meta,
    sizeCount: z.number().int().min(2).max(30),
    ruleCount: z.number().int().min(1).max(100),
  })
  .strict();
const aggregate = {
  id: uuid,
  styleId: uuid,
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  createdAt: time,
  updatedAt: time,
};
const full = z.object({ ...aggregate, latestRevision: revision }).strict();
const compact = z.object({ ...aggregate, latestRevision: summary }).strict();
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
function requireValid(ok: boolean): asserts ok {
  if (!ok) throw new ApiError(502);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  requireValid(r.success);
  return r.data;
}
function ownership(
  r: { id: string; styleId: string; gradeRuleSetId: string },
  style: string,
  parent: string,
  id?: string,
) {
  requireValid(
    r.styleId === style && r.gradeRuleSetId === parent && (!id || r.id === id),
  );
}
export function checkedRevision(
  input: unknown,
  style: string,
  parent: string,
  id?: string,
): Revision {
  const r = parse(revision, input);
  ownership(r, style, parent, id);
  requireValid(r.sizes.some((s) => s.code === r.baseSizeCode));
  requireValid(
    new Set(r.sizes.map((s) => s.code)).size === r.sizes.length &&
      new Set(r.rules.map((g) => g.code)).size === r.rules.length,
  );
  r.sizes.forEach((s, i) => requireValid(s.position === i));
  r.rules.forEach((g, i) => {
    requireValid(g.position === i && g.values.length === r.sizes.length);
    g.values.forEach((v, j) =>
      requireValid(
        v.sizeCode === r.sizes[j].code &&
          (v.sizeCode !== r.baseSizeCode || isZero(v.delta)),
      ),
    );
  });
  return r;
}
export function checkedGrading(
  input: unknown,
  style: string,
  id?: string,
): Grading {
  const r = parse(full, input);
  requireValid(r.styleId === style && (!id || r.id === id));
  checkedRevision(r.latestRevision, style, r.id);
  return r;
}
export function checkedLifecycle(
  input: unknown,
  style: string,
  id: string,
): Lifecycle {
  const r = parse(compact, input);
  requireValid(r.id === id && r.styleId === style);
  ownership(r.latestRevision, style, id);
  return r;
}
export function checkedPage(
  input: unknown,
  style: string,
  filter: Filter,
  limit = 25,
): Page {
  const p = parse(
    z
      .object({
        items: z.array(compact).max(limit),
        limit: z.literal(limit),
        nextCursor: cursor.nullable(),
      })
      .strict(),
    input,
  );
  const ids = new Set<string>();
  for (const a of p.items) {
    requireValid(
      a.styleId === style &&
        !ids.has(a.id) &&
        (filter === "ALL" || a.status === filter),
    );
    ownership(a.latestRevision, style, a.id);
    ids.add(a.id);
  }
  requireValid(p.nextCursor === null || p.items.length === limit);
  return p;
}
export function checkedHistory(
  input: unknown,
  style: string,
  parent: string,
  max: number,
  limit = 25,
): History {
  const p = parse(
    z
      .object({
        items: z.array(summary).max(limit),
        limit: z.literal(limit),
        nextMaxRevisionNumber: integer.nullable(),
      })
      .strict(),
    input,
  );
  let previous = max;
  const ids = new Set<string>();
  p.items.forEach((r, i) => {
    ownership(r, style, parent);
    requireValid(
      r.revisionNumber <= max &&
        (i === 0 || r.revisionNumber < previous) &&
        !ids.has(r.id),
    );
    previous = r.revisionNumber;
    ids.add(r.id);
  });
  requireValid(
    p.nextMaxRevisionNumber === null ||
      (p.items.length === limit && p.nextMaxRevisionNumber < previous),
  );
  return p;
}

export type Draft = {
  name: string;
  notes: string;
  baseSizeCode: string;
  unitSystem: string;
  sizes: { code: string; label: string }[];
  rules: {
    code: string;
    label: string;
    notes: string;
    values: { sizeCode: string; delta: string }[];
  }[];
};
export function draftOf(r?: Revision): Draft {
  return r
    ? {
        name: r.name,
        notes: r.notes ?? "",
        baseSizeCode: r.baseSizeCode,
        unitSystem: r.unitSystem,
        sizes: r.sizes.map((s) => ({ code: s.code, label: s.label })),
        rules: r.rules.map((g) => ({
          code: g.code,
          label: g.label,
          notes: g.notes ?? "",
          values: g.values.map((v) => ({ ...v })),
        })),
      }
    : {
        name: "",
        notes: "",
        unitSystem: "",
        baseSizeCode: "",
        sizes: [
          { code: "S", label: "Small" },
          { code: "M", label: "Medium" },
        ],
        rules: [
          {
            code: "",
            label: "",
            notes: "",
            values: [
              { sizeCode: "S", delta: "" },
              { sizeCode: "M", delta: "" },
            ],
          },
        ],
      };
}
const inputText = (max: number) =>
  z.string().transform(trimBoundary).pipe(canonical(max));
const notes = z
  .string()
  .transform((v) => trimBoundary(v) || null)
  .pipe(canonical(1000).nullable());
const snapshot = z
  .object({
    name: inputText(160),
    notes,
    baseSizeCode: sizeCode,
    unitSystem: unit,
    sizes: z
      .array(z.object({ code: sizeCode, label: inputText(80) }).strict())
      .min(2)
      .max(30),
    rules: z
      .array(
        z
          .object({
            code: ruleCode,
            label: inputText(160),
            notes,
            values: z.array(value).min(2).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((d, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!d.sizes.some((s) => s.code === d.baseSizeCode))
      bad("Choose an existing base size.");
    if (new Set(d.sizes.map((s) => s.code)).size !== d.sizes.length)
      bad("Size codes must be unique.");
    if (new Set(d.rules.map((r) => r.code)).size !== d.rules.length)
      bad("Rule codes must be unique.");
    for (const g of d.rules) {
      if (
        g.values.length !== d.sizes.length ||
        g.values.some((v, j) => v.sizeCode !== d.sizes[j].code)
      )
        bad("Every rule requires all sizes in size order.");
      if (
        g.values.some((v) => v.sizeCode === d.baseSizeCode && !isZero(v.delta))
      )
        bad(
          "Every base-size delta must be zero. Changing base size does not rebase values.",
        );
    }
  });
export function bodyOf(
  d: Draft,
): components["schemas"]["GradeRuleSetCreateInput"] {
  return snapshot.parse(d);
}
export const signed = (v: string) =>
  isZero(v) || v.startsWith("-") ? v : "+" + v;
