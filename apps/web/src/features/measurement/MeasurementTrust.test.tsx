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
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { SessionProvider } from "../../app/session";
import { WorkspaceProvider, WorkspaceGate } from "../../app/workspace";
import { endSession } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  fixture,
  A,
  P,
  S,
  rev,
  spec,
  root,
  route,
  response,
  deferred,
} from "../../test/measurementFixture";
import { useMeasurementSpec } from "./data";
import type { Spec } from "./model";
const clients = new Set<ReturnType<typeof fixture>["cache"]>();
afterEach(() => {
  cleanup();
  endSession();
  for (const c of clients) c.clear();
  clients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function prepared() {
  const h = fixture();
  clients.add(h.cache);
  h.specs.set(A, spec(3));
  for (let n = 1; n <= 3; n++) h.revisions.set(rev(n).id, rev(n));
  return h;
}
const key = (h: ReturnType<typeof fixture>) =>
  queryKeys.measurementSpec(h.scope, A, P, S);
async function ready() {
  await screen.findByRole("heading", { name: "Latest revision 3" });
  await screen.findByRole("button", { name: "Open revision 1" });
}
function effects(h: ReturnType<typeof fixture>) {
  expect(h.writes()).toHaveLength(0);
  expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(0);
}
function Observer({ name }: { name: string }) {
  const q = useMeasurementSpec(P, S, true);
  return (
    <section aria-label={name}>
      <span>
        {q.isError
          ? "rejected"
          : (q.data?.latestRevision.points[0].value ?? "pending")}
      </span>
      <button onClick={() => void q.refetch()}>Refresh {name}</button>
    </section>
  );
}
function Probes() {
  const [a, setA] = useState(true),
    [b, setB] = useState(false);
  return (
    <>
      <button onClick={() => setA(!a)}>Toggle A</button>
      <button onClick={() => setB(!b)}>Toggle B</button>
      {a && <Observer name="Observer A" />}
      {b && <Observer name="Observer B" />}
    </>
  );
}
function probes(h: ReturnType<typeof fixture>, strict = false) {
  const tree = (
    <QueryClientProvider client={h.cache}>
      <MemoryRouter initialEntries={[route()]}>
        <SessionProvider>
          <WorkspaceProvider>
            <Routes>
              <Route
                path="/organizations/:organizationId/projects/:projectId/styles/:styleId/measurements"
                element={
                  <WorkspaceGate>
                    <Probes />
                  </WorkspaceGate>
                }
              />
            </Routes>
          </WorkspaceProvider>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

test.each([false, true])(
  "untrusted cached %s cannot initialize draft or authorize create before network",
  async (absence) => {
    const h = prepared(),
      pending = deferred<Response>();
    h.cache.setQueryData(
      key(h),
      absence
        ? null
        : {
            ...spec(3),
            latestRevision: {
              ...rev(3),
              points: [{ ...rev(3).points[0], value: "999.9999" }],
            },
          },
    );
    h.overrides.set(`GET ${root()}/measurement-spec`, () => pending.promise);
    h.mount();
    await screen.findByRole("heading", { name: "Measurements", level: 1 });
    expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create Measurement Spec" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Measurement draft" }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(response(spec(3))));
    await ready();
    effects(h);
  },
);

test("same-ID POM poison preserves legitimate draft but disables editing, submit and reconciliation", async () => {
  const h = prepared();
  h.mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  const value = screen.getByLabelText("Value · POM 1");
  await userEvent.clear(value);
  await userEvent.type(value, "61.2345");
  const bad = spec(3);
  bad.latestRevision.points[0].value = "999.9999";
  await act(async () => {
    h.cache.setQueryData(key(h), bad);
  });
  await within(
    screen.getByRole("region", { name: "Measurement workspace" }),
  ).findAllByRole("alert");
  expect(value).toHaveValue("61.2345");
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create revision" }),
  ).not.toBeInTheDocument();
  effects(h);
  h.overrides.set(`GET ${root()}/measurement-spec`, () => response(spec(3)));
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key(h), exact: true });
  });
  await ready();
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("61.2345");
  expect(screen.getByRole("button", { name: "Create revision" })).toBeEnabled();
  effects(h);
});

test.each(["spec", "history", "revision"])(
  "authenticated contradictory %s refetch rejects then coherent response recovers",
  async (kind) => {
    const h = prepared();
    h.mount();
    await ready();
    if (kind === "revision") {
      await userEvent.click(
        screen.getByRole("button", { name: "Open revision 1" }),
      );
      await screen.findByRole("region", { name: "Selected revision 1" });
    }
    const qkey =
      kind === "spec"
        ? key(h)
        : kind === "history"
          ? queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3)
          : queryKeys.measurementRevision(h.scope, A, P, S, rev().id);
    const original = h.cache.getQueryData(qkey)!;
    const bad = structuredClone(original) as any;
    if (kind === "spec") bad.latestRevision.points[0].value = "999.9999";
    else if (kind === "history") bad.items[0].baseSize = "POISONED SUMMARY";
    else bad.points[0].value = "999.9999";
    const endpoint = `GET ${root()}/measurement-spec${kind === "history" ? "/revisions" : kind === "revision" ? `/revisions/${rev().id}` : ""}`;
    h.overrides.set(endpoint, () => response(bad));
    await act(async () => {
      await h.cache.refetchQueries({ queryKey: qkey, exact: true });
    });
    await within(
      screen.getByRole("region", { name: "Measurement workspace" }),
    ).findAllByRole("alert");
    expect(
      screen.queryByText(/999\.9999|POISONED SUMMARY/),
    ).not.toBeInTheDocument();
    effects(h);
    h.overrides.set(endpoint, () => response(original));
    await userEvent.click(
      within(
        screen.getByRole("region", { name: "Measurement workspace" }),
      ).getByRole("button", { name: /Try again|Reload/ }),
    );
    if (kind === "revision")
      await screen.findByRole("region", { name: "Selected revision 1" });
    else await ready();
    effects(h);
  },
);

test.each([false, true])(
  "two actual hook observers retain one truth after Query recreation, strict=%s",
  async (strict) => {
    const h = prepared();
    probes(h, strict);
    await within(
      await screen.findByRole("region", { name: "Observer A" }),
    ).findByText("50.0000");
    // A stays an active authenticated history owner while its Query is removed.
    await act(async () => {
      h.cache.removeQueries({ queryKey: key(h), exact: true });
    });
    const bad = spec(3);
    bad.latestRevision.points[0].value = "999.9999";
    h.overrides.set(`GET ${root()}/measurement-spec`, () => response(bad));
    await userEvent.click(screen.getByRole("button", { name: "Toggle B" }));
    await within(
      await screen.findByRole("region", { name: "Observer B" }),
    ).findByText("rejected");
    expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh Observer A" }),
    );
    await within(screen.getByRole("region", { name: "Observer A" })).findByText(
      "rejected",
    );
    expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Toggle A" }));
    h.overrides.set(`GET ${root()}/measurement-spec`, () => response(spec(3)));
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh Observer B" }),
    );
    await within(screen.getByRole("region", { name: "Observer B" })).findByText(
      "50.0000",
    );
    await userEvent.click(screen.getByRole("button", { name: "Toggle A" }));
    await within(screen.getByRole("region", { name: "Observer A" })).findByText(
      "50.0000",
    );
    effects(h);
  },
);

test("two observers reject the same cache contradiction and recover together", async () => {
  const h = prepared();
  probes(h);
  await within(
    await screen.findByRole("region", { name: "Observer A" }),
  ).findByText("50.0000");
  await userEvent.click(screen.getByRole("button", { name: "Toggle B" }));
  await within(screen.getByRole("region", { name: "Observer B" })).findByText(
    "50.0000",
  );
  const bad = spec(3);
  bad.latestRevision.points[0].value = "999.9999";
  await act(async () => {
    h.cache.setQueryData(key(h), bad);
  });
  await within(screen.getByRole("region", { name: "Observer A" })).findByText(
    "rejected",
  );
  await within(screen.getByRole("region", { name: "Observer B" })).findByText(
    "rejected",
  );
  expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
  await act(async () => {
    await h.cache.refetchQueries({ queryKey: key(h), exact: true });
  });
  await waitFor(() => expect(screen.getAllByText("50.0000")).toHaveLength(2));
  effects(h);
});

test.each(["cancelled-first", "current-first"])(
  "late cancelled Query response cannot establish competing trust: %s",
  async (order) => {
    const h = prepared(),
      old = deferred<Response>(),
      fresh = deferred<Response>();
    let count = 0;
    h.overrides.set(`GET ${root()}/measurement-spec`, () =>
      ++count === 1 ? old.promise : fresh.promise,
    );
    probes(h);
    await waitFor(() => expect(count).toBe(1));
    await act(async () => {
      h.cache.removeQueries({ queryKey: key(h), exact: true });
    });
    await userEvent.click(screen.getByRole("button", { name: "Toggle B" }));
    await waitFor(() => expect(count).toBe(2));
    const bad = spec(3);
    bad.latestRevision.points[0].value = "999.9999";
    if (order === "cancelled-first") {
      await act(async () => old.resolve(response(bad)));
      await act(async () => fresh.resolve(response(spec(3))));
    } else {
      await act(async () => fresh.resolve(response(spec(3))));
      await act(async () => old.resolve(response(bad)));
    }
    await within(screen.getByRole("region", { name: "Observer B" })).findByText(
      "50.0000",
    );
    expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
    effects(h);
  },
);

test("active Query eviction cannot discard a legitimate draft during contradictory recovery", async () => {
  const h = prepared();
  h.mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "62.1234");
  const bad = spec(3);
  bad.latestRevision.points[0].value = "999.9999";
  h.overrides.set(`GET ${root()}/measurement-spec`, () => response(bad));
  await act(async () => {
    h.cache.removeQueries({ queryKey: key(h), exact: true });
    h.cache.setQueryData(key(h), bad);
  });
  await within(
    screen.getByRole("region", { name: "Measurement workspace" }),
  ).findAllByRole("alert");
  expect(screen.getByLabelText("Value · POM 1")).toHaveValue("62.1234");
  expect(
    screen.getByRole("group", { name: "Revision snapshot" }),
  ).toBeDisabled();
  expect(screen.queryByText("999.9999")).not.toBeInTheDocument();
  effects(h);
});
