import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { endSession, getSession, setLocalSubject } from "../../api/session";
import type { components } from "../../api/schema";
import { discoveryReturn } from "../materials/navigation";
const mid = "30000000-0000-4000-8000-000000000001",
  lid = "30000000-0000-4000-8000-000000000002",
  vid = "30000000-0000-4000-8000-000000000003",
  seller = "30000000-0000-4000-8000-000000000004",
  catalog = "30000000-0000-4000-8000-000000000005",
  source = "30000000-0000-4000-8000-000000000006";
let material: components["schemas"]["MaterialView"];
let listing: components["schemas"]["ListingView"];
let requests: Request[], clients: QueryClient[];
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "commercial-reference",
    },
  });
let overrides: Record<
  string,
  (url: URL, request: Request) => Response | Promise<Response>
>;
const path = (suffix: string) => `/api/v1/material-listings/${lid}${suffix}`;
beforeEach(() => {
  setLocalSubject("commercial-a");
  requests = [];
  clients = [];
  overrides = {};
  material = {
    id: mid,
    displayName: "Tailoring wool",
    materialType: "FABRIC",
    catalogSupplierId: catalog,
    status: "ACTIVE",
    compositionCompleteness: "PARTIAL",
    composition: [{ fiberCode: "WOOL", percentage: "100" }],
  };
  listing = {
    id: lid,
    materialId: mid,
    sellerSupplierId: seller,
    sellerArticleNumber: "SELL-77",
    minimumOrderQuantity: "0",
    quantityUnit: "METER",
    status: "ACTIVE",
    standardLeadTimeDays: 0,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (overrides[url.pathname])
        return overrides[url.pathname]!(url, request);
      if (url.pathname === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject"),
        });
      if (url.pathname === "/api/identity/capabilities")
        return reply({ platformAdmin: false });
      if (
        url.pathname === "/api/v1/countries" ||
        url.pathname === "/api/v1/fiber-types"
      )
        return reply([]);
      if (url.pathname === `/api/v1/materials/${mid}`) return reply(material);
      if (
        url.pathname === `/api/v1/materials/${mid}/fabric-spec` ||
        url.pathname === `/api/v1/materials/${mid}/leather-spec`
      )
        return reply({}, 404);
      if (url.pathname === `/api/v1/materials/${mid}/variants`)
        return reply([
          {
            id: vid,
            materialId: mid,
            variantName: "Midnight blue",
            colorName: "Blue",
            status: "ACTIVE",
          },
        ]);
      if (url.pathname === `/api/v1/materials/${mid}/listings`)
        return reply([listing]);
      if (url.pathname === path("")) return reply(listing);
      if (url.pathname === path("/effective-prices"))
        return reply({
          asOf: "2026-10-20T10:00:00Z",
          priceMatch: "NO_MATCH",
          listingTermsScope: "CURRENT_TERMS_ONLY",
          currentListingTerms: listing,
          scopes: [],
        });
      if (
        url.pathname === path("/prices") ||
        url.pathname === path("/inventory") ||
        url.pathname === path("/inventory-snapshots")
      )
        return reply({ items: [] });
      if (url.pathname === `/api/v1/suppliers/${catalog}`)
        return reply({ id: catalog, displayName: "Catalog mill A" });
      if (url.pathname === `/api/v1/suppliers/${seller}`)
        return reply({ id: seller, displayName: "Seller trading B" });
      throw new Error("Unexpected read");
    }),
  );
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  endSession();
  vi.unstubAllGlobals();
});
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Route">
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(
  route = `/materials/${mid}`,
  state: unknown = { discoveryReturn: "/materials?q=wool" },
) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: route, state }]}>
        <App />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
const calls = (suffix: string) =>
  requests.filter((request) => new URL(request.url).pathname.endsWith(suffix));
test("return context accepts only canonical internal discovery filters", () => {
  expect(
    discoveryReturn({
      discoveryReturn: "/materials?status=DRAFT&q=wool&token=private",
    }),
  ).toBe("/materials?q=wool");
  for (const value of [
    "https://evil.test/materials",
    "//evil.test/materials",
    "/admin",
    "/materials/other",
    "/materials#secret",
    "/materials?x=\\evil",
  ])
    expect(discoveryReturn({ discoveryReturn: value })).toBe("/materials");
});
test("full Material shows independent optional spec, explicit variants and separate seller terms", async () => {
  mount();
  await screen.findByRole("heading", { name: "Tailoring wool", level: 1 });
  expect(
    await screen.findByText("Physical specification not entered"),
  ).toBeVisible();
  expect(await screen.findByText("Midnight blue")).toBeVisible();
  expect(await screen.findByText("Catalog mill A")).toBeVisible();
  expect(await screen.findByText("Seller trading B")).toBeVisible();
  expect(screen.getByText(/remaining composition unknown/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Browse active materials" }),
  ).toHaveAttribute("href", "/materials?q=wool");
  expect(calls("/fabric-spec")).toHaveLength(1);
  expect(calls("/leather-spec")).toHaveLength(0);
});
test("leather uses only its subtype, keeping exact physical values", async () => {
  material.materialType = "LEATHER";
  overrides[`/api/v1/materials/${mid}/leather-spec`] = () =>
    reply({ thicknessMinMm: "0.0001", thicknessMaxMm: "99.9999" });
  mount();
  expect(await screen.findByText("0.0001")).toBeVisible();
  expect(screen.getByText("99.9999")).toBeVisible();
  expect(calls("/fabric-spec")).toHaveLength(0);
});
test("optional section failure leaves Material header and other sections usable", async () => {
  overrides[`/api/v1/materials/${mid}/fabric-spec`] = () =>
    reply({ detail: "private stack" }, 503);
  mount();
  expect(
    await screen.findByRole("heading", { name: "Service unavailable" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 1, name: "Tailoring wool" }),
  ).toBeVisible();
  expect(await screen.findByText("Midnight blue")).toBeVisible();
  expect(document.body.textContent).not.toContain("private stack");
});
test("Variants and Listings are independently bounded at 25 with offset continuation", async () => {
  overrides[`/api/v1/materials/${mid}/variants`] = (url) =>
    reply(
      url.searchParams.get("offset") === "0"
        ? Array.from({ length: 25 }, (_, i) => ({
            id: `variant-${i}`,
            variantName: `Variant ${i}`,
          }))
        : [],
    );
  overrides[`/api/v1/materials/${mid}/listings`] = (url) =>
    reply(
      url.searchParams.get("offset") === "0"
        ? Array.from({ length: 25 }, (_, i) => ({
            ...listing,
            id: `listing-${i}`,
          }))
        : [],
    );
  mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more variants" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more listings" }),
  );
  await waitFor(() => expect(calls("/variants")).toHaveLength(2));
  for (const suffix of ["/variants", "/listings"]) {
    const urls = calls(suffix).map((request) => new URL(request.url));
    expect(urls.map((url) => url.searchParams.get("offset"))).toEqual([
      "0",
      "25",
    ]);
    expect(urls.every((url) => url.searchParams.get("limit") === "25")).toBe(
      true,
    );
  }
  expect(screen.getByText("25 listings loaded")).toBeVisible();
  expect(screen.queryByText("25 sellers")).not.toBeInTheDocument();
});
test("Material 404 does not mount child collections", async () => {
  overrides[`/api/v1/materials/${mid}`] = () => reply({}, 404);
  mount();
  expect(
    await screen.findByRole("heading", { name: "Material not found" }),
  ).toBeVisible();
  expect(calls("/variants")).toHaveLength(0);
  expect(calls("/fabric-spec")).toHaveLength(0);
});

test("Listing establishes catalog supplier versus Seller, preserving zero and unknown terms", async () => {
  mount(`/material-listings/${lid}`);
  const terms = await screen.findByRole("region", { name: "Listing terms" });
  expect(await within(terms).findByText("Seller trading B")).toBeVisible();
  expect(within(terms).getByText("SELL-77")).toBeVisible();
  expect(within(terms).getAllByText("0")).toHaveLength(2);
  expect(within(terms).getAllByText("Unknown")).toHaveLength(2);
  const context = screen.getByRole("region", {
    name: "Catalog Material context",
  });
  expect(
    await within(context).findByText(/Catalog supplier: Catalog mill A/),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Return to Material search" }),
  ).toHaveAttribute("href", "/materials?q=wool");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});
test("known exact MOQ/MCQ strings remain intact on Listing", async () => {
  listing.minimumOrderQuantity = "999999999999999.9999";
  listing.minimumColorQuantity = "0.0001";
  mount(`/material-listings/${lid}`);
  const terms = await screen.findByRole("region", { name: "Listing terms" });
  expect(within(terms).getByText("999999999999999.9999")).toBeVisible();
  expect(within(terms).getByText("0.0001")).toBeVisible();
});
test("Listing 404 is a page error with safe request reference", async () => {
  overrides[path("")] = () => reply({ detail: "private failure" }, 404);
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByRole("heading", { name: "Listing not found" }),
  ).toBeVisible();
  expect(screen.getByText("commercial-reference")).toBeVisible();
  expect(document.body.textContent).not.toContain("private failure");
});

const priceFact = (): components["schemas"]["PriceView"] => ({
  id: "price-a",
  amount: "999999999999999.9999",
  currency: "JPY",
  priceUnit: "METER",
  dataSourceId: source,
  validFrom: "2025-01-01T00:00:00Z",
  observedAt: "2025-01-01T00:00:00Z",
});
const resolution = (
  scope: Partial<components["schemas"]["PriceOutcome"]> = {},
  historical = false,
) => ({
  asOf: "2026-10-20T10:00:00.123456Z",
  listingTermsScope: historical
    ? "HISTORICAL_TERMS_NOT_RECONSTRUCTED"
    : "CURRENT_TERMS_ONLY",
  currentListingTerms: listing,
  scopes: [
    {
      dataSourceId: source,
      currency: "JPY",
      priceUnit: "METER",
      priceMatch: "MATCHED",
      matchScope: "MATERIAL_EXACT",
      commercialEligibility: "UNKNOWN_TERMS",
      price: priceFact(),
      ...scope,
    },
  ],
});
const resolver = () => screen.getByRole("region", { name: "Price resolver" });
const effective = () =>
  calls("/effective-prices").map((request) => new URL(request.url));
test("current resolver omits asOf and quantity, keeps independent match/eligibility/source scope", async () => {
  overrides[path("/effective-prices")] = () => reply(resolution());
  mount(`/material-listings/${lid}`);
  expect(
    await within(
      await screen.findByRole("region", { name: "Price resolver" }),
    ).findByText("999999999999999.9999"),
  ).toBeVisible();
  const params = effective()[0]!.searchParams;
  expect(params.has("asOf")).toBe(false);
  expect(params.has("requestedQuantity")).toBe(false);
  expect(params.get("allowMaterialFallback")).toBe("false");
  expect(within(resolver()).getByText("Matched")).toBeVisible();
  expect(within(resolver()).getByText("Unknown terms")).toBeVisible();
  expect(
    within(resolver()).getByText(/Friendly source labels are not available/),
  ).toBeVisible();
  expect(
    within(resolver()).getAllByText(`Source reference: ${source}`).length,
  ).toBeGreaterThan(0);
  expect(requests.some((request) => request.url.includes("/admin/"))).toBe(
    false,
  );
});
test("historical lookup transmits explicit UTC, exact quantity, requestedVariantId and fallback", async () => {
  overrides[path("/effective-prices")] = (url) =>
    reply(
      resolution(
        {
          matchScope: "MATERIAL_FALLBACK",
          commercialEligibility: url.searchParams.has("asOf")
            ? "NOT_EVALUATED_FOR_HISTORICAL_QUERY"
            : "UNKNOWN_TERMS",
        },
        url.searchParams.has("asOf"),
      ),
    );
  mount(`/material-listings/${lid}`);
  await screen.findByLabelText("Price mode");
  await userEvent.selectOptions(
    screen.getByLabelText("Price mode"),
    "historical",
  );
  await userEvent.type(
    screen.getByLabelText("Historical price instant (UTC)"),
    "2025-06-01T00:00:00Z",
  );
  await userEvent.type(
    screen.getByLabelText("Requested quantity (in price unit)"),
    "999999999999999.9999",
  );
  await userEvent.selectOptions(screen.getByLabelText("Price variant"), vid);
  await userEvent.click(screen.getByLabelText("Allow Material-level fallback"));
  await userEvent.click(screen.getByRole("button", { name: "Resolve price" }));
  expect(
    await screen.findByText("Not evaluated for historical query"),
  ).toBeVisible();
  const params = effective().at(-1)!.searchParams;
  expect(params.get("asOf")).toBe("2025-06-01T00:00:00Z");
  expect(params.get("requestedQuantity")).toBe("999999999999999.9999");
  expect(params.get("requestedVariantId")).toBe(vid);
  expect(params.has("variantId")).toBe(false);
  expect(params.get("allowMaterialFallback")).toBe("true");
  expect(
    screen.getByText(/Historical Listing terms are not reconstructed/),
  ).toBeVisible();
  expect(screen.getByText(/Material-level fallback result/)).toBeVisible();
});
test("effective cursor is opaque, current requests omit time on every page; Variant/Refresh reset first page", async () => {
  overrides[path("/effective-prices")] = (url) =>
    reply({
      ...resolution({
        matchScope: url.searchParams.has("requestedVariantId")
          ? "VARIANT_EXACT"
          : "MATERIAL_EXACT",
      }),
      nextCursor: url.searchParams.has("cursor")
        ? undefined
        : "captured+server/cursor=",
    });
  mount(`/material-listings/${lid}`);
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more price scopes" }),
  );
  expect(effective().at(-1)!.searchParams.get("cursor")).toBe(
    "captured+server/cursor=",
  );
  expect(effective().every((url) => !url.searchParams.has("asOf"))).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Price variant"), vid);
  await userEvent.click(screen.getByRole("button", { name: "Resolve price" }));
  await waitFor(() =>
    expect(effective().at(-1)!.searchParams.get("requestedVariantId")).toBe(
      vid,
    ),
  );
  expect(effective().at(-1)!.searchParams.has("cursor")).toBe(false);
  await screen.findByText("Variant exact");
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh current price" }),
  );
  await waitFor(() => expect(effective()).toHaveLength(4));
  expect(effective().at(-1)!.searchParams.has("cursor")).toBe(false);
});
test("NO_MATCH has no invented price, while eligibility remains independent", async () => {
  overrides[path("/effective-prices")] = () =>
    reply(
      resolution({
        priceMatch: "NO_MATCH",
        matchScope: "NO_MATCH",
        price: undefined,
        commercialEligibility: "INELIGIBLE",
      }),
    );
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByText("No matching price within this returned scope."),
  ).toBeVisible();
  expect(screen.getByText("Ineligible under current terms")).toBeVisible();
  expect(document.querySelector(".price-amount")).not.toBeInTheDocument();
});
test("price history is an independent bounded read with exact facts and verbatim cursor", async () => {
  overrides[path("/prices")] = (url) =>
    reply({
      items: [
        {
          ...priceFact(),
          id: url.searchParams.has("cursor") ? "price-b" : "price-a",
          materialVariantId: vid,
        },
      ],
      nextCursor: url.searchParams.has("cursor")
        ? undefined
        : "history/opaque+=",
    });
  mount(`/material-listings/${lid}`);
  await screen.findByRole("button", { name: "Show price history" });
  expect(calls("/prices")).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Show price history" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more price history" }),
  );
  await waitFor(() =>
    expect(screen.getByText("2 price facts loaded")).toBeVisible(),
  );
  expect(new URL(calls("/prices").at(-1)!.url).searchParams.get("cursor")).toBe(
    "history/opaque+=",
  );
  expect(new URL(calls("/prices")[0]!.url).searchParams.get("limit")).toBe(
    "25",
  );
});

const fid = "30000000-0000-4000-8000-000000000007";
const observation = (
  quantity = "999999999999999.9999",
  id = "observation-a",
): components["schemas"]["InventoryView"] => ({
  id,
  quantity,
  unit: "METER",
  materialVariantId: vid,
  facilityId: fid,
  captureMode: "MANUAL",
  observedAt: "2026-10-01T00:00:00Z",
  recordedAt: "2026-10-02T00:00:00Z",
});
test("successful empty inventory means unknown, not known zero", async () => {
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByText(
      "No stock observation within this scope · stock unknown.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText("Known zero quantity for this observation scope"),
  ).not.toBeInTheDocument();
});
test("inventory zero is a known observation; other exact quantities/scopes are not summed", async () => {
  overrides[path("/inventory")] = () =>
    reply({
      items: [
        observation("0", "zero"),
        { ...observation(), id: "other-unit", unit: "KG" },
      ],
    });
  overrides[`/api/v1/facilities/${fid}`] = () =>
    reply({ id: fid, name: "Third-party warehouse" });
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByText("Known zero quantity for this observation scope"),
  ).toBeVisible();
  expect(
    screen.getByText("999999999999999.9999", {
      selector: ".inventory-quantity",
    }),
  ).toBeVisible();
  expect(screen.getByText("2 observation scopes loaded")).toBeVisible();
  expect(document.body.textContent).not.toMatch(
    /total stock|available.to.promise/i,
  );
  await waitFor(() => expect(calls(`/facilities/${fid}`)).toHaveLength(1));
  expect(calls("/inventory-snapshots")).toHaveLength(0);
});
test("inventory failure means unavailable with safe reference, preserving other page sections", async () => {
  overrides[path("/inventory")] = () =>
    reply({ detail: "private inventory data" }, 503);
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByRole("heading", {
      name: "Inventory information unavailable",
    }),
  ).toBeVisible();
  expect(screen.queryByText(/No stock observation/)).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Listing terms" })).toBeVisible();
  expect(document.body.textContent).not.toContain("private inventory data");
});
test("absent Facility and failed Facility lookup are different, secondary states", async () => {
  overrides[path("/inventory")] = () =>
    reply({
      items: [
        { ...observation("10", "no-facility"), facilityId: undefined },
        observation("20", "unresolved-facility"),
      ],
    });
  overrides[`/api/v1/facilities/${fid}`] = () => reply({}, 403);
  mount(`/material-listings/${lid}`);
  expect(await screen.findByText("Facility not recorded")).toBeVisible();
  expect(
    await screen.findByText("Facility label unavailable", { exact: false }),
  ).toBeVisible();
  expect(screen.getByText("2 observation scopes loaded")).toBeVisible();
});
test("inventory current/history have distinct cursors, exact strings and shared explicit scope", async () => {
  overrides[path("/inventory")] = (url) =>
    reply({
      items: [
        observation(
          url.searchParams.has("cursor") ? "0.0001" : "99.9999",
          url.searchParams.has("cursor") ? "next" : "first",
        ),
      ],
      nextCursor: url.searchParams.has("cursor")
        ? undefined
        : "inventory/opaque+=",
    });
  overrides[path("/inventory-snapshots")] = (url) =>
    reply({
      items: [
        observation(
          "7",
          url.searchParams.has("cursor") ? "history-2" : "history-1",
        ),
      ],
      nextCursor: url.searchParams.has("cursor") ? undefined : "past/opaque+=",
    });
  overrides[`/api/v1/facilities/${fid}`] = () =>
    reply({ id: fid, name: "Warehouse" });
  mount(`/material-listings/${lid}`);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Load more inventory observations",
    }),
  );
  expect(
    await screen.findByText("0.0001", { selector: ".inventory-quantity" }),
  ).toBeVisible();
  expect(
    new URL(calls("/inventory").at(-1)!.url).searchParams.get("cursor"),
  ).toBe("inventory/opaque+=");
  await userEvent.click(
    screen.getByRole("button", { name: "Show inventory history" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more inventory history" }),
  );
  expect(
    await screen.findByText("2 historical observations loaded"),
  ).toBeVisible();
  expect(
    new URL(calls("/inventory-snapshots").at(-1)!.url).searchParams.get(
      "cursor",
    ),
  ).toBe("past/opaque+=");
  await userEvent.selectOptions(
    screen.getByLabelText("Inventory variant"),
    vid,
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Inventory unit"),
    "METER",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Apply inventory scope" }),
  );
  await waitFor(() =>
    expect(
      new URL(calls("/inventory").at(-1)!.url).searchParams.get("variantId"),
    ).toBe(vid),
  );
  expect(
    new URL(calls("/inventory").at(-1)!.url).searchParams.has("cursor"),
  ).toBe(false);
  expect(
    new URL(calls("/inventory-snapshots").at(-1)!.url).searchParams.get(
      "variantId",
    ),
  ).toBe(vid);
});
test("invalid price cursor reloads the first results without clearing the price scope", async () => {
  overrides[path("/effective-prices")] = (url) =>
    url.searchParams.has("cursor")
      ? reply({}, 400)
      : reply({ ...resolution(), nextCursor: "stale-price-cursor" });
  mount(`/material-listings/${lid}`);
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more price scopes" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Reload first results" }),
  );
  await waitFor(() => expect(effective()).toHaveLength(3));
  expect(effective().at(-1)!.searchParams.get("allowMaterialFallback")).toBe(
    "false",
  );
  expect(effective().at(-1)!.searchParams.has("cursor")).toBe(false);
});
test("Actor switch clears commercial results and late old price/inventory cannot refill the next cache", async () => {
  let releasePrice!: (value: Response) => void,
    releaseInventory!: (value: Response) => void;
  const latePrice = new Promise<Response>((resolve) => {
      releasePrice = resolve;
    }),
    lateInventory = new Promise<Response>((resolve) => {
      releaseInventory = resolve;
    });
  overrides[path("/effective-prices")] = (_url, request) =>
    request.headers.get("X-Dev-Subject") === "commercial-a"
      ? latePrice
      : reply({ scopes: [], asOf: "2026-10-20T10:00:00Z" });
  overrides[path("/inventory")] = (_url, request) =>
    request.headers.get("X-Dev-Subject") === "commercial-a"
      ? lateInventory
      : reply({ items: [] });
  const client = mount(`/material-listings/${lid}`);
  await waitFor(() => expect(calls("/inventory")).toHaveLength(1));
  const old = getSession().key;
  await act(async () => setLocalSubject("commercial-b"));
  await screen.findByText(
    "No stock observation within this scope · stock unknown.",
  );
  await act(async () => {
    releasePrice(reply(resolution()));
    releaseInventory(reply({ items: [observation("888.8888")] }));
  });
  expect(document.body.textContent).not.toContain("999999999999999.9999");
  expect(document.body.textContent).not.toContain("888.8888");
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain(old);
  await act(async () => endSession());
  expect(
    await screen.findByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("region", { name: "Price resolver" }),
  ).not.toBeInTheDocument();
});

test("a missing inventory collection is unavailable, never an empty observation result", async () => {
  overrides[path("/inventory")] = () => reply({});
  mount(`/material-listings/${lid}`);
  expect(
    await screen.findByRole("heading", {
      name: "Inventory information unavailable",
    }),
  ).toBeVisible();
  expect(
    screen.queryByText(/No stock observation within this scope/),
  ).not.toBeInTheDocument();
});
test.each(["COMPLETE", "PARTIAL", "UNKNOWN"] as const)(
  "Material detail retains server composition completeness %s",
  async (completeness) => {
    material.compositionCompleteness = completeness;
    mount();
    await screen.findByRole("heading", { name: "Tailoring wool", level: 1 });
    expect(
      screen.getByText(
        completeness === "PARTIAL"
          ? /remaining composition unknown/
          : completeness === "COMPLETE"
            ? /Complete composition:/
            : "Composition not entered",
      ),
    ).toBeVisible();
  },
);
