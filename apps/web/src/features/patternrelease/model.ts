import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
import { displayNameSchema, formats } from "../pattern/artifactModel";

export type Consent = components["schemas"]["ReleaseConsentView"];
export type SourceSummary =
  components["schemas"]["PatternReleaseSourceSummary"];
export type SourceView = components["schemas"]["PatternReleaseSourceView"];
export type Event = components["schemas"]["PatternReleaseEventSummary"];
export type Received =
  | components["schemas"]["ActiveReceivedPatternRelease"]
  | components["schemas"]["InactiveReceivedPatternRelease"];
export type SourceScope = {
  organizationId: string;
  projectId: string;
  styleId: string;
  patternId: string;
  revisionId: string;
  revisionNumber?: number;
};
const uuid = z.uuid().refine((v) => v === v.toLowerCase());
const time = z.iso.datetime({ offset: true });
const number = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const bytes = z.number().int().min(1).max(10485760);
const safeName = z.string().refine((v) => {
  const p = displayNameSchema.safeParse(v);
  return p.success && p.data === v;
});
const cursor = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable();
const boundary =
  /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/gu;
export const trimPurpose = (s: string) => s.replace(boundary, "");
const purpose = z
  .string()
  .refine(
    (s) =>
      s === trimPurpose(s) &&
      [...s].length >= 1 &&
      [...s].length <= 1000 &&
      !/[\u0000\ud800-\udfff]/u.test(s),
  );
export const sourceDraft = z.object({
  consentId: z.uuid().transform((v) => v.toLowerCase()),
  purpose: z.string().transform(trimPurpose).pipe(purpose),
  accessDurationSeconds: z.number().int().min(1).max(86400),
  confirmed: z.literal(true),
});
export const consentDraft = z.uuid().transform((v) => v.toLowerCase());
function valid(ok: boolean): asserts ok {
  if (!ok) throw new ApiError(502);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  valid(result.success);
  return result.data;
}
// Preserve sub-millisecond ordering as well as exact immutable timestamp strings.
export function instantNanos(value: string): bigint {
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(
    value,
  );
  valid(!!match && time.safeParse(value).success);
  return (
    BigInt(Date.parse(match[1] + match[3])) * 1000000n +
    BigInt((match[2] ?? "").padEnd(9, "0"))
  );
}
function interval(start: string, end: string, maxSeconds: number) {
  const n = instantNanos(end) - instantNanos(start);
  return (
    n > 0n && n <= BigInt(maxSeconds) * 1000000000n && n % 1000000000n === 0n
  );
}
const consentSchema = z
  .object({
    id: uuid,
    recipientOrganizationId: uuid,
    sourceOrganizationId: uuid,
    issuedAt: time,
    expiresAt: time,
    state: z.enum(["ISSUED", "CONSUMED", "WITHDRAWN", "EXPIRED"]),
    latestEventNumber: number,
    consumedReleaseId: uuid.nullable(),
  })
  .strict()
  .refine(
    (c) =>
      c.sourceOrganizationId !== c.recipientOrganizationId &&
      interval(c.issuedAt, c.expiresAt, 900) &&
      instantNanos(c.expiresAt) - instantNanos(c.issuedAt) === 900000000000n &&
      (c.state === "CONSUMED"
        ? c.latestEventNumber === 2 && c.consumedReleaseId !== null
        : c.state === "WITHDRAWN"
          ? c.latestEventNumber === (c.consumedReleaseId === null ? 2 : 3)
          : c.latestEventNumber === 1 && c.consumedReleaseId === null),
  );
export function checkedConsent(
  value: unknown,
  org: string,
  id?: string,
  expected?: Consent,
): Consent {
  const c = parse(consentSchema, value);
  valid(c.recipientOrganizationId === org && (!id || c.id === id));
  if (expected)
    valid(
      [
        "id",
        "recipientOrganizationId",
        "sourceOrganizationId",
        "issuedAt",
        "expiresAt",
      ].every((k) => c[k as keyof typeof c] === expected[k as keyof Consent]),
    );
  if (expected) {
    valid(c.latestEventNumber >= expected.latestEventNumber);
    if (expected.consumedReleaseId !== null)
      valid(c.consumedReleaseId === expected.consumedReleaseId);
    if (expected.state === "WITHDRAWN") valid(c.state === "WITHDRAWN");
    if (expected.state === "EXPIRED") valid(c.state !== "ISSUED");
  }
  return c;
}
const sourceSchema = z
  .object({
    id: uuid,
    consentId: uuid,
    sourceOrganizationId: uuid,
    recipientOrganizationId: uuid,
    projectId: uuid,
    styleId: uuid,
    patternId: uuid,
    patternRevisionId: uuid,
    patternRevisionNumber: number,
    artifactId: uuid,
    declaredFormat: z.enum(formats),
    displayName: safeName,
    sizeBytes: bytes,
    purpose,
    releasedAt: time,
    expiresAt: time,
  })
  .strict()
  .refine(
    (s) =>
      s.sourceOrganizationId !== s.recipientOrganizationId &&
      interval(s.releasedAt, s.expiresAt, 86400),
  );
export function checkedSourceSummary(
  value: unknown,
  scope: SourceScope,
  revisionNumber = scope.revisionNumber,
): SourceSummary {
  const s = parse(sourceSchema, value);
  valid(
    s.sourceOrganizationId === scope.organizationId &&
      s.projectId === scope.projectId &&
      s.styleId === scope.styleId &&
      s.patternId === scope.patternId &&
      s.patternRevisionId === scope.revisionId &&
      (revisionNumber === undefined ||
        s.patternRevisionNumber === revisionNumber),
  );
  return s;
}
export function checkedSource(
  value: unknown,
  scope: SourceScope,
  id?: string,
  expected?: SourceSummary,
): SourceView {
  const v = parse(
    z
      .object({
        release: sourceSchema,
        latestEventNumber: number,
        lifecycle: z.enum(["ACTIVATED", "REVOKED"]),
        effectiveState: z.enum([
          "ACTIVE",
          "EXPIRED",
          "REVOKED",
          "WITHDRAWN",
          "UNAVAILABLE",
        ]),
      })
      .strict(),
    value,
  );
  checkedSourceSummary(v.release, scope);
  valid(
    (!id || v.release.id === id) &&
      v.latestEventNumber === (v.lifecycle === "ACTIVATED" ? 1 : 2) &&
      (v.effectiveState !== "ACTIVE" || v.lifecycle === "ACTIVATED") &&
      (v.effectiveState !== "REVOKED" || v.lifecycle === "REVOKED"),
  );
  if (expected)
    valid(
      Object.keys(expected).every(
        (k) =>
          v.release[k as keyof SourceSummary] ===
          expected[k as keyof SourceSummary],
      ),
    );
  return v;
}
const receipt = {
  releaseId: uuid,
  sourceOrganizationId: uuid,
  recipientOrganizationId: uuid,
  releasedAt: time,
  expiresAt: time,
};
const receivedSchema = z
  .discriminatedUnion("effectiveState", [
    z
      .object({
        ...receipt,
        patternRevisionId: uuid,
        patternRevisionNumber: number,
        artifactId: uuid,
        declaredFormat: z.enum(formats),
        displayName: safeName,
        sizeBytes: bytes,
        purpose,
        effectiveState: z.literal("ACTIVE"),
      })
      .strict(),
    z
      .object({
        ...receipt,
        effectiveState: z.enum([
          "EXPIRED",
          "REVOKED",
          "WITHDRAWN",
          "UNAVAILABLE",
        ]),
      })
      .strict(),
  ])
  .refine(
    (v) =>
      v.sourceOrganizationId !== v.recipientOrganizationId &&
      interval(v.releasedAt, v.expiresAt, 86400),
  );
export function checkedReceived(
  value: unknown,
  org: string,
  id?: string,
  expected?: Received,
): Received {
  const r = parse(receivedSchema, value);
  valid(r.recipientOrganizationId === org && (!id || r.releaseId === id));
  if (expected) {
    valid(
      expected.effectiveState === "ACTIVE" || r.effectiveState !== "ACTIVE",
    );
    valid(
      [
        "releaseId",
        "sourceOrganizationId",
        "recipientOrganizationId",
        "releasedAt",
        "expiresAt",
      ].every(
        (k) =>
          r[k as keyof typeof receipt] === expected[k as keyof typeof receipt],
      ),
    );
    if (r.effectiveState === "ACTIVE" && expected.effectiveState === "ACTIVE")
      valid(
        [
          "patternRevisionId",
          "patternRevisionNumber",
          "artifactId",
          "declaredFormat",
          "displayName",
          "sizeBytes",
          "purpose",
        ].every(
          (k) =>
            r[k as keyof typeof r] === expected[k as keyof typeof expected],
        ),
      );
  }
  return r;
}
function page<T>(
  schema: z.ZodType<T>,
  value: unknown,
  check: (v: T) => unknown,
  id: (v: T) => string,
  at: (v: T) => string,
  limit = 25,
) {
  const p = parse(
    z
      .object({
        items: z.array(schema).max(limit),
        limit: z.literal(limit),
        nextCursor: cursor,
      })
      .strict(),
    value,
  );
  const ids = new Set<string>();
  let previous: T | undefined;
  for (const item of p.items) {
    check(item);
    valid(!ids.has(id(item)));
    ids.add(id(item));
    if (previous) {
      const comparison = instantNanos(at(previous)) - instantNanos(at(item));
      valid(comparison > 0n || (comparison === 0n && id(previous) > id(item)));
    }
    previous = item;
  }
  valid(p.nextCursor === null || p.items.length === limit);
  return p;
}
export function checkedConsentPage(value: unknown, org: string, limit = 25) {
  return page(
    consentSchema,
    value,
    (c) => checkedConsent(c, org),
    (c) => c.id,
    (c) => c.issuedAt,
    limit,
  );
}
export function checkedSourcePage(
  value: unknown,
  scope: SourceScope,
  limit = 25,
) {
  return page(
    sourceSchema,
    value,
    (s) => checkedSourceSummary(s, scope),
    (s) => s.id,
    (s) => s.releasedAt,
    limit,
  );
}
export function checkedReceivedPage(value: unknown, org: string, limit = 25) {
  return page(
    receivedSchema,
    value,
    (r) => checkedReceived(r, org),
    (r) => r.releaseId,
    (r) => r.releasedAt,
    limit,
  );
}
const eventSchema = z
  .object({
    id: uuid,
    releaseId: uuid,
    eventNumber: number,
    kind: z.enum(["ACTIVATED", "REVOKED"]),
    occurredAt: time,
  })
  .strict()
  .refine((e) => e.eventNumber === (e.kind === "ACTIVATED" ? 1 : 2));
export function checkedEvents(
  value: unknown,
  release: string,
  max: number,
  limit = 25,
  expected?: EventHistorySnapshot,
) {
  const p = parse(
    z
      .object({
        items: z.array(eventSchema).max(limit),
        limit: z.literal(limit),
        nextMaxEventNumber: number.nullable(),
      })
      .strict(),
    value,
  );
  let previous = max + 1;
  const ids = new Set<string>();
  for (const e of p.items) {
    valid(
      e.releaseId === release &&
        e.eventNumber <= max &&
        e.eventNumber < previous &&
        !ids.has(e.id),
    );
    previous = e.eventNumber;
    ids.add(e.id);
  }
  valid(
    p.nextMaxEventNumber === null ||
      (p.items.length === limit && p.nextMaxEventNumber < previous),
  );
  if (expected)
    valid(
      p.limit === expected.limit &&
        p.nextMaxEventNumber === expected.nextMaxEventNumber &&
        p.items.length === expected.items.length &&
        p.items.every((event, index) => sameEventFacts(event, expected.items[index])),
    );
  return p;
}

export type EventHistorySnapshot = Readonly<{
  items: readonly Readonly<ReturnType<typeof checkedEvents>["items"][number]>[];
  limit: number;
  nextMaxEventNumber: number | null;
}>;

export function sameEventFacts(
  event: EventHistorySnapshot["items"][number],
  expected: EventHistorySnapshot["items"][number],
) {
  return (
    event.id === expected.id &&
    event.releaseId === expected.releaseId &&
    event.eventNumber === expected.eventNumber &&
    event.kind === expected.kind &&
    event.occurredAt === expected.occurredAt
  );
}

// Own a deep, immutable copy: later cache writes must not mutate the baseline.
export function snapshotEvents(
  page: ReturnType<typeof checkedEvents>,
): EventHistorySnapshot {
  return Object.freeze({
    ...page,
    items: Object.freeze(
      page.items.map((event) => Object.freeze({ ...event })),
    ),
  });
}
