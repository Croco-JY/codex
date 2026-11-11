import { StrictMode } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import App from "../../App";
import { endSession, setLocalSubject } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  fixture,
  A,
  B,
  P,
  S,
  MS,
  rev,
  spec,
  summary,
  root,
  route,
  response,
  deferred,
} from "../../test/measurementFixture";
import type { Page, Revision } from "./model";
import * as trust from "./measurementTrust";
const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => {
  cleanup();
  endSession();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(strict = false) {
  const h = fixture();
  clients.push(h.cache);
  h.specs.set(A, spec(3));
  h.specs.set(B, spec(1, B));
  [1, 2, 3].forEach((n) => h.revisions.set(rev(n).id, rev(n)));
  if (strict)
    render(
      <StrictMode>
        <QueryClientProvider client={h.cache}>
          <MemoryRouter initialEntries={[route()]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  else h.mount();
  return h;
}
const sk = (h: ReturnType<typeof fixture>) =>
  queryKeys.measurementSpec(h.scope, A, P, S);
const hk = (h: ReturnType<typeof fixture>, max = 3) =>
  queryKeys.measurementRevisions(h.scope, A, P, S, 25, max);
const rk = (h: ReturnType<typeof fixture>, n = 1) =>
  queryKeys.measurementRevision(h.scope, A, P, S, rev(n).id);
const path = root() + "/measurement-spec",
  historyPath = path + "/revisions";
async function ready() {
  await screen.findByRole("heading", { name: "Measurements", level: 1 });
  await screen.findByRole("heading", { name: "Measurement Spec", level: 2 });
  await screen.findByRole("heading", { name: "Latest revision 3" });
  await screen.findByRole("button", { name: "Open revision 1" });
}
async function draft() {
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "73.4567");
}
async function read(h: ReturnType<typeof fixture>, key: readonly unknown[]) {
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key, exact: true });
  });
}
async function failHistory(h: ReturnType<typeof fixture>) {
  const good = structuredClone(h.cache.getQueryData<Page>(hk(h))!);
  h.overrides.set("GET " + historyPath, () => {
    const bad = structuredClone(good);
    bad.items[0].baseSize = "BAD-HISTORY";
    return response(bad);
  });
  await read(h, hk(h));
  await act(async () => {
    h.cache.setQueryData(hk(h), good);
  });
  h.overrides.delete("GET " + historyPath);
}
async function failExact(h: ReturnType<typeof fixture>) {
  const bad = rev();
  bad.points[0].value = "999.9999";
  h.overrides.set("GET " + historyPath + "/" + rev().id, () => response(bad));
  await read(h, rk(h));
  await act(async () => {
    h.cache.setQueryData(rk(h), rev());
  });
  h.overrides.delete("GET " + historyPath + "/" + rev().id);
}
async function advance(h: ReturnType<typeof fixture>, n = 4) {
  h.specs.set(A, spec(n));
  for (let i = 1; i <= n; i++) h.revisions.set(rev(i).id, rev(i));
  await read(h, sk(h));
  await screen.findByRole("heading", { name: "Latest revision " + n });
  await screen.findByRole("button", { name: "Open revision " + n });
}
const oldRetry = () =>
  screen.getByRole("button", {
    name: "Reload failed history window through revision 3 (25 per page)",
  });
const historyReads = (h: ReturnType<typeof fixture>, max: number) =>
  h
    .measurementReads()
    .filter(
      (r) =>
        new URL(r.url).pathname === historyPath &&
        new URL(r.url).searchParams.get("maxRevisionNumber") === String(max),
    );
function context(h: ReturnType<typeof fixture>) {
  return Array.from({ length: 100 }, (_, generation) => ({
    scope: h.scope,
    organizationId: A,
    projectId: P,
    styleId: S,
    generation,
    current: () => true,
  })).find((c) => trust.measurementTrustVersion(h.cache, c) > 0)!;
}
function unchanged(h: ReturnType<typeof fixture>) {
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("73.4567");
  expect(screen.getByText("Draft baseline revision: 3")).toBeVisible();
  expect(h.writes()).toHaveLength(0);
  expect(h.calls.filter((r) => r.url.includes("/content"))).toHaveLength(0);
}
test.each([false, true])(
  "head advancement retains an exact explicit history retry and stale draft, strict=%s",
  async (strict) => {
    const h = setup(strict);
    await ready();
    await draft();
    await failHistory(h);
    const before = historyReads(h, 3).length;
    await advance(h);
    expect(historyReads(h, 3)).toHaveLength(before);
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeDisabled();
    unchanged(h);
    await userEvent.click(oldRetry());
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Revision snapshot" }),
      ).toBeEnabled(),
    );
    expect(historyReads(h, 3)).toHaveLength(before + 1);
    expect(
      new URL(historyReads(h, 3).at(-1)!.url).searchParams.get("limit"),
    ).toBe("25");
    unchanged(h);
    expect(
      screen.getByRole("button", { name: "Create revision" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("heading", {
        name: "Review authoritative measurements before submitting again",
      }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Reconcile draft with latest revision",
      }),
    );
    expect(screen.getByText("Draft baseline revision: 4")).toBeVisible();
    expect(screen.getByLabelText("Value · POM 1")).toHaveValue("73.4567");
    expect(h.writes()).toHaveLength(0);
    await userEvent.click(
      screen.getByRole("button", { name: "Create revision" }),
    );
    await screen.findByRole("heading", { name: "Latest revision 5" });
    expect(h.writes()).toHaveLength(1);
    expect(
      (await h.writes()[0].clone().json()).expectedLatestRevisionNumber,
    ).toBe(4);
  },
);
test("failed retry and canonical Query eviction keep the same actionable window and immutable baseline", async () => {
  const h = setup();
  await ready();
  await draft();
  await failHistory(h);
  await advance(h);
  await act(async () =>
    h.cache.removeQueries({ queryKey: hk(h), exact: true }),
  );
  const before = historyReads(h, 3).length;
  expect(oldRetry()).toBeEnabled();
  expect(historyReads(h, 3)).toHaveLength(before);
  h.overrides.set("GET " + historyPath, () => {
    const bad: {
      items: ReturnType<typeof rev>[];
      limit: number;
      nextMaxRevisionNumber: null;
    } = { items: [], limit: 25, nextMaxRevisionNumber: null };
    return response(bad);
  });
  await userEvent.click(oldRetry());
  await screen.findByRole("heading", { name: "Measurement recovery failed" });
  expect(oldRetry()).toBeEnabled();
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  unchanged(h);
  h.overrides.delete("GET " + historyPath);
  await userEvent.click(oldRetry());
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  expect(
    h.cache.getQueryData<Page>(hk(h))?.items.map((x) => x.revisionNumber),
  ).toEqual([3, 2, 1]);
  unchanged(h);
});
test("history recovery, refresh cursor/selection reset and hidden exact recovery are independently reachable", async () => {
  const h = setup();
  await ready();
  await draft();
  await userEvent.click(
    screen.getByRole("button", { name: "Open revision 1" }),
  );
  await screen.findByRole("region", { name: "Selected revision 1" });
  await failExact(h);
  await failHistory(h);
  await advance(h);
  await userEvent.click(oldRetry());
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: /Reload failed history window through revision 3/,
      }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  unchanged(h);
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh measurement comparison" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Reload failed exact revision " + rev().id,
      }),
    ).toBeEnabled(),
  );
  const before = h.measurementReads().length;
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reload failed exact revision " + rev().id,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  expect(h.measurementReads()).toHaveLength(before + 1);
  unchanged(h);
  expect(
    screen.getByRole("button", { name: "Create revision" }),
  ).toBeDisabled();
});
test.each([false, true])(
  "two failed history windows recover independently in either order, reverse=%s",
  async (reverse) => {
    const h = setup();
    await ready();
    await draft();
    await failHistory(h);
    await advance(h);
    const c = context(h);
    await act(async () =>
      trust.rejectMeasurementRead(
        trust.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max: 2, limit: 25 },
          new AbortController().signal,
        ),
      ),
    );
    const buttons = reverse
      ? [
          "Reload failed history window through revision 2 (25 per page)",
          "Reload failed history window through revision 3 (25 per page)",
        ]
      : [
          "Reload failed history window through revision 3 (25 per page)",
          "Reload failed history window through revision 2 (25 per page)",
        ];
    await userEvent.click(screen.getByRole("button", { name: buttons[0] }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: buttons[0] })).toBeNull(),
    );
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeDisabled();
    unchanged(h);
    await userEvent.click(screen.getByRole("button", { name: buttons[1] }));
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Revision snapshot" }),
      ).toBeEnabled(),
    );
    unchanged(h);
  },
);
test("at most eight disabled recovery observers are live and every failure page is reachable without prefetch", async () => {
  const h = setup();
  await ready();
  await advance(h, 40);
  const c = context(h),
    before = h.measurementReads().length;
  await act(async () => {
    for (let max = 1; max <= 35; max++)
      trust.rejectMeasurementRead(
        trust.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max, limit: 25 },
          new AbortController().signal,
        ),
      );
  });
  expect(h.measurementReads()).toHaveLength(before);
  for (let page = 0; page < 5; page++) {
    const active = h.cache
      .getQueryCache()
      .getAll()
      .filter(
        (q) =>
          q.queryKey.includes("explicit-recovery") && q.getObserversCount(),
      );
    expect(active.length).toBeLessThanOrEqual(8);
    if (page < 4)
      await userEvent.click(
        screen.getByRole("button", { name: "More recovery requests" }),
      );
  }
  expect(
    screen.getByRole("button", { name: "More recovery requests" }),
  ).toBeDisabled();
  expect(h.measurementReads()).toHaveLength(before);
  for (let page = 0; page < 4; page++)
    await userEvent.click(
      screen.getByRole("button", { name: "Previous recovery requests" }),
    );
  expect(h.measurementReads()).toHaveLength(before);
  expect(h.writes()).toHaveLength(0);
});
test.each(["actor", "organization", "ABA"] as const)(
  "late recovery and stale callbacks cannot update the replacement %s workspace",
  async (boundary) => {
    const h = setup();
    await ready();
    await draft();
    await failHistory(h);
    await advance(h);
    const pending = deferred<Response>();
    h.overrides.set("GET " + historyPath, () => {
      h.overrides.delete("GET " + historyPath);
      return pending.promise;
    });
    const oldButton = oldRetry();
    await userEvent.click(oldButton);
    if (boundary === "actor")
      await act(async () => setLocalSubject("RECOVERY-ACTOR-B"));
    else {
      await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
      await screen.findByRole("heading", { name: "Latest revision 1" });
      if (boundary === "ABA") {
        h.overrides.delete("GET " + historyPath);
        await userEvent.click(screen.getByRole("button", { name: "Enter A" }));
      }
    }
    await screen.findByRole("heading", {
      name: "Latest revision " + (boundary === "organization" ? 1 : 4),
    });
    h.overrides.delete("GET " + historyPath);
    await act(async () =>
      pending.resolve(
        response({ items: [], limit: 25, nextMaxRevisionNumber: null }),
      ),
    );
    const reads = h.measurementReads().length;
    await act(async () => oldButton.click());
    expect(h.measurementReads()).toHaveLength(reads);
    expect(h.writes()).toHaveLength(0);
    expect(
      screen.queryByRole("form", { name: "Measurement draft" }),
    ).toBeNull();
    expect(document.body).not.toHaveTextContent("73.4567");
  },
);

test("changing exact revision selection retains an idle exact recovery for the previous revision", async () => {
  const h = setup();
  await ready();
  await draft();
  await userEvent.click(
    screen.getByRole("button", { name: "Open revision 1" }),
  );
  await screen.findByRole("region", { name: "Selected revision 1" });
  await failExact(h);
  const before = h
    .measurementReads()
    .filter(
      (r) => new URL(r.url).pathname === historyPath + "/" + rev().id,
    ).length;
  await userEvent.click(
    screen.getByRole("button", { name: "Open revision 2" }),
  );
  await screen.findByRole("region", { name: "Selected revision 2" });
  expect(
    h
      .measurementReads()
      .filter((r) => new URL(r.url).pathname === historyPath + "/" + rev().id),
  ).toHaveLength(before);
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reload failed exact revision " + rev().id,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  unchanged(h);
  expect(screen.getByRole("button", { name: "Create revision" })).toBeEnabled();
});
test("removing a recovery Query aborts its receipt without erasing the obligation or retry path", async () => {
  const h = setup();
  await ready();
  await draft();
  await failHistory(h);
  await advance(h);
  const pending = deferred<Response>();
  h.overrides.set("GET " + historyPath, () => {
    h.overrides.delete("GET " + historyPath);
    return pending.promise;
  });
  await userEvent.click(oldRetry());
  const request = historyReads(h, 3).at(-1)!;
  await act(async () =>
    h.cache.removeQueries({
      predicate: (q) => q.queryKey.includes("explicit-recovery"),
    }),
  );
  expect(request.signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve(
      response({
        items: [3, 2, 1].map((n) => summary(rev(n))),
        limit: 25,
        nextMaxRevisionNumber: null,
      }),
    ),
  );
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  expect(oldRetry()).toBeEnabled();
  unchanged(h);
  await userEvent.click(oldRetry());
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  unchanged(h);
});
test.each([false, true])(
  "overlapping window retries clear only their own slot in either order, reverse=%s",
  async (reverse) => {
    const h = setup();
    await ready();
    await draft();
    await failHistory(h);
    await advance(h);
    const c = context(h);
    await act(async () =>
      trust.rejectMeasurementRead(
        trust.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max: 2, limit: 25 },
          new AbortController().signal,
        ),
      ),
    );
    const d2 = deferred<Response>(),
      d3 = deferred<Response>();
    h.overrides.set("GET " + historyPath, (r) =>
      new URL(r.url).searchParams.get("maxRevisionNumber") === "2"
        ? d2.promise
        : d3.promise,
    );
    await userEvent.click(oldRetry());
    await userEvent.click(
      screen.getByRole("button", {
        name: "Reload failed history window through revision 2 (25 per page)",
      }),
    );
    expect(screen.getAllByText(/Recovery in progress for/)).toHaveLength(2);
    const order = reverse ? [2, 3] : [3, 2];
    for (const n of order) {
      await act(async () => {
        (n === 2 ? d2 : d3).resolve(
          response({
            items: Array.from({ length: n }, (_, i) => summary(rev(n - i))),
            limit: 25,
            nextMaxRevisionNumber: null,
          }),
        );
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("button", {
            name: `Reload failed history window through revision ${n} (25 per page)`,
          }),
        ).toBeNull(),
      );
      if (n === order[0])
        expect(
          screen.getByRole("group", { name: "Revision snapshot" }),
        ).toBeDisabled();
      unchanged(h);
    }
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Revision snapshot" }),
      ).toBeEnabled(),
    );
    unchanged(h);
  },
);
