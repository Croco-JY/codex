import { z } from "zod";
import type { components } from "../../api/schema";
export type Source = components["schemas"]["SourceView"];
export type SourceInput = components["schemas"]["SourceInput"];
export type RecordView = components["schemas"]["RecordView"];
export type Observation = components["schemas"]["Observation"];
export type Review = components["schemas"]["Review"];
export const sourceTypes = [
  "OFFICIAL_WEBSITE",
  "PUBLIC_DIRECTORY",
  "PARTNER_FEED",
  "MANUAL_ENTRY",
  "SUPPLIER_SUBMISSION",
  "TRADE_SHOW",
  "OTHER",
] as const satisfies readonly SourceInput["sourceType"][];
export const accessMethods = [
  "MANUAL",
  "API",
  "FEED",
  "PERMITTED_WEB",
  "OTHER",
] as const satisfies readonly SourceInput["accessMethod"][];
export const policies = ["PRESERVE", "TRIM"] as const;
export const recordKinds = [
  "SUPPLIER",
  "FACILITY",
  "MATERIAL",
  "MATERIAL_VARIANT",
  "MATERIAL_LISTING",
] as const satisfies readonly components["schemas"]["RecordInput"]["recordKind"][];
export const reviewStatuses = ["ACCEPTED", "REJECTED", "NEEDS_REVIEW"] as const;
export const permissions = [
  "UNKNOWN",
  "PERMITTED",
  "RESTRICTED",
  "PROHIBITED",
] as const;
export const uuid = z
  .string()
  .length(36)
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Enter a valid UUID.",
  );
export const isUuid = (value: unknown): value is string =>
  uuid.safeParse(value).success;
export const text = (value: unknown) =>
  typeof value === "string" && value.length ? value : "Not available";
export const sourceLabel = (source: Source) =>
  typeof source.name === "string" &&
  source.name.trim() &&
  typeof source.sourceCode === "string" &&
  source.sourceCode.trim()
    ? `${source.name} · ${source.sourceCode}`
    : text(source.name);
export function validSourceUrl(raw: string): boolean {
  if (!raw) return true;
  if (raw.length > 2000 || /[\s\\#]/u.test(raw) || !/^https?:\/\//.test(raw))
    return false;
  const authority = /^https?:\/\/([^/?#]*)/.exec(raw)?.[1];
  if (
    !authority ||
    authority.includes("@") ||
    /[^\x21-\x7e]/.test(authority) ||
    authority.includes("%")
  )
    return false;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    return (
      !!host &&
      !url.username &&
      !url.password &&
      (host.startsWith("[") ||
        host
          .replace(/\.$/, "")
          .split(".")
          .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))
    );
  } catch {
    return false;
  }
}
const requiredText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => v.trim().length > 0, "Enter a value.");
export const sourceFields = z.object({
  sourceCode: z
    .string()
    .refine((v) => v === v.trim(), "Whitespace is not allowed in Source code.")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/,
      "Start with a letter or digit; use up to 100 letters, digits, dots, underscores or hyphens.",
    ),
  sourceType: z.enum(sourceTypes),
  name: requiredText(160),
  namespace: z.string().max(160),
  baseUrl: z
    .string()
    .refine(
      validSourceUrl,
      "Enter an HTTP(S) URL without credentials or a fragment.",
    ),
  accessMethod: z.enum(accessMethods),
  normalizationPolicy: z.enum(policies),
  active: z.boolean(),
});
export type SourceFields = z.infer<typeof sourceFields>;
export const sourceDefaults: SourceFields = {
  sourceCode: "",
  name: "",
  namespace: "",
  baseUrl: "",
  sourceType: "MANUAL_ENTRY",
  accessMethod: "MANUAL",
  normalizationPolicy: "PRESERVE",
  active: true,
};
export const safeVersion = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function editableSource(source: Source) {
  if (
    !isUuid(source.id) ||
    !safeVersion(source.version) ||
    typeof source.active !== "boolean"
  )
    return undefined;
  if (
    (source.namespace != null && typeof source.namespace !== "string") ||
    (source.baseUrl != null && typeof source.baseUrl !== "string")
  )
    return undefined;
  const parsed = sourceFields.safeParse({
    ...source,
    namespace: source.namespace ?? "",
    baseUrl: source.baseUrl ?? "",
  });
  return parsed.success
    ? { id: source.id, version: source.version, fields: parsed.data }
    : undefined;
}
export type EditableSource = NonNullable<ReturnType<typeof editableSource>>;
export function sourceBody(fields: SourceFields, version: number): SourceInput {
  return {
    sourceCode: fields.sourceCode,
    name: fields.name,
    sourceType: fields.sourceType,
    accessMethod: fields.accessMethod,
    normalizationPolicy: fields.normalizationPolicy,
    active: fields.active,
    version,
    ...(fields.namespace !== "" ? { namespace: fields.namespace } : {}),
    ...(fields.baseUrl !== "" ? { baseUrl: fields.baseUrl } : {}),
  };
}
export const recordFields = z.object({
  recordKind: z.enum(recordKinds),
  externalRecordKey: requiredText(500),
});
export type RecordFields = z.infer<typeof recordFields>;
/** The controls are explicitly UTC; preserve up to six fractional digits without locale conversion. */
export function utcInstant(value: string): string | undefined {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?$/.test(value))
    return;
  const expanded = value.length === 16 ? value + ":00" : value;
  const date = new Date(expanded + "Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== expanded.slice(0, 19)
  )
    return;
  return expanded + "Z";
}
export const observationFields = z.object({
  observationKey: requiredText(200),
  observedAt: z
    .string()
    .refine((v) => !!utcInstant(v), "Enter a valid UTC date and time."),
  retrievedAt: z
    .string()
    .refine((v) => !v || !!utcInstant(v), "Enter a valid UTC date and time."),
  contentHash: z
    .string()
    .refine(
      (v) => !v || (v.length === 64 && /^[0-9a-f]{64}$/.test(v)),
      "Use exactly 64 lowercase hexadecimal characters.",
    ),
  supersedesObservationId: z.union([z.literal(""), uuid]),
});
export type ObservationFields = z.infer<typeof observationFields>;
export const observationDefaults: ObservationFields = {
  observationKey: "",
  observedAt: "",
  retrievedAt: "",
  contentHash: "",
  supersedesObservationId: "",
};
export function observationBody(
  record: string,
  fields: ObservationFields,
): components["schemas"]["ObservationInput"] {
  return {
    sourceRecordId: record,
    observationKey: fields.observationKey,
    observedAt: utcInstant(fields.observedAt)!,
    ...(fields.retrievedAt
      ? { retrievedAt: utcInstant(fields.retrievedAt)! }
      : {}),
    ...(fields.contentHash
      ? { contentHash: fields.contentHash, hashAlgorithm: "SHA-256" }
      : {}),
    ...(fields.supersedesObservationId
      ? { supersedesObservationId: fields.supersedesObservationId }
      : {}),
  };
}
export const reviewFields = z.object({
  reviewStatus: z.enum(reviewStatuses),
  licenseStatus: z.enum(["", ...permissions]),
  termsStatus: z.enum(["", ...permissions]),
  notes: z.string().max(1000),
});
export type ReviewFields = z.infer<typeof reviewFields>;
export const reviewDefaults: ReviewFields = {
  reviewStatus: "NEEDS_REVIEW",
  licenseStatus: "",
  termsStatus: "",
  notes: "",
};
export function reviewBody(
  fields: ReviewFields,
): components["schemas"]["ReviewInput"] {
  return {
    reviewStatus: fields.reviewStatus,
    ...(fields.licenseStatus ? { licenseStatus: fields.licenseStatus } : {}),
    ...(fields.termsStatus ? { termsStatus: fields.termsStatus } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
  };
}
