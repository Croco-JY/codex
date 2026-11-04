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
import { StrictMode, useState } from "react";
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
function Probe({ initiallyShown = true, initialMax = 2, initialLimit = 1 }: { initiallyShown?: boolean; initialMax?: number; initialLimit?: number }) {
  const [max, bound] = useState(initialMax),
    [shown, show] = useState(initiallyShown),
    [limit, size] = useState(initialLimit),
    [twins, duplicate] = useState(false),
    [late, mountLate] = useState<number | null>(null),
    [standard, mountStandard] = useState(false),
    [renders, rerender] = useState(0);
  return (
    <>
      <button onClick={() => bound(1)}>Older window</button>
      <button onClick={() => bound(2)}>First window</button>
      <button onClick={() => show((v) => !v)}>Toggle observer</button>
      <button onClick={() => size((v) => (v === 1 ? 2 : 1))}>
        Toggle page size
      </button>
      <button onClick={() => duplicate(true)}>Second observer</button>
      <button onClick={() => mountLate(2)}>Late first-window observer</button>
      <button onClick={() => mountLate(1)}>Late older-window observer</button>
      <button onClick={() => mountLate(null)}>Close late observer</button>
      <button onClick={() => mountStandard(true)}>Standard first-window observer</button>
      <button onClick={() => duplicate(false)}>Close second observer</button>
      <button onClick={() => rerender(renders + 1)}>Rerender observers {renders}</button>
      {shown && <Window max={max} limit={limit} />}
      {twins && <Window max={max} limit={limit} />}
      {late !== null && <Window max={late} limit={limit} />}
      {standard && <Window max={2} limit={25} />}
    </>
  );
}
function mountProbe(h: ReturnType<typeof fixture>, options: { strict?: boolean; initiallyShown?: boolean; initialMax?: number; initialLimit?: number } = {}) {
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
                    <Probe initiallyShown={options.initiallyShown} initialMax={options.initialMax} initialLimit={options.initialLimit} />
                  </WorkspaceGate>
                }
              />
            </Routes>
          </WorkspaceProvider>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
    options.strict ? { wrapper: StrictMode } : undefined,
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


test("FRA-01: a late observer cannot create competing trust after inactive query eviction", async () => {
  const h = fixture();
  await readyProbe(h);
  const key = eventQuery(h, 2).queryKey;
  click("Older window");
  await screen.findByText("1 · ACTIVATED · " + time);
  h.cache.removeQueries({ queryKey: key, exact: true });
  let corruptRequests = 0;
  h.overrides.set("GET " + eventPath, async (request) => {
    const max = Number(new URL(request.url).searchParams.get("maxEventNumber"));
    if (max === 2) corruptRequests++;
    return response(max === 2 ? changed(page(2)) : page(max));
  });
  click("Late first-window observer");
  await waitFor(() => expect(corruptRequests).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText("Fetching history")).toBeNull());
  click("First window");
  await waitFor(() => expect(eventQuery(h, 2).getObserversCount()).toBe(2));
  await waitFor(() => expect(screen.queryByText("Fetching history")).toBeNull());
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(eventQuery(h, 2).options.retry).toBe(false);
  expect(eventQuery(h, 2).queryKey.at(-1)).toBe(2);
  expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
  h.overrides.set("GET " + eventPath, async () => response(page(2)));
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh window" })[0]);
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2);
  await act(async () => h.cache.setQueryData(eventQuery(h, 2).queryKey, changed(page(2))));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
});


test("shared cache replacement and Query recreation reject B for both observers", async () => {
  const h = fixture(); await readyProbe(h);
  click("Late first-window observer");
  await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
  const key = eventQuery(h).queryKey;
  await act(async () => h.cache.setQueryData(key, changed(page(2))));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  await act(async () => {
    h.cache.removeQueries({ queryKey: key, exact: true });
    h.cache.setQueryData(key, changed(page(2)));
  });
  fireEvent.click(screen.getByRole("button", { name: /Rerender observers/ }));
  await waitFor(() => expect(eventQuery(h).getObserversCount()).toBe(2));
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh window" })[0]);
  await waitFor(() => expect(screen.queryAllByRole("alert")).toHaveLength(0));
  expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2);
});

test("opposite observer order shares the same first network facts", async () => {
  const h = fixture(); mountProbe(h, { initiallyShown: false });
  fireEvent.click(await screen.findByRole("button", { name: "Late first-window observer" }));
  await screen.findByText("2 · REVOKED · " + last.occurredAt);
  click("Toggle observer");
  await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
  await act(async () => h.cache.setQueryData(eventQuery(h).queryKey, changed(page(2))));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
});

test("older-window eviction cannot give a late observer alternate first facts", async () => {
  const h = fixture(); await readyProbe(h);
  click("Older window"); await screen.findByText("1 · ACTIVATED · " + time);
  const key = eventQuery(h, 1).queryKey;
  click("First window"); await screen.findByText("2 · REVOKED · " + last.occurredAt);
  h.cache.removeQueries({ queryKey: key, exact: true });
  h.overrides.set("GET " + eventPath, async () => response(changed(page(1))));
  click("Late older-window observer");
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  click("Older window");
  await waitFor(() => expect(eventQuery(h, 1).getObserversCount()).toBe(2));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
});

test("one owner ending retains trust; final owner plus cache eviction requires fresh provenance", async () => {
  const h = fixture(); await readyProbe(h);
  click("Late first-window observer");
  await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
  const key = eventQuery(h).queryKey;
  click("Toggle observer");
  h.cache.removeQueries({ queryKey: key, exact: true });
  h.overrides.set("GET " + eventPath, async () => response(changed(page(2))));
  click("Refresh window");
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  click("Close late observer");
  h.cache.removeQueries({ queryKey: key, exact: true });
  h.cache.setQueryData(key, page(2));
  const pending = deferred<Response>();
  h.overrides.set("GET " + eventPath, () => pending.promise);
  click("Toggle observer");
  await screen.findByRole("alert");
  expect(screen.queryByText("2 · REVOKED · " + last.occurredAt)).toBeNull();
  await act(async () => pending.resolve(response(page(2))));
  await screen.findByText("2 · REVOKED · " + last.occurredAt);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("Strict Mode replay keeps shared trust and one cleanup cannot revoke the remaining owner", async () => {
  const h = fixture(); mountProbe(h, { strict: true });
  await screen.findByText("2 · REVOKED · " + last.occurredAt);
  click("Late first-window observer");
  await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
  click("Toggle observer");
  h.overrides.set("GET " + eventPath, async () => response(changed(page(2))));
  click("Refresh window");
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  h.overrides.set("GET " + eventPath, async () => response(page(2)));
  click("Refresh window");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("2 · REVOKED · " + last.occurredAt)).toBeInTheDocument();
});

test.each(["Actor", "Organization ABA"])(
  "late network data from a previous %s cannot seed shared current trust", async (boundary) => {
    const h = fixture(), pending = deferred<Response>();
    let oldRequests = 0;
    h.overrides.set("GET " + eventPath, async () => { oldRequests++; return pending.promise; });
    h.mount(sourceRoute());
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(id(600)) }));
    fireEvent.click(await screen.findByRole("button", { name: "Open release events" }));
    await waitFor(() => expect(oldRequests).toBe(1));
    if (boundary === "Actor") {
      act(() => setLocalSubject("fra01-current-actor"));
      await screen.findByRole("button", { name: new RegExp(id(600)) });
    } else {
      click("Inbox B"); await screen.findByText(/Private B exact.pdf · ACTIVE/);
      click("Source A"); await screen.findByRole("button", { name: new RegExp(id(600)) });
    }
    h.overrides.set("GET " + eventPath, async () => response(page(1, 25)));
    await openRealHistory(h);
    await act(async () => pending.resolve(response(changed(page(1, 25)))));
    const history = screen.getByRole("region", { name: "Pinned release events" });
    expect(history).not.toHaveTextContent("00:00:42Z");
    expect(history).toHaveTextContent("1 · ACTIVATED · " + time);
    expect(within(history).queryByRole("alert")).toBeNull();
    expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
  },
);


test("overlapping events agree across previously untrusted page-size windows", async () => {
  const h = fixture(); await readyProbe(h);
  h.overrides.set("GET " + eventPath, async () => response(changed(page(2, 2))));
  click("Toggle page size");
  await screen.findByRole("alert");
  expect(screen.queryByText(/00:00:42Z/)).toBeNull();
  h.overrides.set("GET " + eventPath, async () => response(page(2, 2)));
  click("Refresh window");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("2 · REVOKED · " + last.occurredAt)).toBeInTheDocument();
  expect(screen.getByText("1 · ACTIVATED · " + time)).toBeInTheDocument();
});

test.each(["old-first", "current-first"])(
  "overlapping deferred reads and Query recreation never install canceled facts: %s", async (order) => {
    const h = fixture(), old = deferred<Response>(), current = deferred<Response>();
    mountProbe(h);
    let requests = 0;
    h.overrides.set("GET " + eventPath, async () => {
      requests++;
      return requests === 1 ? old.promise : current.promise;
    });
    await waitFor(() => expect(requests).toBe(1));
    const key = eventQuery(h).queryKey;
    h.cache.removeQueries({ queryKey: key, exact: true });
    click("Late first-window observer");
    await waitFor(() => expect(requests).toBe(2));
    if (order === "old-first") {
      await act(async () => old.resolve(response(changed(page(2)))));
      expect(screen.queryByText(/00:00:42Z/)).toBeNull();
      await act(async () => current.resolve(response(page(2))));
    } else {
      await act(async () => current.resolve(response(page(2))));
      await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
      await act(async () => old.resolve(response(changed(page(2)))));
    }
    fireEvent.click(screen.getByRole("button", { name: /Rerender observers/ }));
    await waitFor(() => expect(eventQuery(h).getObserversCount()).toBe(2));
    await waitFor(() => expect(screen.getAllByText("2 · REVOKED · " + last.occurredAt)).toHaveLength(2));
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    await act(async () => h.cache.setQueryData(key, changed(page(2))));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.queryByText(/00:00:42Z/)).toBeNull();
    expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
  },
);

test("FRA-02: default25 new-head omission is rejected and genuine history recovers", async () => {
  const h = fixture(); mountProbe(h, { initialMax: 1, initialLimit: 25 });
  await screen.findByText("1 · ACTIVATED · " + time);
  const omitted = { items: [last], limit: 25, nextMaxEventNumber: null };
  h.overrides.set("GET " + eventPath, async () => response(omitted));
  click("Late first-window observer");
  const regions = screen.getAllByRole("region", { name: "Observed event window" });
  await within(regions[1]).findByRole("alert");
  expect(eventQuery(h, 2, 25).state.data).toBeUndefined();
  expect(eventQuery(h, 1, 25).getObserversCount()).toBe(1);
  expect(eventQuery(h, 2, 25).getObserversCount()).toBe(1);
  expect(regions[0]).toHaveTextContent("1 · ACTIVATED · " + time);
  expect(regions[1]).not.toHaveTextContent("2 · REVOKED");
  await act(async () => h.cache.setQueryData(eventQuery(h, 2, 25).queryKey, omitted));
  expect(regions[1]).not.toHaveTextContent("2 · REVOKED");
  expect(within(regions[1]).getByRole("alert")).toBeInTheDocument();
  expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(2);
  h.overrides.set("GET " + eventPath, async () => response(page(2, 25)));
  fireEvent.click(within(regions[1]).getByRole("button", { name: "Refresh window" }));
  await within(regions[1]).findByText("2 · REVOKED · " + last.occurredAt);
  expect(regions[1]).toHaveTextContent("1 · ACTIVATED · " + time);
  expect(within(regions[1]).queryByRole("alert")).toBeNull();
  expect(regions[0]).toHaveTextContent("1 · ACTIVATED · " + time);
  expect(eventQuery(h, 2, 25).options.retry).toBe(false);
  expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(3);
  expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
});

test("FRA-02: both known pages survive eviction and control a recreated standard window", async () => {
  const h = fixture(); await readyProbe(h);
  const originalHead = eventQuery(h, 2).queryKey;
  click("Older window"); await screen.findByText("1 · ACTIVATED · " + time);
  h.cache.removeQueries({ queryKey: originalHead, exact: true });
  h.overrides.set("GET " + eventPath, async () => response({ items: [last], limit: 25, nextMaxEventNumber: null }));
  click("Standard first-window observer");
  await screen.findByRole("alert");
  const key = eventQuery(h, 2, 25).queryKey;
  expect(eventQuery(h, 2, 25).state.data).toBeUndefined();
  h.cache.removeQueries({ queryKey: key, exact: true });
  fireEvent.click(screen.getByRole("button", { name: /Rerender observers/ }));
  await waitFor(() => expect(eventQuery(h, 2, 25).getObserversCount()).toBe(1));
  await waitFor(() => expect(screen.queryByText("Fetching history")).toBeNull());
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("2 · REVOKED · " + last.occurredAt)).toBeNull();
  h.overrides.set("GET " + eventPath, async () => response(page(2, 25)));
  const regions = screen.getAllByRole("region", { name: "Observed event window" });
  fireEvent.click(within(regions[1]).getByRole("button", { name: "Refresh window" }));
  await within(regions[1]).findByText("2 · REVOKED · " + last.occurredAt);
  expect(regions[1]).toHaveTextContent("1 · ACTIVATED · " + time);
  expect(regions[0]).toHaveTextContent("1 · ACTIVATED · " + time);
  expect(within(regions[0]).queryByRole("alert")).toBeNull();
  expect(eventQuery(h, 2, 25).options.retry).toBe(false);
  expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
});

test.each(["omission-first", "complete-first"])(
  "FRA-02: concurrent authenticated window responses preserve coherent history: %s", async (order) => {
    const h = fixture(); mountProbe(h, { initialMax: 1, initialLimit: 2 });
    await screen.findByText("1 · ACTIVATED · " + time);
    const omitted = deferred<Response>(), complete = deferred<Response>();
    let omissionRequests = 0, completeRequests = 0;
    h.overrides.set("GET " + eventPath, async (request) => {
      if (new URL(request.url).searchParams.get("limit") === "25") {
        omissionRequests++; return omitted.promise;
      }
      completeRequests++; return complete.promise;
    });
    click("Standard first-window observer"); click("Late first-window observer");
    await waitFor(() => expect([omissionRequests, completeRequests]).toEqual([1, 1]));
    const bad = { items: [last], limit: 25, nextMaxEventNumber: null };
    if (order === "omission-first") {
      await act(async () => omitted.resolve(response(bad)));
      await screen.findByRole("alert");
      await act(async () => complete.resolve(response(page(2, 2))));
    } else {
      await act(async () => complete.resolve(response(page(2, 2))));
      await screen.findByText("2 · REVOKED · " + last.occurredAt);
      await act(async () => omitted.resolve(response(bad)));
    }
    await waitFor(() => expect(screen.queryByText("Fetching history")).toBeNull());
    const regions = screen.getAllByRole("region", { name: "Observed event window" });
    expect(within(regions[2]).getByRole("alert")).toBeInTheDocument();
    expect(regions[2]).not.toHaveTextContent("2 · REVOKED");
    expect(regions[1]).toHaveTextContent("2 · REVOKED · " + last.occurredAt);
    expect(regions[1]).toHaveTextContent("1 · ACTIVATED · " + time);
    expect(regions[0]).toHaveTextContent("1 · ACTIVATED · " + time);
    expect(eventQuery(h, 2, 25).state.data).toBeUndefined();
    h.overrides.set("GET " + eventPath, async () => response(page(2, 25)));
    fireEvent.click(within(regions[2]).getByRole("button", { name: "Refresh window" }));
    await within(regions[2]).findByText("2 · REVOKED · " + last.occurredAt);
    expect(regions[2]).toHaveTextContent("1 · ACTIVATED · " + time);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(omissionRequests).toBe(1); expect(completeRequests).toBe(1);
    expect(eventQuery(h, 2, 25).options.retry).toBe(false);
    expect(h.calls.filter((r) => r.method !== "GET" || r.url.endsWith("/content"))).toHaveLength(0);
  },
);
