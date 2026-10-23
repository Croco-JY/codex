import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  checkedCandidate,
  checkedCandidates,
  type Candidate,
  supportedFacility,
} from "./facilityCandidateModel";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const S = id(1),
  F = id(2),
  F2 = id(3),
  U = id(4),
  U2 = id(5),
  stamp = "2026-10-23T00:00:00Z";
const row = (n = 10, facilityId = F): Candidate => ({
  id: id(n),
  styleId: S,
  facilityId,
  createdAt: stamp,
});
const project = (org = "A") => ({
  id: "P",
  organizationId: org,
  name: `Project ${org}`,
  description: null,
  status: parentArchived ? "ARCHIVED" : "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
});
const style = (org = "A") => ({
  id: S,
  projectId: "P",
  name: `Style ${org}`,
  styleCode: null,
  description: null,
  status: styleArchived ? "ARCHIVED" : "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
});
const reply = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "candidate-reference",
    },
  });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let cache: QueryClient,
  calls: Request[],
  rows: Candidate[],
  role: string,
  listStatus: number,
  postStatus: number,
  deleteStatus: number,
  parentArchived: boolean,
  styleArchived: boolean,
  commitUncertain: boolean,
  more: boolean;
let pDelay: Promise<Response> | undefined,
  sDelay: Promise<Response> | undefined,
  reqDelay: Promise<Response> | undefined,
  selectionDelay: Promise<Response> | undefined,
  listDelay: Promise<Response> | undefined,
  writeDelay: Promise<Response> | undefined,
  reqStatus: number,
  selectionStatus: number;
let facilityData: Map<string, Record<string, unknown>>,
  facilityFailures: Map<string, number>,
  supplierFailures: Map<string, number>,
  supplierStatuses: Map<string, string>,
  facilityDelays: Map<string, Promise<Response>>;
const facility = (key = F) => ({
  id: key,
  supplierId: key === F2 ? U2 : U,
  name: key === F2 ? "Beta Facility" : "Alpha Facility",
  facilityType: "FACTORY",
  status: "ACTIVE",
});
beforeEach(() => {
  setAccessToken();
  calls = [];
  rows = [];
  role = "ORG_OWNER";
  listStatus = postStatus = deleteStatus = reqStatus = selectionStatus = 200;
  parentArchived = styleArchived = commitUncertain = more = false;
  pDelay =
    sDelay =
    reqDelay =
    selectionDelay =
    listDelay =
    writeDelay =
      undefined;
  facilityData = new Map();
  facilityFailures = new Map();
  supplierFailures = new Map();
  supplierStatuses = new Map();
  facilityDelays = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r);
      const u = new URL(r.url),
        p = u.pathname;
      if (p === "/api/identity")
        return reply({
          issuer: "local",
          subject: r.headers.get("X-Dev-Subject") ?? "actor-a",
        });
      if (p === "/api/identity/capabilities")
        return reply({ platformAdmin: true });
      if (p === "/api/organizations")
        return reply(
          role === "NONE"
            ? []
            : ["A", "B"].map((id) => ({
                id,
                name: `Organization ${id}`,
                role,
                status: "ACTIVE",
                version: 0,
              })),
        );
      if (p.startsWith("/api/v1/organizations/")) {
        const org = p.includes("/B/") ? "B" : "A";
        if (p.endsWith("/projects/P"))
          return org === "A" && pDelay ? pDelay : reply(project(org));
        if (p.endsWith(`/styles/${S}`))
          return org === "A" && sDelay ? sDelay : reply(style(org));
        if (p.endsWith("/requirement"))
          return reqDelay ?? reply({}, reqStatus === 200 ? 404 : reqStatus);
        if (p.endsWith("/material-selections"))
          return (
            selectionDelay ??
            reply(
              { items: [], limit: 25, offset: 0, hasMore: false },
              selectionStatus,
            )
          );
        if (p.includes("/facility-candidates")) {
          if (r.method === "POST") {
            if (writeDelay) return writeDelay;
            const body = await r.clone().json();
            if (postStatus === 200 || commitUncertain)
              rows = [{ ...row(100 + rows.length), ...body }, ...rows];
            if (postStatus === 0) throw new TypeError("offline");
            return postStatus === 200
              ? reply(rows[0], 201)
              : reply({ detail: "private raw body" }, postStatus);
          }
          if (r.method === "DELETE") {
            if (writeDelay) return writeDelay;
            if (deleteStatus === 200 || commitUncertain || deleteStatus === 404)
              rows = rows.filter((row) => row.id !== p.split("/").at(-1));
            if (deleteStatus === 0) throw new TypeError("offline");
            return reply({}, deleteStatus === 200 ? 204 : deleteStatus);
          }
          if (org === "A" && listDelay) return listDelay;
          if (listStatus !== 200) return reply({}, listStatus);
          const offset = Number(u.searchParams.get("offset"));
          return reply({
            items: rows.slice(offset, offset + 25),
            limit: 25,
            offset,
            hasMore: rows.length > offset + 25,
          });
        }
      }
      if (p === "/api/v1/facilities")
        return reply({
          items: [
            {
              id: u.searchParams.has("cursor") ? F2 : F,
              name: u.searchParams.has("cursor") ? "Beta site" : "Alpha site",
              facilityType: "FACTORY",
              country: "KR",
              supplierId: U,
            },
          ],
          nextCursor: more && !u.searchParams.has("cursor") ? "next" : null,
        });
      if (p.startsWith("/api/v1/facilities/")) {
        const key = p.split("/").at(-1)!;
        if (facilityDelays.has(key)) return facilityDelays.get(key)!;
        if (facilityFailures.has(key))
          return reply({}, facilityFailures.get(key));
        return reply(facilityData.get(key) ?? facility(key));
      }
      if (p.startsWith("/api/v1/suppliers/")) {
        const key = p.split("/").at(-1)!;
        if (supplierFailures.has(key))
          return reply({}, supplierFailures.get(key));
        return reply({
          id: key,
          displayName: `Supplier ${key}`,
          status: supplierStatuses.get(key) ?? "ACTIVE",
          verificationStatus: "DISCOVERED",
        });
      }
      if (p === "/api/v1/suppliers")
        return reply({ items: [], nextCursor: null });
      if (
        p === "/api/v1/countries" ||
        p === "/api/v1/regions" ||
        p === "/api/v1/industrial-clusters" ||
        p === "/api/v1/capabilities"
      )
        return reply([]);
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  cache?.clear();
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Nav() {
  const n = useNavigate();
  return (
    <>
      <button onClick={() => n(`/organizations/B/projects/P/styles/${S}`)}>
        Go B
      </button>
      <button onClick={() => n(`/organizations/A/projects/P/styles/${S}`)}>
        Go A
      </button>
    </>
  );
}
function mount() {
  cache = createQueryClient();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[`/organizations/A/projects/P/styles/${S}`]}
      >
        <App />
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const region = () =>
  within(screen.getByRole("region", { name: "Facility Candidates" }));
const privateCalls = () =>
  calls.filter((r) => r.url.includes("/facility-candidates"));
const writes = () => privateCalls().filter((r) => r.method !== "GET");
const exactFacilities = () =>
  calls.filter((r) =>
    /^\/api\/v1\/facilities\/[a-f0-9-]+$/.test(new URL(r.url).pathname),
  );
const exactSuppliers = () =>
  calls.filter((r) =>
    /^\/api\/v1\/suppliers\/[a-f0-9-]+$/.test(new URL(r.url).pathname),
  );
async function ready() {
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  await waitFor(() => expect(privateCalls().length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(
      region().queryByLabelText("Loading Facility Candidates"),
    ).not.toBeInTheDocument(),
  );
}
async function pick() {
  await userEvent.click(
    region().getByRole("button", { name: "Choose Facility" }),
  );
  await userEvent.click(
    await region().findByRole("button", {
      name: "Choose Alpha site",
    }),
  );
}
async function enabled() {
  await waitFor(() =>
    expect(
      region().getByRole("button", {
        name: "Add Facility Candidate",
      }),
    ).toBeEnabled(),
  );
}
async function add() {
  await userEvent.click(
    region().getByRole("button", {
      name: "Add Facility Candidate",
    }),
  );
}
async function remove() {
  await userEvent.click(
    region().getByRole("button", { name: "Remove candidate" }),
  );
  await userEvent.click(
    region().getByRole("button", { name: "Confirm remove" }),
  );
}

test("empty 200 uses complete private hierarchy key", async () => {
  mount();
  await ready();
  expect(
    region().getByText(
      "No Facility candidates have been added for this Style.",
    ),
  ).toBeVisible();
  expect(privateCalls()).toHaveLength(1);
  expect(
    cache.getQueryData(
      queryKeys.candidates(getSession().key, "A", "P", S, 25, 0),
    ),
  ).toMatchObject({ items: [] });
});
test.each([404, 403, 500])(
  "collection %s is an error, never absence",
  async (status) => {
    listStatus = status;
    mount();
    await screen.findByRole("heading", {
      name:
        status === 403
          ? "Access denied"
          : status === 404
            ? "Not found"
            : "Service unavailable",
    });
    expect(
      screen.queryByText(
        "No Facility candidates have been added for this Style.",
      ),
    ).not.toBeInTheDocument();
    expect(privateCalls()).toHaveLength(1);
  },
);
test("writer sends only facilityId and does not invalidate global records", async () => {
  mount();
  await ready();
  await pick();
  await enabled();
  await add();
  await region().findByText("Facility candidate added.");
  expect(writes()).toHaveLength(1);
  expect(await writes()[0].clone().json()).toEqual({ facilityId: F });
  expect(region().getByText(row(100).id, { exact: true })).toBeVisible();
  expect(
    cache.getQueryState(queryKeys.facility(getSession().key, F))?.isInvalidated,
  ).toBe(false);
  expect(exactFacilities()).toHaveLength(1);
  expect(exactSuppliers()).toHaveLength(1);
});
test.each(["VIEWER", "Project", "Style"])(
  "%s makes Candidate read-only",
  async (kind) => {
    rows = [row()];
    if (kind === "VIEWER") role = "VIEWER";
    if (kind === "Project") parentArchived = true;
    if (kind === "Style") styleArchived = true;
    mount();
    await ready();
    await region().findByText(/Alpha Facility/);
    expect(
      region().queryByRole("button", { name: "Choose Facility" }),
    ).not.toBeInTheDocument();
    expect(
      region().queryByRole("button", { name: "Remove candidate" }),
    ).not.toBeInTheDocument();
    expect(writes()).toEqual([]);
  },
);
test("PLATFORM_ADMIN alone cannot bypass Organization resolution", async () => {
  role = "NONE";
  mount();
  await screen.findByRole("heading", { name: "Access denied" });
  expect(privateCalls()).toEqual([]);
});
test("picker shares bounded directory cache, supports existing filters and changing choice follows new Supplier", async () => {
  more = true;
  mount();
  await ready();
  await pick();
  await enabled();
  const initial = exactSuppliers().length;
  await userEvent.click(
    region().getByRole("button", { name: "Load more Facility choices" }),
  );
  const hold = deferred<Response>();
  facilityDelays.set(F2, hold.promise);
  await userEvent.click(
    await region().findByRole("button", { name: "Choose Beta site" }),
  );
  expect(
    region().queryByText(new RegExp(`Supplier ${U}`)),
  ).not.toBeInTheDocument();
  expect(exactSuppliers()).toHaveLength(initial);
  expect(
    region().getByRole("button", { name: "Add Facility Candidate" }),
  ).toBeDisabled();
  await act(async () => hold.resolve(reply(facility(F2))));
  await enabled();
  await region().findByText(new RegExp(`Supplier ${U2}`));
  await add();
  await region().findByText("Facility candidate added.");
  expect(await writes()[0].clone().json()).toEqual({ facilityId: F2 });
  const directory = calls.filter(
    (r) => new URL(r.url).pathname === "/api/v1/facilities",
  );
  expect(directory).toHaveLength(2);
  expect(new URL(directory[0].url).searchParams.get("limit")).toBe("25");
  expect(new URL(directory[0].url).searchParams.has("q")).toBe(false);
  expect(new URL(directory[1].url).searchParams.get("cursor")).toBe("next");
  expect(
    cache.getQueryData([
      "supply",
      getSession().key,
      "facility-directory",
      {},
      25,
    ]),
  ).toBeDefined();
  expect(calls.some((r) => r.url.includes("/capabilities/"))).toBe(false);
});
for (const context of ["row", "chosen"] as const)
  for (const outcome of ["pending", 404, 500, "malformed"] as const)
    test(`${context} Facility ${outcome} creates zero dependent Supplier queries`, async () => {
      const pending = deferred<Response>();
      if (context === "row") rows = [row()];
      if (outcome === "pending") facilityDelays.set(F, pending.promise);
      else if (outcome === "malformed")
        facilityData.set(F, { ...facility(), supplierId: undefined });
      else facilityFailures.set(F, outcome);
      mount();
      await ready();
      if (context === "chosen") await pick();
      await waitFor(() => expect(exactFacilities()).toHaveLength(1));
      expect(exactSuppliers()).toHaveLength(0);
      if (context === "chosen")
        expect(
          region().getByRole("button", { name: "Add Facility Candidate" }),
        ).toBeDisabled();
      else expect(region().getByRole("link", { name: F })).toBeVisible();
      if (outcome === "pending") {
        await act(async () => pending.resolve(reply(facility())));
        await waitFor(() => expect(exactSuppliers()).toHaveLength(1));
      } else {
        await region().findByText("Facility label unavailable");
        expect(exactSuppliers()).toHaveLength(0);
      }
    });
test.each(["ARCHIVED", 404, 500] as const)(
  "Supplier %s is contextual and never disables ACTIVE Facility Add",
  async (state) => {
    if (state === "ARCHIVED") supplierStatuses.set(U, state);
    else supplierFailures.set(U, state);
    mount();
    await ready();
    await pick();
    await enabled();
    if (state === "ARCHIVED")
      await region().findByText(/ARCHIVED · DISCOVERED/);
    else await region().findByText("Supplier label/status unavailable");
    await add();
    await region().findByText("Facility candidate added.");
    expect(writes()).toHaveLength(1);
  },
);
test("shared Supplier is fetched once for several distinct Facilities", async () => {
  rows = [row(), row(11, F2)];
  facilityData.set(F2, { ...facility(F2), supplierId: U });
  mount();
  await ready();
  await waitFor(() => expect(exactSuppliers()).toHaveLength(1));
  await waitFor(() =>
    expect(region().getAllByText(new RegExp(`Supplier ${U}`))).toHaveLength(2),
  );
  expect(exactFacilities()).toHaveLength(2);
  expect(new Set(exactFacilities().map((r) => r.url)).size).toBe(2);
  expect(exactSuppliers()).toHaveLength(1);
});
test("25 distinct current-page Facilities and Suppliers hydrate 50 exact keys, zero capability or speculative reads", async () => {
  rows = Array.from({ length: 26 }, (_, n) => row(100 + n, id(200 + n)));
  for (let n = 0; n < 26; n++)
    facilityData.set(id(200 + n), {
      ...facility(id(200 + n)),
      supplierId: id(500 + n),
    });
  mount();
  await ready();
  await waitFor(() => expect(exactSuppliers()).toHaveLength(25));
  expect(exactFacilities()).toHaveLength(25);
  expect(new Set(exactFacilities().map((r) => r.url)).size).toBe(25);
  expect(new Set(exactSuppliers().map((r) => r.url)).size).toBe(25);
  expect(privateCalls()).toHaveLength(1);
  expect(calls.some((r) => r.url.endsWith(id(225)))).toBe(false);
  expect(
    calls.filter((r) => /facilities\/.+\/capabilities/.test(r.url)),
  ).toHaveLength(0);
  expect(
    calls.some((r) =>
      /suppliers\/.+\/(facilities|materials|listings|verification-events)|sources|provenance/.test(
        r.url,
      ),
    ),
  ).toBe(false);
});
test.each(["Facility", "Supplier"])(
  "archived %s stays visible and unlink remains allowed",
  async (kind) => {
    rows = [row()];
    if (kind === "Facility")
      facilityData.set(F, { ...facility(), status: "ARCHIVED" });
    else supplierStatuses.set(U, "ARCHIVED");
    mount();
    await ready();
    await region().findByText(/ARCHIVED/);
    await remove();
    await region().findByText(
      "No Facility candidates have been added for this Style.",
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0].method).toBe("DELETE");
  },
);
test.each(["duplicate", "Facility", "Project"])(
  "add 409 %s preserves draft, refetches parents and does not retry",
  async (kind) => {
    mount();
    await ready();
    await pick();
    await enabled();
    postStatus = 409;
    if (kind === "duplicate") rows = [row()];
    if (kind === "Facility")
      facilityData.set(F, { ...facility(), status: "ARCHIVED" });
    if (kind === "Project") parentArchived = true;
    await add();
    await region().findByText(/Your Facility draft is retained/);
    await waitFor(() => expect(exactFacilities().length).toBe(2));
    expect(writes()).toHaveLength(1);
    expect(region().getByText(`Chosen Facility: ${F}`)).toBeVisible();
    expect(calls.filter((r) => r.url.endsWith("/projects/P"))).toHaveLength(2);
    expect(calls.filter((r) => r.url.endsWith(`/styles/${S}`))).toHaveLength(2);
    if (kind === "duplicate")
      await region().findByText(/This Facility is already a candidate/);
    if (kind === "Project")
      await region().findByText(/read-only while Project or Style is archived/);
    expect(
      region().getByRole("button", { name: "Add Facility Candidate" }),
    ).toBeDisabled();
  },
);
test("add 404 retains draft and failed Facility refetch cannot issue a Supplier request", async () => {
  mount();
  await ready();
  await pick();
  await enabled();
  await waitFor(() => expect(exactSuppliers()).toHaveLength(1));
  postStatus = 404;
  facilityFailures.set(F, 404);
  await add();
  await region().findByText(/Your Facility draft is retained/);
  await waitFor(() => expect(exactFacilities()).toHaveLength(2));
  expect(exactSuppliers()).toHaveLength(1);
  expect(region().getByText(`Chosen Facility: ${F}`)).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(
    region().queryByText(new RegExp(`Supplier ${U}`)),
  ).not.toBeInTheDocument();
});
for (const status of [0, 500])
  for (const committed of [true, false])
    test(`ambiguous POST ${status} committed=${committed} never resubmits`, async () => {
      mount();
      await ready();
      await pick();
      await enabled();
      postStatus = status;
      commitUncertain = committed;
      await add();
      await region().findByText(/Your Facility draft is retained/);
      await waitFor(() =>
        expect(privateCalls().filter((r) => r.method === "GET")).toHaveLength(
          2,
        ),
      );
      if (committed) await region().findByText(/matching Candidate exists/);
      else await region().findByText(/outcome remains uncertain/);
      expect(writes()).toHaveLength(1);
      expect(
        region().getByRole("button", { name: "Add Facility Candidate" }),
      ).toBeDisabled();
    });
test("remove requires confirmation and cancel is non-mutating", async () => {
  rows = [row()];
  mount();
  await ready();
  await userEvent.click(
    region().getByRole("button", { name: "Remove candidate" }),
  );
  expect(
    region().getByText(/Facility and Supplier remain unchanged/),
  ).toBeVisible();
  await userEvent.click(
    region().getByRole("button", { name: "Cancel remove" }),
  );
  expect(writes()).toEqual([]);
  await remove();
  await region().findByText("Facility candidate removed.");
  expect(writes()).toHaveLength(1);
  expect(exactFacilities()).toHaveLength(1);
});
test.each([404, 409, 0, 500])(
  "remove %s refreshes bounded state without retry",
  async (status) => {
    rows = [row()];
    mount();
    await ready();
    deleteStatus = status;
    if (status === 409) parentArchived = true;
    await remove();
    if (status === 404)
      await region().findByText("Candidate is no longer present.");
    else await region().findByText(/Removal outcome requires review/);
    await waitFor(() =>
      expect(privateCalls().filter((r) => r.method === "GET")).toHaveLength(2),
    );
    expect(writes()).toHaveLength(1);
    if (status === 409) {
      await region().findByText(/read-only while Project or Style is archived/);
      expect(
        region().getByRole("button", { name: "Confirm remove" }),
      ).toBeDisabled();
      expect(calls.filter((r) => r.url.endsWith("/projects/P"))).toHaveLength(
        2,
      );
    }
  },
);
test("later-page unlink resets offset to zero", async () => {
  rows = Array.from({ length: 26 }, (_, n) => row(100 + n));
  mount();
  await ready();
  await userEvent.click(
    region().getByRole("button", { name: "Next candidates" }),
  );
  await region().findByText(row(125).id, { exact: true });
  await remove();
  await waitFor(() =>
    expect(
      region().getByRole("button", { name: "Previous candidates" }),
    ).toBeDisabled(),
  );
  expect(
    new URL(
      privateCalls()
        .filter((r) => r.method === "GET")
        .at(-1)!.url,
    ).searchParams.get("offset"),
  ).toBe("0");
});
test.each(["project", "style"])(
  "%s pending gates every Style descendant",
  async (kind) => {
    const d = deferred<Response>();
    if (kind === "project") pDelay = d.promise;
    else sDelay = d.promise;
    mount();
    await waitFor(() =>
      expect(
        calls.some((r) =>
          r.url.endsWith(kind === "project" ? "/projects/P" : `/styles/${S}`),
        ),
      ).toBe(true),
    );
    expect(
      calls.some((r) =>
        /requirement|material-selections|facility-candidates/.test(r.url),
      ),
    ).toBe(false);
    if (kind === "project")
      expect(calls.some((r) => r.url.endsWith(`/styles/${S}`))).toBe(false);
    await act(async () =>
      d.resolve(reply(kind === "project" ? project() : style())),
    );
    await ready();
    for (const child of [
      "requirement",
      "material-selections",
      "facility-candidates",
    ])
      expect(
        calls.filter((r) => new URL(r.url).pathname.endsWith(child)),
      ).toHaveLength(1);
  },
);
test.each(["requirement", "selections", "candidates"])(
  "held %s does not serialize either successful sibling",
  async (child) => {
    const d = deferred<Response>();
    if (child === "requirement") reqDelay = d.promise;
    if (child === "selections") selectionDelay = d.promise;
    if (child === "candidates") listDelay = d.promise;
    mount();
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    if (child !== "candidates")
      await region().findByText(
        "No Facility candidates have been added for this Style.",
      );
    if (child !== "selections")
      await screen.findByText("No materials selected for this Style.");
    if (child !== "requirement")
      await screen.findByText(
        "No Requirement sheet has been created for this Style.",
      );
    for (const name of [
      "requirement",
      "material-selections",
      "facility-candidates",
    ])
      expect(
        calls.filter((r) => new URL(r.url).pathname.endsWith(name)),
      ).toHaveLength(1);
    await act(async () =>
      d.resolve(
        child === "requirement"
          ? reply({}, 404)
          : reply({ items: [], limit: 25, offset: 0, hasMore: false }),
      ),
    );
  },
);
test.each(["requirement", "selections"])(
  "%s 5xx cannot suppress successful Candidates",
  async (kind) => {
    if (kind === "requirement") reqStatus = 500;
    else selectionStatus = 500;
    mount();
    await ready();
    await region().findByText(
      "No Facility candidates have been added for this Style.",
    );
    expect(
      region().getByRole("button", { name: "Choose Facility" }),
    ).toBeEnabled();
  },
);
test.each(["project", "style"])(
  "%s hierarchy 404 suppresses every child read",
  async (kind) => {
    if (kind === "project") pDelay = Promise.resolve(reply({}, 404));
    else sDelay = Promise.resolve(reply({}, 404));
    mount();
    await screen.findByRole("heading", { name: "Not found" });
    expect(
      calls.some((r) =>
        /requirement|material-selections|facility-candidates/.test(r.url),
      ),
    ).toBe(false);
  },
);
test.each(["read", "POST", "DELETE"])(
  "old %s completion is isolated across A→B→A while global caches survive",
  async (kind) => {
    if (kind === "DELETE") rows = [row()];
    const d = deferred<Response>();
    if (kind === "read") listDelay = d.promise;
    mount();
    if (kind === "read")
      await screen.findByRole("heading", { name: "Style A", level: 1 });
    else {
      await ready();
      if (kind === "POST") {
        await pick();
        await enabled();
      }
      writeDelay = d.promise;
      if (kind === "POST") await add();
      else await remove();
    }
    await waitFor(() => expect(privateCalls().length).toBeGreaterThan(0));
    const old = privateCalls().at(-1)!;
    const global = queryKeys.facility(getSession().key, F);
    cache.setQueryData(global, { ...facility(), name: "Global sentinel" });
    listDelay = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Go B" }));
    await screen.findByRole("heading", { name: "Style B", level: 1 });
    expect(old.signal.aborted).toBe(true);
    expect(region().queryByText(/Chosen Facility:/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go A" }));
    await ready();
    const count = privateCalls().length;
    await act(async () =>
      d.resolve(
        kind === "read"
          ? reply({ items: [row(900)], limit: 25, offset: 0, hasMore: false })
          : kind === "POST"
            ? reply(row(901), 201)
            : reply({}, 204),
      ),
    );
    expect(privateCalls()).toHaveLength(count);
    expect(
      region().queryByText("Facility candidate added."),
    ).not.toBeInTheDocument();
    expect(
      region().queryByRole("region", { name: "Add Facility Candidate" }),
    ).not.toBeInTheDocument();
    expect(cache.getQueryData(global)).toMatchObject({
      name: "Global sentinel",
    });
  },
);
test("Actor switch aborts old Candidate mutation and clears its picker", async () => {
  mount();
  await ready();
  await pick();
  await enabled();
  const d = deferred<Response>();
  writeDelay = d.promise;
  await add();
  const old = writes()[0];
  await act(async () => setLocalSubject("actor-b"));
  await waitFor(() => expect(old.signal.aborted).toBe(true));
  await act(async () => d.resolve(reply(row(), 201)));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(screen.queryByText(/Chosen Facility:/)).not.toBeInTheDocument();
});
test.each([
  { id: "" },
  { facilityId: 123 },
  { styleId: id(999) },
  { createdAt: "bad" },
])("malformed private Candidate blocks destructive UI %#", (patch) => {
  expect(() =>
    checkedCandidate({ ...row(), ...patch } as Candidate, S),
  ).toThrow();
});
test("page and Facility response guards fail closed", () => {
  expect(() =>
    checkedCandidates(
      { items: [row()], limit: 100, offset: 0, hasMore: false },
      S,
      0,
    ),
  ).toThrow();
  for (const patch of [
    { supplierId: undefined },
    { id: F2 },
    { status: "DRAFT" },
    { name: null },
    { facilityType: "UNKNOWN" },
  ])
    expect(supportedFacility({ ...facility(), ...patch }, F)).toBe(false);
});
