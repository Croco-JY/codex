import type { paths } from "../../api/schema";
type SupplierQuery = NonNullable<
  paths["/api/v1/suppliers"]["get"]["parameters"]["query"]
>;
type FacilityQuery = NonNullable<
  paths["/api/v1/facilities"]["get"]["parameters"]["query"]
>;
export type SupplierFilters = Omit<SupplierQuery, "limit" | "cursor">;
export type FacilityFilters = Omit<FacilityQuery, "limit" | "cursor">;
export const roles = [
  "MILL",
  "CONVERTER",
  "MATERIAL_SUPPLIER",
  "TRIM_SUPPLIER",
  "FACTORY",
  "PROCESSOR",
  "QC_COMPANY",
  "LOGISTICS_COMPANY",
  "OTHER",
] as const satisfies readonly NonNullable<SupplierFilters["role"]>[];
export const verifications = [
  "DISCOVERED",
  "CLAIMED",
  "VERIFIED",
  "AUDITED",
  "TRANSACTED",
  "PROVEN",
] as const satisfies readonly NonNullable<
  SupplierFilters["verificationStatus"]
>[];
export const facilityTypes = [
  "OFFICE",
  "MILL",
  "FACTORY",
  "WAREHOUSE",
  "SHOWROOM",
  "PROCESSING_PLANT",
  "QC_SITE",
  "OTHER",
] as const satisfies readonly NonNullable<FacilityFilters["type"]>[];
export const supplierKeys = [
  "q",
  "country",
  "role",
  "verificationStatus",
  "facilityCountry",
  "region",
  "cluster",
  "capability",
] as const;
export const facilityKeys = [
  "country",
  "region",
  "cluster",
  "type",
  "capability",
  "supplier",
] as const;
export type DirectoryKind = "suppliers" | "facilities";
export type NetworkFilters = SupplierFilters & FacilityFilters;
export const labels: Record<keyof NetworkFilters, string> = {
  q: "Keyword",
  country: "Country",
  role: "Supplier role",
  verificationStatus: "Supplier verification",
  facilityCountry: "Facility country",
  region: "Region",
  cluster: "Industrial Cluster",
  capability: "Capability",
  type: "Facility type",
  supplier: "Supplier",
};
export const validUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function parseDirectory(kind: DirectoryKind, input: string) {
  const source = new URLSearchParams(input),
    out = new URLSearchParams();
  for (const key of kind === "suppliers" ? supplierKeys : facilityKeys) {
    const raw = source.get(key);
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) continue;
    let value = raw.trim();
    if (key === "q") {
      if (value.length > 160) continue;
    } else if (key === "country" || key === "facilityCountry") {
      value = value.toUpperCase();
      if (!/^[A-Z]{2}$/.test(value)) continue;
    } else if (key === "role") {
      if (!roles.some((v) => v === value)) continue;
    } else if (key === "verificationStatus") {
      if (!verifications.some((v) => v === value)) continue;
    } else if (key === "type") {
      if (!facilityTypes.some((v) => v === value)) continue;
    } else {
      if (!validUuid(value)) continue;
      value = value.toLowerCase();
    }
    if (value) out.set(key, value);
  }
  // The parser validates every value against the generated endpoint's allowlist above.
  const filters = Object.fromEntries(out) as NetworkFilters;
  return {
    filters,
    canonical: out.toString(),
    cleaned: source.toString() !== out.toString(),
  };
}
export function serializeDirectory(
  kind: DirectoryKind,
  filters: NetworkFilters,
) {
  const params = new URLSearchParams();
  for (const key of kind === "suppliers" ? supplierKeys : facilityKeys) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return parseDirectory(kind, params.toString()).canonical;
}
export function safeWebsite(value?: string) {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
