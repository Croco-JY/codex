import { z } from "zod";
import type { components } from "../../api/schema";
import { roles, verifications, facilityTypes } from "../network/filters";
import { uuid, safeVersion, validSourceUrl } from "../admin-sources/model";

export type Supplier = components["schemas"]["SupplierView"];
export type Facility = components["schemas"]["FacilityView"];
export type Assignment = components["schemas"]["FacilityCapabilityAdminView"];
export const statuses = ["ACTIVE", "ARCHIVED"] as const;
export const manualVerification = [
  "DISCOVERED",
  "VERIFIED",
  "AUDITED",
] as const;
export const aliasTypes = [
  "ORIGINAL",
  "ENGLISH",
  "ROMANIZED",
  "COMMERCIAL",
  "OTHER",
] as const;
export const supplierFacts = [
  "RECORD",
  "DISPLAY_NAME",
  "LEGAL_NAME",
  "NATIVE_NAME",
  "ENGLISH_NAME",
  "COUNTRY",
  "WEBSITE_URL",
  "DESCRIPTION",
  "ROLE",
  "ALIAS",
  "VERIFICATION",
] as const satisfies readonly components["schemas"]["SupplierCitation"]["fieldName"][];
export const facilityFacts = [
  "RECORD",
  "NAME",
  "TYPE",
  "COUNTRY",
  "REGION",
  "CLUSTER",
  "ADDRESS",
  "COORDINATES",
  "PHONE",
  "EMAIL",
] as const satisfies readonly components["schemas"]["FacilityCitation"]["fieldName"][];
export const proficiencies = [
  "SUPPORTED",
  "EXPERIENCED",
  "SPECIALIST",
] as const;
export const capabilityVerifications = [
  "UNVERIFIED",
  "DOCUMENTED",
  "AUDITED",
] as const;
export const capabilityUnits = [
  "PCS",
  "METER",
  "YARD",
  "KG",
  "GRAM",
  "MM",
  "CM",
  "M2",
] as const satisfies readonly NonNullable<
  components["schemas"]["FacilityCapabilityInput"]["quantityUnit"]
>[];
const nonblank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !!v.trim(), "Enter a value.");
const optionalUuid = z.union([z.literal(""), uuid]);
const version = z.custom<number>(
  safeVersion,
  "A safe current server version is required.",
);
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => v ?? "");
export const safeNotes = (value: string) =>
  !/(?:Bearer\s+|github_pat_|gh[pousr]_|-----BEGIN|password\s*[:=]|authorization\s*:)/is.test(
    value,
  );
const notes = z
  .string()
  .max(1000)
  .refine(safeNotes, "Do not enter credentials or secret material.");

export const supplierFields = z.object({
  countryId: uuid,
  displayName: nonblank(160),
  legalName: z.string().max(160),
  nativeName: z.string().max(160),
  englishName: z.string().max(160),
  businessRegistrationNumber: z.string().max(100),
  websiteUrl: z
    .string()
    .refine(
      validSourceUrl,
      "Enter an HTTP(S) URL without credentials or a fragment.",
    ),
  description: z.string().max(4000),
  status: z.enum(statuses),
  roles: z.array(z.enum(roles)),
  observationId: uuid,
});
export type SupplierFields = z.infer<typeof supplierFields>;
export const supplierDefaults: SupplierFields = {
  countryId: "",
  displayName: "",
  legalName: "",
  nativeName: "",
  englishName: "",
  businessRegistrationNumber: "",
  websiteUrl: "",
  description: "",
  status: "ACTIVE",
  roles: [],
  observationId: "",
};
const supplierState = supplierFields.omit({ observationId: true }).extend({
  id: uuid,
  version,
  verificationStatus: z.enum(verifications),
  legalName: optionalText(160),
  nativeName: optionalText(160),
  englishName: optionalText(160),
  businessRegistrationNumber: optionalText(100),
  websiteUrl: optionalText(2000).refine(validSourceUrl),
  description: optionalText(4000),
});
export function supplierBaseline(value: unknown) {
  const result = supplierState.safeParse(value);
  return result.success
    ? {
        id: result.data.id,
        version: result.data.version,
        verificationStatus: result.data.verificationStatus,
        fields: { ...result.data, observationId: "" },
      }
    : undefined;
}
export type SupplierBaseline = NonNullable<ReturnType<typeof supplierBaseline>>;
export function supplierBody(
  v: SupplierFields,
  currentVersion: number,
): components["schemas"]["SupplierInput"] {
  return {
    countryId: v.countryId,
    displayName: v.displayName,
    status: v.status,
    roles: v.roles,
    observationId: v.observationId,
    version: currentVersion,
    ...(v.legalName ? { legalName: v.legalName } : {}),
    ...(v.nativeName ? { nativeName: v.nativeName } : {}),
    ...(v.englishName ? { englishName: v.englishName } : {}),
    ...(v.businessRegistrationNumber
      ? { businessRegistrationNumber: v.businessRegistrationNumber }
      : {}),
    ...(v.websiteUrl ? { websiteUrl: v.websiteUrl } : {}),
    ...(v.description ? { description: v.description } : {}),
  };
}
export const aliasFields = z.object({
  alias: nonblank(160),
  aliasType: z.enum(aliasTypes),
  languageCode: z
    .string()
    .refine(
      (v) => !v || /^[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8})*$/.test(v),
      "Enter a supported language code.",
    ),
  observationId: uuid,
});
export type AliasFields = z.infer<typeof aliasFields>;
export function aliasBody(
  v: AliasFields,
  currentVersion: number,
): components["schemas"]["SupplierAliasInput"] {
  return {
    alias: v.alias,
    aliasType: v.aliasType,
    observationId: v.observationId,
    version: currentVersion,
    ...(v.languageCode ? { languageCode: v.languageCode } : {}),
  };
}
export const verificationFields = z.object({
  status: z.enum(manualVerification),
  reason: notes.refine((v) => !!v.trim(), "Enter a reason."),
  observationId: uuid,
});
export type VerificationFields = z.infer<typeof verificationFields>;

/** Plain decimals stay strings. Scale only for exact validation, never for transport. */
export function scaled(value: string, places: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const magnitude = BigInt(whole! + fraction.padEnd(places, "0"));
  return negative ? -magnitude : magnitude;
}
export function coordinate(value: string, kind: "latitude" | "longitude") {
  if (value !== value.trim() || !/^[+-]?\d{1,3}(?:\.\d{1,6})?$/.test(value))
    return false;
  const n = scaled(value, 6),
    limit = kind === "latitude" ? 90_000_000n : 180_000_000n;
  return n >= -limit && n <= limit;
}
export const quantity = (v: string) =>
  v === v.trim() && /^\d{1,15}(?:\.\d{1,4})?$/.test(v);
export const facilityFields = z
  .object({
    supplierId: uuid,
    facilityType: z.enum(facilityTypes),
    name: nonblank(160),
    countryId: uuid,
    regionId: optionalUuid,
    industrialClusterId: optionalUuid,
    addressLine1: z.string().max(300),
    addressLine2: z.string().max(300),
    postalCode: z.string().max(30),
    latitude: z
      .string()
      .refine(
        (v) => !v || coordinate(v, "latitude"),
        "Use a plain decimal from -90 to 90, with at most six fractional digits.",
      ),
    longitude: z
      .string()
      .refine(
        (v) => !v || coordinate(v, "longitude"),
        "Use a plain decimal from -180 to 180, with at most six fractional digits.",
      ),
    phone: z.string().max(80),
    email: z.union([z.literal(""), z.email().max(254)]),
    status: z.enum(statuses),
    observationId: uuid,
  })
  .refine((v) => !!v.latitude === !!v.longitude, {
    path: ["latitude"],
    message: "Enter both coordinates, or leave both absent.",
  });
export type FacilityFields = z.infer<typeof facilityFields>;
export const facilityDefaults: FacilityFields = {
  supplierId: "",
  facilityType: "OFFICE",
  name: "",
  countryId: "",
  regionId: "",
  industrialClusterId: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  latitude: "",
  longitude: "",
  phone: "",
  email: "",
  status: "ACTIVE",
  observationId: "",
};
export function facilityBaseline(value: unknown) {
  const shape = z
    .object({
      id: uuid,
      version,
      supplierId: uuid,
      facilityType: z.enum(facilityTypes),
      name: nonblank(160),
      countryId: uuid,
      status: z.enum(statuses),
      regionId: optionalText(36),
      industrialClusterId: optionalText(36),
      addressLine1: optionalText(300),
      addressLine2: optionalText(300),
      postalCode: optionalText(30),
      latitude: optionalText(30),
      longitude: optionalText(30),
      phone: optionalText(80),
      email: optionalText(254),
    })
    .safeParse(value);
  if (!shape.success) return;
  const fields = facilityFields.safeParse({
    ...shape.data,
    observationId: "00000000-0000-4000-8000-000000000000",
  });
  return fields.success
    ? {
        id: shape.data.id,
        version: shape.data.version,
        fields: { ...fields.data, observationId: "" },
      }
    : undefined;
}
export type FacilityBaseline = NonNullable<ReturnType<typeof facilityBaseline>>;
export function facilityBody(
  v: FacilityFields,
  currentVersion: number,
  parent: string,
): components["schemas"]["FacilityInput"] {
  return {
    supplierId: parent,
    facilityType: v.facilityType,
    name: v.name,
    countryId: v.countryId,
    status: v.status,
    observationId: v.observationId,
    version: currentVersion,
    ...(v.regionId ? { regionId: v.regionId } : {}),
    ...(v.industrialClusterId
      ? { industrialClusterId: v.industrialClusterId }
      : {}),
    ...(v.addressLine1 ? { addressLine1: v.addressLine1 } : {}),
    ...(v.addressLine2 ? { addressLine2: v.addressLine2 } : {}),
    ...(v.postalCode ? { postalCode: v.postalCode } : {}),
    ...(v.latitude !== "" ? { latitude: v.latitude } : {}),
    ...(v.longitude !== "" ? { longitude: v.longitude } : {}),
    ...(v.phone ? { phone: v.phone } : {}),
    ...(v.email ? { email: v.email } : {}),
  };
}
export const assignmentFields = z
  .object({
    proficiencyLevel: z.enum(["", ...proficiencies]),
    minimumOrderQuantity: z
      .string()
      .refine(
        (v) => !v || quantity(v),
        "Use up to 15 integer and 4 fractional digits; quantity must be nonnegative.",
      ),
    maximumOrderQuantity: z
      .string()
      .refine(
        (v) => !v || quantity(v),
        "Use up to 15 integer and 4 fractional digits; quantity must be nonnegative.",
      ),
    quantityUnit: z.enum(["", ...capabilityUnits]),
    notes,
    verificationStatus: z.enum(capabilityVerifications),
    observationId: uuid,
  })
  .refine(
    (v) =>
      (!v.minimumOrderQuantity && !v.maximumOrderQuantity) || !!v.quantityUnit,
    {
      path: ["quantityUnit"],
      message: "A unit is required with either quantity.",
    },
  )
  .refine(
    (v) =>
      !quantity(v.minimumOrderQuantity) ||
      !quantity(v.maximumOrderQuantity) ||
      scaled(v.minimumOrderQuantity, 4) <= scaled(v.maximumOrderQuantity, 4),
    {
      path: ["maximumOrderQuantity"],
      message: "Maximum must be at least minimum.",
    },
  );
export type AssignmentFields = z.infer<typeof assignmentFields>;
export const assignmentDefaults: AssignmentFields = {
  proficiencyLevel: "",
  minimumOrderQuantity: "",
  maximumOrderQuantity: "",
  quantityUnit: "",
  notes: "",
  verificationStatus: "UNVERIFIED",
  observationId: "",
};
export function assignmentBaseline(
  value: unknown,
  facilityId: string,
  capabilityId: string,
) {
  const result = z
    .object({
      facilityId: uuid,
      capabilityId: uuid,
      version,
      verificationStatus: z.enum(capabilityVerifications),
      proficiencyLevel: optionalText(30),
      minimumOrderQuantity: optionalText(30),
      maximumOrderQuantity: optionalText(30),
      quantityUnit: optionalText(10),
      notes: optionalText(1000),
    })
    .safeParse(value);
  if (
    !result.success ||
    result.data.facilityId !== facilityId ||
    result.data.capabilityId !== capabilityId
  )
    return;
  const fields = assignmentFields.safeParse({
    ...result.data,
    observationId: "00000000-0000-4000-8000-000000000000",
  });
  return fields.success
    ? {
        facilityId,
        capabilityId,
        version: result.data.version,
        fields: { ...fields.data, observationId: "" },
      }
    : undefined;
}
export type AssignmentBaseline = NonNullable<
  ReturnType<typeof assignmentBaseline>
>;
export function assignmentBody(
  v: AssignmentFields,
  currentVersion: number,
): components["schemas"]["FacilityCapabilityInput"] {
  return {
    verificationStatus: v.verificationStatus,
    observationId: v.observationId,
    version: currentVersion,
    ...(v.proficiencyLevel ? { proficiencyLevel: v.proficiencyLevel } : {}),
    ...(v.quantityUnit ? { quantityUnit: v.quantityUnit } : {}),
    ...(v.minimumOrderQuantity !== ""
      ? { minimumOrderQuantity: v.minimumOrderQuantity }
      : {}),
    ...(v.maximumOrderQuantity !== ""
      ? { maximumOrderQuantity: v.maximumOrderQuantity }
      : {}),
    ...(v.notes ? { notes: v.notes } : {}),
  };
}
export type CitationRow = {
  observationId: string;
  fieldName: string;
  createdAt: string;
};
export function parseCitation(
  row: unknown,
  allowed: readonly string[],
): CitationRow | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return;
  const data = row as Record<string, unknown>;
  if (
    !uuid.safeParse(data.source_observation_id).success ||
    typeof data.field_name !== "string" ||
    !allowed.includes(data.field_name) ||
    typeof data.created_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
      data.created_at,
    ) ||
    !Number.isFinite(Date.parse(data.created_at))
  )
    return;
  return {
    observationId: data.source_observation_id as string,
    fieldName: data.field_name,
    createdAt: data.created_at,
  };
}
