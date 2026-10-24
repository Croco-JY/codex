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
  checkedSelection,
  checkedSelections,
  pageReferences,
  type Selection,
} from "./materialSelectionModel";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const S = id(1),
  M = id(2),
  V = id(3),
  L = id(4),
  M2 = id(5),
  stamp = "2026-10-23T00:00:00Z";
const row = (
  n = 10,
  variant: string | null = V,
  listing: string | null = L,
): Selection => ({
  id: id(n),
  styleId: S,
  materialId: M,
  variantId: variant,
  listingId: listing,
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
      "X-Request-ID": "selection-reference",
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
  rows: Selection[],
  role: string,
  listStatus: number,
  postStatus: number,
  deleteStatus: number,
  parentArchived: boolean,
  styleArchived: boolean;
let pDelay: Promise<Response> | undefined,
  sDelay: Promise<Response> | undefined,
  reqDelay: Promise<Response> | undefined,
  listDelay: Promise<Response> | undefined,
  writeDelay: Promise<Response> | undefined,
  reqStatus: number,
  more: boolean,
  commitUncertain: boolean;
let statuses: Map<string, string>, failures: Map<string, number>;
beforeEach(() => {
  setAccessToken();
  calls = [];
  rows = [];
  role = "ORG_OWNER";
  listStatus = postStatus = deleteStatus = reqStatus = 200;
  parentArchived = styleArchived = more = commitUncertain = false;
  pDelay = sDelay = reqDelay = listDelay = writeDelay = undefined;
  statuses = new Map();
  failures = new Map();
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
        if (p.endsWith("/development-references"))
          return reply({ items: [], limit: 25, offset: 0, hasMore: false });
        if (p.endsWith("/facility-candidates"))
          return reply({ items: [], limit: 25, offset: 0, hasMore: false });
        const org = p.includes("/B/") ? "B" : "A";
        if (p.endsWith("/projects/P"))
          return org === "A" && pDelay ? pDelay : reply(project(org));
        if (p.endsWith(`/styles/${S}`))
          return org === "A" && sDelay ? sDelay : reply(style(org));
        if (p.endsWith("/requirement"))
          return reqDelay ?? reply({}, reqStatus === 200 ? 404 : reqStatus);
        if (p.includes("/material-selections")) {
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
      if (p === "/api/v1/materials")
        return reply({
          items: [
            {
              id: u.searchParams.has("cursor") ? M2 : M,
              displayName: u.searchParams.has("cursor")
                ? "Other fabric"
                : "Wool fabric",
              status: "ACTIVE",
            },
          ],
          nextCursor: more && !u.searchParams.has("cursor") ? "next" : null,
        });
      if (p.endsWith("/variants"))
        return reply([
          {
            id: V,
            materialId: M,
            variantName: "Blue variant",
            status: "ACTIVE",
          },
          {
            id: id(90),
            materialId: M,
            variantName: "Archived variant",
            status: "ARCHIVED",
          },
        ]);
      if (p.endsWith("/listings"))
        return reply([
          {
            id: L,
            materialId: M,
            sellerArticleNumber: "Independent seller",
            status: "ACTIVE",
          },
          {
            id: id(91),
            materialId: M,
            sellerArticleNumber: "Archived listing",
            status: "ARCHIVED",
          },
        ]);
      const kind = p.startsWith("/api/v1/material-variants/")
        ? "variant"
        : p.startsWith("/api/v1/material-listings/")
          ? "listing"
          : p.startsWith("/api/v1/materials/")
            ? "material"
            : null;
      if (kind) {
        const key = `${kind}:${p.split("/").at(-1)}`,
          ref = p.split("/").at(-1)!;
        if (failures.has(key)) return reply({}, failures.get(key));
        const parent =
          rows.find((row) => row.variantId === ref || row.listingId === ref)
            ?.materialId ?? M;
        return reply({
          id: ref,
          materialId: parent,
          status: statuses.get(key) ?? "ACTIVE",
          displayName: "Live fabric",
          variantName: "Live variant",
          sellerArticleNumber: "Live listing",
        });
      }
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
  within(screen.getByRole("region", { name: "Material Selections" }));
const privateCalls = () =>
  calls.filter((r) => r.url.includes("/material-selections"));
const writes = () => privateCalls().filter((r) => r.method !== "GET");
async function ready() {
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  await waitFor(() => expect(privateCalls().length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(
      region().queryByLabelText("Loading Material Selections"),
    ).not.toBeInTheDocument(),
  );
}
async function pick(v = false, l = false) {
  await userEvent.click(
    region().getByRole("button", { name: "Choose catalog Material" }),
  );
  await userEvent.type(
    region().getByLabelText("Catalog Material keyword"),
    "wool",
  );
  await userEvent.click(
    region().getByRole("button", { name: "Search active Materials" }),
  );
  await userEvent.click(
    await region().findByRole("button", { name: "Choose Wool fabric" }),
  );
  if (v)
    await userEvent.selectOptions(
      region().getByLabelText("Optional Variant"),
      V,
    );
  if (l)
    await userEvent.selectOptions(
      region().getByLabelText("Optional Listing"),
      L,
    );
  await waitFor(() =>
    expect(
      region().getByRole("button", {
        name: "Add Material Selection",
      }),
    ).toBeEnabled(),
  );
}
async function add() {
  await userEvent.click(
    region().getByRole("button", {
      name: "Add Material Selection",
    }),
  );
}
async function remove() {
  await userEvent.click(
    region().getByRole("button", { name: "Remove selection" }),
  );
  await userEvent.click(
    region().getByRole("button", { name: "Confirm remove" }),
  );
}

test("200 empty page is normal, and private query key includes complete hierarchy", async () => {
  mount();
  await ready();
  expect(
    region().getByText("No materials selected for this Style."),
  ).toBeVisible();
  expect(privateCalls()).toHaveLength(1);
  expect(
    cache.getQueryData(
      queryKeys.selections(getSession().key, "A", "P", S, 25, 0),
    ),
  ).toMatchObject({ items: [] });
});
test.each([404, 403, 500])(
  "list %s remains an error rather than an empty page",
  async (status) => {
    listStatus = status;
    mount();
    await screen.findByRole("heading", {
      name:
        status === 404
          ? "Not found"
          : status === 403
            ? "Access denied"
            : "Service unavailable",
    });
    expect(
      screen.queryByText("No materials selected for this Style."),
    ).not.toBeInTheDocument();
    expect(privateCalls()).toHaveLength(1);
  },
);
test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "explicit scope Variant=%s Listing=%s sends only three identity facts",
  async (v, l) => {
    mount();
    await ready();
    await pick(v, l);
    expect(writes()).toHaveLength(0);
    await add();
    await region().findByText("Material selection added.");
    expect(await writes()[0].clone().json()).toEqual({
      materialId: M,
      variantId: v ? V : null,
      listingId: l ? L : null,
    });
    expect(writes()).toHaveLength(1);
    const materialSearch = calls.find(
      (r) => new URL(r.url).pathname === "/api/v1/materials",
    )!;
    expect(new URL(materialSearch.url).searchParams.get("status")).toBe(
      "ACTIVE",
    );
    expect(
      cache
        .getMutationCache()
        .getAll()
        .every((m) => m.options.retry === false),
    ).toBe(true);
  },
);
test("Material change clears independent optional choices; search supports bounded load more", async () => {
  more = true;
  mount();
  await ready();
  await pick(true, true);
  await userEvent.click(
    region().getByRole("button", { name: "Load more Materials" }),
  );
  await userEvent.click(
    await region().findByRole("button", { name: "Choose Other fabric" }),
  );
  expect(region().getByLabelText("Optional Variant")).toHaveValue("");
  expect(region().getByLabelText("Optional Listing")).toHaveValue("");
  expect(writes()).toHaveLength(0);
  await add();
  await region().findByText("Material selection added.");
  expect((await writes()[0].clone().json()).materialId).toBe(M2);
});
test.each(["VIEWER", "ARCHIVED", "PLATFORM_ADMIN"])(
  "%s cannot mutate private edges",
  async (state) => {
    if (state === "PLATFORM_ADMIN") role = "NONE";
    if (state === "VIEWER") role = state;
    if (state === "ARCHIVED") parentArchived = true;
    rows = [row()];
    mount();
    if (state === "PLATFORM_ADMIN") {
      await screen.findByRole("heading", { name: "Access denied" });
      expect(privateCalls()).toHaveLength(0);
    } else {
      await ready();
      expect(
        region().queryByRole("button", { name: "Choose catalog Material" }),
      ).not.toBeInTheDocument();
      expect(
        region().queryByRole("button", { name: "Remove selection" }),
      ).not.toBeInTheDocument();
    }
    expect(writes()).toHaveLength(0);
  },
);
test("duplicate 409 retains draft and shows matching scope without retry", async () => {
  mount();
  await ready();
  await pick(true, true);
  rows = [row()];
  postStatus = 409;
  await add();
  await region().findByText(/This material scope is already selected/);
  expect(region().getByLabelText("Optional Variant")).toHaveValue(V);
  expect(region().getByLabelText("Optional Listing")).toHaveValue(L);
  expect(writes()).toHaveLength(1);
  expect(region().getByText("selection-reference")).toBeVisible();
});
test.each(["parent", "material"])(
  "409 refreshes %s state and retains draft read-only or inactive",
  async (kind) => {
    mount();
    await ready();
    await pick();
    if (kind === "parent") parentArchived = true;
    else statuses.set(`material:${M}`, "ARCHIVED");
    postStatus = 409;
    await add();
    await region().findByText(/Your selection draft is retained/);
    await waitFor(() =>
      expect(
        calls.filter((r) => r.url.endsWith("/projects/P")).length,
      ).toBeGreaterThan(1),
    );
    expect(
      region().getByRole("button", {
        name: "Add Material Selection",
      }),
    ).toBeDisabled();
    if (kind === "material")
      await region().findByText(/Live fabric · ARCHIVED/);
    else
      expect(
        region().getByLabelText("Catalog Material keyword"),
      ).toHaveAttribute("readonly");
  },
);
test("add 404 preserves choices and refreshes only those exact references", async () => {
  mount();
  await ready();
  await pick(true, true);
  postStatus = 404;
  failures.set(`variant:${V}`, 404);
  await add();
  await region().findByRole("heading", { name: "Not found" });
  expect(region().getByLabelText("Optional Variant")).toHaveValue(V);
  expect(writes()).toHaveLength(1);
  await waitFor(() =>
    expect(
      calls.filter((r) => r.url.endsWith(`/material-variants/${V}`)).length,
    ).toBe(2),
  );
});
test.each([0, 500])(
  "ambiguous POST %s refetches first page without automatic second mutation",
  async (status) => {
    mount();
    await ready();
    await pick();
    postStatus = status;
    commitUncertain = true;
    await add();
    await region().findByText(/A matching Selection exists/);
    expect(writes()).toHaveLength(1);
    expect(
      region().getByText(/Your selection draft is retained/),
    ).toBeVisible();
  },
);
test("remove requires confirmation, leaves canonical cache intact and reports success", async () => {
  rows = [row()];
  mount();
  await ready();
  await region().findByText("Live fabric · ACTIVE");
  const canonical = cache.getQueryData(queryKeys.material(getSession().key, M));
  await userEvent.click(
    region().getByRole("button", { name: "Remove selection" }),
  );
  expect(writes()).toHaveLength(0);
  await userEvent.click(
    region().getByRole("button", { name: "Cancel remove" }),
  );
  await remove();
  await region().findByText("Material selection removed.");
  expect(writes()).toHaveLength(1);
  expect(writes()[0].method).toBe("DELETE");
  expect(cache.getQueryData(queryKeys.material(getSession().key, M))).toEqual(
    canonical,
  );
});
test.each([404, 409, 0, 500])(
  "remove %s is never automatically retried and refreshes the bounded collection",
  async (status) => {
    rows = [row()];
    mount();
    await ready();
    deleteStatus = status;
    if (status === 409) styleArchived = true;
    if (status === 0 || status === 500) commitUncertain = true;
    await remove();
    await region().findByText(
      status === 404
        ? "Selection is no longer present."
        : /Removal outcome requires review/,
    );
    expect(writes()).toHaveLength(1);
    if (status === 409) {
      await region().findByText(/read-only while Project or Style is archived/);
      expect(
        region().getByRole("button", { name: "Confirm remove" }),
      ).toBeDisabled();
    }
  },
);
test("pagination is bounded; removal at later offset resets to first page", async () => {
  rows = Array.from({ length: 26 }, (_, n) => row(n + 100, null, null));
  mount();
  await ready();
  await userEvent.click(
    region().getByRole("button", { name: "Next selections" }),
  );
  await waitFor(() =>
    expect(
      region().getAllByRole("button", { name: "Remove selection" }),
    ).toHaveLength(1),
  );
  await remove();
  await region().findByText("Material selection removed.");
  expect(
    region().getByRole("button", { name: "Previous selections" }),
  ).toBeDisabled();
  expect(
    new URL(
      privateCalls()
        .filter((r) => r.method === "GET")
        .at(-1)!.url,
    ).searchParams.get("offset"),
  ).toBe("0");
});
test("live 404/500 labels preserve stored identity and archived references remain visible", async () => {
  rows = [row()];
  statuses.set(`material:${M}`, "ARCHIVED");
  failures.set(`variant:${V}`, 404);
  failures.set(`listing:${L}`, 500);
  mount();
  await ready();
  await region().findByText("Live fabric · ARCHIVED");
  expect(region().getByText(V, { exact: false })).toBeVisible();
  expect(region().getByRole("link", { name: L })).toBeVisible();
  expect(
    region().getAllByText("Label unavailable", { exact: false }).length,
  ).toBe(2);
  expect(rows).toHaveLength(1);
});
test("shared canonical references deduplicate into one in-flight global key each", async () => {
  rows = [
    row(10, null, null),
    row(11, V, null),
    row(12, null, L),
    row(13, V, L),
  ];
  mount();
  await ready();
  await region().findAllByText("Live fabric · ACTIVE");
  await waitFor(() =>
    expect(
      calls.filter((r) => new URL(r.url).pathname === `/api/v1/materials/${M}`),
    ).toHaveLength(1),
  );
  expect(
    calls.filter((r) => r.url.endsWith(`/material-variants/${V}`)),
  ).toHaveLength(1);
  expect(
    calls.filter((r) => r.url.endsWith(`/material-listings/${L}`)),
  ).toHaveLength(1);
});
test("25 distinct full scopes hydrate exactly 75 unique current-page identities, without next page or recursive fanout", async () => {
  rows = Array.from({ length: 26 }, (_, n) => ({
    ...row(n + 100),
    materialId: id(n + 1000),
    variantId: id(n + 2000),
    listingId: id(n + 3000),
  }));
  mount();
  await ready();
  const exact = () =>
    calls.filter((r) =>
      /\/api\/v1\/(materials|material-variants|material-listings)\/[a-f0-9-]+$/.test(
        new URL(r.url).pathname,
      ),
    );
  await waitFor(() => expect(exact()).toHaveLength(75));
  expect(new Set(exact().map((r) => r.url)).size).toBe(75);
  expect(privateCalls().filter((r) => r.method === "GET")).toHaveLength(1);
  expect(
    calls.some(
      (r) =>
        r.url.includes(id(1025)) ||
        r.url.includes(id(2025)) ||
        r.url.includes(id(3025)),
    ),
  ).toBe(false);
  expect(
    calls.some((r) => /suppliers|prices|inventory|sources/.test(r.url)),
  ).toBe(false);
});
test.each(["project", "style"])(
  "%s pending gates all descendant requests; success enables both sibling reads",
  async (kind) => {
    const pending = deferred<Response>();
    if (kind === "project") pDelay = pending.promise;
    else sDelay = pending.promise;
    mount();
    await waitFor(() =>
      expect(
        calls.some((r) =>
          r.url.endsWith(kind === "project" ? "/projects/P" : `/styles/${S}`),
        ),
      ).toBe(true),
    );
    expect(privateCalls()).toHaveLength(0);
    expect(calls.some((r) => r.url.endsWith("/requirement"))).toBe(false);
    if (kind === "project")
      expect(calls.some((r) => r.url.endsWith(`/styles/${S}`))).toBe(false);
    await act(async () =>
      pending.resolve(reply(kind === "project" ? project() : style())),
    );
    await ready();
    expect(calls.filter((r) => r.url.endsWith("/requirement"))).toHaveLength(1);
    expect(privateCalls()).toHaveLength(1);
  },
);
test.each(["requirement", "selections"])(
  "pending %s does not serialize its sibling",
  async (child) => {
    const pending = deferred<Response>();
    if (child === "requirement") reqDelay = pending.promise;
    else listDelay = pending.promise;
    mount();
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    if (child === "requirement")
      await region().findByText("No materials selected for this Style.");
    else
      await screen.findByText(
        "No Requirement sheet has been created for this Style.",
      );
    expect(calls.filter((r) => r.url.endsWith("/requirement"))).toHaveLength(1);
    expect(privateCalls()).toHaveLength(1);
    await act(async () =>
      pending.resolve(
        child === "requirement"
          ? reply({}, 404)
          : reply({ items: [], limit: 25, offset: 0, hasMore: false }),
      ),
    );
  },
);
test("Requirement 5xx does not suppress successful Selection collection", async () => {
  reqStatus = 500;
  mount();
  await ready();
  await region().findByText("No materials selected for this Style.");
  expect(
    screen.getByRole("heading", { name: "Service unavailable" }),
  ).toBeVisible();
});
test.each(["read", "POST", "DELETE"])(
  "old %s completion cannot cross A→B→A; catalog cache survives while draft is discarded",
  async (kind) => {
    if (kind === "DELETE") rows = [row()];
    const pending = deferred<Response>();
    if (kind === "read") listDelay = pending.promise;
    mount();
    if (kind === "read")
      await screen.findByRole("heading", { name: "Style A", level: 1 });
    else {
      await ready();
      if (kind === "POST") await pick(true, true);
      writeDelay = pending.promise;
      if (kind === "POST") await add();
      else await remove();
    }
    await waitFor(() => expect(privateCalls().length).toBeGreaterThan(0));
    const old = privateCalls().at(-1)!;
    const global = queryKeys.material(getSession().key, M);
    cache.setQueryData(global, {
      id: M,
      status: "ACTIVE",
      displayName: "Global cache sentinel",
    });
    listDelay = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Go B" }));
    await screen.findByRole("heading", { name: "Style B", level: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Go A" }));
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    await waitFor(() =>
      expect(
        region().queryByLabelText("Loading Material Selections"),
      ).not.toBeInTheDocument(),
    );
    const before = privateCalls().length;
    await act(async () =>
      pending.resolve(
        kind === "read"
          ? reply({ items: [row(900)], limit: 25, offset: 0, hasMore: false })
          : kind === "POST"
            ? reply(row(901), 201)
            : reply({}, 204),
      ),
    );
    expect(old.signal.aborted).toBe(true);
    expect(privateCalls()).toHaveLength(before);
    expect(
      region().queryByRole("region", { name: "Add Material Selection" }),
    ).not.toBeInTheDocument();
    expect(
      region().queryByText("Material selection added."),
    ).not.toBeInTheDocument();
    expect(cache.getQueryData(global)).toMatchObject({
      displayName: "Global cache sentinel",
    });
  },
);
test("Actor switch aborts old Selection mutation and discards picker", async () => {
  mount();
  await ready();
  await pick();
  const pending = deferred<Response>();
  writeDelay = pending.promise;
  await add();
  const old = writes()[0];
  await act(async () => setLocalSubject("actor-b"));
  await waitFor(() => expect(old.signal.aborted).toBe(true));
  await act(async () => pending.resolve(reply(row(), 201)));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(
    screen.queryByRole("region", { name: "Add Material Selection" }),
  ).not.toBeInTheDocument();
});
test.each([
  { id: "" },
  { materialId: 123 },
  { variantId: undefined },
  { listingId: {} },
  { styleId: id(999) },
  { createdAt: "bad" },
])("malformed private identity blocks hydration %#", (patch) => {
  expect(() =>
    checkedSelection({ ...row(), ...patch } as Selection, S),
  ).toThrow();
});
test("page model enforces bounds and distinct-reference cardinality", () => {
  expect(() =>
    checkedSelections(
      { items: [row()], limit: 100, offset: 0, hasMore: false },
      S,
      0,
    ),
  ).toThrow();
  expect(pageReferences([row(), row(11)])).toHaveLength(3);
});
