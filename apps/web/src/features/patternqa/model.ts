import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
import type { Revision } from "../pattern/model";

export type Qa = components["schemas"]["PatternQaView"];
export type Assessment = components["schemas"]["PatternQaAssessmentView"];
export type Summary = components["schemas"]["PatternQaAssessmentSummary"];
export type History = components["schemas"]["PatternQaAssessmentPage"];
export type Input = components["schemas"]["PatternQaCreateInput"];
export const outcomes = [
  "OBSERVED",
  "CHANGES_REQUESTED",
  "HUMAN_REVIEWED",
] as const;
export const bases = ["METADATA_ONLY", "READY_ARTIFACT"] as const;
const boundary =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/gu;
export const trimNotes = (s: string) => s.replace(boundary, "");
const validNotes = (s: string) =>
  s.length > 0 && [...s].length <= 2000 && !/[\u0000\ud800-\udfff]/u.test(s);
const notes = z.string().refine((s) => trimNotes(s) === s && validNotes(s));
const uuid = z.uuid().refine((s) => s === s.toLowerCase());
const head = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const number = head.min(1);
const meta = {
  id: uuid,
  patternRevisionId: uuid,
  styleId: uuid,
  assessmentNumber: number,
  outcome: z.enum(outcomes),
  evidenceBasis: z.enum(bases),
  artifactId: uuid.nullable(),
  reviewedAt: z.iso.datetime({ offset: true }),
};
const basisValid = (s: {
  evidenceBasis: string;
  artifactId: string | null;
  outcome: string;
}) =>
  s.evidenceBasis === "READY_ARTIFACT"
    ? s.artifactId !== null
    : s.artifactId === null && s.outcome !== "HUMAN_REVIEWED";
const summarySchema = z.object(meta).strict().refine(basisValid);
const assessmentSchema = z
  .object({ ...meta, notes })
  .strict()
  .refine(basisValid);
const qaSchema = z
  .object({
    patternId: uuid,
    patternRevisionId: uuid,
    styleId: uuid,
    patternRevisionNumber: number,
    state: z.enum(["UNREVIEWED", ...outcomes]),
    latestAssessment: assessmentSchema.nullable(),
  })
  .strict();
function requireValid(ok: boolean): asserts ok {
  if (!ok) throw new ApiError(502);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  requireValid(p.success);
  return p.data;
}
export function checkedAssessment(
  input: unknown,
  revision: Revision,
  id?: string,
): Assessment {
  const a = parse(assessmentSchema, input);
  requireValid(
    a.patternRevisionId === revision.id &&
      a.styleId === revision.styleId &&
      (!id || a.id === id),
  );
  return a;
}
export function checkedHistorical(
  input: unknown,
  revision: Revision,
  expected: Summary,
): Assessment {
  const a = checkedAssessment(input, revision, expected.id);
  const keys = [
    "id",
    "patternRevisionId",
    "styleId",
    "assessmentNumber",
    "outcome",
    "evidenceBasis",
    "artifactId",
    "reviewedAt",
  ] as const;
  requireValid(keys.every((k) => a[k] === expected[k]));
  return a;
}
export function checkedQa(input: unknown, revision: Revision): Qa {
  const q = parse(qaSchema, input);
  requireValid(
    q.patternId === revision.patternId &&
      q.patternRevisionId === revision.id &&
      q.styleId === revision.styleId &&
      q.patternRevisionNumber === revision.revisionNumber,
  );
  requireValid(
    q.latestAssessment === null
      ? q.state === "UNREVIEWED"
      : q.state === q.latestAssessment.outcome,
  );
  if (q.latestAssessment) checkedAssessment(q.latestAssessment, revision);
  return q;
}
export function checkedHistory(
  input: unknown,
  revision: Revision,
  max: number,
  limit = 25,
): History {
  const p = parse(
    z
      .object({
        items: z.array(summarySchema).max(limit),
        limit: z.literal(limit),
        nextMaxAssessmentNumber: number.nullable(),
      })
      .strict(),
    input,
  );
  let previous = max + 1;
  const ids = new Set<string>();
  for (const a of p.items) {
    requireValid(
      a.patternRevisionId === revision.id &&
        a.styleId === revision.styleId &&
        a.assessmentNumber <= max &&
        a.assessmentNumber < previous &&
        !ids.has(a.id),
    );
    previous = a.assessmentNumber;
    ids.add(a.id);
  }
  requireValid(
    p.nextMaxAssessmentNumber === null ||
      (p.items.length === limit && p.nextMaxAssessmentNumber < previous),
  );
  return p;
}
export const draftSchema = z.object({
  outcome: z.enum(outcomes),
  evidenceBasis: z.enum(bases),
  notes: z
    .string()
    .transform(trimNotes)
    .refine(validNotes, "Enter 1–2,000 characters of review notes."),
});
export type Draft = z.input<typeof draftSchema>;
export function bodyOf(
  draft: Draft,
  baseline: number,
  artifact: { id: string; state: string } | null,
): Input {
  const d = draftSchema.parse(draft);
  head.parse(baseline);
  const artifactId =
    d.evidenceBasis === "READY_ARTIFACT" && artifact?.state === "READY"
      ? artifact.id
      : null;
  if (!basisValid({ ...d, artifactId }))
    throw new Error(
      "Human review requires the exact READY artifact and explicit artifact basis.",
    );
  return { ...d, artifactId, expectedLatestAssessmentNumber: baseline };
}
export function checkedCreated(
  input: unknown,
  revision: Revision,
  body: Input,
): Assessment {
  const a = checkedAssessment(input, revision);
  requireValid(
    a.assessmentNumber === body.expectedLatestAssessmentNumber + 1 &&
      a.outcome === body.outcome &&
      a.evidenceBasis === body.evidenceBasis &&
      a.artifactId === body.artifactId &&
      a.notes === body.notes,
  );
  return a;
}
