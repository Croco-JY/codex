import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import * as t from "./measurementTrust";
import {
  A,
  B,
  P,
  S,
  MS,
  rev,
  spec,
  summary,
} from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
});
function setup(client = new QueryClient(), generation = 1, organizationId = A) {
  let current = true;
  const c: t.MeasurementContext = {
    scope: "history-request",
    organizationId,
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
  const receipt = (
    q: Parameters<typeof t.beginMeasurementRead>[2],
    signal = new AbortController().signal,
  ) => t.beginMeasurementRead(client, c, q, signal);
  t.acceptMeasurementSpec(receipt({ kind: "spec" }), spec(3));
  const request = (max = 2, limit = 25) => ({
    kind: "history" as const,
    specId: MS,
    max,
    limit,
  });
  const page = (max = 2, limit = 25) => ({
    items: Array.from({ length: Math.min(max, limit) }, (_, i) =>
      summary(rev(max - i)),
    ),
    limit,
    nextMaxRevisionNumber: max > limit ? max - limit : null,
  });
  const key = (max = 2, limit = 25) =>
    queryKeys.measurementRevisions(c.scope, organizationId, P, S, limit, max);
  const inject = (max = 2, limit = 25) =>
    client.setQueryData(key(max, limit), page(max, limit));
  return {
    client,
    c,
    release,
    end: () => {
      current = false;
    },
    receipt,
    request,
    page,
    key,
    inject,
    projection: () => t.measurementRecoveries(client, c),
  };
}
test.each(["before", "during", "after-response"] as const)(
  "cancelled %s-dispatch request retains no facts and only valid invocation permits retry",
  async (when) => {
    const h = setup();
    h.inject();
    const abort = new AbortController();
    const receipt = h.receipt(h.request(), abort.signal);
    const transport = vi.fn(async () => h.page());
    if (when === "before") abort.abort();
    if (when === "before")
      expect(() =>
        t.runMeasurementHistoryRequest(receipt, transport),
      ).toThrow();
    else {
      await t.runMeasurementHistoryRequest(
        receipt,
        when === "during"
          ? async () => {
              abort.abort();
              return h.page();
            }
          : transport,
      );
      abort.abort();
    }
    expect(() => t.acceptMeasurementHistory(receipt, h.page())).toThrow();
    const d = h.projection().items[0];
    expect(d.cacheFailure).toBe(true);
    expect(d.networkFailure).toBe(false);
    expect(d.request !== undefined).toBe(when !== "before");
    expect(() =>
      t.selectMeasurementHistory(h.client, h.c, h.page(), 2, 25),
    ).toThrow();
    expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
    expect(transport.mock.calls.length).toBe(when === "after-response" ? 1 : 0);
    if (when !== "before") {
      const retry = t.beginMeasurementRecoveryRead(
        h.client,
        h.c,
        d,
        h.request(),
        new AbortController().signal,
      );
      await t.runMeasurementHistoryRequest(retry, async () => h.page());
      t.acceptMeasurementHistory(retry, h.page());
      expect(h.projection().total).toBe(0);
    }
  },
);
test("cached keys, Query observers and generic receipts alone create no request provenance", () => {
  const h = setup();
  h.inject();
  const r = h.receipt(h.request());
  t.rejectMeasurementRead({ ...r });
  expect(h.projection().items[0].request).toBeUndefined();
  expect(() =>
    t.requireMeasurementRecovery(h.client, h.c, h.projection().items[0]),
  ).toThrow();
  expect(() =>
    t.runMeasurementHistoryRequest({ ...r }, async () => h.page()),
  ).toThrow();
  expect(() =>
    t.runMeasurementHistoryRequest(Object.freeze({}), async () => h.page()),
  ).toThrow();
  expect(h.projection().items[0].request).toBeUndefined();
});
test.each([
  { specId: rev().id },
  { max: 4 },
  { max: 0 },
  { max: NaN },
  { limit: 0 },
  { limit: 101 },
  { limit: 1.5 },
])("invalid authorized request target %j never invokes transport", (q) => {
  const h = setup();
  const call = vi.fn(async () => h.page());
  expect(() =>
    t.runMeasurementHistoryRequest(h.receipt({ ...h.request(), ...q }), call),
  ).toThrow();
  expect(call).not.toHaveBeenCalled();
  h.inject();
  expect(h.projection().items[0].request).toBeUndefined();
});
test("a request receipt dispatches once and captures immutable exact request identity", async () => {
  const h = setup();
  h.inject();
  const q = h.request(),
    receipt = h.receipt(q);
  q.max = 3;
  const transport = vi.fn(async () => h.page());
  await t.runMeasurementHistoryRequest(receipt, transport);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(() => t.runMeasurementHistoryRequest(receipt, transport)).toThrow();
  t.acceptMeasurementHistory(receipt, h.page());
  expect(h.projection().total).toBe(0);
  expect(() => t.acceptMeasurementHistory(receipt, h.page())).toThrow();
});
test("provenance survives active Query eviction, but never establishes cache provenance or clears a gate", async () => {
  const h = setup();
  h.inject();
  const abort = new AbortController(),
    r = h.receipt(h.request(), abort.signal);
  await t.runMeasurementHistoryRequest(r, async () => h.page());
  abort.abort();
  t.rejectMeasurementRead(r);
  h.client.clear();
  expect(h.projection().items[0].request).toEqual(h.request());
  expect(() =>
    t.selectMeasurementHistory(h.client, h.c, h.page(), 2, 25),
  ).toThrow();
  expect(h.projection().items[0].networkFailure).toBe(false);
});
test.each([
  "actor",
  "organization",
  "generation",
  "client",
  "retirement",
] as const)(
  "attempts and descriptors cannot authorize replacement %s",
  async (boundary) => {
    const h = setup();
    h.inject();
    const r = h.receipt(h.request());
    await t.runMeasurementHistoryRequest(r, async () => h.page());
    const old = h.projection().items[0];
    let replacement: ReturnType<typeof setup>;
    if (boundary === "retirement") {
      vi.useFakeTimers();
      h.client.setQueryData(
        queryKeys.measurementSpec(h.c.scope, A, P, S),
        spec(3),
      );
      h.release();
      vi.advanceTimersByTime(t.measurementTrustLimits.orphanMs + 1);
      replacement = setup(h.client);
    } else if (boundary === "client") replacement = setup();
    else {
      h.end();
      replacement = setup(
        h.client,
        boundary === "generation" ? 2 : 1,
        boundary === "organization" ? B : A,
      );
    }
    replacement.inject();
    expect(replacement.projection().items[0].request).toBeUndefined();
    expect(() =>
      t.requireMeasurementRecovery(replacement.client, replacement.c, old),
    ).toThrow();
    if (boundary !== "client")
      expect(() => t.acceptMeasurementHistory(r, h.page())).toThrow();
  },
);
test.each([true, false])(
  "concurrent same-channel cancellation never authenticates the cancelled result, validFirst=%s",
  async (validFirst) => {
    const h = setup();
    h.inject();
    const abort = new AbortController(),
      a = h.receipt(h.request(), abort.signal),
      b = h.receipt(h.request());
    await t.runMeasurementHistoryRequest(a, async () => h.page());
    await t.runMeasurementHistoryRequest(b, async () => h.page());
    abort.abort();
    const good = () => t.acceptMeasurementHistory(b, h.page()),
      bad = () => {
        expect(() => t.acceptMeasurementHistory(a, h.page())).toThrow();
        t.rejectMeasurementRead(a);
      };
    if (validFirst) {
      good();
      bad();
    } else {
      bad();
      good();
    }
    expect(h.projection().total).toBe(0);
    expect(t.selectMeasurementHistory(h.client, h.c, h.page(), 2, 25)).toEqual(
      h.page(),
    );
  },
);
test("cancellation during validation is atomic and never a synthetic network rejection", async () => {
  const h = setup();
  h.inject();
  const abort = new AbortController(),
    r = h.receipt(h.request(), abort.signal);
  await t.runMeasurementHistoryRequest(r, async () => h.page());
  const candidate = h.page();
  Object.defineProperty(candidate.items[0], "baseSize", {
    get() {
      abort.abort();
      return rev(2).baseSize;
    },
    enumerable: true,
  });
  expect(() => t.acceptMeasurementHistory(r, candidate)).toThrow();
  const d = h.projection().items[0];
  expect(d.cacheFailure).toBe(true);
  expect(d.networkFailure).toBe(false);
  expect(() =>
    t.selectMeasurementHistory(h.client, h.c, h.page(), 2, 25),
  ).toThrow();
  const fresh = h.receipt(h.request());
  await t.runMeasurementHistoryRequest(fresh, async () => h.page());
  t.acceptMeasurementHistory(fresh, h.page());
  expect(h.projection().total).toBe(0);
});
test.each([
  "timestamp",
  "identity",
  "cursor",
  "EOF",
  "known-omission",
] as const)(
  "request eligibility does not weaken %s acceptance",
  async (attack) => {
    const h = setup();
    const known = h.page(3, 1);
    t.acceptMeasurementHistory(h.receipt(h.request(3, 1)), known);
    h.inject();
    const r = h.receipt(h.request());
    await t.runMeasurementHistoryRequest(r, async () => h.page());
    const bad = h.page();
    if (attack === "timestamp") {
      t.acceptMeasurementHistory(h.receipt(h.request()), h.page());
      bad.items[0].createdAt = "2026-01-01T00:00:00Z";
    }
    if (attack === "identity") bad.items[0].id = rev(3).id;
    if (attack === "cursor") bad.nextMaxRevisionNumber = 2;
    if (attack === "EOF" || attack === "known-omission") bad.items = [];
    expect(() => t.acceptMeasurementHistory(r, bad)).toThrow();
    expect(h.projection().items[0].networkFailure).toBe(true);
    expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
  },
);
test("bounded attempt storage refuses overflow before invoking transport and active facts are retained", async () => {
  const h = setup();
  t.acceptMeasurementSpec(h.receipt({ kind: "spec" }), spec(400));
  for (let n = 1; n <= t.measurementTrustLimits.historyAttempts; n++) {
    const abort = new AbortController(),
      r = h.receipt(h.request(n), abort.signal);
    await t.runMeasurementHistoryRequest(r, async () => h.page(n, 1));
    abort.abort();
    t.rejectMeasurementRead(r);
  }
  const transport = vi.fn(async () => h.page());
  expect(() =>
    t.runMeasurementHistoryRequest(h.receipt(h.request(257)), transport),
  ).toThrow();
  expect(transport).not.toHaveBeenCalled();
  h.inject(2);
  expect(h.projection().items[0].request).toEqual(h.request());
  expect(t.selectMeasurementSpec(h.client, h.c, spec(400))).toEqual(spec(400));
});
test("unrequestable malformed cache bounds cannot mint authority or create an unreachable blocking channel", () => {
  const h = setup();
  h.client.setQueryData(h.key(NaN, 500), {});
  h.client.setQueryData(h.key(2, -1), {});
  h.client.setQueryData(h.key(9000, 25), {});
  expect(h.projection().total).toBe(0);
  expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(true);
  expect(() => t.measurementHistoryTarget(h.client, h.c, NaN, 500)).toThrow();
});
