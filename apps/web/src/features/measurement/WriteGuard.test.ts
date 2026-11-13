import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, test } from "vitest";
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
const dispose: (() => void)[] = [];
afterEach(() =>
  dispose
    .splice(0)
    .reverse()
    .forEach((f) => f()),
);
function setup(absent = false) {
  const client = new QueryClient(),
    c = {
      scope: "guard",
      organizationId: A,
      projectId: P,
      styleId: S,
      generation: 1,
      current: () => true,
    };
  const release = t.retainMeasurementTrust(client, c, {});
  dispose.push(() => {
    release();
    client.clear();
  });
  const receipt = (request: Parameters<typeof t.beginMeasurementRead>[2]) =>
    t.beginMeasurementRead(client, c, request, new AbortController().signal);
  t.acceptMeasurementSpec(receipt({ kind: "spec" }), absent ? null : spec(3));
  const page = {
    items: [3, 2, 1].map((n) => summary(rev(n))),
    limit: 25,
    nextMaxRevisionNumber: null,
  };
  if (!absent)
    t.acceptMeasurementHistory(
      receipt({ kind: "history", specId: MS, max: 3, limit: 25 }),
      page,
    );
  const key = () => [
    ...queryKeys.measurementRevisions(c.scope, A, P, S, 25, 3),
  ];
  const observe = (k: unknown[], data: unknown = page) => {
    const o = new QueryObserver(client, {
      queryKey: k,
      enabled: false,
      retry: false,
    });
    const off = o.subscribe(() => {});
    dispose.push(off);
    const q = o.getCurrentQuery();
    if (data !== undefined) q.setData(data);
    return { q, off };
  };
  const write = () =>
    t.requireMeasurementWrite(
      client,
      c,
      absent ? null : spec(3),
      absent ? "create" : "revision",
      absent ? null : 3,
    );
  return { client, c, page, key, observe, write };
}
const attacks: [string, (k: unknown[]) => void][] = [
  ...[NaN, Infinity, -Infinity, -1, 0, 4, 1.5, "3"].map(
    (v) =>
      [
        "max=" + String(v),
        (k: unknown[]) => {
          k[9] = v;
        },
      ] as [string, (k: unknown[]) => void],
  ),
  ...[0, 101, 1.5, "25"].map(
    (v) =>
      [
        "limit=" + String(v),
        (k: unknown[]) => {
          k[8] = v;
        },
      ] as [string, (k: unknown[]) => void],
  ),
  [
    "missing bound",
    (k) => {
      k.pop();
    },
  ],
  [
    "unknown suffix",
    (k) => {
      k.push("unsupported");
    },
  ],
  [
    "malformed recovery",
    (k) => {
      k.push("explicit-recovery", "history:2:25");
    },
  ],
  [
    "unknown family",
    (k) => {
      k[7] = "measurement-unknown";
    },
  ],
  [
    "invalid revision UUID",
    (k) => {
      k.splice(7, 3, "measurement-revision", "invalid");
    },
  ],
  [
    "extra spec suffix",
    (k) => {
      k.splice(7, 3, "measurement-spec", "unsupported");
    },
  ],
];
test.each(
  attacks.flatMap(([name, attack]) =>
    ["success", "pending", "error"].map((state) => ({ name, attack, state })),
  ),
)(
  "active $name / $state blocks final authorization without creating a failure channel",
  ({ attack, state }) => {
    const h = setup(),
      k = h.key();
    attack(k);
    const { q, off } = h.observe(k);
    q.setState({ status: state as "success" | "pending" | "error" });
    expect(() => h.write()).toThrow();
    expect(t.measurementEditingAllowed(h.client, h.c, spec(3))).toBe(false);
    expect(t.measurementRecoveries(h.client, h.c).total).toBe(0);
    off();
    expect(() => h.write()).not.toThrow();
  },
);
test.each(["namespace", "hash", "length"])(
  "actual declared observer cannot evade final guard by mutating %s",
  (attack) => {
    const h = setup(),
      k = h.key(),
      { q, off } = h.observe(k),
      owner = {};
    const unbind = t.retainMeasurementReader(
      h.client,
      h.c,
      owner,
      [...k],
      () => q,
    );
    dispose.push(unbind);
    if (attack === "namespace") {
      k[2] = B;
      k[7] = "other";
      q.queryHash = "other";
    } else if (attack === "hash") q.queryHash = "unsupported";
    else k.length = 0;
    expect(() => h.write()).toThrow();
    off();
    // A reader's declaration must end with its lifecycle, not merely lose its
    // Query observers. Otherwise a stale declaration could hide a replacement.
    expect(() => h.write()).toThrow();
    unbind();
    expect(() => h.write()).not.toThrow();
  },
);
test("unresolved reader blocks until its own declaration is cleaned up", () => {
  const h = setup();
  const unbind = t.retainMeasurementReader(h.client, h.c, {}, h.key(), () => undefined);
  dispose.push(unbind);
  expect(() => h.write()).toThrow();
  expect(t.measurementRecoveries(h.client, h.c).total).toBe(0);
  unbind();
  expect(() => h.write()).not.toThrow();
});
test("old reader cleanup cannot delete its owner's replacement declaration", () => {
  const h = setup(), owner = {}, { q, off } = h.observe(h.key());
  const old = t.retainMeasurementReader(h.client, h.c, owner, h.key(), () => undefined);
  const current = t.retainMeasurementReader(h.client, h.c, owner, h.key(), () => q);
  dispose.push(current);
  old();
  expect(() => h.write()).not.toThrow();
  off();
  expect(() => h.write()).toThrow();
  old();
  expect(() => h.write()).toThrow();
  current();
  expect(() => h.write()).not.toThrow();
});
test.each([
  "inactive",
  "foreign organization",
  "foreign project",
  "foreign style",
  "unrelated",
])("$s cache query cannot poison an unrelated authorized write", (kind) => {
  const h = setup(),
    k = h.key();
  k[9] = NaN;
  if (kind === "foreign organization") k[2] = B;
  if (kind === "foreign project") k[4] = B;
  if (kind === "foreign style") k[6] = B;
  if (kind === "unrelated") k[7] = "pattern";
  if (kind === "inactive")
    h.client
      .getQueryCache()
      .build(h.client, { queryKey: k })
      .setState({ data: {}, status: "success" });
  else h.observe(k, {});
  expect(() => h.write()).not.toThrow();
});
test.each(
  [[], ["explicit-history-request"], ["explicit-recovery", "history:3:25"]].map(
    (suffix) => ({ suffix }),
  ),
)(
  "valid authenticated supported history variant $suffix permits write",
  ({ suffix }) => {
    const h = setup();
    h.observe([...h.key(), ...suffix]);
    expect(() => h.write()).not.toThrow();
  },
);
test("malformed active query also blocks authenticated absence creation and recovers after observer removal", () => {
  const h = setup(true),
    k = h.key();
  k[9] = NaN;
  const { off } = h.observe(k, {});
  expect(() => h.write()).toThrow();
  off();
  expect(() => h.write()).not.toThrow();
});
test("active valid-shaped unproven and contradictory raw data are both rejected synchronously", () => {
  const h = setup(),
    { q, off } = h.observe(h.key());
  q.setState({
    data: {
      ...h.page,
      items: h.page.items.map((x) => ({ ...x, baseSize: "POISON" })),
    },
  });
  expect(() => h.write()).toThrow();
  off();
  // A genuine accepted response recovers this channel, never cache contents alone.
  t.acceptMeasurementHistory(
    t.beginMeasurementRead(
      h.client,
      h.c,
      { kind: "history", specId: MS, max: 3, limit: 25 },
      new AbortController().signal,
    ),
    h.page,
  );
  expect(() => h.write()).not.toThrow();
});

test("valid-shaped active pending window without authenticated facts also blocks until safely removed", () => {
  const h = setup(),
    observer = new QueryObserver(h.client, {
      queryKey: queryKeys.measurementRevisions(h.c.scope, A, P, S, 1, 2),
      enabled: false,
    });
  const off = observer.subscribe(() => {});
  dispose.push(off);
  expect(() => h.write()).toThrow();
  off();
  expect(() => h.write()).not.toThrow();
});
