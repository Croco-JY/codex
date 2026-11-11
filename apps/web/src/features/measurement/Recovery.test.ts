import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import * as t from "./measurementTrust";
import { A, P, S, MS, rev, spec, summary } from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .reverse()
    .splice(0)
    .forEach((f) => f());
  vi.useRealTimers();
});
function setup(client = new QueryClient(), generation = 1) {
  let current = true;
  const c: t.MeasurementContext = {
    scope: "recovery",
    organizationId: A,
    projectId: P,
    styleId: S,
    generation,
    current: () => current,
  };
  const release = t.retainMeasurementTrust(client, c, {});
  cleanups.push(() => {
    release();
    client.clear();
  });
  const read = (
    q: Parameters<typeof t.beginMeasurementRead>[2],
    signal = new AbortController().signal,
  ) => t.beginMeasurementRead(client, c, q, signal);
  t.acceptMeasurementSpec(read({ kind: "spec" }), spec(3));
  const fail = (q: Parameters<typeof t.beginMeasurementRead>[2]) =>
    t.rejectMeasurementRead(read(q));
  const page = (max = 3, limit = 25) => ({
    items: Array.from({ length: Math.min(max, limit) }, (_, i) =>
      summary(rev(max - i)),
    ),
    limit,
    nextMaxRevisionNumber: max > limit ? max - limit : null,
  });
  return {
    client,
    c,
    read,
    fail,
    release,
    page,
    end: () => {
      current = false;
    },
    all: (offset = 0) => t.measurementRecoveries(client, c, offset),
  };
}
const reqs = [
  { kind: "spec" } as const,
  { kind: "history", specId: MS, max: 3, limit: 25 } as const,
  { kind: "revision", specId: MS, revisionId: rev(3).id } as const,
  { kind: "mutation", specId: MS } as const,
];
test.each(reqs)(
  "registry discovery for $kind survives Query removal with exact immutable scope",
  (q) => {
    const h = setup();
    h.fail(q);
    const before = h.client.getQueryCache().getAll().length;
    const page = h.all();
    expect(page.total).toBe(1);
    expect(h.client.getQueryCache().getAll()).toHaveLength(before);
    const d = page.items[0];
    expect(d.networkFailure).toBe(true);
    expect(d.cacheFailure).toBe(false);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.context)).toBe(true);
    expect(Object.isFrozen(d.request)).toBe(true);
    expect(d.context).toEqual({
      scope: h.c.scope,
      organizationId: A,
      projectId: P,
      styleId: S,
      generation: 1,
    });
    expect(t.requireMeasurementRecovery(h.client, h.c, d)).toEqual(
      q.kind === "mutation" ? { kind: "spec" } : q,
    );
    h.client.clear();
    expect(t.measurementRecoveryState(h.client, h.c, d)).toBe("pending");
    expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
  },
);
test("cache and network flags are projected from their sole owning sets; recovery is channel-specific", () => {
  const h = setup();
  h.fail(reqs[1]);
  h.fail(reqs[2]);
  h.client.setQueryData(queryKeys.measurementSpec(h.c.scope, A, P, S), {
    ...spec(3),
    createdAt: "2026-01-01T00:00:00Z",
  });
  expect(h.all().total).toBe(3);
  const d = h.all().items.find((x) => x.channel === "history:3:25")!;
  const receipt = t.beginMeasurementRecoveryRead(
    h.client,
    h.c,
    d,
    reqs[1],
    new AbortController().signal,
  );
  t.acceptMeasurementHistory(receipt, h.page());
  expect(t.measurementRecoveryState(h.client, h.c, d)).toBe("recovered");
  expect(h.all().total).toBe(2);
  expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
  expect(() => t.requireMeasurementRecovery(h.client, h.c, d)).toThrow();
});
test("forged, cross-client, cross-scope and retired descriptors cannot issue new receipts", () => {
  const h = setup();
  h.fail(reqs[1]);
  const d = h.all().items[0];
  expect(() =>
    t.requireMeasurementRecovery(h.client, h.c, structuredClone(d)),
  ).toThrow();
  const other = setup();
  other.fail(reqs[1]);
  expect(() =>
    t.requireMeasurementRecovery(other.client, other.c, d),
  ).toThrow();
  expect(() =>
    t.requireMeasurementRecovery(
      h.client,
      { ...h.c, organizationId: "00000000-0000-4000-8000-000000000099" },
      d,
    ),
  ).toThrow();
  const late = t.beginMeasurementRecoveryRead(
    h.client,
    h.c,
    d,
    reqs[1],
    new AbortController().signal,
  );
  h.end();
  const next = setup(h.client, 2);
  next.fail(reqs[1]);
  expect(() => t.acceptMeasurementHistory(late, h.page())).toThrow();
  expect(() => t.requireMeasurementRecovery(h.client, next.c, d)).toThrow();
  expect(next.all().total).toBe(1);
});
test("recovery cannot change window/limit/revision; failed validation stays blocking and can be retried", () => {
  const h = setup();
  h.fail(reqs[1]);
  const d = h.all().items[0];
  const signal = new AbortController().signal;
  expect(() =>
    t.beginMeasurementRecoveryRead(
      h.client,
      h.c,
      d,
      { ...reqs[1], max: 2 },
      signal,
    ),
  ).toThrow();
  expect(() =>
    t.beginMeasurementRecoveryRead(
      h.client,
      h.c,
      d,
      { ...reqs[1], limit: 1 },
      signal,
    ),
  ).toThrow();
  const first = t.beginMeasurementRecoveryRead(
    h.client,
    h.c,
    d,
    reqs[1],
    signal,
  );
  const bad = h.page();
  bad.items[0].baseSize = "CONTRADICTION";
  expect(() => t.acceptMeasurementHistory(first, bad)).toThrow();
  expect(t.measurementRecoveryState(h.client, h.c, d)).toBe("pending");
  t.acceptMeasurementHistory(
    t.beginMeasurementRecoveryRead(h.client, h.c, d, reqs[1], signal),
    h.page(),
  );
  expect(h.all().total).toBe(0);
});
test("two distinct limits retain independent authenticated recovery obligations", () => {
  const h = setup();
  const a = { kind: "history", specId: MS, max: 3, limit: 1 } as const,
    b = { ...a, limit: 2 };
  h.fail(a);
  h.fail(b);
  const da = h
    .all()
    .items.find((d) => d.request?.kind === "history" && d.request.limit === 1)!;
  t.acceptMeasurementHistory(
    t.beginMeasurementRecoveryRead(
      h.client,
      h.c,
      da,
      a,
      new AbortController().signal,
    ),
    h.page(3, 1),
  );
  expect(h.all().total).toBe(1);
  expect(h.all().items[0].request).toEqual(b);
});
test("untrusted cached request keys cannot bootstrap a recovery identity or invalid bounds", () => {
  const h = setup();
  h.client.setQueryData(
    queryKeys.measurementRevisions(h.c.scope, A, P, S, 25, 2),
    {},
  );
  h.client.setQueryData(
    queryKeys.measurementRevision(h.c.scope, A, P, S, rev(1).id),
    {},
  );
  h.client.setQueryData(
    queryKeys.measurementRevisions(h.c.scope, A, P, S, 500, NaN),
    {},
  );
  for (const d of h.all().items) {
    expect(d.request).toBeUndefined();
    expect(d.blockedReason).toBeTruthy();
    expect(() => t.requireMeasurementRecovery(h.client, h.c, d)).toThrow();
  }
  expect(h.all().total).toBe(3);
});
test("projection pagination bounds allocated descriptors and does not add query observers", () => {
  const h = setup();
  for (let max = 1; max <= 35; max++) h.fail({ ...reqs[1], max });
  const channels = new Set<string>();
  for (let offset = 0; offset < 35; offset += t.measurementRecoveryPageSize) {
    const p = h.all(offset);
    expect(p.total).toBe(35);
    expect(p.items.length).toBeLessThanOrEqual(8);
    p.items.forEach((d) => channels.add(d.channel));
  }
  expect(channels.size).toBe(35);
  expect(h.client.getQueryCache().getAll()).toHaveLength(0);
  expect(h.all(10000).offset).toBe(32);
});
test("orphan retention keeps recovery obligations and facts together; retirement revokes descriptor capabilities", () => {
  vi.useFakeTimers();
  const h = setup();
  h.fail(reqs[1]);
  const d = h.all().items[0];
  h.client.setQueryData(queryKeys.measurementSpec(h.c.scope, A, P, S), spec(3));
  h.release();
  vi.advanceTimersByTime(1000);
  const release = t.retainMeasurementTrust(h.client, h.c, {});
  expect(t.measurementRecoveryState(h.client, h.c, d)).toBe("pending");
  release();
  vi.advanceTimersByTime(t.measurementTrustLimits.orphanMs + 1);
  const newOwner = t.retainMeasurementTrust(h.client, h.c, {});
  cleanups.push(newOwner);
  expect(t.measurementRecoveryState(h.client, h.c, d)).toBe("retired");
  expect(() =>
    t.beginMeasurementRecoveryRead(
      h.client,
      h.c,
      d,
      reqs[1],
      new AbortController().signal,
    ),
  ).toThrow();
  expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
});
