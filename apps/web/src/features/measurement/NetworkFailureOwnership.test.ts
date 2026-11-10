import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { queryKeys } from "../../api/queryKeys";
import { A, P, S, MS, rev, spec, summary } from "../../test/measurementFixture";
import type { Page } from "./model";
import * as t from "./measurementTrust";
const releases: (() => void)[] = [];
afterEach(() => {
  releases
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
});
type Channel = "spec" | "history" | "revision";
function setup(client = new QueryClient(), generation = 1) {
  let current = true;
  const c: t.MeasurementContext = {
    scope: "failure-owner",
    organizationId: A,
    generation,
    projectId: P,
    styleId: S,
    current: () => current,
  };
  const release = t.retainMeasurementTrust(client, c, {});
  releases.push(() => {
    release();
    client.clear();
  });
  const receipt = (
    request: Parameters<typeof t.beginMeasurementRead>[2],
    signal = new AbortController().signal,
  ) => t.beginMeasurementRead(client, c, request, signal);
  const acceptSpec = () =>
    t.acceptMeasurementSpec(receipt({ kind: "spec" }), spec(3));
  const page = (max = 3): Page => ({
    items: Array.from({ length: max }, (_, i) => summary(rev(max - i))),
    limit: 25,
    nextMaxRevisionNumber: null,
  });
  const request = (ch: Channel, max = 3) =>
    ch === "spec"
      ? { kind: "spec" as const }
      : ch === "history"
        ? { kind: "history" as const, specId: MS, max, limit: 25 }
        : { kind: "revision" as const, specId: MS, revisionId: rev().id };
  const good = (ch: Channel, max = 3) =>
    ch === "spec" ? spec(3) : ch === "history" ? page(max) : rev();
  function bad(ch: Channel, max = 3) {
    const value = structuredClone(good(ch, max));
    if ("latestRevision" in value)
      value.latestRevision.points[0].value = "999.9999";
    else if ("items" in value) value.items[0].baseSize = "CONTRADICTORY";
    else value.points[0].value = "999.9999";
    return value;
  }
  function accept(ch: Channel, value = good(ch), max = 3) {
    const r = receipt(request(ch, max));
    if (ch === "spec")
      return t.acceptMeasurementSpec(r, value as ReturnType<typeof spec>);
    if (ch === "history") return t.acceptMeasurementHistory(r, value as Page);
    return t.acceptMeasurementRevision(r, value as ReturnType<typeof rev>);
  }
  const key = (ch: Channel, max = 3) =>
    ch === "spec"
      ? queryKeys.measurementSpec(c.scope, A, P, S)
      : ch === "history"
        ? queryKeys.measurementRevisions(c.scope, A, P, S, 25, max)
        : queryKeys.measurementRevision(c.scope, A, P, S, rev().id);
  function select(ch: Channel, value = good(ch), max = 3) {
    if (ch === "spec")
      return t.selectMeasurementSpec(
        client,
        c,
        value as ReturnType<typeof spec>,
      );
    if (ch === "history")
      return t.selectMeasurementHistory(client, c, value as Page, max, 25);
    return t.selectMeasurementRevision(
      client,
      c,
      value as ReturnType<typeof rev>,
      rev().id,
    );
  }
  const allowed = () => t.measurementEditingAllowed(client, c, spec(3));
  if (!t.hasMeasurementProvenance(client, c, { kind: "spec" }, spec(3))) {
    acceptSpec();
    accept("history");
    accept("revision");
  }
  return {
    client,
    c,
    release,
    receipt,
    accept,
    good,
    bad,
    key,
    select,
    allowed,
    end: () => {
      current = false;
    },
    request,
  };
}

test.each(
  (["spec", "history", "revision"] as const).flatMap((ch) =>
    (["network-first", "cache-first"] as const).map((order) => ({ ch, order })),
  ),
)(
  "$ch: $order cache validation cannot recover an authenticated failure",
  ({ ch, order }) => {
    const h = setup();
    h.client.setQueryData(h.key(ch), h.good(ch));
    if (order === "cache-first") h.client.setQueryData(h.key(ch), h.bad(ch));
    expect(() => h.accept(ch, h.bad(ch))).toThrow();
    expect(h.allowed()).toBe(false);
    if (order === "network-first") h.client.setQueryData(h.key(ch), h.bad(ch));
    for (const value of [h.good(ch), structuredClone(h.good(ch))]) {
      h.client.setQueryData(h.key(ch), value);
      h.select(ch, value);
      expect(h.allowed()).toBe(false);
      expect(t.measurementRecoveryRequired(h.client, h.c, h.request(ch))).toBe(
        true,
      );
      expect(() =>
        t.requireMeasurementWrite(h.client, h.c, spec(3), "revision", 3),
      ).toThrow();
    }
    h.accept(ch);
    expect(h.allowed()).toBe(true);
    expect(t.measurementRecoveryRequired(h.client, h.c)).toBe(false);
  },
);

test.each(["spec", "history", "revision"] as const)(
  "%s network failure survives cache removal, recreation and a second observer",
  (ch) => {
    const a = setup();
    expect(() => a.accept(ch, a.bad(ch))).toThrow();
    a.client.removeQueries({ queryKey: a.key(ch), exact: true });
    const b = setup(a.client);
    a.client.setQueryData(a.key(ch), a.bad(ch));
    a.client.setQueryData(a.key(ch), a.good(ch));
    a.select(ch);
    b.select(ch);
    expect(a.allowed()).toBe(false);
    expect(b.allowed()).toBe(false);
    a.release();
    expect(b.allowed()).toBe(false);
    b.accept(ch);
    expect(b.allowed()).toBe(true);
  },
);

test("cache and authenticated recovery each clear only their independently owned channels", () => {
  const h = setup();
  for (const ch of ["spec", "history", "revision"] as const)
    expect(() => h.accept(ch, h.bad(ch))).toThrow();
  for (const ch of ["spec", "history", "revision"] as const) {
    for (const other of ["spec", "history", "revision"] as const)
      h.client.setQueryData(h.key(other), h.good(other));
    h.accept(ch);
    expect(t.measurementRecoveryRequired(h.client, h.c, h.request(ch))).toBe(
      false,
    );
    if (ch !== "revision") expect(h.allowed()).toBe(false);
  }
  expect(h.allowed()).toBe(true);
});

test("distinct history windows retain distinct authenticated failure ownership", () => {
  const h = setup();
  h.accept("history", h.good("history", 2), 2);
  expect(() => h.accept("history", h.bad("history", 2), 2)).toThrow();
  expect(() => h.accept("history", h.bad("history"))).toThrow();
  h.accept("history");
  expect(h.allowed()).toBe(false);
  expect(
    t.measurementRecoveryRequired(h.client, h.c, h.request("history", 2)),
  ).toBe(true);
  h.accept("spec");
  expect(h.allowed()).toBe(false);
  h.accept("history", h.good("history", 2), 2);
  expect(h.allowed()).toBe(true);
});

test.each(["valid-first", "invalid-first"] as const)(
  "concurrent authenticated completion order: %s",
  (order) => {
    const h = setup(),
      valid = h.receipt({ kind: "spec" }),
      invalid = h.receipt({ kind: "spec" });
    const good = () => t.acceptMeasurementSpec(valid, spec(3)),
      bad = () =>
        expect(() =>
          t.acceptMeasurementSpec(
            invalid,
            h.bad("spec") as ReturnType<typeof spec>,
          ),
        ).toThrow();
    if (order === "valid-first") {
      good();
      bad();
      expect(h.allowed()).toBe(false);
    } else {
      bad();
      good();
      expect(h.allowed()).toBe(true);
    }
    h.client.setQueryData(h.key("spec"), h.bad("spec"));
    h.client.setQueryData(h.key("spec"), h.good("spec"));
    expect(h.allowed()).toBe(order === "invalid-first");
  },
);

test("only authenticated Spec reconciliation resolves an ambiguous mutation; other failures remain", () => {
  const h = setup();
  t.rejectMeasurementRead(h.receipt({ kind: "mutation", specId: MS }));
  expect(() => h.accept("history", h.bad("history"))).toThrow();
  h.client.setQueryData(h.key("spec"), h.bad("spec"));
  h.client.setQueryData(h.key("spec"), h.good("spec"));
  h.select("spec");
  expect(h.allowed()).toBe(false);
  expect(t.measurementRecoveryRequired(h.client, h.c, { kind: "spec" })).toBe(
    true,
  );
  h.accept("revision");
  expect(h.allowed()).toBe(false);
  h.accept("spec");
  expect(t.measurementRecoveryRequired(h.client, h.c, { kind: "spec" })).toBe(
    false,
  );
  expect(h.allowed()).toBe(false);
  h.accept("history");
  expect(h.allowed()).toBe(true);
});

test("final write guard blocks a stale enabled command even when every observed raw query is a valid cache success", () => {
  const h = setup(),
    observer = new QueryObserver(h.client, {
      queryKey: h.key("spec"),
      enabled: false,
      queryFn: async () => spec(3),
    }),
    unsub = observer.subscribe(() => {});
  releases.push(unsub);
  h.client.setQueryData(h.key("spec"), h.good("spec"));
  expect(() => h.accept("spec", h.bad("spec"))).toThrow();
  h.client.setQueryData(h.key("spec"), h.bad("spec"));
  h.client.setQueryData(h.key("spec"), h.good("spec"));
  expect(h.client.getQueryState(h.key("spec"))?.status).toBe("success");
  expect(
    t.hasMeasurementProvenance(h.client, h.c, { kind: "spec" }, spec(3)),
  ).toBe(true);
  expect(() =>
    t.requireMeasurementWrite(h.client, h.c, spec(3), "revision", 3),
  ).toThrow();
  h.accept("spec");
  expect(() =>
    t.requireMeasurementWrite(h.client, h.c, spec(3), "revision", 3),
  ).not.toThrow();
});

test("retired receipts and failure state cannot affect a replacement authenticated generation", () => {
  const a = setup();
  expect(() => a.accept("spec", a.bad("spec"))).toThrow();
  const late = a.receipt({ kind: "spec" });
  a.end();
  const b = setup(a.client, 2);
  expect(b.allowed()).toBe(true);
  expect(() => t.acceptMeasurementSpec(late, spec(3))).toThrow();
  t.rejectMeasurementRead(late);
  expect(b.allowed()).toBe(true);
});

test("ordinary Query eviction preserves a network gate; final context retirement discards facts and failures together", () => {
  const a = setup();
  expect(() => a.accept("spec", a.bad("spec"))).toThrow();
  a.client.setQueryData(a.key("spec"), a.good("spec"));
  a.client.removeQueries({ queryKey: a.key("spec"), exact: true });
  expect(a.allowed()).toBe(false);
  a.release();
  const client = a.client,
    c = a.c,
    release = t.retainMeasurementTrust(client, c, {});
  releases.push(release);
  expect(t.measurementRecoveryRequired(client, c)).toBe(false);
  expect(t.measurementEditingAllowed(client, c, spec(3))).toBe(false);
  const receipt = t.beginMeasurementRead(
    client,
    c,
    { kind: "spec" },
    new AbortController().signal,
  );
  t.acceptMeasurementSpec(receipt, spec(3));
  expect(t.measurementEditingAllowed(client, c, spec(3))).toBe(true);
});

test("orphan retention cannot launder a network failure before legitimate five-minute retirement", () => {
  vi.useFakeTimers();
  const a = setup();
  expect(() => a.accept("spec", a.bad("spec"))).toThrow();
  a.client.setQueryData(a.key("spec"), a.good("spec"));
  a.release();
  vi.advanceTimersByTime(1000);
  const release = t.retainMeasurementTrust(a.client, a.c, {});
  expect(t.measurementEditingAllowed(a.client, a.c, spec(3))).toBe(false);
  release();
  vi.advanceTimersByTime(t.measurementTrustLimits.orphanMs + 1);
  const next = t.retainMeasurementTrust(a.client, a.c, {});
  releases.push(next);
  expect(t.measurementRecoveryRequired(a.client, a.c)).toBe(false);
  expect(t.measurementEditingAllowed(a.client, a.c, spec(3))).toBe(false);
});
