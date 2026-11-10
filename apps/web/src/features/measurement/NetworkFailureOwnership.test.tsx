import { StrictMode, useState } from "react";
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
import { MemoryRouter, Routes, Route } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { endSession } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import { SessionProvider } from "../../app/session";
import { WorkspaceProvider, WorkspaceGate } from "../../app/workspace";
import {
  fixture,
  A,
  B,
  P,
  S,
  rev,
  spec,
  root,
  route,
  response,
} from "../../test/measurementFixture";
import { useMeasurementSpec, useMeasurementAuthority } from "./data";
import type { Page, Revision, Spec } from "./model";
import { MeasurementPicker } from "../pattern/MeasurementPicker";
const clients = new Set<ReturnType<typeof fixture>["cache"]>();
afterEach(() => {
  cleanup();
  endSession();
  clients.forEach((c) => c.clear());
  clients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function prepared() {
  const h = fixture();
  clients.add(h.cache);
  h.specs.set(A, spec(3));
  h.specs.set(B, spec(1, B));
  for (let n = 1; n <= 3; n++) h.revisions.set(rev(n).id, rev(n));
  return h;
}
type Kind = "spec" | "history" | "revision";
const key = (h: ReturnType<typeof fixture>, ch: Kind) =>
  ch === "spec"
    ? queryKeys.measurementSpec(h.scope, A, P, S)
    : ch === "history"
      ? queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3)
      : queryKeys.measurementRevision(h.scope, A, P, S, rev().id);
const endpoint = (ch: Kind) =>
  `GET ${root()}/measurement-spec${ch === "history" ? "/revisions" : ch === "revision" ? `/revisions/${rev().id}` : ""}`;
async function ready() {
  // Await the real lazy-route and domain-mount boundaries before waiting for
  // its first authenticated result. Each assertion retains the default wait.
  await screen.findByRole("heading", { name: "Measurements", level: 1 });
  await screen.findByRole("heading", { name: "Measurement Spec", level: 2 });
  await screen.findByRole("heading", { name: "Latest revision 3" });
  await screen.findByRole("button", { name: "Open revision 1" });
}
function poison(value: unknown, ch: Kind) {
  const b = structuredClone(value);
  if (ch === "spec") (b as Spec).latestRevision.points[0].value = "999.9999";
  else if (ch === "history") (b as Page).items[0].baseSize = "CONTRADICTORY";
  else (b as Revision).points[0].value = "999.9999";
  return b;
}
async function cached(h: ReturnType<typeof fixture>, ch: Kind, value: unknown) {
  await act(async () => {
    h.cache.setQueryData(key(h, ch), value);
  });
}
async function retry(ch: Kind) {
  const scope =
    ch === "history"
      ? within(
          screen.getByRole("region", { name: "Measurement revision history" }),
        )
      : within(screen.getByRole("region", { name: "Measurement workspace" }));
  await userEvent.click(
    scope.getByRole("button", { name: /Try again|Reload/ }),
  );
}
function noWrites(h: ReturnType<typeof fixture>) {
  expect(h.writes()).toHaveLength(0);
  expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(0);
}

test.each(
  (["spec", "history", "revision"] as const).flatMap((ch) =>
    (["network-first", "cache-first"] as const).map((order) => ({ ch, order })),
  ),
)(
  "$ch $order: only authenticated recovery re-enables a retained draft and POST",
  async ({ ch, order }) => {
    const h = prepared();
    h.mount();
    await ready();
    if (ch === "revision") {
      await userEvent.click(
        screen.getByRole("button", { name: "Open revision 1" }),
      );
      await screen.findByRole("region", { name: "Selected revision 1" });
    }
    await userEvent.click(
      screen.getByRole("button", { name: "Create new revision" }),
    );
    const input = screen.getByLabelText("Value · POM 1");
    await userEvent.clear(input);
    await userEvent.type(input, "63.1234");
    const good = structuredClone(h.cache.getQueryData(key(h, ch))!),
      bad = poison(good, ch);
    if (order === "cache-first") await cached(h, ch, bad);
    h.overrides.set(endpoint(ch), () => response(bad));
    await act(async () => {
      await h.cache.refetchQueries({ queryKey: key(h, ch), exact: true });
    });
    await within(
      screen.getByRole("region", { name: "Measurement workspace" }),
    ).findAllByRole("alert");
    const reads = h.measurementReads().length;
    if (order === "network-first") await cached(h, ch, bad);
    for (const value of [good, structuredClone(good)]) {
      await cached(h, ch, value);
      expect(h.measurementReads()).toHaveLength(reads);
      expect(
        screen.getByRole("group", { name: "Revision snapshot" }),
      ).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Create revision" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "Reload the affected measurement data before editing or submitting.",
        ),
      ).toBeVisible();
      expect(input).toHaveValue("63.1234");
      expect(
        screen.queryByText(/999\.9999|CONTRADICTORY/),
      ).not.toBeInTheDocument();
      noWrites(h);
    }
    // Force normal form submission as well as checking disabled/hidden controls.
    await act(async () => {
      screen
        .getByRole("form", { name: "Measurement draft" })
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await waitFor(() => expect(h.cache.isMutating()).toBe(0));
    noWrites(h);
    h.overrides.set(endpoint(ch), () => response(good));
    await retry(ch);
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Revision snapshot" }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByLabelText("Value · POM 1")).toHaveValue("63.1234");
    noWrites(h);
    h.overrides.delete(endpoint(ch));
    await userEvent.click(
      screen.getByRole("button", { name: "Create revision" }),
    );
    await screen.findByRole("heading", { name: "Latest revision 4" });
    expect(h.writes()).toHaveLength(1);
    expect(
      (await h.writes()[0].clone().json()).expectedLatestRevisionNumber,
    ).toBe(3);
  },
);

test("one authenticated channel recovery cannot clear another unresolved channel", async () => {
  const h = prepared();
  h.mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Open revision 1" }),
  );
  await screen.findByRole("region", { name: "Selected revision 1" });
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  const history = structuredClone(h.cache.getQueryData(key(h, "history"))!),
    exact = rev();
  for (const ch of ["history", "revision"] as const) {
    const bad = poison(ch === "history" ? history : exact, ch);
    h.overrides.set(endpoint(ch), () => response(bad));
    await act(async () => {
      await h.cache.refetchQueries({ queryKey: key(h, ch), exact: true });
    });
    await cached(h, ch, bad);
    await cached(h, ch, ch === "history" ? history : exact);
  }
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key(h, "spec"), exact: true });
  });
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  h.overrides.set(endpoint("history"), () => response(history));
  await retry("history");
  await within(
    screen.getByRole("region", { name: "Measurement revision history" }),
  ).findByRole("button", { name: "Open revision 1" });
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  noWrites(h);
  h.overrides.set(endpoint("revision"), () => response(exact));
  await retry("revision");
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).not.toBeDisabled(),
  );
  noWrites(h);
});

test("ambiguous mutation cannot be unblocked by cache; authenticated Spec recovery preserves explicit reconciliation", async () => {
  const h = prepared();
  h.mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "64.1234");
  const committed = spec(4);
  committed.latestRevision.points[0].value = "64.1234";
  h.overrides.set(`POST ${root()}/measurement-spec/revisions`, () => {
    h.specs.set(A, committed);
    h.revisions.set(rev(4).id, committed.latestRevision);
    return response({}, 500);
  });
  h.overrides.set(endpoint("spec"), () => response({}, 503));
  await userEvent.click(
    screen.getByRole("button", { name: "Create revision" }),
  );
  await screen.findByRole("heading", {
    name: "Review authoritative measurements before submitting again",
  });
  await waitFor(() => expect(h.cache.isMutating()).toBe(0));
  expect(h.writes()).toHaveLength(1);
  await cached(h, "spec", poison(spec(3), "spec"));
  await cached(h, "spec", spec(3));
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("64.1234");
  expect(
    screen.queryByRole("button", {
      name: "Reconcile draft with latest revision",
    }),
  ).not.toBeInTheDocument();
  expect(h.writes()).toHaveLength(1);
  h.overrides.set(endpoint("spec"), () => response(committed));
  const workspace = within(
    screen.getByRole("region", { name: "Measurement workspace" }),
  );
  await userEvent.click(
    workspace.getByRole("button", { name: /Try again|Reload/ }),
  );
  await screen.findByRole("heading", { name: "Latest revision 4" });
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("64.1234");
  expect(screen.getByText("Draft baseline revision: 3")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Create revision" }),
  ).toBeDisabled();
  expect(h.writes()).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", {
      name: "Reconcile draft with latest revision",
    }),
  );
  expect(screen.getByText("Draft baseline revision: 4")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create revision" })).toBeEnabled();
  expect(h.writes()).toHaveLength(1);
});

function Observer({ name }: { name: string }) {
  const q = useMeasurementSpec(P, S, true),
    a = useMeasurementAuthority(P, S);
  return (
    <section aria-label={name}>
      <span>
        {q.requiresRecovery
          ? "recovery required"
          : (q.data?.latestRevision.points[0].value ?? "pending")}
      </span>
      <span>{a.editingAllowed(q.data) ? "editable" : "blocked"}</span>
      <button onClick={() => void q.refetch()}>Refresh {name}</button>
    </section>
  );
}
function Observers() {
  const [a, setA] = useState(true),
    [b, setB] = useState(false);
  return (
    <>
      <button onClick={() => setA(!a)}>Toggle A</button>
      <button onClick={() => setB(!b)}>Toggle B</button>
      {a && <Observer name="A" />}
      {b && <Observer name="B" />}
    </>
  );
}
function mountObservers(h: ReturnType<typeof fixture>, strict: boolean) {
  const body = (
    <QueryClientProvider client={h.cache}>
      <MemoryRouter initialEntries={[route()]}>
        <SessionProvider>
          <WorkspaceProvider>
            <Routes>
              <Route
                path="/organizations/:organizationId/projects/:projectId/styles/:styleId/measurements"
                element={
                  <WorkspaceGate>
                    <Observers />
                  </WorkspaceGate>
                }
              />
            </Routes>
          </WorkspaceProvider>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{body}</StrictMode> : body);
}

test.each([false, true])(
  "shared network latch survives observer remount and Query recreation, strict=%s",
  async (strict) => {
    const h = prepared();
    mountObservers(h, strict);
    await within(await screen.findByRole("region", { name: "A" })).findByText(
      "editable",
    );
    h.overrides.set(endpoint("spec"), () => response(poison(spec(3), "spec")));
    await userEvent.click(screen.getByRole("button", { name: "Refresh A" }));
    await within(screen.getByRole("region", { name: "A" })).findByText(
      "recovery required",
    );
    await act(async () => {
      h.cache.removeQueries({ queryKey: key(h, "spec"), exact: true });
      h.cache.setQueryData(key(h, "spec"), spec(3));
    });
    await userEvent.click(screen.getByRole("button", { name: "Toggle B" }));
    await within(screen.getByRole("region", { name: "B" })).findByText(
      "recovery required",
    );
    expect(
      within(screen.getByRole("region", { name: "B" })).getByText("blocked"),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "A" })).getByText("blocked"),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Toggle A" }));
    h.overrides.set(endpoint("spec"), () => response(spec(3)));
    await userEvent.click(screen.getByRole("button", { name: "Refresh B" }));
    await within(screen.getByRole("region", { name: "B" })).findByText(
      "editable",
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle A" }));
    await within(screen.getByRole("region", { name: "A" })).findByText(
      "editable",
    );
    noWrites(h);
  },
);

test("raw cache alias contradiction retains a draft without a selector rerender loop or POST", async () => {
  const h = prepared();
  h.mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "71.2345");
  const original = structuredClone(h.cache.getQueryData<Spec>(key(h, "spec"))!);
  await act(async () => {
    const alias = h.cache.getQueryData<Spec>(key(h, "spec"))!;
    alias.latestRevision.points[0].value = "999.9999";
    h.cache.setQueryData(key(h, "spec"), alias);
  });
  await within(
    screen.getByRole("region", { name: "Measurement workspace" }),
  ).findAllByRole("alert");
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("71.2345");
  expect(document.body).not.toHaveTextContent("999.9999");
  await act(async () => {
    screen
      .getByRole("form", { name: "Measurement draft" })
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  noWrites(h);
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key(h, "spec"), exact: true });
  });
  expect(h.cache.getQueryData(key(h, "spec"))).toEqual(original);
  await waitFor(() =>
    expect(
      screen.getByRole("group", { name: "Revision snapshot" }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("71.2345");
  noWrites(h);
});

test.each(["spec", "history"] as const)(
  "existing Measurement picker observes %s raw-alias errors without changing hook notification tracking",
  async (ch) => {
    const h = prepared(),
      choose = vi.fn();
    render(
      <QueryClientProvider client={h.cache}>
        <MemoryRouter initialEntries={[route()]}>
          <SessionProvider>
            <WorkspaceProvider>
              <Routes>
                <Route
                  path="/organizations/:organizationId/projects/:projectId/styles/:styleId/measurements"
                  element={
                    <WorkspaceGate>
                      <MeasurementPicker
                        projectId={P}
                        styleId={S}
                        choose={choose}
                        close={() => {}}
                      />
                    </WorkspaceGate>
                  }
                />
              </Routes>
            </WorkspaceProvider>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Use Measurement revision 1" });
    await act(async () => {
      const alias = h.cache.getQueryData(key(h, ch))!;
      if (ch === "spec")
        (alias as Spec).latestRevision.points[0].value = "999.9999";
      else (alias as Page).items[0].baseSize = "CONTRADICTORY";
      h.cache.setQueryData(key(h, ch), alias);
    });
    await screen.findByRole("alert");
    const blocked = screen.queryByRole("button", {
      name: "Use Measurement revision 1",
    });
    if (blocked) expect(blocked).toBeDisabled();
    expect(document.body).not.toHaveTextContent(/999\.9999|CONTRADICTORY/);
    expect(choose).not.toHaveBeenCalled();
    noWrites(h);
    await act(async () => {
      await h.cache.refetchQueries({ queryKey: key(h, ch), exact: true });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Use Measurement revision 1" }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Use Measurement revision 1" }),
    );
    expect(choose).toHaveBeenCalledExactlyOnceWith(rev().id);
    noWrites(h);
  },
);
