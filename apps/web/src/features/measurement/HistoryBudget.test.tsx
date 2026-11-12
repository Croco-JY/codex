import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
  fixture,
  A,
  P,
  S,
  MS,
  rev,
  spec,
  summary,
  root,
  deferred,
  response,
} from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
import { endSession } from "../../api/session";
import * as t from "./measurementTrust";
const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => {
  cleanup();
  endSession();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const hp = root() + "/measurement-spec/revisions";
const page = (max: number, limit = 25) => ({
  items: Array.from({ length: Math.min(max, limit) }, (_, i) =>
    summary(rev(max - i)),
  ),
  limit,
  nextMaxRevisionNumber: max > limit ? max - limit : null,
});
function context(h: ReturnType<typeof fixture>) {
  return Array.from({ length: 100 }, (_, generation) => ({
    scope: h.scope,
    organizationId: A,
    projectId: P,
    styleId: S,
    generation,
    current: () => true,
  })).find((c) => t.measurementTrustVersion(h.cache, c) > 0)!;
}
async function set(label: string, value: string) {
  await userEvent.clear(screen.getByLabelText(label));
  await userEvent.type(screen.getByLabelText(label), value);
}
async function setup(n = 1) {
  const h = fixture();
  clients.push(h.cache);
  h.specs.set(A, spec(n));
  for (let i = 1; i <= n; i++) h.revisions.set(rev(i).id, rev(i));
  h.mount();
  await screen.findByRole("button", { name: "Open revision " + n });
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await set("Value · POM 1", "87.6543");
  await set("Notes · POM 1", "BUDGET-DRAFT");
  return h;
}
const snapshot = () =>
  Array.from(
    screen
      .getByRole("form", { name: "Measurement draft" })
      .querySelectorAll("input,textarea,select"),
  ).map((x) => ({
    name: (x as HTMLInputElement).name,
    value: (x as HTMLInputElement).value,
  }));
async function force() {
  await act(async () => {
    screen
      .getByRole("form", { name: "Measurement draft" })
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
test("original 256 actual typed cancellations now allow authenticated history 258 without losing the baseline1 draft", async () => {
  const h = await setup(),
    c = context(h),
    draft = snapshot(),
    pending = deferred<void>();
  h.overrides.set("GET " + hp, (r) => {
    const max = Number(new URL(r.url).searchParams.get("maxRevisionNumber"));
    return pending.promise.then(() => response(page(max)));
  });
  for (let n = 2; n <= 258; n++) {
    h.specs.set(A, spec(n));
    h.revisions.set(rev(n).id, rev(n));
    await act(async () => {
      await h.cache.refetchQueries({
        queryKey: queryKeys.measurementSpec(h.scope, A, P, S),
        exact: true,
      });
    });
    await waitFor(() =>
      expect(
        h
          .measurementReads()
          .some(
            (r) =>
              new URL(r.url).searchParams.get("maxRevisionNumber") ===
              String(n),
          ),
      ).toBe(true),
    );
  }
  const cancelled = h
    .measurementReads()
    .filter(
      (r) =>
        new URL(r.url).pathname === hp &&
        Number(new URL(r.url).searchParams.get("maxRevisionNumber")) >= 2 &&
        Number(new URL(r.url).searchParams.get("maxRevisionNumber")) <= 257,
    );
  expect(cancelled).toHaveLength(256);
  expect(cancelled.every((r) => r.signal.aborted)).toBe(true);
  expect(t.measurementRecoveries(h.cache, c).total).toBe(0);
  expect(snapshot()).toEqual(draft);
  expect(screen.getByText("Draft baseline revision: 1")).toBeVisible();
  await force();
  expect(h.writes()).toHaveLength(0);
  await act(async () => pending.resolve());
  await screen.findByRole("button", { name: "Open revision 258" });
  expect(snapshot()).toEqual(draft);
  expect(screen.getByText("Draft baseline revision: 1")).toBeVisible();
  await force();
  expect(h.writes()).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reconcile draft with latest revision",
    }),
  );
  expect(snapshot()).toEqual(draft);
  expect(screen.getByText("Draft baseline revision: 258")).toBeVisible();
  expect(h.writes()).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Create revision" }),
  );
  await screen.findByRole("heading", { name: "Latest revision 259" });
  expect(h.writes()).toHaveLength(1);
  const body = await h.writes()[0].clone().json();
  expect(body.points[0].value).toBe("87.6543");
  expect(body.points[0].notes).toBe("BUDGET-DRAFT");
  expect(body.expectedLatestRevisionNumber).toBe(258);
}, 120000);
test("all256 protected obligations have paginated retries; one retry admits257 without clearing other failures or malformed active blocker", async () => {
  const h = await setup(400),
    c = context(h),
    draft = snapshot();
  await act(async () => {
    for (let max = 1; max <= 256; max++) {
      const k = queryKeys.measurementRevisions(h.scope, A, P, S, 1, max);
      h.cache.setQueryData(k, page(max, 1));
      const a = new AbortController(),
        r = t.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max, limit: 1 },
          a.signal,
        );
      t.runMeasurementHistoryRequest(r, async () => page(max, 1));
      a.abort();
      t.rejectMeasurementRead(r);
    }
    h.cache.setQueryData(
      queryKeys.measurementRevisions(h.scope, A, P, S, 25, 257),
      page(257),
    );
  });
  expect(t.measurementRecoveries(h.cache, c).total).toBe(257);
  // The arbitrary cache entry is not a new authorized attempt. Choosing bounds
  // separately creates a typed read, whose capacity failure occurs before HTTP.
  while (
    !screen.queryByRole("button", { name: "Request authoritative history" })
  )
    await userEvent.click(
      screen.getByRole("button", { name: "More recovery requests" }),
    );
  await userEvent.click(
    screen.getByRole("button", { name: "Request authoritative history" }),
  );
  await set("Historical maximum", "257");
  await userEvent.click(
    screen.getByRole("button", { name: "Choose history request" }),
  );
  const count = h.measurementReads().length;
  await userEvent.click(
    screen.getByRole("button", { name: "Load selected history window" }),
  );
  await screen.findByText(/bounded history request capacity is occupied/);
  expect(h.measurementReads()).toHaveLength(count);
  expect(t.measurementRecoveries(h.cache, c).total).toBe(257);
  expect(
    t
      .measurementRecoveries(h.cache, c, 256, 8)
      .items.some((d) => d.networkFailure),
  ).toBe(false);
  expect(snapshot()).toEqual(draft);
  await force();
  expect(h.writes()).toHaveLength(0);
  while (
    screen.queryByRole("button", { name: "Previous recovery requests" }) &&
    !screen
      .getByRole("button", { name: "Previous recovery requests" })
      .hasAttribute("disabled")
  )
    await userEvent.click(
      screen.getByRole("button", { name: "Previous recovery requests" }),
    );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reload failed history window through revision 1 (1 per page)",
    }),
  );
  await waitFor(() =>
    expect(
      t.measurementRecoveryRequired(h.cache, c, {
        kind: "history",
        max: 1,
        limit: 1,
      }),
    ).toBe(false),
  );
  expect(
    t.measurementRecoveryRequired(h.cache, c, {
      kind: "history",
      max: 2,
      limit: 1,
    }),
  ).toBe(true);
  const bad = new QueryObserver(h.cache, {
    queryKey: queryKeys.measurementRevisions(h.scope, A, P, S, 25, NaN),
    enabled: false,
  });
  const off = bad.subscribe(() => {});
  try {
    await userEvent.click(
      screen.getByRole("button", { name: "Load selected history window" }),
    );
    await waitFor(() =>
      expect(
        t.measurementRecoveryRequired(h.cache, c, {
          kind: "history",
          max: 257,
          limit: 25,
        }),
      ).toBe(false),
    );
    expect(snapshot()).toEqual(draft);
    expect(t.measurementRecoveries(h.cache, c).total).toBe(255);
    expect(() =>
      t.requireMeasurementWrite(h.cache, c, spec(400), "revision", 400),
    ).toThrow();
    await force();
    expect(h.writes()).toHaveLength(0);
  } finally {
    off();
  }
}, 30000);

test("closed workflow still exposes exact existing retries when all256 slots protect failures and the new head is locally capacity-rejected", async () => {
  const h = await setup(400),
    c = context(h),
    draft = snapshot();
  await act(async () => {
    for (let max = 1; max <= 256; max++) {
      h.cache.setQueryData(
        queryKeys.measurementRevisions(h.scope, A, P, S, 1, max),
        page(max, 1),
      );
      const a = new AbortController(),
        r = t.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max, limit: 1 },
          a.signal,
        );
      t.runMeasurementHistoryRequest(r, async () => page(max, 1));
      a.abort();
      t.rejectMeasurementRead(r);
    }
  });
  expect(t.measurementRecoveries(h.cache, c).total).toBe(256);
  expect(
    screen.queryByRole("button", { name: "Request authoritative history" }),
  ).toBeNull();
  const before = h.measurementReads().length;
  h.specs.set(A, spec(401));
  h.revisions.set(rev(401).id, rev(401));
  await act(async () => {
    await h.cache.refetchQueries({
      queryKey: queryKeys.measurementSpec(h.scope, A, P, S),
      exact: true,
    });
  });
  await screen.findByText(/bounded history request capacity is occupied/);
  expect(h.measurementReads()).toHaveLength(before + 1);
  expect(t.measurementRecoveries(h.cache, c).total).toBe(256);
  expect(snapshot()).toEqual(draft);
  expect(screen.getByText("Draft baseline revision: 400")).toBeVisible();
  const retry = screen.getByRole("button", {
    name: "Reload failed history window through revision 1 (1 per page)",
  });
  expect(retry).toBeEnabled();
  await userEvent.click(retry);
  await waitFor(() =>
    expect(
      t.measurementRecoveryRequired(h.cache, c, {
        kind: "history",
        max: 1,
        limit: 1,
      }),
    ).toBe(false),
  );
  await userEvent.click(
    within(
      screen.getByRole("region", { name: "Measurement revision history" }),
    ).getByRole("button", { name: "Try again" }),
  );
  await screen.findByRole("button", { name: "Open revision 401" });
  expect(t.measurementRecoveries(h.cache, c).total).toBe(255);
  expect(snapshot()).toEqual(draft);
  expect(screen.getByText("Draft baseline revision: 400")).toBeVisible();
  await force();
  expect(h.writes()).toHaveLength(0);
}, 30000);
