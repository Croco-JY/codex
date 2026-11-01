import { describe, it, expect } from "vitest";
import {
  checkedConsent,
  checkedConsentPage,
  checkedSource,
  checkedSourcePage,
  checkedReceived,
  checkedReceivedPage,
  checkedEvents,
  instantNanos,
  sourceDraft,
  type SourceScope,
} from "./model";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: SourceScope = {
  organizationId: id(1),
  projectId: id(2),
  styleId: id(3),
  patternId: id(4),
  revisionId: id(5),
  revisionNumber: 2,
};
const at = "2026-11-01T10:00:00.123456Z",
  expires = "2026-11-01T11:00:00.123456Z";
const summary = {
  id: id(6),
  consentId: id(7),
  sourceOrganizationId: id(1),
  recipientOrganizationId: id(8),
  projectId: id(2),
  styleId: id(3),
  patternId: id(4),
  patternRevisionId: id(5),
  patternRevisionNumber: 2,
  artifactId: id(9),
  declaredFormat: "PDF",
  displayName: "exact.pdf",
  sizeBytes: 42,
  purpose: "Approved outbound purpose",
  releasedAt: at,
  expiresAt: expires,
};
const view = {
  release: summary,
  latestEventNumber: 1,
  lifecycle: "ACTIVATED",
  effectiveState: "ACTIVE",
};
const received = {
  releaseId: summary.id,
  sourceOrganizationId: id(1),
  recipientOrganizationId: id(8),
  patternRevisionId: id(5),
  patternRevisionNumber: 2,
  artifactId: id(9),
  declaredFormat: "PDF",
  displayName: "exact.pdf",
  sizeBytes: 42,
  purpose: summary.purpose,
  releasedAt: at,
  expiresAt: expires,
  effectiveState: "ACTIVE",
};
const consent = {
  id: id(7),
  recipientOrganizationId: id(8),
  sourceOrganizationId: id(1),
  issuedAt: at,
  expiresAt: "2026-11-01T10:15:00.123456Z",
  latestEventNumber: 1,
  state: "ISSUED",
  consumedReleaseId: null,
};
describe("Release immutable runtime contract", () => {
  it("accepts exact scope, bounded policy and canonical Unicode without normalizing server data", () => {
    expect(checkedSource(view, scope)).toEqual(view);
    expect(checkedConsent(consent, id(8))).toEqual(consent);
    expect(checkedReceived(received, id(8))).toEqual(received);
    expect(
      sourceDraft.parse({
        consentId: id(7),
        purpose: " \u00a0🧵 review\u00a0 ",
        accessDurationSeconds: 86400,
        confirmed: true,
      }).purpose,
    ).toBe("🧵 review");
  });
  it.each(Object.keys(summary))(
    "contradictory shared immutable source field %s fails against selected summary",
    (field) => {
      const expected = checkedSource(view, scope).release;
      const original = summary[field as keyof typeof summary];
      const value =
        typeof original === "number"
          ? original + 1
          : field === "declaredFormat"
            ? "DXF_AAMA"
            : field === "displayName"
              ? "different.pdf"
              : field === "purpose"
                ? "Different outbound purpose"
                : field === "releasedAt"
                  ? "2026-11-01T10:00:00.123457Z"
                  : field === "expiresAt"
                    ? "2026-11-01T11:00:00.123457Z"
                    : id(99);
      expect(() =>
        checkedSource(
          { ...view, release: { ...summary, [field]: value } },
          scope,
          summary.id,
          expected,
        ),
      ).toThrow();
    },
  );
  it("a legitimate newer event head does not rewrite the immutable selected receipt", () => {
    const expected = checkedSource(view, scope).release;
    expect(
      checkedSource(
        {
          ...view,
          latestEventNumber: 2,
          lifecycle: "REVOKED",
          effectiveState: "REVOKED",
        },
        scope,
        summary.id,
        expected,
      ).latestEventNumber,
    ).toBe(2);
  });
  it.each([
    "storageObjectId",
    "sha256",
    "projectId",
    "privateQaNotes",
    "actorSubject",
  ])("rejects recipient response containing forbidden %s", (field) =>
    expect(() =>
      checkedReceived({ ...received, [field]: "private" }, id(8)),
    ).toThrow(),
  );
  it.each([
    "patternRevisionId",
    "patternRevisionNumber",
    "artifactId",
    "displayName",
    "sizeBytes",
    "purpose",
    "releasedAt",
    "expiresAt",
  ])("rejects selected recipient immutable contradiction %s", (field) => {
    const expected = checkedReceived(received, id(8));
    const value =
      field === "sizeBytes"
        ? 43
        : field === "patternRevisionNumber"
          ? 3
          : field === "displayName"
            ? "changed.pdf"
            : field === "purpose"
              ? "changed"
              : field === "releasedAt"
                ? "2026-11-01T10:00:00.123457Z"
                : field === "expiresAt"
                  ? "2026-11-01T11:00:00.123457Z"
                  : id(99);
    expect(() =>
      checkedReceived(
        { ...received, [field]: value },
        id(8),
        summary.id,
        expected,
      ),
    ).toThrow();
  });
  it("inactive receipt omits active private fields and retains exact immutable identity", () => {
    const r = {
      releaseId: id(6),
      sourceOrganizationId: id(1),
      recipientOrganizationId: id(8),
      releasedAt: at,
      expiresAt: expires,
      effectiveState: "WITHDRAWN",
    };
    expect(
      checkedReceived(r, id(8), id(6), checkedReceived(received, id(8))),
    ).toEqual(r);
    expect(() =>
      checkedReceived({ ...received, effectiveState: "WITHDRAWN" }, id(8)),
    ).toThrow();
  });
  it.each(["displayName", "purpose"])(
    "malformed successful %s is rejected instead of silently trimmed",
    (field) =>
      expect(() =>
        checkedSource(
          { ...view, release: { ...summary, [field]: " padded " } },
          scope,
        ),
      ).toThrow(),
  );
  it.each([
    "2026-11-01",
    "2026-11-01T10:00:00",
    "2026-13-01T00:00:00Z",
    "wrong",
  ])("rejects invalid offset-aware timestamp %s", (releasedAt) =>
    expect(() => checkedReceived({ ...received, releasedAt }, id(8))).toThrow(),
  );
  it("consent transitions preserve original issuance identity and exact time precision", () => {
    const expected = checkedConsent(consent, id(8));
    const consumed = {
      ...consent,
      state: "CONSUMED",
      latestEventNumber: 2,
      consumedReleaseId: id(6),
    };
    expect(checkedConsent(consumed, id(8), consent.id, expected)).toEqual(
      consumed,
    );
    expect(() =>
      checkedConsent(
        {
          ...consumed,
          issuedAt: "2026-11-01T10:00:00.123457Z",
          expiresAt: "2026-11-01T10:15:00.123457Z",
        },
        id(8),
        consent.id,
        expected,
      ),
    ).toThrow();
  });
  it.each([
    { state: "CONSUMED", latestEventNumber: 1, consumedReleaseId: id(6) },
    { state: "ISSUED", latestEventNumber: 2, consumedReleaseId: null },
    { state: "WITHDRAWN", latestEventNumber: 2, consumedReleaseId: id(6) },
    { state: "EXPIRED", latestEventNumber: 1, consumedReleaseId: id(6) },
  ])("rejects impossible consent sequence %j", (change) =>
    expect(() => checkedConsent({ ...consent, ...change }, id(8))).toThrow(),
  );
  it("enforces exact 15-minute consent and maximum 24-hour access intervals", () => {
    expect(() =>
      checkedConsent({ ...consent, expiresAt: expires }, id(8)),
    ).toThrow();
    expect(() =>
      checkedReceived(
        { ...received, expiresAt: "2026-11-02T10:00:01.123456Z" },
        id(8),
      ),
    ).toThrow();
  });
  it("orders true microsecond keysets without millisecond truncation or duplicate records", () => {
    const a = {
        ...summary,
        id: id(1),
        releasedAt: "2026-11-01T10:00:00.000002Z",
        expiresAt: "2026-11-01T11:00:00.000002Z",
      },
      b = {
        ...summary,
        id: id(99),
        releasedAt: "2026-11-01T10:00:00.000001Z",
        expiresAt: "2026-11-01T11:00:00.000001Z",
      };
    expect(
      checkedSourcePage({ items: [a, b], limit: 25, nextCursor: null }, scope)
        .items,
    ).toHaveLength(2);
    expect(() =>
      checkedSourcePage({ items: [b, a], limit: 25, nextCursor: null }, scope),
    ).toThrow();
    expect(() =>
      checkedSourcePage({ items: [a, a], limit: 25, nextCursor: null }, scope),
    ).toThrow();
    expect(instantNanos(a.releasedAt) - instantNanos(b.releasedAt)).toBe(1000n);
  });
  it("validates all page boundaries and Organization ownership", () => {
    expect(() =>
      checkedReceivedPage(
        { items: [received], limit: 25, nextCursor: "more" },
        id(8),
      ),
    ).toThrow();
    expect(() =>
      checkedReceivedPage(
        { items: [received], limit: 25, nextCursor: null },
        id(99),
      ),
    ).toThrow();
    expect(() =>
      checkedConsentPage(
        { items: [consent, consent], limit: 25, nextCursor: null },
        id(8),
      ),
    ).toThrow();
  });
  it("pins event history identity, sequence, kind and requested maximum", () => {
    const event = {
      id: id(10),
      releaseId: id(6),
      eventNumber: 1,
      kind: "ACTIVATED",
      occurredAt: at,
    };
    expect(
      checkedEvents(
        { items: [event], limit: 25, nextMaxEventNumber: null },
        id(6),
        1,
      ).items,
    ).toEqual([event]);
    expect(() =>
      checkedEvents(
        {
          items: [{ ...event, eventNumber: 2, kind: "REVOKED" }],
          limit: 25,
          nextMaxEventNumber: null,
        },
        id(6),
        1,
      ),
    ).toThrow();
    expect(() =>
      checkedEvents(
        {
          items: [{ ...event, releaseId: id(99) }],
          limit: 25,
          nextMaxEventNumber: null,
        },
        id(6),
        1,
      ),
    ).toThrow();
  });
});
