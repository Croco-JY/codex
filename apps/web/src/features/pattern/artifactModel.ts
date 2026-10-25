import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
import {
  checkedRevision,
  draftSchema as patternDraft,
  type Revision,
} from "./model";
export type Artifact = components["schemas"]["PatternArtifactView"];
export type ArtifactResult = { revision: Revision; artifact: Artifact };
export const MAX_ARTIFACT_BYTES = 10485760;
export const formats = ["DXF_AAMA", "DXF_ASTM", "PDF"] as const;
export const failureCodes = [
  "STORAGE_WRITE_FAILED",
  "STORAGE_READBACK_FAILED",
  "STORAGE_INTEGRITY_MISMATCH",
] as const;
const safe = (s: string) =>
  s !== "." && s !== ".." && !/[\u0000-\u001f\u007f-\u009f/\\]/.test(s);
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    safe,
    "Use a safe attachment name without path separators or control characters.",
  );
const artifactSchema = z
  .object({
    id: z.uuid(),
    patternRevisionId: z.uuid(),
    patternId: z.uuid(),
    styleId: z.uuid(),
    declaredFormat: z.enum(formats),
    displayName: z
      .string()
      .min(1)
      .max(255)
      .refine((v) => v === v.trim() && safe(v)),
    sizeBytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
    state: z.enum(["PENDING", "READY", "FAILED"]),
    failureCode: z.enum(failureCodes).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) =>
    v.state === "FAILED" ? v.failureCode !== null : v.failureCode === null,
  );
export function checkedArtifact(
  value: unknown,
  style: string,
  pattern: string,
  revision: string,
): Artifact {
  const p = artifactSchema.safeParse(value);
  if (
    !p.success ||
    p.data.styleId !== style ||
    p.data.patternId !== pattern ||
    p.data.patternRevisionId !== revision
  )
    throw new ApiError(502);
  return p.data;
}
export function checkedArtifactResult(
  value: ArtifactResult,
  style: string,
  pattern: string,
  baseline: number,
  size: number,
) {
  if (!value) throw new ApiError(502);
  const revision = checkedRevision(value.revision, style, pattern);
  const artifact = checkedArtifact(value.artifact, style, pattern, revision.id);
  if (
    revision.revisionNumber !== baseline + 1 ||
    artifact.state !== "READY" ||
    artifact.sizeBytes !== size
  )
    throw new ApiError(502);
  return { revision, artifact };
}
export const artifactDraftSchema = patternDraft.extend({
  declaredFormat: z.enum(["", ...formats]).transform((v, c) => {
    if (v === "") {
      c.addIssue({ code: "custom", message: "Choose a declared format." });
      return z.NEVER;
    }
    return v;
  }),
  displayName: displayNameSchema,
});
export type ArtifactDraft = z.input<typeof artifactDraftSchema>;
export function artifactBody(d: ArtifactDraft, baseline: number) {
  if (!Number.isSafeInteger(baseline) || baseline < 1) throw new ApiError(400);
  const p = artifactDraftSchema.parse(d);
  return {
    expectedLatestRevisionNumber: baseline,
    name: p.name,
    purpose: p.purpose || null,
    measurementRevisionId: p.measurementRevisionId || null,
    declaredFormat: p.declaredFormat,
    displayName: p.displayName,
  };
}
export function artifactFormData(
  d: ArtifactDraft,
  baseline: number,
  file: File,
) {
  if (file.size < 1 || file.size > MAX_ARTIFACT_BYTES)
    throw new ApiError(file.size ? 413 : 400);
  const metadata = new Blob([JSON.stringify(artifactBody(d, baseline))], {
    type: "application/json",
  });
  if (metadata.size > 16384) throw new ApiError(400);
  const form = new FormData();
  form.append("metadata", metadata);
  form.append("file", file);
  return form;
}
