import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  fixture as releaseFixture,
  sourceRoute,
  id,
} from "../../test/patternReleaseFixture";

const clients = new Set<QueryClient>();
function fixture() {
  const h = releaseFixture();
  clients.add(h.cache);
  return h;
}
afterEach(() => {
  cleanup();
  clients.forEach((cache) => cache.clear());
  clients.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("IA-01: valid cached timestamp cannot replace first trusted pinned event", async () => {
  const h = fixture();
  h.mount(sourceRoute());
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(id(600)) }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Open release events" }),
  );
  const history = await screen.findByRole("region", {
    name: "Pinned release events",
  });
  await within(history).findByText("1 · ACTIVATED · 2026-10-24T00:00:00Z");
  const query = h.cache
    .getQueryCache()
    .getAll()
    .find((q) => q.queryKey.includes("events"))!;
  const original = structuredClone(query.state.data) as {
    items: { occurredAt: string }[];
  };
  const candidate = structuredClone(original);
  candidate.items[0].occurredAt = "2026-10-24T00:00:42Z";
  await act(async () => {
    h.cache.setQueryData(query.queryKey, candidate);
  });
  await within(history).findByRole("alert");
  expect(history).not.toHaveTextContent("2026-10-24T00:00:42Z");
  const writes = () =>
    h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"));
  expect(writes()).toHaveLength(0);
  await act(async () => {
    h.cache.setQueryData(query.queryKey, structuredClone(original));
  });
  await waitFor(() => expect(within(history).queryByRole("alert")).toBeNull());
  expect(history).toHaveTextContent("1 · ACTIVATED · 2026-10-24T00:00:00Z");
  expect(history).not.toHaveTextContent("2026-10-24T00:00:42Z");
  expect(writes()).toHaveLength(0);
  expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(1);
});

// Exercise the production hook with a legitimate one-event page size. The
// actual release lifecycle has only two events; no invented long event history.
import { render } from "@testing-library/react";
import { useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { SessionProvider } from "../../app/session";
import { WorkspaceProvider, WorkspaceGate } from "../../app/workspace";
import { useReleaseEvents } from "./data";
import {
  A,
  B,
  P,
  S,
  PID,
  revision,
  response,
  time,
} from "../../test/patternReleaseFixture";
import { deferred } from "../../test/measurementFixture";
import { setLocalSubject } from "../../api/session";
const scope = {
  organizationId: A,
  projectId: P,
  styleId: S,
  patternId: PID,
  revisionId: revision().id,
  revisionNumber: 1,
};
const first = {
  id: id(680),
  releaseId: id(600),
  eventNumber: 1,
  kind: "ACTIVATED",
  occurredAt: time,
};
const last = {
  id: id(681),
  releaseId: id(600),
  eventNumber: 2,
  kind: "REVOKED",
  occurredAt: "2026-10-24T00:00:01Z",
};
const eventPath = "/api/v1" + sourceRoute() + "/" + id(600) + "/events";
const page = (max: number, limit = 1) => ({
  items: [last, first].filter((e) => e.eventNumber <= max).slice(0, limit),
  limit,
  nextMaxEventNumber: max === 2 && limit === 1 ? 1 : null,
});
function Window({ max, limit }: { max: number; limit: number }) {
  const q = useReleaseEvents(scope, id(600), max, limit);
  return (
    <section aria-label="Observed event window">
      {q.isError && <p role="alert">History rejected</p>}
      {q.isFetching && <p>Fetching history</p>}
      <button onClick={() => void q.refetch()}>Refresh window</button>
      {q.data?.items.map((e) => (
        <p key={e.id}>
          {e.eventNumber} · {e.kind} · {e.occurredAt}
        </p>
      ))}
    </section>
  );
}
function Probe() {
  const [max, bound] = useState(2),
    [shown, show] = useState(true),
    [limit, size] = useState(1),
    [twins, duplicate] = useState(false);
  return (
    <>
      <button onClick={() => bound(1)}>Older window</button>
      <button onClick={() => bound(2)}>First window</button>
      <button onClick={() => show((v) => !v)}>Toggle observer</button>
      <button onClick={() => size((v) => (v === 1 ? 2 : 1))}>
        Toggle page size
      </button>
      <button onClick={() => duplicate(true)}>Second observer</button>
      {shown && <Window max={max} limit={limit} />}
      {twins && <Window max={max} limit={limit} />}
    </>
  );
}
function mountProbe(h: ReturnType<typeof fixture>) {
  h.overrides.set("GET " + eventPath, async (r) => {
    const u = new URL(r.url);
    return response(
      page(
        Number(u.searchParams.get("maxEventNumber")),
        Number(u.searchParams.get("limit")),
      ),
    );
  });
  return render(
    <QueryClientProvider client={h.cache}>
      <MemoryRouter initialEntries={[sourceRoute()]}>
        <SessionProvider>
          <WorkspaceProvider>
            <Routes>
              <Route
                path="/organizations/:organizationId/*"
                element={
                  <WorkspaceGate>
                    <Probe />
                  </WorkspaceGate>
                }
              />
            </Routes>
          </WorkspaceProvider>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
function eventQuery(h: ReturnType<typeof fixture>, max = 2, limit = 1) {
  return h.cache
    .getQueryCache()
    .getAll()
    .find(
      (q) =>
        q.queryKey.includes("events") &&
        q.queryKey.at(-1) === max &&
        q.queryKey.at(-2) === limit,
    )!;
}
async function readyProbe(h: ReturnType<typeof fixture>) {
  mountProbe(h);
  await screen.findByText("2 · REVOKED · " + last.occurredAt);
}
const changed = (value: ReturnType<typeof page>) => ({
  ...value,
  items: value.items.map((e) => ({ ...e, occurredAt: "2026-10-24T00:00:42Z" })),
});

test.each(["first", "older"])(
  "independent anchors survive older-page navigation: attack %s",
  async (target) => {
    const h = fixture();
    await readyProbe(h);
    click("Older window");
    await screen.findByText("1 · ACTIVATED · " + time);
    click("First window");
    await screen.findByText("2 · REVOKED · " + last.occurredAt);
    const max = target === "first" ? 2 : 1;
    if (max === 1) {
      click("Older window");
      await screen.findByText("1 · ACTIVATED · " + time);
    }
    const q = eventQuery(h, max);
    await act(async () => {
      h.cache.setQueryData(q.queryKey, changed(page(max)));
    });
    await screen.findByRole("alert");
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    await act(async () => {
      h.cache.setQueryData(q.queryKey, page(max));
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(2);
  },
);

test("network contradictions never overwrite the anchor and identical retries recover", async () => {
  const h = fixture();
  await readyProbe(h);
  const q = eventQuery(h);
  let requests = 0;
  h.overrides.set("GET " + eventPath, async () => {
    requests++;
    return response(changed(page(2)));
  });
  click("Refresh window");
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.queryByText("Fetching history")).toBeNull(),
  );
  expect(requests).toBe(1);
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  h.overrides.set("GET " + eventPath, async () => response(page(2)));
  click("Refresh window");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(
    screen.getByText("2 · REVOKED · " + last.occurredAt),
  ).toBeInTheDocument();
  await act(async () => {
    h.cache.setQueryData(q.queryKey, changed(page(2)));
  });
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
});

test("observer remount reuses previously trusted facts even if cache was replaced", async () => {
  const h = fixture();
  await readyProbe(h);
  const q = eventQuery(h);
  click("Toggle observer");
  h.cache.setQueryData(q.queryKey, changed(page(2)));
  const pending = deferred<Response>();
  h.overrides.set("GET " + eventPath, () => pending.promise);
  click("Toggle observer");
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  await act(async () => pending.resolve(response(page(2))));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(
    screen.getByText("2 · REVOKED · " + last.occurredAt),
  ).toBeInTheDocument();
});

test.each([false, true])(
  "untrusted cache after query eviction cannot seed an anchor (poison=%s)",
  async (poison) => {
    const h = fixture();
    await readyProbe(h);
    const key = eventQuery(h).queryKey;
    click("Toggle observer");
    h.cache.removeQueries({ queryKey: key, exact: true });
    h.cache.setQueryData(key, poison ? changed(page(2)) : page(2));
    const pending = deferred<Response>();
    h.overrides.set("GET " + eventPath, () => pending.promise);
    click("Toggle observer");
    await screen.findByRole("alert");
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    expect(screen.queryByText("2 · REVOKED · " + last.occurredAt)).toBeNull();
    await act(async () => pending.resolve(response(page(2))));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(
      screen.getByText("2 · REVOKED · " + last.occurredAt),
    ).toBeInTheDocument();
  },
);

test("page-size windows have independent trust and returning preserves the first anchor", async () => {
  const h = fixture();
  await readyProbe(h);
  click("Toggle page size");
  await screen.findByText("1 · ACTIVATED · " + time);
  click("Toggle page size");
  await waitFor(() =>
    expect(screen.queryByText("1 · ACTIVATED · " + time)).toBeNull(),
  );
  const q = eventQuery(h);
  await act(async () => {
    h.cache.setQueryData(q.queryKey, changed(page(2)));
  });
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
});

test("malformed initial network response cannot bless a later plausible cache value", async () => {
  const h = fixture();
  mountProbe(h);
  h.overrides.set("GET " + eventPath, async () =>
    response({ ...page(2), items: [{ ...last, occurredAt: "invalid" }] }),
  );
  await screen.findByRole("alert");
  const q = eventQuery(h);
  await act(async () => {
    h.cache.setQueryData(q.queryKey, page(2));
  });
  expect(screen.queryByText("2 · REVOKED · " + last.occurredAt)).toBeNull();
  expect(screen.getByRole("alert")).toBeInTheDocument();
  h.overrides.set("GET " + eventPath, async () => response(page(2)));
  click("Refresh window");
  await screen.findByText("2 · REVOKED · " + last.occurredAt);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

async function openRealHistory(h: ReturnType<typeof fixture>) {
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(id(600)) }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Open release events" }),
  );
  await screen.findByText("1 · ACTIVATED · " + time);
  return h.cache
    .getQueryCache()
    .getAll()
    .find((q) => q.queryKey.includes("events") && q.getObserversCount() > 0)!;
}
test.each(["Actor", "Organization ABA"])(
  "trusted anchors and late cached data stay inside %s generation",
  async (boundary) => {
    const h = fixture();
    h.mount(sourceRoute());
    const old = await openRealHistory(h);
    if (boundary === "Actor") {
      act(() => setLocalSubject("ia01-next-actor"));
      await screen.findByRole("button", { name: new RegExp(id(600)) });
    } else {
      click("Inbox B");
      await screen.findByText(/Private B exact.pdf · ACTIVE/);
      expect(screen.queryByText("1 · ACTIVATED · " + time)).toBeNull();
      click("Source A");
      await screen.findByRole("button", { name: new RegExp(id(600)) });
    }
    await act(async () => {
      h.cache.setQueryData(old.queryKey, {
        items: [{ ...first, occurredAt: "2026-10-24T00:00:42Z" }],
        limit: 25,
        nextMaxEventNumber: null,
      });
    });
    const current = await openRealHistory(h);
    expect(current.queryKey).not.toEqual(old.queryKey);
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Access denied" })).toBeNull();
    expect(
      h.calls.some((r) => r.method !== "GET" || r.url.endsWith("/content")),
    ).toBe(false);
  },
);

test("valid cached event UUID replacement is rejected without replacing trusted membership", async () => {
  const h = fixture();
  h.mount(sourceRoute());
  const q = await openRealHistory(h);
  const original = structuredClone(q.state.data) as ReturnType<typeof page>;
  const candidate = {
    ...original,
    items: original.items.map((e) => ({ ...e, id: id(999) })),
  };
  await act(async () => {
    h.cache.setQueryData(q.queryKey, candidate);
  });
  const history = screen.getByRole("region", { name: "Pinned release events" });
  await within(history).findByRole("alert");
  expect(history).toHaveTextContent("1 · ACTIVATED · " + time);
  await act(async () => {
    h.cache.setQueryData(q.queryKey, structuredClone(original));
  });
  await waitFor(() => expect(within(history).queryByRole("alert")).toBeNull());
  expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(1);
  expect(
    h.calls.some((r) => r.method !== "GET" || r.url.endsWith("/content")),
  ).toBe(false);
});

test("concurrent observers share only the same authoritative network window, not cached trust", async () => {
  const h = fixture();
  mountProbe(h);
  const pending = deferred<Response>();
  h.overrides.set("GET " + eventPath, () => pending.promise);
  await waitFor(() =>
    expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(1),
  );
  click("Second observer");
  await act(async () => pending.resolve(response(page(2))));
  await waitFor(() =>
    expect(
      screen.getAllByText("2 · REVOKED · " + last.occurredAt),
    ).toHaveLength(2),
  );
  expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(1);
  const q = eventQuery(h);
  await act(async () => {
    h.cache.setQueryData(q.queryKey, changed(page(2)));
  });
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  await act(async () => {
    h.cache.setQueryData(q.queryKey, page(2));
  });
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
});

test("real history with no fetching-state subscription recovers identical untrusted cache", async () => {
  const h = fixture();
  h.mount(sourceRoute());
  const q = await openRealHistory(h);
  const original = structuredClone(q.state.data),
    key = q.queryKey;
  click("Close release events");
  h.cache.removeQueries({ queryKey: key, exact: true });
  h.cache.setQueryData(key, original);
  click("Open release events");
  const history = await screen.findByRole("region", {
    name: "Pinned release events",
  });
  await waitFor(() =>
    expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(2),
  );
  await within(history).findByText("1 · ACTIVATED · " + time);
  await waitFor(() => expect(within(history).queryByRole("alert")).toBeNull());
  expect(
    h.calls.some((r) => r.method !== "GET" || r.url.endsWith("/content")),
  ).toBe(false);
});


test.each(["first", "older"])(
  "pinned context retains %s window trust after inactive query eviction",
  async (target) => {
    const h = fixture();
    await readyProbe(h);
    click("Older window");
    await screen.findByText("1 · ACTIVATED · " + time);
    const max = target === "first" ? 2 : 1;
    if (max === 1) {
      click("First window");
      await screen.findByText("2 · REVOKED · " + last.occurredAt);
    }
    const key = eventQuery(h, max).queryKey;
    h.cache.removeQueries({ queryKey: key, exact: true });
    const pending = deferred<Response>();
    let requests = 0;
    h.overrides.set("GET " + eventPath, async () => {
      requests++;
      return pending.promise;
    });
    click(max === 2 ? "First window" : "Older window");
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    await waitFor(() => expect(requests).toBe(1));
    await act(async () => pending.resolve(response(changed(page(max)))));
    await waitFor(() => expect(screen.queryByText("Fetching history")).toBeNull());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    expect(requests).toBe(1);
    h.overrides.set("GET " + eventPath, async () => response(page(max)));
    click("Refresh window");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText(max === 2
      ? "2 · REVOKED · " + last.occurredAt
      : "1 · ACTIVATED · " + time)).toBeInTheDocument();
    expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
  },
);
