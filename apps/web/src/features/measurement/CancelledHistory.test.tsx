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
import * as t from "./measurementTrust";
const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => {
  cleanup();
  endSession();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const path = root() + "/measurement-spec",
  hp = path + "/revisions";
const sk = (h: ReturnType<typeof fixture>) =>
    queryKeys.measurementSpec(h.scope, A, P, S),
  hk = (h: ReturnType<typeof fixture>, max = 3, limit = 25) =>
    queryKeys.measurementRevisions(h.scope, A, P, S, limit, max);
const page = (max = 3, limit = 25) => ({
  items: Array.from({ length: Math.min(max, limit) }, (_, i) =>
    summary(rev(max - i)),
  ),
  limit,
  nextMaxRevisionNumber: max > limit ? max - limit : null,
});
function setup(n = 3) {
  const h = fixture();
  clients.push(h.cache);
  h.specs.set(A, spec(n));
  h.specs.set(B, spec(1, B));
  for (let i = 1; i <= n; i++) h.revisions.set(rev(i).id, rev(i));
  return h;
}
async function read(h: ReturnType<typeof fixture>, key: readonly unknown[]) {
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key, exact: true });
  });
}
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
async function draft() {
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "81.2345");
  await userEvent.clear(screen.getByLabelText("Notes · POM 1"));
  await userEvent.type(
    screen.getByLabelText("Notes · POM 1"),
    "IA04-RETAINED-DRAFT",
  );
}
async function advance(h: ReturnType<typeof fixture>, n: number) {
  h.specs.set(A, spec(n));
  h.specs.set(B, spec(1, B));
  h.revisions.set(rev(n).id, rev(n));
  await read(h, sk(h));
  await screen.findByRole("heading", { name: "Latest revision " + n });
}
const retry = (n: number) =>
  screen.getByRole("button", {
    name: `Reload failed history window through revision ${n} (25 per page)`,
  });
async function force() {
  await act(async () => {
    screen
      .getByRole("form", { name: "Measurement draft" })
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function preserved(h: ReturnType<typeof fixture>, n: number) {
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("81.2345");
  expect(screen.getByLabelText("Notes · POM 1")).toHaveValue(
    "IA04-RETAINED-DRAFT",
  );
  expect(screen.getByText("Draft baseline revision: " + n)).toBeVisible();
  expect(h.writes()).toHaveLength(0);
}
const historyReads = (h: ReturnType<typeof fixture>, max: number) =>
  h
    .measurementReads()
    .filter(
      (r) =>
        new URL(r.url).searchParams.get("maxRevisionNumber") === String(max),
    );
test.each([false, true])(
  "cancelled first window remains explicitly recoverable after head advance, StrictMode=%s",
  async (strict) => {
    const h = setup(),
      pending = deferred<Response>();
    h.cache.setQueryData(hk(h), page());
    h.overrides.set("GET " + hp, (r) =>
      new URL(r.url).searchParams.get("maxRevisionNumber") === "3"
        ? pending.promise
        : response(page(4)),
    );
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
    await screen.findByRole("heading", { name: "Latest revision 3" });
    await waitFor(() => expect(historyReads(h, 3)).toHaveLength(1));
    const original = historyReads(h, 3)[0];
    await advance(h, 4);
    await screen.findByRole("button", { name: "Open revision 4" });
    await waitFor(() => expect(original.signal.aborted).toBe(true));
    await act(async () => pending.resolve(response(page())));
    const c = context(h),
      d = t.measurementRecoveries(h.cache, c).items[0];
    expect(d.cacheFailure).toBe(true);
    expect(d.networkFailure).toBe(false);
    expect(d.request).toMatchObject({ kind: "history", max: 3, limit: 25 });
    expect(retry(3)).toBeEnabled();
    expect(historyReads(h, 3)).toHaveLength(1);
    expect(h.writes()).toHaveLength(0);
    h.overrides.clear();
    await userEvent.click(retry(3));
    await waitFor(() =>
      expect(t.measurementRecoveryRequired(h.cache, c)).toBe(false),
    );
    expect(historyReads(h, 3)).toHaveLength(2);
    expect(new URL(historyReads(h, 3)[1].url).searchParams.get("limit")).toBe(
      "25",
    );
    expect(h.writes()).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Open revision 4" }),
    ).toBeEnabled();
  },
);
test("retained draft cursor5 survives head31, eviction, independent failure and exact recovery before explicit reconciliation", async () => {
  const h = setup(30);
  h.mount();
  await screen.findByRole("button", { name: "Open revision 6" });
  await draft();
  await act(async () => h.cache.setQueryData(hk(h, 5), page(5)));
  await userEvent.click(
    screen.getByRole("button", { name: "Older revisions" }),
  );
  const pending = deferred<Response>();
  h.overrides.set("GET " + hp, (r) =>
    new URL(r.url).searchParams.get("maxRevisionNumber") === "5"
      ? pending.promise
      : response(page(31)),
  );
  await userEvent.click(
    within(
      screen.getByRole("region", { name: "Measurement revision history" }),
    ).getByRole("button", { name: /Try again|Reload/ }),
  );
  await waitFor(() => expect(historyReads(h, 5).length).toBeGreaterThan(0));
  const old = historyReads(h, 5).at(-1)!;
  await advance(h, 31);
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh measurement comparison" }),
  );
  await screen.findByRole("button", { name: "Open revision 31" });
  await waitFor(() => expect(old.signal.aborted).toBe(true));
  await act(async () => pending.resolve(response(page(5))));
  const c = context(h);
  await act(async () => {
    h.cache.removeQueries({ queryKey: hk(h, 5), exact: true });
    t.rejectMeasurementRead(
      t.beginMeasurementRead(
        h.cache,
        c,
        { kind: "history", specId: MS, max: 4, limit: 25 },
        new AbortController().signal,
      ),
    );
  });
  const before = historyReads(h, 5).length;
  expect(retry(5)).toBeEnabled();
  preserved(h, 30);
  await force();
  preserved(h, 30);
  expect(historyReads(h, 5)).toHaveLength(before);
  h.overrides.clear();
  await userEvent.click(retry(5));
  await waitFor(() =>
    expect(
      t.measurementRecoveryRequired(h.cache, c, {
        kind: "history",
        max: 5,
        limit: 25,
      }),
    ).toBe(false),
  );
  expect(historyReads(h, 5)).toHaveLength(before + 1);
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  preserved(h, 30);
  await userEvent.click(retry(4));
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  preserved(h, 30);
  expect(
    screen.getByRole("button", { name: "Create revision" }),
  ).toBeDisabled();
  await force();
  preserved(h, 30);
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reconcile draft with latest revision",
    }),
  );
  expect(screen.getByText("Draft baseline revision: 31")).toBeVisible();
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("81.2345");
  expect(h.writes()).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Create revision" }),
  );
  await screen.findByRole("heading", { name: "Latest revision 32" });
  expect(h.writes()).toHaveLength(1);
  expect(
    (await h.writes()[0].clone().json()).expectedLatestRevisionNumber,
  ).toBe(31);
});
test("cache-only injected window has no retry capability; user-selected authenticated read provides an attainable prerequisite", async () => {
  const h = setup();
  h.mount();
  await screen.findByRole("button", { name: "Open revision 1" });
  await draft();
  await act(async () => h.cache.setQueryData(hk(h, 2), page(2)));
  const c = context(h),
    before = h.measurementReads().length;
  expect(t.measurementRecoveries(h.cache, c).items[0].request).toBeUndefined();
  expect(
    screen.queryByRole("button", {
      name: /Reload failed history window through revision 2/,
    }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Request authoritative history" }),
  );
  await userEvent.clear(screen.getByLabelText("Historical maximum"));
  await userEvent.type(screen.getByLabelText("Historical maximum"), "2");
  await userEvent.click(
    screen.getByRole("button", { name: "Choose history request" }),
  );
  expect(h.measurementReads()).toHaveLength(before);
  expect(t.measurementRecoveries(h.cache, c).items[0].request).toBeUndefined();
  await force();
  preserved(h, 3);
  const pending = deferred<Response>();
  h.overrides.set("GET " + hp, () => pending.promise);
  await userEvent.click(
    screen.getByRole("button", { name: "Load selected history window" }),
  );
  await waitFor(() => expect(historyReads(h, 2)).toHaveLength(1));
  expect(t.measurementRecoveries(h.cache, c).items[0].request).toMatchObject({
    max: 2,
    limit: 25,
  });
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  await force();
  preserved(h, 3);
  await act(async () => pending.resolve(response({ ...page(2), items: [] })));
  await screen.findByRole("heading", {
    name: "Authoritative history request failed",
  });
  expect(t.measurementRecoveryRequired(h.cache, c)).toBe(true);
  preserved(h, 3);
  h.overrides.clear();
  await userEvent.click(
    screen.getByRole("button", { name: "Load selected history window" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  preserved(h, 3);
  expect(historyReads(h, 2)).toHaveLength(2);
});
test("independent history selection validates bounds and reserves the eight-observer budget without prefetch", async () => {
  const h = setup(40);
  h.mount();
  await screen.findByRole("button", { name: "Open revision 40" });
  const c = context(h);
  await act(async () => {
    for (let max = 1; max <= 35; max++)
      t.rejectMeasurementRead(
        t.beginMeasurementRead(
          h.cache,
          c,
          { kind: "history", specId: MS, max, limit: 25 },
          new AbortController().signal,
        ),
      );
    h.cache.setQueryData(hk(h, 39), page(39));
  });
  // The cache-only prerequisite is on the final recovery page.
  while (
    !screen.queryByRole("button", { name: "Request authoritative history" })
  )
    await userEvent.click(
      screen.getByRole("button", { name: "More recovery requests" }),
    );
  const before = h.measurementReads().length;
  await userEvent.click(
    screen.getByRole("button", { name: "Request authoritative history" }),
  );
  await userEvent.clear(screen.getByLabelText("Historical maximum"));
  await userEvent.type(screen.getByLabelText("Historical maximum"), "41");
  await userEvent.click(
    screen.getByRole("button", { name: "Choose history request" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("positive maximum");
  expect(h.measurementReads()).toHaveLength(before);
  await userEvent.clear(screen.getByLabelText("Historical maximum"));
  await userEvent.type(screen.getByLabelText("Historical maximum"), "40");
  await userEvent.click(
    screen.getByRole("button", { name: "Choose history request" }),
  );
  for (let i = 0; i < 4; i++) {
    if (
      screen.queryByRole("button", { name: "Previous recovery requests" }) &&
      !screen
        .getByRole("button", { name: "Previous recovery requests" })
        .hasAttribute("disabled")
    )
      await userEvent.click(
        screen.getByRole("button", { name: "Previous recovery requests" }),
      );
    const observers = h.cache
      .getQueryCache()
      .getAll()
      .filter(
        (q) =>
          (q.queryKey.includes("explicit-recovery") ||
            q.queryKey.includes("explicit-history-request")) &&
          q.getObserversCount(),
      );
    expect(observers.length).toBeLessThanOrEqual(8);
  }
  expect(h.measurementReads()).toHaveLength(before);
  expect(h.writes()).toHaveLength(0);
});
test.each(["actor", "organization", "ABA"] as const)(
  "cancelled request provenance cannot recover a replacement %s context",
  async (boundary) => {
    const h = setup();
    h.mount();
    await screen.findByRole("button", { name: "Open revision 1" });
    await act(async () => h.cache.setQueryData(hk(h, 2), page(2)));
    await userEvent.click(
      screen.getByRole("button", { name: "Request authoritative history" }),
    );
    await userEvent.clear(screen.getByLabelText("Historical maximum"));
    await userEvent.type(screen.getByLabelText("Historical maximum"), "2");
    await userEvent.click(
      screen.getByRole("button", { name: "Choose history request" }),
    );
    const pending = deferred<Response>();
    h.overrides.set("GET " + hp, () => {
      h.overrides.delete("GET " + hp);
      return pending.promise;
    });
    const old = screen.getByRole("button", {
      name: "Load selected history window",
    });
    await userEvent.click(old);
    if (boundary === "actor")
      await act(async () => setLocalSubject("IA04-REPLACEMENT"));
    else {
      await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
      await screen.findByRole("heading", { name: "Latest revision 1" });
      if (boundary === "ABA")
        await userEvent.click(screen.getByRole("button", { name: "Enter A" }));
    }
    await act(async () => pending.resolve(response(page(2))));
    const reads = h.measurementReads().length;
    await act(async () => old.click());
    expect(h.measurementReads()).toHaveLength(reads);
    expect(h.writes()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Load selected history window" }),
    ).toBeNull();
  },
);
