import { z } from "zod";
import type { components } from "../../api/schema";
import { ApiError } from "../../api/errors";
export type Selection = components["schemas"]["StyleMaterialSelectionView"];
export type SelectionPage = components["schemas"]["StyleMaterialSelectionPage"];
export type SelectionInput =
  components["schemas"]["StyleMaterialSelectionInput"];
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const selectionSchema = z.object({
  materialId: z.string().refine(uuid),
  variantId: z.string().refine(uuid).nullable(),
  listingId: z.string().refine(uuid).nullable(),
});
export function checkedSelection(v: Selection, style: string): Selection {
  if (
    !v ||
    !uuid(v.id) ||
    !uuid(v.styleId) ||
    v.styleId !== style ||
    !uuid(v.materialId) ||
    !(v.variantId === null || uuid(v.variantId)) ||
    !(v.listingId === null || uuid(v.listingId)) ||
    typeof v.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(v.createdAt) ||
    !Number.isFinite(Date.parse(v.createdAt))
  )
    throw new ApiError(502);
  return v;
}
export function checkedSelections(
  v: SelectionPage,
  style: string,
  offset: number,
): SelectionPage {
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 25 ||
    v.limit !== 25 ||
    v.offset !== offset ||
    typeof v.hasMore !== "boolean"
  )
    throw new ApiError(502);
  v.items.forEach((row) => checkedSelection(row, style));
  return v;
}
export type ReferenceKind = "material" | "variant" | "listing";
export function pageReferences(rows: Selection[]) {
  const refs = new Map<string, { kind: ReferenceKind; id: string }>();
  for (const row of rows)
    for (const [kind, id] of [
      ["material", row.materialId],
      ["variant", row.variantId],
      ["listing", row.listingId],
    ] as const)
      if (id) refs.set(`${kind}:${id}`, { kind, id });
  return [...refs.values()];
}
export function sameScope(row: Selection, input: SelectionInput) {
  return (
    row.materialId === input.materialId &&
    row.variantId === (input.variantId ?? null) &&
    row.listingId === (input.listingId ?? null)
  );
}
export function liveLabel(
  data: unknown,
  kind: ReferenceKind,
  id: string,
  materialId: string,
): string {
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    data.id !== id ||
    !("status" in data) ||
    typeof data.status !== "string" ||
    !["ACTIVE", "ARCHIVED", ...(kind === "material" ? ["DRAFT"] : [])].includes(
      data.status,
    ) ||
    (kind !== "material" &&
      (!("materialId" in data) || data.materialId !== materialId))
  )
    return "Label unavailable";
  const name =
    kind === "material" && "displayName" in data
      ? data.displayName
      : kind === "variant" && "variantName" in data
        ? data.variantName
        : "sellerArticleNumber" in data
          ? data.sellerArticleNumber
          : undefined;
  return `${typeof name === "string" && name ? name : kind === "listing" ? "Listing" : "Label unavailable"} · ${data.status}`;
}
