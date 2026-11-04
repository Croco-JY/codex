import { afterEach, expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import { id, time } from "../../test/patternReleaseFixture";
import { deferred } from "../../test/measurementFixture";
import {
  acceptEventHistoryRead, beginEventHistoryRead, retainEventHistory, selectEventHistory,
} from "./eventHistoryTrust";

const clients = new Set<QueryClient>();
const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  clients.forEach((client) => client.clear());
  clients.clear();
});
const releaseId = id(600);
const context = ["actor/session-X", id(10), "generation", 1, "pattern-release",
  "source", { project: id(11), style: id(12), pattern: id(13), revision: id(14) },
  "release", releaseId, "events"];
const first = { id: id(680), releaseId, eventNumber: 1, kind: "ACTIVATED", occurredAt: time };
const last = { id: id(681), releaseId, eventNumber: 2, kind: "REVOKED", occurredAt: "2026-10-24T00:00:01Z" };
const changed = "2026-10-24T00:00:42Z";
const page = (max = 2, limit = 1) => ({
  items: [last, first].filter((event) => event.eventNumber <= max).slice(0, limit).map((event) => ({ ...event })),
  limit, nextMaxEventNumber: max === 2 && limit === 1 ? 1 : null,
});
function harness(client = new QueryClient(), key = context) {
  clients.add(client);
  const stop = retainEventHistory(client, key, {}, 2);
  releases.push(stop);
  const begin = (max = 2, limit = 1) => beginEventHistoryRead(client, key, releaseId, max, limit);
  const network = (value: unknown, max = 2, limit = 1) => acceptEventHistoryRead(begin(max, limit), value);
  const cached = (value: unknown, max = 2, limit = 1) => selectEventHistory(client, key, value, releaseId, max, limit);
  return { client, key, stop, begin, network, cached };
}

test("cached shape cannot establish network provenance, even for known overlapping events", () => {
  const h = harness();
  expect(() => h.cached(page())).toThrow(ApiError);
  h.network(page());
  expect(h.cached(page())).toEqual(page());
  expect(() => h.cached(page(2, 2), 2, 2)).toThrow(ApiError);
  expect(h.network(page(2, 2), 2, 2)).toEqual(page(2, 2));
});

test.each([false, true])("first current network candidate atomically wins, reverse=%s", (reverse) => {
  const h = harness(), second = harness(h.client);
  const a = page(), b = page(); b.items[0].occurredAt = changed;
  const ra = h.begin(), rb = second.begin();
  const winner = reverse ? b : a, loser = reverse ? a : b;
  expect(acceptEventHistoryRead(reverse ? rb : ra, winner)).toEqual(winner);
  expect(() => acceptEventHistoryRead(reverse ? ra : rb, loser)).toThrow(ApiError);
  expect(h.cached(winner)).toEqual(winner);
  expect(second.cached(winner)).toEqual(winner);
  expect(() => second.cached(loser)).toThrow(ApiError);
});

test("receipts cannot be forged, reused, or seed an ended context", () => {
  const h = harness(), receipt = h.begin();
  expect(() => acceptEventHistoryRead({}, page())).toThrow(ApiError);
  h.stop(); h.client.clear();
  const next = harness(h.client);
  expect(() => acceptEventHistoryRead(receipt, page())).toThrow(ApiError);
  const valid = next.begin(); acceptEventHistoryRead(valid, page());
  expect(() => acceptEventHistoryRead(valid, page())).toThrow(ApiError);
});

test("one observer ending cannot erase another live owner's truth after all queries are removed", () => {
  const h = harness(), other = harness(h.client);
  h.network(page());
  h.stop(); h.client.clear();
  const bad = page(); bad.items[0].occurredAt = changed;
  expect(() => other.network(bad)).toThrow(ApiError);
  expect(other.network(page())).toEqual(page());
});

test("cached query retains provenance after final owner closes, then eviction releases it", () => {
  const h = harness(), key = [...context, 1, 2];
  h.network(page()); h.client.setQueryData(key, page()); h.stop();
  const remount = harness(h.client), bad = page(); bad.items[0].occurredAt = changed;
  expect(remount.cached(page())).toEqual(page());
  expect(() => remount.network(bad)).toThrow(ApiError);
  remount.stop(); h.client.removeQueries({ queryKey: key, exact: true });
  const fresh = harness(h.client);
  expect(() => fresh.cached(page())).toThrow(ApiError);
  // All owners and cached data ended: a new context needs new HTTP provenance.
  expect(fresh.network(bad)).toEqual(bad);
});

test("client isolation holds even with identical authenticated context keys", () => {
  const a = harness(), b = harness();
  a.network(page());
  expect(() => b.cached(page())).toThrow(ApiError);
  const independent = page(); independent.items[0].occurredAt = changed;
  b.network(independent);
  expect(a.cached(page())).toEqual(page());
  expect(b.cached(independent)).toEqual(independent);
  expect(() => a.cached(independent)).toThrow(ApiError);
});

test.each(["session", "organization", "generation", "project", "style", "pattern", "revision", "release"])(
  "new %s scope cannot inherit private provenance", (boundary) => {
    const h = harness(); h.network(page());
    const key = structuredClone(context);
    if (boundary === "session") key[0] = "actor/session-Y";
    else if (boundary === "organization") key[1] = id(20);
    else if (boundary === "generation") key[3] = 2;
    else if (boundary === "release") key[8] = id(601);
    else (key[6] as Record<string, string>)[boundary] = id(21);
    const other = harness(h.client, key);
    expect(() => other.cached(page())).toThrow(ApiError);
    expect(h.cached(page())).toEqual(page());
  },
);

test.each(["uuid", "number-kind", "timestamp", "equivalent-precision", "nanoseconds"])(
  "unknown overlapping window rejects changed %s facts", (field) => {
    const h = harness(); h.network(page());
    const candidate = page(2, 2);
    if (field === "uuid") candidate.items[0].id = id(699);
    else if (field === "number-kind") {
      candidate.items = [{ ...last, eventNumber: 1, kind: "ACTIVATED" }];
      candidate.nextMaxEventNumber = null;
    } else candidate.items[0].occurredAt = field === "timestamp" ? changed :
      field === "equivalent-precision" ? "2026-10-24T00:00:01.000Z" : "2026-10-24T00:00:01.000000001Z";
    expect(() => h.network(candidate, field === "number-kind" ? 1 : 2, 2)).toThrow(ApiError);
    expect(h.cached(page())).toEqual(page());
  },
);

test("a rejected multi-event page cannot partially install event facts or its envelope", () => {
  const h = harness(); h.network(page(1), 1);
  const rejected = page(2, 2);
  rejected.items[0].occurredAt = changed;
  rejected.items[1].occurredAt = changed;
  expect(() => h.network(rejected, 2, 2)).toThrow(ApiError);
  expect(() => h.cached(rejected, 2, 2)).toThrow(ApiError);
  expect(h.network(page(2, 2), 2, 2)).toEqual(page(2, 2));
});

test("raw cache aliases cannot mutate shared snapshots or cross-window event indexes", () => {
  const h = harness(), raw = page(); h.network(raw);
  raw.items[0].occurredAt = changed;
  expect(() => h.cached(raw)).toThrow(ApiError);
  expect(() => h.network({ ...page(2, 2), items: [raw.items[0], { ...first }] }, 2, 2)).toThrow(ApiError);
  expect(h.network(page(2, 2), 2, 2)).toEqual(page(2, 2));
});

test("FRA-02: standard window rejects known omissions and genuinely recovers", () => {
  const h = harness();
  h.network(page());
  h.network(page(1), 1);
  const omitted = { items: [{ ...last }], limit: 25, nextMaxEventNumber: null };
  expect(() => h.network(omitted, 2, 25)).toThrow(ApiError);
  expect(() => h.cached(omitted, 2, 25)).toThrow(ApiError);
  expect(h.cached(page())).toEqual(page());
  expect(h.cached(page(1), 1)).toEqual(page(1));
  expect(h.network(page(2, 25), 2, 25)).toEqual(page(2, 25));
  expect(h.cached(page(2, 25), 2, 25)).toEqual(page(2, 25));
});

test.each([
  { max: 2, limit: 25, numbers: [2, 1], next: null, accepted: true },
  { max: 2, limit: 25, numbers: [2], next: null, accepted: false },
  { max: 2, limit: 25, numbers: [1], next: null, accepted: false },
  { max: 2, limit: 25, numbers: [], next: null, accepted: false },
  { max: 2, limit: 2, numbers: [2, 1], next: null, accepted: true },
  { max: 2, limit: 2, numbers: [2], next: null, accepted: false },
  { max: 2, limit: 1, numbers: [2], next: 1, accepted: true },
  { max: 2, limit: 1, numbers: [2], next: null, accepted: false },
  { max: 2, limit: 1, numbers: [1], next: null, accepted: false },
  { max: 1, limit: 25, numbers: [1], next: null, accepted: true },
  { max: 1, limit: 1, numbers: [1], next: null, accepted: true },
])("known-event coverage max=$max limit=$limit items=$numbers next=$next", ({ max, limit, numbers, next, accepted }) => {
  const h = harness(), original = page(2, 50);
  h.network(original, 2, 50);
  const candidate = {
    items: numbers.map((n) => ({ ...(n === 1 ? first : last) })),
    limit, nextMaxEventNumber: next,
  };
  if (accepted) {
    expect(h.network(candidate, max, limit)).toEqual(candidate);
    expect(h.cached(candidate, max, limit)).toEqual(candidate);
  } else {
    expect(() => h.network(candidate, max, limit)).toThrow(ApiError);
    expect(() => h.cached(candidate, max, limit)).toThrow(ApiError);
  }
  expect(h.cached(original, 2, 50)).toEqual(original);
});

test.each([0, 2])("continuation %s cannot skip or overlap the returned full page", (next) => {
  const h = harness(); h.network(page(1), 1);
  expect(() => h.network({ ...page(), nextMaxEventNumber: next })).toThrow(ApiError);
  expect(h.network(page())).toEqual(page());
  expect(h.cached(page(1), 1)).toEqual(page(1));
});

test.each([25, 1])("new facts cannot contradict an existing window's false EOF at limit%s", (limit) => {
  const h = harness(), incomplete = { items: [{ ...last }], limit, nextMaxEventNumber: null };
  h.network(incomplete, 2, limit);
  expect(() => h.network(page(1, 25), 1, 25)).toThrow(ApiError);
  expect(() => h.cached(page(1, 25), 1, 25)).toThrow(ApiError);
  expect(h.cached(incomplete, 2, limit)).toEqual(incomplete);
  // The rejected activation was not partially indexed or installed as a page.
  expect(h.network({ ...incomplete, limit: 50 }, 2, 50)).toEqual({ ...incomplete, limit: 50 });
});

test("new higher-priority event cannot contradict a previously trusted full-page prefix", () => {
  const h = harness(), skipped = { items: [{ ...first }], limit: 1, nextMaxEventNumber: null };
  h.network(skipped, 2, 1);
  expect(() => h.network(page(2, 25), 2, 25)).toThrow(ApiError);
  expect(h.cached(skipped, 2, 1)).toEqual(skipped);
  expect(() => h.cached(page(2, 25), 2, 25)).toThrow(ApiError);
});

test("a new head above an old maximum and reachable older pages remain valid", () => {
  const h = harness(); h.network(page(1, 25), 1, 25);
  expect(h.network(page())).toEqual(page());
  expect(h.network(page(2, 25), 2, 25)).toEqual(page(2, 25));
  expect(h.network(page(1), 1)).toEqual(page(1));
  expect(h.cached(page(1, 25), 1, 25)).toEqual(page(1, 25));
});

test("a trusted first-excluded cursor prevents a later empty page hiding that event", () => {
  const h = harness(); h.network(page());
  const empty = { items: [], limit: 25, nextMaxEventNumber: null };
  expect(() => h.network(empty, 1, 25)).toThrow(ApiError);
  expect(() => h.cached(empty, 1, 25)).toThrow(ApiError);
  expect(h.cached(page())).toEqual(page());
  expect(h.network(page(1, 25), 1, 25)).toEqual(page(1, 25));
});

test("a new first-excluded cursor cannot contradict an earlier trusted empty window", () => {
  const h = harness(), empty = { items: [], limit: 25, nextMaxEventNumber: null };
  h.network(empty, 1, 25);
  expect(() => h.network(page())).toThrow(ApiError);
  expect(() => h.cached(page())).toThrow(ApiError);
  expect(h.cached(empty, 1, 25)).toEqual(empty);
  // Rejection must not install either the new event or its cursor witness.
  expect(h.network({ ...empty, limit: 2 }, 2, 2)).toEqual({ ...empty, limit: 2 });
});

test("rejected new facts leave all old windows, indexes, epoch and pending valid receipt intact", () => {
  const h = harness(), original = page(1, 25);
  h.network(original, 1, 25);
  const invalidReceipt = h.begin(2, 2), validReceipt = h.begin(2, 25);
  const omitted = { items: [{ ...last }], limit: 2, nextMaxEventNumber: null };
  expect(() => acceptEventHistoryRead(invalidReceipt, omitted)).toThrow(ApiError);
  expect(() => acceptEventHistoryRead(invalidReceipt, omitted)).toThrow(ApiError);
  expect(() => h.cached(omitted, 2, 2)).toThrow(ApiError);
  expect(h.cached(original, 1, 25)).toEqual(original);
  // A different timestamp on the previously rejected, unknown event is valid:
  // rejection must not install even that event's otherwise plausible facts.
  const complete = page(2, 25); complete.items[0].occurredAt = changed;
  expect(acceptEventHistoryRead(validReceipt, complete)).toEqual(complete);
  expect(h.network({ ...complete, limit: 2 }, 2, 2)).toEqual({ ...complete, limit: 2 });
  expect(h.cached(original, 1, 25)).toEqual(original);
  expect(() => h.network(page(2, 25), 2, 25)).toThrow(ApiError);
});

test.each(["omission-first", "complete-first"])("controlled concurrent windows cannot install inconsistent membership: %s", async (order) => {
  const h = harness(); h.network(page(1, 25), 1, 25);
  const bad = deferred<unknown>(), good = deferred<unknown>();
  const badReceipt = h.begin(2, 25), goodReceipt = h.begin(2, 2);
  const badResult = bad.promise.then((value) => acceptEventHistoryRead(badReceipt, value));
  const rejected = expect(badResult).rejects.toBeInstanceOf(ApiError);
  const goodResult = good.promise.then((value) => acceptEventHistoryRead(goodReceipt, value));
  const omitted = { items: [{ ...last }], limit: 25, nextMaxEventNumber: null };
  if (order === "omission-first") {
    bad.resolve(omitted); await rejected;
    good.resolve(page(2, 2)); await expect(goodResult).resolves.toEqual(page(2, 2));
  } else {
    good.resolve(page(2, 2)); await expect(goodResult).resolves.toEqual(page(2, 2));
    bad.resolve(omitted); await rejected;
  }
  expect(() => h.cached(omitted, 2, 25)).toThrow(ApiError);
  expect(h.cached(page(1, 25), 1, 25)).toEqual(page(1, 25));
  expect(h.cached(page(2, 2), 2, 2)).toEqual(page(2, 2));
  expect(h.network(page(2, 25), 2, 25)).toEqual(page(2, 25));
});
