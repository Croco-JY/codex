import { z } from "zod";
import type { components } from "../../api/schema";
import { ApiError } from "../../api/errors";
import { validUuid } from "../network/filters";
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export type Reference = components["schemas"]["StyleDevelopmentReferenceView"];
export type ReferencePage =
  components["schemas"]["StyleDevelopmentReferencePage"];
export type ReferenceState = Reference["state"];
export const referenceStates = [
  "PENDING",
  "READY",
  "FAILED",
  "DETACHED",
] as const;
export const safeDisplayName = (v: string) => {
  // Match Java String.strip(): nonbreaking spaces are not Java whitespace.
  const n = v.replace(
    /^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+$/gu,
    "",
  );
  return (
    n.length > 0 &&
    n.length <= 255 &&
    n !== "." &&
    n !== ".." &&
    !/[\u0000-\u001f\u007f-\u009f/\\]/u.test(n)
  );
};
export const referenceNameSchema = z.object({
  displayName: z
    .string()
    .refine(
      safeDisplayName,
      "Enter a safe display name of 1–255 characters, without path separators or control characters.",
    ),
});
const uuid = (v: unknown): v is string => typeof v === "string" && validUuid(v);
const timestamp = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  Number.isFinite(Date.parse(v));
export function checkedReference(v: Reference, style: string): Reference {
  if (
    !v ||
    !uuid(v.id) ||
    !uuid(v.styleId) ||
    v.styleId !== style ||
    !uuid(v.storageObjectId) ||
    typeof v.displayName !== "string" ||
    !safeDisplayName(v.displayName) ||
    v.mediaType !== "application/octet-stream" ||
    !Number.isSafeInteger(v.sizeBytes) ||
    v.sizeBytes < 1 ||
    v.sizeBytes > MAX_REFERENCE_BYTES ||
    !referenceStates.some((s) => s === v.state) ||
    !Number.isSafeInteger(v.version) ||
    v.version < 0 ||
    !timestamp(v.createdAt) ||
    !timestamp(v.updatedAt)
  )
    throw new ApiError(502);
  return v;
}
export function checkedReferences(
  v: ReferencePage,
  style: string,
  offset: number,
): ReferencePage {
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 25 ||
    v.limit !== 25 ||
    v.offset !== offset ||
    typeof v.hasMore !== "boolean"
  )
    throw new ApiError(502);
  v.items.forEach((row) => checkedReference(row, style));
  return v;
}
export interface UploadDraft {
  displayName: string;
  file: File;
}
export function referenceFormData(draft: UploadDraft) {
  const form = new FormData();
  form.append("displayName", draft.displayName);
  form.append("file", draft.file);
  return form;
}
