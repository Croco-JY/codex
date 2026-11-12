import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import * as t from "./measurementTrust";
import {
  A,
  B,
  P,
  S,
  MS,
  spec,
  rev,
  summary,
} from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
const disposals: (() => void)[] = [];
afterEach(() => {
  disposals
    .splice(0)
    .reverse()
    .forEach((f) => f());
  vi.useRealTimers();
});
function setup(client = new QueryClient(), organizationId = A, generation = 1) {
  let current = true;
  const c = {
    scope: "budget",
    organizationId,
    projectId: P,
    styleId: S,
    generation,
    current: () => current,
  };
  const release = t.retainMeasurementTrust(client, c, {});
  disposals.push(() => {
    release();
    client.clear();
  });
  const receipt = (max: number, signal = new AbortController().signal) =>
    t.beginMeasurementRead(
      client,
      c,
      { kind: "history", specId: MS, max, limit: 1 },
      signal,
    );
  t.acceptMeasurementSpec(
    t.beginMeasurementRead(
      client,
      c,
      { kind: "spec" },
      new AbortController().signal,
    ),
    spec(1000),
  );
  const page = (max: number) => ({
    items: [summary(rev(max))],
    limit: 1,
    nextMaxRevisionNumber: max > 1 ? max - 1 : null,
  });
  const inject = (max: number) =>
    client.setQueryData(
      queryKeys.measurementRevisions(c.scope, organizationId, P, S, 1, max),
      page(max),
    );
  const attempt = (max: number) => {
    const abort = new AbortController(),
      r = receipt(max, abort.signal);
    t.runMeasurementHistoryRequest(r, async () => page(max));
    return { abort, r };
  };
  return {
    client,
    c,
    release,
    receipt,
    page,
    inject,
    attempt,
    end: () => {
      current = false;
    },
    failures: () => t.measurementRecoveries(client, c, 0, 8),
  };
}
test("256 unresolved failures protect provenance; existing retry frees exactly one slot and capacity rejection never invents a server failure", async () => {
  const h = setup();
  for (let n = 1; n <= 256; n++) {
    h.inject(n);
    const a = h.attempt(n);
    a.abort.abort();
    t.rejectMeasurementRead(a.r);
  }
  expect(h.failures().total).toBe(256);
  let covered = 0;
  for (let offset = 0; offset < 256; offset += 8) {
    const p = t.measurementRecoveries(h.client, h.c, offset, 8);
    expect(p.items).toHaveLength(8);
    expect(
      p.items.every(
        (d) =>
          d.request?.kind === "history" && d.cacheFailure && !d.networkFailure,
      ),
    ).toBe(true);
    covered += p.items.length;
  }
  expect(covered).toBe(256);
  const denied = h.receipt(257),
    transport = vi.fn(async () => h.page(257));
  expect(() => t.runMeasurementHistoryRequest(denied, transport)).toThrow(
    t.MeasurementHistoryCapacityError,
  );
  t.rejectMeasurementRead(denied);
  expect(transport).not.toHaveBeenCalled();
  expect(h.failures().total).toBe(256);
  expect(() => t.acceptMeasurementHistory(denied, h.page(257))).toThrow();
  const descriptor = h
    .failures()
    .items.find((d) => d.channel === "history:1:1")!;
  const retry = t.beginMeasurementRecoveryRead(
    h.client,
    h.c,
    descriptor,
    { kind: "history", specId: MS, max: 1, limit: 1 },
    new AbortController().signal,
  );
  await t.runMeasurementHistoryRequest(retry, async () => h.page(1));
  t.acceptMeasurementHistory(retry, h.page(1));
  expect(h.failures().total).toBe(255);
  expect(
    t.measurementRecoveryRequired(h.client, h.c, {
      kind: "history",
      max: 2,
      limit: 1,
    }),
  ).toBe(true);
  const fresh = h.receipt(257);
  await t.runMeasurementHistoryRequest(fresh, transport);
  expect(transport).toHaveBeenCalledTimes(1);
  t.acceptMeasurementHistory(fresh, h.page(257));
  expect(h.failures().total).toBe(255);
});
test("no failures and 256 settled cancelled attempts cannot strand the next authorized request", async () => {
  const h = setup();
  for (let n = 1; n <= 256; n++) {
    const a = h.attempt(n);
    a.abort.abort();
    t.rejectMeasurementRead(a.r);
  }
  expect(h.failures().total).toBe(0);
  const next = h.receipt(257),
    transport = vi.fn(async () => h.page(257));
  await t.runMeasurementHistoryRequest(next, transport);
  t.acceptMeasurementHistory(next, h.page(257));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    t.selectMeasurementHistory(h.client, h.c, h.page(257), 257, 1),
  ).toEqual(h.page(257));
  expect(h.failures().total).toBe(0);
});
test("in-flight receipts remain protected until acceptance or cancellation; failed admission cannot be replayed", async () => {
  const h = setup(),
    pending = Array.from({ length: 256 }, (_, i) => h.attempt(i + 1)),
    call = vi.fn(async () => h.page(257)),
    rejected = h.receipt(257);
  expect(() => t.runMeasurementHistoryRequest(rejected, call)).toThrow(
    t.MeasurementHistoryCapacityError,
  );
  expect(call).not.toHaveBeenCalled();
  expect(h.failures().total).toBe(0);
  pending[0].abort.abort();
  expect(() => t.runMeasurementHistoryRequest(rejected, call)).toThrow();
  const current = h.receipt(257);
  await t.runMeasurementHistoryRequest(current, call);
  t.acceptMeasurementHistory(current, h.page(257));
  expect(() => t.acceptMeasurementHistory(pending[0].r, h.page(1))).toThrow();
  // The other live slots still occupy all remaining capacity.
  const one = h.receipt(258);
  await t.runMeasurementHistoryRequest(one, async () => h.page(258));
  const overflow = h.receipt(259);
  expect(() => t.runMeasurementHistoryRequest(overflow, call)).toThrow(
    t.MeasurementHistoryCapacityError,
  );
});
test.each([true, false])(
  "final slot competition is serialized; acceptance/cancellation cannot erase unrelated failure, acceptFirst=%s",
  async (acceptFirst) => {
    const h = setup();
    const pending = Array.from({ length: 255 }, (_, i) => h.attempt(i + 1));
    h.inject(1);
    const a = h.attempt(256),
      other = h.receipt(257),
      call = vi.fn(async () => h.page(257));
    expect(() => t.runMeasurementHistoryRequest(other, call)).toThrow();
    const accept = () => t.acceptMeasurementHistory(a.r, h.page(256)),
      cancel = () => pending[1].abort.abort();
    if (acceptFirst) {
      accept();
      cancel();
    } else {
      cancel();
      accept();
    }
    expect(
      t.measurementRecoveryRequired(h.client, h.c, {
        kind: "history",
        max: 1,
        limit: 1,
      }),
    ).toBe(true);
    const next = h.receipt(257);
    await t.runMeasurementHistoryRequest(next, call);
    t.acceptMeasurementHistory(next, h.page(257));
    expect(call).toHaveBeenCalledTimes(1);
    expect(h.failures().total).toBe(1);
  },
);
test("capacity is QueryClient bounded across contexts without transferring another context's retry authority", async () => {
  const a = setup();
  for (let n = 1; n <= 256; n++) {
    a.inject(n);
    const r = a.attempt(n);
    r.abort.abort();
    t.rejectMeasurementRead(r.r);
  }
  const b = setup(a.client, B),
    other = b.receipt(257),
    call = vi.fn(async () => b.page(257));
  expect(() => t.runMeasurementHistoryRequest(other, call)).toThrow(
    t.MeasurementHistoryCapacityError,
  );
  expect(b.failures().total).toBe(0);
  expect(() =>
    t.requireMeasurementRecovery(b.client, b.c, a.failures().items[0]),
  ).toThrow();
  const isolated = setup();
  await t.runMeasurementHistoryRequest(isolated.receipt(257), call);
  expect(call).toHaveBeenCalledTimes(1);
  a.end();
  a.release();
  const replacement = setup(a.client, A, 2);
  await t.runMeasurementHistoryRequest(replacement.receipt(257), call);
  expect(call).toHaveBeenCalledTimes(2);
  expect(replacement.failures().total).toBe(0);
});
test("a rejected authenticated attempt stays protected and recovery clears only its own channel", async () => {
  const h = setup();
  for (let n = 1; n <= 256; n++) {
    const r = h.attempt(n);
    t.rejectMeasurementRead(r.r);
  }
  const specReceipt = t.beginMeasurementRead(
    h.client,
    h.c,
    { kind: "spec" },
    new AbortController().signal,
  );
  t.rejectMeasurementRead(specReceipt);
  const d = h.failures().items.find((d) => d.request?.kind === "history")!;
  const q = d.request!;
  expect(q.kind).toBe("history");
  if (q.kind !== "history") throw Error("fixture");
  const r = t.beginMeasurementRecoveryRead(
    h.client,
    h.c,
    d,
    q,
    new AbortController().signal,
  );
  await t.runMeasurementHistoryRequest(r, async () => h.page(q.max));
  t.acceptMeasurementHistory(r, h.page(q.max));
  expect(t.measurementRecoveryRequired(h.client, h.c, { kind: "spec" })).toBe(
    true,
  );
  expect(t.measurementEditingAllowed(h.client, h.c, spec(1000))).toBe(false);
});

test("a consumed receipt whose owner is no longer current releases only its in-flight accounting while another owner retains the context", async () => {
  const a = setup(),
    b = setup(a.client),
    pending = Array.from({ length: 256 }, (_, i) => a.attempt(i + 1));
  a.end();
  expect(() => t.acceptMeasurementHistory(pending[0].r, a.page(1))).toThrow();
  const r = b.receipt(257),
    call = vi.fn(async () => b.page(257));
  await t.runMeasurementHistoryRequest(r, call);
  t.acceptMeasurementHistory(r, b.page(257));
  expect(call).toHaveBeenCalledTimes(1);
  expect(b.failures().total).toBe(0);
  expect(() => t.acceptMeasurementHistory(pending[0].r, a.page(1))).toThrow();
});
