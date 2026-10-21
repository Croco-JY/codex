import type { components } from "../../api/schema";
import { isUuid } from "../admin-sources/model";
import { supplierBaseline, facilityBaseline } from "../admin-network/model";
import {
  materialBaseline,
  variantBaseline,
  listingBaseline,
} from "../admin-catalog/model";
type S = components["schemas"];
export const identityKinds = {
  supplier: { kind: "SUPPLIER", label: "Supplier" },
  facility: { kind: "FACILITY", label: "Facility" },
  material: { kind: "MATERIAL", label: "Material" },
  variant: { kind: "MATERIAL_VARIANT", label: "Variant" },
  listing: { kind: "MATERIAL_LISTING", label: "Seller Listing" },
} as const;
export type IdentityType = keyof typeof identityKinds;
export type CreateBodies = {
  supplier: S["SupplierIdentityInput"]["supplier"];
  facility: S["FacilityIdentityInput"]["facility"];
  material: S["MaterialIdentityInput"]["material"];
  variant: S["MaterialVariantIdentityInput"]["variant"];
  listing: S["ListingIdentityInput"]["listing"];
};
export function resolvedState(type: IdentityType, data: unknown) {
  if (!data || typeof data !== "object") return undefined;
  const raw = data as Record<string, unknown>;
  const s = type === "supplier" ? supplierBaseline(data) : undefined;
  const f = type === "facility" ? facilityBaseline(data) : undefined;
  const m = type === "material" ? materialBaseline(data) : undefined;
  // Validate against the RETURNED parent, never the submitted Material.
  const v =
    type === "variant" && isUuid(raw.materialId)
      ? variantBaseline(data, raw.materialId)
      : undefined;
  const l = type === "listing" ? listingBaseline(data) : undefined;
  const state = s ?? f ?? m ?? v ?? l;
  if (!state) return undefined;
  const values: [string, string | number][] = [
    ["Canonical reference", state.id],
  ];
  if (s)
    values.push(
      ["Display name", s.fields.displayName],
      ["Country reference", s.fields.countryId],
      ["Status", s.fields.status],
      ["Version", s.version],
    );
  if (f)
    values.push(
      ["Parent Supplier", f.fields.supplierId],
      ["Name", f.fields.name],
      ["Type", f.fields.facilityType],
      ["Country reference", f.fields.countryId],
      ["Status", f.fields.status],
    );
  if (m)
    values.push(
      ["Catalog Supplier", m.catalogSupplierId],
      ["Material type", m.materialType],
      ["Display name", m.displayName],
      ["Status", m.status],
    );
  if (v)
    values.push(
      ["Actual Material", v.fields.materialId],
      ["Name", v.fields.variantName],
      ["Status", v.fields.status],
    );
  if (l)
    values.push(
      ["Actual Material", l.fields.materialId],
      ["Actual Seller", l.fields.sellerSupplierId],
      ["Status", l.fields.status],
    );
  return {
    id: state.id,
    values,
    material: m?.id ?? v?.fields.materialId ?? l?.fields.materialId,
    supplier:
      s?.id ??
      f?.fields.supplierId ??
      m?.catalogSupplierId ??
      l?.fields.sellerSupplierId,
    href: s
      ? `/admin/suppliers/${s.id}`
      : f
        ? `/admin/facilities/${f.id}`
        : m
          ? `/admin/materials/${m.id}`
          : v
            ? `/admin/materials/${v.fields.materialId}`
            : `/admin/listings/${l!.id}`,
  };
}
// Only compare submitted facts; server timestamps, IDs and initial verification are not create claims.
export function draftDiffers(body: object, data: unknown) {
  if (!data || typeof data !== "object") return true;
  const view = data as Record<string, unknown>;
  return Object.entries(body).some(([key, value]) => {
    if (key === "version" || key === "observationId") return false;
    const actual = view[key];
    if (key === "roles" && Array.isArray(value) && Array.isArray(actual))
      return [...value].sort().join("\0") !== [...actual].sort().join("\0");
    if (
      key === "composition" &&
      Array.isArray(value) &&
      Array.isArray(actual)
    ) {
      const parts = (rows: Record<string, unknown>[]) =>
        rows
          .map((p) => `${p.fiberTypeId}:${decimalText(p.percentage)}`)
          .sort()
          .join("\0");
      return parts(value) !== parts(actual);
    }
    if (
      key === "latitude" ||
      key === "longitude" ||
      key === "minimumOrderQuantity" ||
      key === "minimumColorQuantity"
    )
      return decimalText(value) !== decimalText(actual);
    return JSON.stringify(value) !== JSON.stringify(actual);
  });
}
function decimalText(value: unknown) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))
    return value;
  const [whole, fraction = ""] = value.split(".");
  const integer = whole!.replace(/^(-?)0+(?=\d)/, "$1");
  const tail = fraction.replace(/0+$/, "");
  return `${integer === "-0" && !tail ? "0" : integer}${tail ? `.${tail}` : ""}`;
}
