import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
export type Pattern = components["schemas"]["PatternView"];
export type Revision = components["schemas"]["PatternRevisionView"];
export type Page = components["schemas"]["PatternPage"];
export type HistoryPage = components["schemas"]["PatternRevisionPage"];
export type Filter = "ACTIVE" | "ARCHIVED" | "ALL";
const uuid = z.uuid(),
  time = z.iso.datetime({ offset: true });
const integer = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v === v.trim());
const revision = z.object({
  id: uuid,
  patternId: uuid,
  styleId: uuid,
  revisionNumber: integer,
  name: text(160),
  purpose: text(160).nullable(),
  measurementRevisionId: uuid.nullable(),
  createdAt: time,
});
const pattern = z.object({
  id: uuid,
  styleId: uuid,
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  latestRevision: revision,
  createdAt: time,
  updatedAt: time,
});
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
function requireValid(ok: boolean) {
  if (!ok) throw new ApiError(502);
}
export function checkedRevision(
  v: Revision,
  style: string,
  parent: string,
  id?: string,
) {
  requireValid(revision.safeParse(v).success);
  requireValid(
    v.styleId === style && v.patternId === parent && (!id || v.id === id),
  );
  return v;
}
export function checkedPattern(v: Pattern, style: string, id?: string) {
  requireValid(pattern.safeParse(v).success);
  requireValid(v.styleId === style && (!id || v.id === id));
  checkedRevision(v.latestRevision, style, v.id);
  return v;
}
export function checkedPage(
  v: Page,
  style: string,
  filter: Filter,
  limit = 25,
) {
  requireValid(
    !!v &&
      Array.isArray(v.items) &&
      v.items.length <= limit &&
      v.limit === limit &&
      (v.nextCursor === null || cursor.safeParse(v.nextCursor).success),
  );
  const ids = new Set<string>();
  for (const p of v.items) {
    checkedPattern(p, style);
    requireValid(!ids.has(p.id) && (filter === "ALL" || p.status === filter));
    ids.add(p.id);
  }
  requireValid(v.nextCursor === null || v.items.length === limit);
  return v;
}
export function checkedHistory(
  v: HistoryPage,
  style: string,
  parent: string,
  max: number,
  limit = 25,
) {
  requireValid(
    !!v &&
      Array.isArray(v.items) &&
      v.items.length <= limit &&
      v.limit === limit &&
      (v.nextMaxRevisionNumber === null ||
        integer.safeParse(v.nextMaxRevisionNumber).success),
  );
  let previous = max + 1;
  const ids = new Set<string>();
  for (const r of v.items) {
    checkedRevision(r, style, parent);
    requireValid(
      r.revisionNumber <= max && r.revisionNumber < previous && !ids.has(r.id),
    );
    previous = r.revisionNumber;
    ids.add(r.id);
  }
  requireValid(
    v.nextMaxRevisionNumber === null ||
      (v.items.length === limit &&
        v.items.length > 0 &&
        v.nextMaxRevisionNumber < previous),
  );
  return v;
}
export const draftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  purpose: z.string().trim().max(160),
  measurementRevisionId: z.union([z.literal(""), uuid]),
});
export type Draft = z.input<typeof draftSchema>;
export const draftOf = (v?: Revision): Draft => ({
  name: v?.name ?? "",
  purpose: v?.purpose ?? "",
  measurementRevisionId: v?.measurementRevisionId ?? "",
});
export function bodyOf(d: Draft) {
  const v = draftSchema.parse(d);
  return {
    name: v.name,
    purpose: v.purpose || null,
    measurementRevisionId: v.measurementRevisionId || null,
  };
}
