import { describe, it, expect } from "vitest";
import {
  checkedConsent,
  checkedConsentPage,
  checkedSource,
  checkedSourcePage,
  checkedReceived,
  checkedReceivedPage,
  checkedEvents,
  snapshotEvents,
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

describe("trusted immutable release-event windows", () => {
  const event1 = {
    id: id(81),
    releaseId: id(80),
    eventNumber: 1,
    kind: "ACTIVATED",
    occurredAt: "2026-10-24T00:00:00.123456Z",
  };
  const event2 = {
    id: id(82),
    releaseId: id(80),
    eventNumber: 2,
    kind: "REVOKED",
    occurredAt: "2026-10-24T00:00:01Z",
  };
  const page: {
    items: (typeof event1)[];
    limit: number;
    nextMaxEventNumber: number | null;
  } = { items: [event2, event1], limit: 2, nextMaxEventNumber: null };
  it.each([
    [
      "event UUID",
      (p: typeof page) => {
        p.items[0].id = id(83);
      },
    ],
    [
      "release UUID",
      (p: typeof page) => {
        p.items[0].releaseId = id(84);
      },
    ],
    [
      "number",
      (p: typeof page) => {
        p.items[0].eventNumber = 1;
      },
    ],
    [
      "kind",
      (p: typeof page) => {
        p.items[0].kind = "ACTIVATED";
      },
    ],
    [
      "valid timestamp",
      (p: typeof page) => {
        p.items[0].occurredAt = "2026-10-24T00:00:42Z";
      },
    ],
    [
      "remove event",
      (p: typeof page) => {
        p.items.pop();
      },
    ],
    [
      "insert event",
      (p: typeof page) => {
        p.items.push({ ...event1, id: id(85) });
      },
    ],
    [
      "reorder",
      (p: typeof page) => {
        p.items.reverse();
      },
    ],
    [
      "duplicate",
      (p: typeof page) => {
        p.items[1] = { ...event2 };
      },
    ],
    [
      "above head",
      (p: typeof page) => {
        p.items[0].eventNumber = 3;
      },
    ],
    [
      "limit",
      (p: typeof page) => {
        p.limit = 3;
      },
    ],
    [
      "cursor",
      (p: typeof page) => {
        p.nextMaxEventNumber = 1;
      },
    ],
  ])("rejects %s without altering the trusted baseline", (_name, attack) => {
    const baseline = snapshotEvents(checkedEvents(page, id(80), 2, 2));
    const candidate = structuredClone(page);
    attack(candidate);
    expect(() => checkedEvents(candidate, id(80), 2, 2, baseline)).toThrow();
    expect(baseline).toEqual(page);
    expect(
      checkedEvents(structuredClone(page), id(80), 2, 2, baseline),
    ).toEqual(page);
  });
  it.each([
    "2026-10-24T00:00:42Z",
    "2026-10-24T01:00:00.123456+01:00",
    "2026-10-24T00:00:00.1234560Z",
    "2026-10-24T00:00:00.123456001Z",
  ])("rejects different exact valid timestamp %s", (occurredAt) => {
    const original = { items: [event1], limit: 1, nextMaxEventNumber: null };
    const baseline = snapshotEvents(checkedEvents(original, id(80), 1, 1));
    const candidate = { ...original, items: [{ ...event1, occurredAt }] };
    expect(checkedEvents(candidate, id(80), 1, 1)).toEqual(candidate);
    if (occurredAt !== "2026-10-24T00:00:42Z")
      expect(Date.parse(occurredAt)).toBe(Date.parse(event1.occurredAt));
    expect(() => checkedEvents(candidate, id(80), 1, 1, baseline)).toThrow();
  });
  it("rejects a structurally valid changed page cursor and owns a deep immutable snapshot", () => {
    const original = {
      items: [{ ...event2 }],
      limit: 1,
      nextMaxEventNumber: 1,
    };
    const baseline = snapshotEvents(checkedEvents(original, id(80), 2, 1));
    const changed = { ...original, nextMaxEventNumber: null };
    expect(checkedEvents(changed, id(80), 2, 1)).toEqual(changed);
    expect(() => checkedEvents(changed, id(80), 2, 1, baseline)).toThrow();
    original.items[0].occurredAt = "2026-10-24T00:00:42Z";
    expect(baseline.items[0].occurredAt).toBe(event2.occurredAt);
    expect(
      Object.isFrozen(baseline) &&
        Object.isFrozen(baseline.items) &&
        Object.isFrozen(baseline.items[0]),
    ).toBe(true);
  });
});

it.each([false, true])(
  "rejects a valid-shaped insertion into a trusted %s-empty window",
  (nonempty) => {
    const first = {
      id: id(91),
      releaseId: id(90),
      eventNumber: 1,
      kind: "ACTIVATED",
      occurredAt: at,
    };
    const last = {
      id: id(92),
      releaseId: id(90),
      eventNumber: 2,
      kind: "REVOKED",
      occurredAt: expires,
    };
    const original = {
      items: nonempty ? [last] : [],
      limit: 2,
      nextMaxEventNumber: null,
    };
    const expected = snapshotEvents(checkedEvents(original, id(90), 2, 2));
    const candidate = {
      ...original,
      items: nonempty ? [last, first] : [first],
    };
    expect(checkedEvents(candidate, id(90), 2, 2)).toEqual(candidate);
    expect(() => checkedEvents(candidate, id(90), 2, 2, expected)).toThrow();
    expect(
      checkedEvents(structuredClone(original), id(90), 2, 2, expected),
    ).toEqual(original);
  },
);
