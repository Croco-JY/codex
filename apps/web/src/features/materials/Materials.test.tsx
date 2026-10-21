import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppShell from "../../app/AppShell";
import { SessionProvider, useSession } from "../../app/session";
import { createQueryClient } from "../../app/queryClient";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "../../api/session";
import type { Material } from "./MaterialSummary";
const supplierId = "10000000-0000-0000-0000-000000000001";
const countryId = "10000000-0000-0000-0000-000000000002";
const fiberId = "10000000-0000-0000-0000-000000000003";
const materialId = "10000000-0000-0000-0000-000000000004";
const material = (name = "Wool twill", id = materialId): Material => ({
  id,
  displayName: name,
  materialType: "FABRIC",
  catalogSupplierId: supplierId,
  catalogArticleNumber: "TW-01",
  originCountryId: countryId,
  compositionCompleteness: "COMPLETE",
  composition: [
    { fiberTypeId: fiberId, fiberCode: "WOOL", percentage: "99.9999" },
  ],
  status: "ACTIVE",
  description: "Soft tailoring fabric",
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "material-test",
    },
  });
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let requests: Request[];
let clients: QueryClient[];
let searchHandler: (url: URL, request: Request) => Response | Promise<Response>;
let supplierStatus: number;
let detailStatus: number;
let row: Material;
beforeEach(() => {
  setLocalSubject("actor-a");
  requests = [];
  clients = [];
  row = material();
  supplierStatus = 200;
  detailStatus = 200;
  searchHandler = () => reply({ items: [row] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject") ?? "actor-a",
        });
      if (url.pathname === "/api/identity/capabilities")
        return reply({ platformAdmin: false });
      if (url.pathname === "/api/v1/materials")
        return searchHandler(url, request);
      if (/\/(variants|listings)$/.test(url.pathname)) return reply([]);
      if (/\/(fabric-spec|leather-spec)$/.test(url.pathname))
        return reply({}, 404);
      if (url.pathname.startsWith("/api/v1/materials/"))
        return reply(row, detailStatus);
      if (url.pathname === "/api/v1/countries")
        return reply([
          { id: countryId, nameEn: "Japan", alpha2: "JP", active: true },
          {
            id: "20000000-0000-0000-0000-000000000002",
            nameEn: "Inactive country",
            active: false,
          },
        ]);
      if (url.pathname === "/api/v1/fiber-types")
        return reply([
          { id: fiberId, code: "WOOL", nameEn: "Wool", active: true },
          {
            id: "20000000-0000-0000-0000-000000000003",
            code: "OLD",
            nameEn: "Inactive fiber",
            active: false,
          },
        ]);
      if (url.pathname === "/api/v1/suppliers")
        return reply({
          items: [
            { id: supplierId, displayName: "Kyoto Textiles", country: "JP" },
          ],
        });
      if (url.pathname.startsWith("/api/v1/suppliers/"))
        return reply(
          { id: supplierId, displayName: "Kyoto Textiles" },
          supplierStatus,
        );
      throw new Error("Unexpected API path");
    }),
  );
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  endSession();
  vi.unstubAllGlobals();
});
function Controls() {
  const location = useLocation(),
    navigate = useNavigate(),
    session = useSession();
  return (
    <>
      <output aria-label="Current URL">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate(-1)}>History back</button>
      <button onClick={() => navigate(1)}>History forward</button>
      <button
        onClick={() =>
          session.select({
            id: "organization-only",
            name: "Selected organization",
            role: "ORG_OWNER",
            version: 0,
          })
        }
      >
        Select working organization
      </button>
    </>
  );
}
function mount(path = "/materials") {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider>
          <AppShell />
          <Controls />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
const searches = () =>
  requests.filter(
    (request) => new URL(request.url).pathname === "/api/v1/materials",
  );
const lastQuery = () => new URL(searches().at(-1)!.url).searchParams;
const expand = async (name: string) => {
  const node = screen.getByText(name, { selector: "summary" });
  if (!(node.parentElement as HTMLDetailsElement).open)
    await userEvent.click(node);
};
test("draft edits do not search; Apply changes URL/results and Clear restores ACTIVE baseline", async () => {
  searchHandler = (url) =>
    reply({ items: url.searchParams.has("q") ? [] : [row] });
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  expect(lastQuery().get("status")).toBe("ACTIVE");
  expect(lastQuery().get("limit")).toBe("25");
  expect(lastQuery().has("cursor")).toBe(false);
  await userEvent.type(screen.getByLabelText("Keyword"), "absent");
  expect(searches()).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(
    await screen.findByText("No materials match these filters"),
  ).toBeVisible();
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    "/materials?q=absent",
  );
  expect(
    screen.getByRole("list", { name: "Applied filters" }),
  ).toHaveTextContent("Keyword: absent");
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await screen.findByRole("link", { name: "Wool twill" });
  expect(screen.getByLabelText("Keyword")).toHaveValue("");
  expect(screen.getByLabelText("Current URL")).toHaveTextContent(
    /^\/materials$/,
  );
});
test("Back/Forward synchronizes form with applied URL and chip removal resets filters", async () => {
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await userEvent.type(screen.getByLabelText("Keyword"), "wool");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(lastQuery().get("q")).toBe("wool"));
  await userEvent.click(screen.getByRole("button", { name: "History back" }));
  await waitFor(() => expect(screen.getByLabelText("Keyword")).toHaveValue(""));
  await userEvent.click(
    screen.getByRole("button", { name: "History forward" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Keyword")).toHaveValue("wool"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Remove keyword filter" }),
  );
  expect(screen.getByLabelText("Keyword")).toHaveValue("");
});
test("invalid exact range prevents Apply and reports accessible field errors", async () => {
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await expand("Technical filters");
  await userEvent.type(screen.getByLabelText("Minimum GSM"), "10");
  await userEvent.type(screen.getByLabelText("Maximum GSM"), "9");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check the highlighted filters",
  );
  expect(screen.getByLabelText("Maximum GSM")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(searches()).toHaveLength(1);
});
test("commercial group is secondary, seller is a name-based choice, terms stay on listings", async () => {
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  expect(
    (
      screen.getByText("Commercial filters", { selector: "summary" })
        .parentElement as HTMLDetailsElement
    ).open,
  ).toBe(false);
  await expand("Commercial filters");
  await userEvent.type(screen.getByLabelText("Search seller by name"), "Kyoto");
  await userEvent.click(screen.getByRole("button", { name: "Find seller" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Kyoto Textiles · JP" }),
  );
  await userEvent.type(
    screen.getByLabelText("Maximum MOQ"),
    "999999999999999.9999",
  );
  await userEvent.type(
    screen.getByLabelText("Maximum MCQ / minimum color quantity"),
    "0.0001",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Quantity unit"),
    "METER",
  );
  expect(searches()).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(lastQuery().get("sellerSupplierId")).toBe(supplierId),
  );
  expect(lastQuery().get("maxMoq")).toBe("999999999999999.9999");
  expect(lastQuery().get("maxMcq")).toBe("0.0001");
  expect(
    screen.getByText(
      "Materials with at least one seller listing matching these terms.",
    ),
  ).toBeVisible();
  const results = screen.getByRole("list", { name: "Applied filters" });
  expect(results).toHaveTextContent("Seller: Kyoto Textiles");
  const card = document.querySelector(".material-card")!;
  expect(card.textContent).not.toMatch(/MOQ|MCQ|price|stock|matching seller/i);
});
test("catalog supplier picker searches bounded API, resolves selection, and clears explicitly", async () => {
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await expand("Catalog identity");
  await userEvent.type(
    screen.getByLabelText("Search catalog supplier by name"),
    "Kyoto",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Find catalog supplier" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Kyoto Textiles · JP" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(lastQuery().get("catalogSupplierId")).toBe(supplierId),
  );
  expect(
    screen.getByRole("list", { name: "Applied filters" }),
  ).toHaveTextContent("Catalog supplier: Kyoto Textiles");
  await userEvent.click(
    screen.getByRole("button", { name: "Clear catalog supplier" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(
      /^\/materials$/,
    ),
  );
  const request = requests.find(
    (request) => new URL(request.url).pathname === "/api/v1/suppliers",
  )!;
  expect(new URL(request.url).searchParams.get("limit")).toBe("20");
});
test("opaque cursor loads more once while preserving prior rows, then disappears", async () => {
  const next = deferred();
  const cursor = "opaque+/server=value";
  searchHandler = (url) =>
    url.searchParams.has("cursor")
      ? next.promise
      : reply({ items: [row], nextCursor: cursor });
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await userEvent.dblClick(screen.getByRole("button", { name: "Load more" }));
  expect(screen.getByRole("link", { name: "Wool twill" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Loading more materials…" }),
  ).toBeDisabled();
  expect(searches()).toHaveLength(2);
  expect(lastQuery().get("cursor")).toBe(cursor);
  await act(async () =>
    next.resolve(
      reply({
        items: [
          material("Cotton poplin", "10000000-0000-0000-0000-000000000005"),
        ],
      }),
    ),
  );
  expect(
    await screen.findByRole("link", { name: "Cotton poplin" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Load more" }),
  ).not.toBeInTheDocument();
});
test("empty next page preserves prior results and filter change resets cursor", async () => {
  searchHandler = (url) =>
    url.searchParams.has("cursor")
      ? reply({ items: [] })
      : reply({ items: [row], nextCursor: "server-cursor" });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("link", { name: "Wool twill" })).toBeVisible();
  await userEvent.type(screen.getByLabelText("Keyword"), "new");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(lastQuery().get("q")).toBe("new"));
  expect(lastQuery().has("cursor")).toBe(false);
});
test("rejected cursor offers first-page recovery with filters preserved", async () => {
  searchHandler = (url) =>
    url.searchParams.has("cursor")
      ? reply({}, 400)
      : reply({ items: [row], nextCursor: "stale-cursor" });
  mount("/materials?q=wool");
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Reload first results" }),
  );
  await waitFor(() => expect(searches()).toHaveLength(3));
  expect(lastQuery().get("q")).toBe("wool");
  expect(lastQuery().has("cursor")).toBe(false);
});
test("references resolve with supplier deduplication and no physical/commercial request fanout", async () => {
  searchHandler = () =>
    reply({
      items: [
        row,
        material("Second fabric", "10000000-0000-0000-0000-000000000005"),
      ],
    });
  mount();
  await screen.findByRole("link", { name: "Second fabric" });
  await waitFor(() =>
    expect(screen.getAllByText("Kyoto Textiles")).toHaveLength(2),
  );
  expect(screen.getAllByText("Japan", { selector: "dd" })).toHaveLength(2);
  expect(
    screen.getByRole("option", { name: "WOOL — Wool" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: /Inactive/ }),
  ).not.toBeInTheDocument();
  expect(
    requests.filter(
      (request) =>
        new URL(request.url).pathname === `/api/v1/suppliers/${supplierId}`,
    ),
  ).toHaveLength(1);
  expect(
    requests.some((request) =>
      /fabric-spec|leather-spec|listings|prices|inventory/.test(
        new URL(request.url).pathname,
      ),
    ),
  ).toBe(false);
});
test.each([undefined, "20000000-0000-0000-0000-000000000002"])(
  "origin distinction is preserved for %s",
  async (id) => {
    row.originCountryId = id;
    if (id) row.originCountryId = "30000000-0000-0000-0000-000000000002";
    mount();
    expect(
      await screen.findByText(
        id ? "Origin label unavailable" : "Origin not entered",
      ),
    ).toBeVisible();
  },
);
test("unresolved supplier is a secondary label failure and does not block the Material", async () => {
  supplierStatus = 503;
  mount();
  expect(await screen.findByRole("link", { name: "Wool twill" })).toBeVisible();
  expect(await screen.findByText("Supplier label unavailable")).toBeVisible();
});
test.each(["UNKNOWN", "PARTIAL", "COMPLETE"] as const)(
  "server composition state %s is authoritative",
  async (state) => {
    row.compositionCompleteness = state;
    row.composition = [{ fiberCode: "WOOL", percentage: "100" }];
    mount();
    await screen.findByRole("link", { name: "Wool twill" });
    const card = document.querySelector(".material-card")!;
    expect(card.textContent).toContain(
      state === "UNKNOWN"
        ? "Composition not entered"
        : state === "PARTIAL"
          ? "remaining composition unknown"
          : "Complete composition:",
    );
  },
);
test("manipulated status/price/private URL keys are removed and never transported", async () => {
  mount("/materials?status=DRAFT&maxPrice=10&token=do-not-use&q=wool");
  await screen.findByRole("link", { name: "Wool twill" });
  await waitFor(() =>
    expect(screen.getByLabelText("Current URL")).toHaveTextContent(
      "/materials?q=wool",
    ),
  );
  expect(lastQuery().get("status")).toBe("ACTIVE");
  expect(lastQuery().has("maxPrice")).toBe(false);
  expect(lastQuery().has("token")).toBe(false);
});
test("basic detail is read-only, has a semantic link and respects browser Back", async () => {
  mount("/materials?q=wool");
  await userEvent.click(
    await screen.findByRole("link", { name: "Wool twill" }),
  );
  expect(
    await screen.findByRole("heading", { level: 1, name: "Wool twill" }),
  ).toBeVisible();
  expect(screen.getByText("Soft tailoring fabric")).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(
    screen.queryByText(/effective price|inventory|price history/i),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "History back" }));
  expect(await screen.findByRole("link", { name: "Wool twill" })).toBeVisible();
  expect(screen.getByLabelText("Keyword")).toHaveValue("wool");
});
test.each([
  [404, "Material not found"],
  [403, "Access denied"],
  [503, "Service unavailable"],
] as const)(
  "detail HTTP %s has safe page semantics",
  async (status, heading) => {
    detailStatus = status;
    mount(`/materials/${materialId}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    expect(screen.getByText("material-test")).toBeVisible();
  },
);
test("late prior-Actor response cannot restore results or cache; logout clears Material UI", async () => {
  const late = deferred();
  searchHandler = (_url, request) =>
    request.headers.get("X-Dev-Subject") === "actor-a"
      ? late.promise
      : reply({ items: [] });
  const client = mount();
  await waitFor(() => expect(searches()).toHaveLength(1));
  const oldScope = getSession().key;
  await act(async () => setLocalSubject("actor-b"));
  await screen.findByText("No active materials yet");
  await act(async () =>
    late.resolve(reply({ items: [material("Private old actor fabric")] })),
  );
  expect(
    screen.queryByText("Private old actor fabric"),
  ).not.toBeInTheDocument();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain(oldScope);
  await act(async () => endSession());
  expect(
    await screen.findByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Active materials" }),
  ).not.toBeInTheDocument();
});
test("Actor switch removes previously rendered results; organization selection never changes catalog scope", async () => {
  searchHandler = (_url, request) =>
    reply({
      items: request.headers.get("X-Dev-Subject") === "actor-a" ? [row] : [],
    });
  const client = mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await userEvent.click(
    screen.getByRole("button", { name: "Select working organization" }),
  );
  expect(searches()).toHaveLength(1);
  expect(lastQuery().has("organizationId")).toBe(false);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain("organization-only");
  await act(async () => setLocalSubject("actor-b"));
  await screen.findByText("No active materials yet");
  expect(
    screen.queryByRole("link", { name: "Wool twill" }),
  ).not.toBeInTheDocument();
});
test("Material queries put no credentials in URL or persistent storage", async () => {
  const localWrite = vi.spyOn(Storage.prototype, "setItem");
  setAccessToken("private-token");
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  expect(screen.getByLabelText("Current URL").textContent).toBe("/materials");
  expect(
    requests.every(
      (request) =>
        !request.url.includes("private-token") &&
        !request.url.includes(getSession().key),
    ),
  ).toBe(true);
  expect(localWrite).not.toHaveBeenCalled();
  localWrite.mockRestore();
});

test("applying a new search keeps prior results with an explicit updating announcement", async () => {
  const pending = deferred();
  searchHandler = (url) =>
    url.searchParams.has("q") ? pending.promise : reply({ items: [row] });
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await userEvent.type(screen.getByLabelText("Keyword"), "cotton");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(
    await screen.findByText(
      "Updating results. Previous search results remain visible.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Wool twill" })).toBeVisible();
  await act(async () =>
    pending.resolve(reply({ items: [material("New cotton results")] })),
  );
  expect(
    await screen.findByRole("link", { name: "New cotton results" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Wool twill" }),
  ).not.toBeInTheDocument();
});
test("supplier picker name search and selection work with the keyboard", async () => {
  mount();
  await screen.findByRole("link", { name: "Wool twill" });
  await expand("Catalog identity");
  await userEvent.type(
    screen.getByLabelText("Search catalog supplier by name"),
    "Kyoto{Enter}",
  );
  const choice = await screen.findByRole("button", {
    name: "Kyoto Textiles · JP",
  });
  choice.focus();
  await userEvent.keyboard("{Enter}");
  expect(
    screen.getByRole("button", { name: "Clear catalog supplier" }),
  ).toBeVisible();
  expect(searches()).toHaveLength(1);
});
test.each(["/materials", `/materials/${materialId}`])(
  "anonymous route %s never requests supply data",
  async (path) => {
    endSession();
    mount(path);
    expect(
      await screen.findByRole("heading", { name: "Authentication required" }),
    ).toBeVisible();
    expect(
      requests.some((request) =>
        new URL(request.url).pathname.startsWith("/api/v1"),
      ),
    ).toBe(false);
  },
);

test("Clear and reapplying a cached filter start from the first cursor page", async () => {
  searchHandler = (url) =>
    url.searchParams.has("cursor")
      ? reply({
          items: [
            material(
              "Next page material",
              "10000000-0000-0000-0000-000000000006",
            ),
          ],
        })
      : reply({ items: [row], nextCursor: "second-page" });
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more" }),
  );
  await screen.findByRole("link", { name: "Next page material" });
  await userEvent.type(screen.getByLabelText("Keyword"), "wool");
  await userEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(lastQuery().get("q")).toBe("wool"));
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(lastQuery().has("q")).toBe(false));
  expect(lastQuery().has("cursor")).toBe(false);
  expect(
    screen.queryByRole("link", { name: "Next page material" }),
  ).not.toBeInTheDocument();
});
