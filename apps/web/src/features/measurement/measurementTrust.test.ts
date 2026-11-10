import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  id,
  A,
  P,
  S,
  MS,
  rev,
  spec,
  summary,
} from "../../test/measurementFixture";
import { checkedRevision, type Spec, type Revision, type Page } from "./model";
import * as trust from "./measurementTrust";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});
function harness(
  client = new QueryClient(),
  override: Partial<trust.MeasurementContext> = {},
) {
  let current = true;
  const c: trust.MeasurementContext = {
    scope: "actor-a",
    organizationId: A,
    generation: 1,
    projectId: P,
    styleId: S,
    current: () => current,
    ...override,
  };
  const release = trust.retainMeasurementTrust(client, c, {});
  cleanups.push(() => {
    release();
    client.clear();
  });
  const receipt = (
    request: Parameters<typeof trust.beginMeasurementRead>[2],
    signal = new AbortController().signal,
  ) => trust.beginMeasurementRead(client, c, request, signal);
  return {
    client,
    c,
    release,
    end: () => {
      current = false;
    },
    receipt,
    spec: (v: Spec | null) =>
      trust.acceptMeasurementSpec(receipt({ kind: "spec" }), v),
    full: (v: Revision) =>
      trust.acceptMeasurementRevision(
        receipt({ kind: "revision", specId: MS, revisionId: v.id }),
        v,
      ),
    page: (v: Page, max = 1) =>
      trust.acceptMeasurementHistory(
        receipt({ kind: "history", specId: MS, max, limit: v.limit }),
        v,
      ),
    select: (v: Spec | null) => trust.selectMeasurementSpec(client, c, v),
  };
}
const page = (ns: number[], limit = 25, next: number | null = null): Page => ({
  items: ns.map((n) => summary(rev(n))),
  limit,
  nextMaxRevisionNumber: next,
});

describe("Measurement authenticated immutable trust", () => {
  it.each(["spec", "absence", "history", "revision"])(
    "never bootstraps %s from cache",
    (kind) => {
      const h = harness();
      expect(() =>
        kind === "spec"
          ? h.select(spec())
          : kind === "absence"
            ? h.select(null)
            : kind === "history"
              ? trust.selectMeasurementHistory(h.client, h.c, page([1]), 1, 25)
              : trust.selectMeasurementRevision(h.client, h.c, rev(), rev().id),
      ).toThrow();
      h.spec(spec());
      expect(h.select(spec())).toEqual(spec());
    },
  );
  it("accepts only authenticated absence and forbids absence after immutable existence", () => {
    const h = harness();
    h.spec(null);
    expect(h.select(null)).toBeNull();
    h.spec(spec());
    expect(() => h.spec(null)).toThrow();
    expect(() => h.select(null)).toThrow();
    expect(h.select(spec())).toEqual(spec());
  });
  it.each(["id", "createdAt"])("pins stable Spec %s", (field) => {
    const h = harness();
    h.spec(spec());
    const altered = spec();
    if (field === "id") {
      altered.id = id(900);
      altered.latestRevision.measurementSpecId = altered.id;
    } else altered.createdAt = "2026-10-25T00:00:00Z";
    expect(() => h.spec(altered)).toThrow();
    expect(h.select(spec())).toEqual(spec());
  });
  it.each([
    "baseSize",
    "unitSystem",
    "createdAt",
    "code",
    "label",
    "value",
    "tolerancePlus",
    "toleranceMinus",
    "notes",
  ])("compares complete immutable %s before registration", (field) => {
    const h = harness();
    h.spec(spec());
    const altered = rev();
    if (field === "baseSize") altered.baseSize = "L";
    else if (field === "unitSystem") altered.unitSystem = "IN";
    else if (field === "createdAt")
      altered.createdAt = "2026-10-24T00:00:00.000000001Z";
    else
      Object.assign(altered.points[0], {
        [field]:
          field === "value"
            ? "999.9999"
            : field === "tolerancePlus" || field === "toleranceMinus"
              ? "2.0000"
              : field === "code"
                ? "ALTERED"
                : "Altered",
      });
    expect(() => checkedRevision(altered, S, MS, altered.id)).not.toThrow();
    expect(() => h.full(altered)).toThrow();
    expect(
      trust.selectMeasurementRevision(h.client, h.c, rev(), rev().id),
    ).toEqual(rev());
  });
  it.each([
    "2026-10-24T00:00:00.000000000Z",
    "2026-10-24T00:00:00.000000001Z",
    "2026-10-24T09:00:00+09:00",
  ])("compares exact timestamp serialization %s", (createdAt) => {
    const h = harness();
    h.spec(spec());
    const altered = rev();
    altered.createdAt = createdAt;
    expect(() => h.full(altered)).toThrow();
  });
  it("detaches and deeply freezes trusted snapshots from both input and returned data", () => {
    const h = harness(),
      input = spec(),
      returned = h.spec(input)!;
    input.latestRevision.points[0].value = "999.9999";
    returned.latestRevision.points[0].value = "888.8888";
    const selected = h.select(spec())!;
    expect(selected.latestRevision.points[0].value).toBe("50.0000");
    expect(Object.isFrozen(selected.latestRevision.points[0])).toBe(true);
  });
  it.each(["summary-first", "full-first"])(
    "rejects reverse cross-view contradiction: %s",
    (order) => {
      const h = harness();
      const altered = page([1]);
      altered.items[0].baseSize = "L";
      if (order === "summary-first") {
        h.page(altered);
        expect(() => h.full(rev())).toThrow();
        expect(() => h.spec(spec())).toThrow();
      } else {
        h.full(rev());
        expect(() => h.page(altered)).toThrow();
        expect(h.page(page([1]))).toEqual(page([1]));
      }
    },
  );
  it.each(["uuid", "number"])("rejects revision %s collisions", (field) => {
    const h = harness();
    h.full(rev());
    const altered = rev(field === "uuid" ? 2 : 1);
    if (field === "uuid") altered.id = rev().id;
    else altered.id = id(990);
    expect(() => h.full(altered)).toThrow();
  });
  it("permits authenticated head jumps while preserving all old immutable POMs", () => {
    const h = harness();
    h.spec(spec());
    expect(() => h.select(spec(4))).toThrow();
    h.spec(spec(4));
    expect(h.select(spec(4))).toEqual(spec(4));
    expect(() => h.spec(spec())).toThrow();
    expect(() => h.select(spec())).toThrow();
    expect(
      trust.selectMeasurementRevision(h.client, h.c, rev(), rev().id),
    ).toEqual(rev());
  });
  it("newer authenticated summary cannot leave an old Spec editable", () => {
    const h = harness();
    h.spec(spec());
    h.page(page([3, 1]), 3);
    expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(false);
    h.spec(spec(3));
    expect(h.select(spec(3))).toEqual(spec(3));
  });
  it("keeps complete windows stable and rejects cache-only envelope replacements", () => {
    const h = harness();
    h.page(page([2], 1, 1), 2);
    expect(() =>
      trust.selectMeasurementHistory(h.client, h.c, page([2], 1, null), 2, 1),
    ).toThrow();
    expect(h.page(page([1], 1), 1)).toEqual(page([1], 1));
    expect(h.page(page([2], 1, 1), 2)).toEqual(page([2], 1, 1));
  });
  it.each([
    "known-omission",
    "reverse-eof",
    "cursor-past-known",
    "prefix-omission",
  ])("rejects bidirectional coverage: %s", (kind) => {
    const h = harness();
    if (kind === "reverse-eof") {
      h.page(page([2]), 2);
      expect(() => h.page(page([1]), 1)).toThrow();
    } else if (kind === "prefix-omission") {
      h.page(page([1], 1), 2);
      expect(() => h.page(page([2], 1, 1), 2)).toThrow();
    } else {
      h.full(rev());
      expect(() =>
        h.page(
          page(
            [2],
            kind === "known-omission" ? 25 : 1,
            kind === "known-omission" ? null : 0,
          ),
          2,
        ),
      ).toThrow();
    }
  });
  it("accepts lower maxima, different page sizes and a new head above previous maximum", () => {
    const h = harness();
    h.page(page([1]), 1);
    h.page(page([2], 1, 1), 2);
    h.page(page([2, 1], 2), 2);
    expect(h.page(page([1]), 1)).toEqual(page([1]));
  });
  it("failed candidate is atomic; a separate valid pending receipt still succeeds", () => {
    const h = harness();
    h.spec(spec());
    const valid = h.receipt({
      kind: "revision",
      specId: MS,
      revisionId: rev(2).id,
    });
    const invalid = page([3, 1]);
    invalid.items[1].baseSize = "L";
    expect(() => h.page(invalid, 3)).toThrow();
    expect(
      trust.hasMeasurementProvenance(
        h.client,
        h.c,
        { kind: "revision", revisionId: rev(3).id },
        rev(3),
      ),
    ).toBe(false);
    expect(trust.acceptMeasurementRevision(valid, rev(2))).toEqual(rev(2));
  });
  it("consumes rejected and accepted read receipts exactly once", () => {
    const h = harness();
    const first = h.receipt({ kind: "spec" });
    trust.acceptMeasurementSpec(first, spec());
    expect(() => trust.acceptMeasurementSpec(first, spec())).toThrow();
    const second = h.receipt({ kind: "spec" }),
      bad = spec();
    bad.latestRevision.points[0].value = "999.9999";
    expect(() => trust.acceptMeasurementSpec(second, bad)).toThrow();
    expect(() => trust.acceptMeasurementSpec(second, spec())).toThrow();
  });
  it("shares facts across observers and real Query eviction/recreation", () => {
    const a = harness();
    a.spec(spec());
    const b = harness(a.client);
    const key = [
      "workspace",
      "actor-a",
      A,
      "project",
      P,
      "style",
      S,
      "measurement-spec",
    ];
    a.client.setQueryData(key, spec());
    a.client.removeQueries({ queryKey: key, exact: true });
    const bad = spec();
    bad.latestRevision.points[0].value = "999.9999";
    expect(() => b.spec(bad)).toThrow();
    expect(() => a.select(bad)).toThrow();
    expect(() => b.select(bad)).toThrow();
    a.release();
    expect(b.select(spec())).toEqual(spec());
    a.client.clear();
    expect(() => b.spec(bad)).toThrow();
    expect(b.spec(spec())).toEqual(spec());
  });
  it.each(["a-first", "b-first"])(
    "concurrent network candidates establish one truth: %s",
    (order) => {
      const a = harness(),
        b = harness(a.client),
        ra = a.receipt({ kind: "spec" }),
        rb = b.receipt({ kind: "spec" }),
        bad = spec();
      bad.latestRevision.points[0].value = "999.9999";
      const first = order === "a-first" ? ra : rb,
        second = order === "a-first" ? rb : ra;
      trust.acceptMeasurementSpec(first, spec());
      expect(() => trust.acceptMeasurementSpec(second, bad)).toThrow();
      expect(a.select(spec())).toEqual(b.select(spec()));
    },
  );
  it.each(["actor", "organization", "generation", "client"])(
    "isolates %s trust",
    (kind) => {
      const a = harness();
      a.spec(spec());
      const b = harness(
        kind === "client" ? undefined : a.client,
        kind === "actor"
          ? { scope: "actor-b" }
          : kind === "organization"
            ? { organizationId: id(900) }
            : kind === "generation"
              ? { generation: 2 }
              : {},
      );
      expect(() => b.select(spec())).toThrow();
      b.spec(spec());
      expect(b.select(spec())).toEqual(spec());
    },
  );
  it("retired generation receipts cannot register or poison a new generation", () => {
    const a = harness(),
      old = a.receipt({ kind: "spec" });
    a.end();
    const b = harness(a.client, { generation: 2 });
    b.spec(spec());
    expect(() => trust.acceptMeasurementSpec(old, spec(2))).toThrow();
    trust.rejectMeasurementRead(old);
    expect(trust.measurementEditingAllowed(b.client, b.c, spec())).toBe(true);
  });
  it("cancelled and ended-context responses cannot establish facts", () => {
    const h = harness(),
      abort = new AbortController(),
      r = h.receipt({ kind: "spec" }, abort.signal);
    abort.abort();
    expect(() => trust.acceptMeasurementSpec(r, spec())).toThrow();
    expect(() => h.select(spec())).toThrow();
    const late = h.receipt({ kind: "spec" });
    h.end();
    expect(() => trust.acceptMeasurementSpec(late, spec())).toThrow();
  });
  it("retains through Strict Mode cleanup/replay when cached data exists; bounds orphan retention", () => {
    vi.useFakeTimers();
    const h = harness();
    h.spec(spec());
    const key = [
      "workspace",
      "actor-a",
      A,
      "project",
      P,
      "style",
      S,
      "measurement-spec",
    ];
    h.client.setQueryData(key, spec());
    h.release();
    const b = harness(h.client);
    expect(b.select(spec())).toEqual(spec());
    b.release();
    vi.advanceTimersByTime(trust.measurementTrustLimits.orphanMs + 1);
    const c = harness(h.client);
    expect(() => c.select(spec())).toThrow();
    c.spec(spec());
  });
  it("network outage preserves a legitimate snapshot but disables mutation until recovery", () => {
    const h = harness();
    h.spec(spec());
    const failed = h.receipt({ kind: "spec" });
    trust.rejectMeasurementRead(failed);
    expect(trust.retainedMeasurementSpec(h.client, h.c, spec())).toEqual(
      spec(),
    );
    expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(false);
    h.select(spec());
    expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(false);
    h.spec(spec());
    expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(true);
  });
});

it("bounded context capacity fails closed without dropping an active owner", () => {
  const first = harness();
  first.spec(spec());
  for (let n = 1; n < trust.measurementTrustLimits.contexts; n++)
    harness(first.client, { styleId: id(1000 + n) });
  const denied = harness(first.client, { styleId: id(9000) });
  expect(() => denied.receipt({ kind: "spec" })).toThrow();
  expect(first.select(spec())).toEqual(spec());
});
it("global window budget rejects atomically and preserves the last trusted page", () => {
  const h = harness();
  h.full(rev());
  for (let limit = 1; limit <= 100; limit++) h.page(page([1], limit), 1);
  // Distinct maxima give distinct immutable page windows while keeping the same event facts.
  for (let max = 2; max <= 157; max++) h.page(page([1]), max);
  expect(() => h.page(page([1]), 158)).toThrow();
  expect(
    trust.hasMeasurementProvenance(
      h.client,
      h.c,
      { kind: "history", max: 158, limit: 25 },
      page([1]),
    ),
  ).toBe(false);
  expect(h.page(page([1]), 157)).toEqual(page([1]));
});

it("authenticated Spec reconciliation clears an ambiguous mutation gate without rebasing the draft", () => {
  const h = harness();
  h.spec(spec());
  const receipt = h.receipt({ kind: "mutation", specId: MS });
  trust.rejectMeasurementRead(receipt);
  expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(false);
  h.select(spec());
  expect(trust.measurementEditingAllowed(h.client, h.c, spec())).toBe(false);
  h.spec(spec(2));
  expect(trust.measurementEditingAllowed(h.client, h.c, spec(2))).toBe(true);
});
