import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, useNavigate } from "react-router";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { getSession, setLocalSubject, endSession } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import type { Schemas } from "./model";
const id = (n: number) =>
  `1c5d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lid = id(1),
  mid = id(2),
  seller = id(3),
  source = id(4),
  oid = id(5),
  pid = id(6),
  vid = id(7),
  fid = id(8);
const at = "2026-10-21T00:00:00.123456Z";
type Call = {
  url: URL;
  method: string;
  body: Record<string, unknown>;
  request: Request;
};
let calls: Call[],
  clients: QueryClient[],
  admin: boolean,
  capCode: number,
  prices: Schemas["PriceView"][],
  inventory: Schemas["InventoryView"][],
  evidence: Schemas["PriceEvidenceView"][],
  overrides: Record<string, (c: Call) => Response | Promise<Response>>,
  listing: Record<string, unknown>;
const reply = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "commercial-safe-reference",
    },
  });
const price = (): Schemas["PriceView"] =>
  ({
    id: pid,
    listingId: lid,
    materialId: mid,
    dataSourceId: source,
    amount: "999999999999999.9999",
    currency: "USD",
    priceUnit: "METER",
    materialVariantId: null,
    minimumOrderQuantity: null,
    validFrom: "2026-10-21T00:00:00.000001Z",
    validTo: null,
    observedAt: at,
    version: 0,
    createdAt: at,
    updatedAt: at,
  }) as never;
beforeEach(() => {
  setLocalSubject("commercial-admin-a");
  calls = [];
  clients = [];
  admin = true;
  capCode = 200;
  prices = [];
  inventory = [];
  evidence = [];
  overrides = {};
  listing = {
    id: lid,
    materialId: mid,
    sellerSupplierId: seller,
    sellerArticleNumber: null,
    minimumOrderQuantity: null,
    minimumColorQuantity: null,
    quantityUnit: null,
    standardLeadTimeDays: null,
    reproductionLeadTimeDays: null,
    status: "ACTIVE",
    version: 51,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url),
        c: Call = {
          url,
          method: request.method,
          request,
          body: request.method === "GET" ? {} : await request.clone().json(),
        },
        p = url.pathname;
      calls.push(c);
      if (overrides[`${c.method} ${p}`])
        return overrides[`${c.method} ${p}`]!(c);
      if (p === "/api/identity")
        return reply({
          issuer: "fixture",
          subject: request.headers.get("X-Dev-Subject"),
        });
      if (p === "/api/identity/capabilities")
        return reply({ platformAdmin: admin }, capCode);
      if (p === "/api/health") return reply({ status: "UP" });
      if (p === `/api/v1/material-listings/${lid}`) return reply(listing);
      if (p === `/api/v1/materials/${mid}`)
        return reply({
          id: mid,
          displayName: "Catalog material",
          catalogSupplierId: seller,
        });
      if (p === `/api/v1/suppliers/${seller}`)
        return reply({ id: seller, displayName: "Seller supplier" });
      if (p === `/api/v1/materials/${mid}/variants`)
        return reply([
          {
            id: vid,
            materialId: mid,
            variantName: "Historical indigo",
            status: "ARCHIVED",
          },
        ]);
      if (p === "/api/v1/admin/sources")
        return reply([
          {
            id: source,
            name: "Historical provider",
            sourceCode: "provider-original",
            active: false,
          },
        ]);
      if (p === "/api/v1/facilities")
        return reply({ items: [{ id: fid, name: "Third-party Warehouse" }] });
      if (p === `/api/v1/facilities/${fid}`)
        return reply({
          id: fid,
          name: "Archived third-party Warehouse",
          supplierId: id(99),
          status: "ARCHIVED",
        });
      if (p === `/api/v1/material-listings/${lid}/prices`)
        return reply({ items: prices });
      if (p === `/api/v1/material-listings/${lid}/effective-prices`)
        return reply({
          asOf: at,
          scopes: [],
          priceMatch: "NO_MATCH",
          listingTermsScope: "CURRENT_TERMS_ONLY",
        });
      if (
        p === `/api/v1/material-listings/${lid}/inventory` ||
        p === `/api/v1/material-listings/${lid}/inventory-snapshots`
      )
        return reply({ items: inventory });
      if (p === "/api/v1/admin/material-prices") {
        const v = {
          ...price(),
          ...c.body,
          id: request.headers.get("Idempotency-Key")!,
        };
        prices = [
          v as Schemas["PriceView"],
          ...prices.filter((p) => p.id !== v.id),
        ];
        return reply(v);
      }
      if (p === `/api/v1/admin/material-prices/${pid}/sources`) {
        if (c.method === "GET") return reply(evidence);
        evidence = [
          ...evidence,
          { observationId: c.body.observationId as string, createdAt: at },
        ];
        return new Response(null, { status: 200 });
      }
      if (p === `/api/v1/admin/material-prices/${pid}/close`) {
        prices = [
          { ...prices[0], validTo: c.body.validTo as string, version: 1 },
        ];
        return reply(prices[0]);
      }
      if (p === "/api/v1/admin/material-inventory-snapshots") {
        const v = {
          ...c.body,
          id: id(50),
          materialId: mid,
          actorIssuer: "fixture",
          actorSubject: request.headers.get("X-Dev-Subject"),
          recordedAt: at,
          createdAt: at,
        };
        inventory = [v as Schemas["InventoryView"], ...inventory];
        return reply(v);
      }
      return reply([]);
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  endSession();
  vi.unstubAllGlobals();
});
function mount(
  path = `/admin/listings/${lid}`,
  probe?: import("react").ReactNode,
) {
  const cache = createQueryClient();
  cache.setDefaultOptions({ queries: { retry: false } });
  clients.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        {probe}
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
const area = (name: string) => screen.getByRole("region", { name });
const fill = (label: string, value: string, a: HTMLElement = document.body) =>
  fireEvent.change(within(a).getByLabelText(label, { exact: true }), {
    target: { value },
  });
const post = (path: string) =>
  calls.filter((c) => c.method === "POST" && c.url.pathname === path);
async function ready() {
  await screen.findByRole("heading", { name: "Manual Price creation" });
}
async function fillPrice() {
  const a = area("Manual Price creation");
  await within(a).findByRole("option", { name: /Historical provider/ });
  fill("Provider Source", source, a);
  fill("Price amount", "999999999999999.9999", a);
  fill("Commercial currency", " usd ", a);
  fill("Fact price unit", "METER", a);
  fill("Price valid from (UTC)", "2026-10-21T00:00:00.000001Z", a);
  fill("Price observed at (UTC)", at, a);
  fill("Price Observation UUID 1", oid, a);
  return a;
}
async function fillInventory() {
  const a = area("Manual Inventory observation");
  fill("Manual Inventory quantity", "0", a);
  fill("Observation quantity unit", "KG", a);
  fill("Inventory observed at (UTC)", at, a);
  return a;
}
async function manage() {
  await userEvent.click(
    screen.getByRole("button", { name: "Show price history" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: `Manage Price · ${pid}` }),
  );
  await screen.findByRole("heading", { name: "Selected Price evidence" });
}
test.each([false, true])(
  "non-admin/capability error fail closed %s",
  async (error) => {
    admin = false;
    if (error) capCode = 503;
    mount();
    await screen.findByRole("heading", {
      name: error ? "Curation access unavailable" : "Access denied",
    });
    expect(calls.some((c) => c.url.pathname.startsWith("/api/v1/admin/"))).toBe(
      false,
    );
    expect(
      screen.queryByRole("heading", { name: "Manual Price creation" }),
    ).toBeNull();
  },
);
test("pending gate issues no protected/commercial reads until ADMIN", async () => {
  let release!: (r: Response) => void;
  overrides["GET /api/identity/capabilities"] = () =>
    new Promise((r) => {
      release = r;
    });
  mount();
  await screen.findByLabelText("Checking curation access");
  expect(calls.some((c) => c.url.pathname.includes("material-listings"))).toBe(
    false,
  );
  await act(async () => release(reply({ platformAdmin: true })));
  await ready();
});
test("missing or malformed Listing never mounts commercial children", async () => {
  delete listing.materialId;
  mount();
  await screen.findByRole("heading", { name: "Seller Listing curation" });
  expect(
    screen.queryByRole("heading", { name: "Manual Price creation" }),
  ).toBeNull();
  expect(
    calls.some(
      (c) =>
        c.url.pathname.endsWith("effective-prices") ||
        c.url.pathname.endsWith("/inventory"),
    ),
  ).toBe(false);
});
test("archived Listing allows explicit commercial facts without ACTIVE inference", async () => {
  listing.status = "ARCHIVED";
  mount();
  await ready();
  expect(
    screen.getByRole("button", { name: "Create manual Price" }),
  ).toBeEnabled();
  expect(screen.getByText(/This record is archived/)).toBeVisible();
});
test("Price create sends generated UUID header, exact decimal, canonical currency and only transport fields", async () => {
  mount();
  await ready();
  const a = await fillPrice();
  fill("Price tier MOQ (optional)", "0", a);
  fill("Observation Variant (optional)", vid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await within(a).findByText(/Price fact confirmed/);
  const c = post("/api/v1/admin/material-prices")[0]!;
  expect(c.request.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
  expect(c.body).toEqual({
    listingId: lid,
    dataSourceId: source,
    materialVariantId: vid,
    amount: "999999999999999.9999",
    currency: "USD",
    priceUnit: "METER",
    minimumOrderQuantity: "0",
    validFrom: "2026-10-21T00:00:00.000001Z",
    observedAt: at,
    observationIds: [oid],
  });
  expect(prices[0]?.id).toBe(c.request.headers.get("Idempotency-Key"));
  expect(within(a).getByLabelText("Price amount")).toBeDisabled();
});
test("Price ambiguity freezes key/body/validTo/evidence and retries only on explicit action", async () => {
  let failed = true;
  overrides["POST /api/v1/admin/material-prices"] = async (c) => {
    if (failed) {
      failed = false;
      throw new TypeError("Network lost");
    }
    return reply({
      ...price(),
      ...c.body,
      id: c.request.headers.get("Idempotency-Key"),
    });
  };
  mount();
  await ready();
  const a = await fillPrice();
  fill("Price valid to (UTC, optional)", "2026-10-22T00:00:00.123456Z", a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await within(a).findByRole("heading", {
    name: "Price creation outcome unknown",
  });
  expect(
    within(a).getByLabelText("Price valid to (UTC, optional)"),
  ).toBeDisabled();
  expect(post("/api/v1/admin/material-prices")).toHaveLength(1);
  await userEvent.click(
    within(a).getByRole("button", { name: "Retry same Price intention" }),
  );
  await within(a).findByText(/Price fact confirmed/);
  const cs = post("/api/v1/admin/material-prices");
  expect(cs[1]?.body).toEqual(cs[0]?.body);
  expect(cs[1]?.request.headers.get("Idempotency-Key")).toBe(
    cs[0]?.request.headers.get("Idempotency-Key"),
  );
  await userEvent.click(
    within(a).getByRole("button", { name: "Start a new Price intention" }),
  );
  expect(within(a).getByLabelText("Price amount")).toBeEnabled();
  expect(
    within(a).getByText(/Price command reference:/).textContent,
  ).not.toContain(cs[0]?.request.headers.get("Idempotency-Key"));
});
test.each([400, 404, 409, 500])(
  "Price HTTP %i preserves snapshot without automatic retry or transport-ambiguity copy",
  async (status) => {
    overrides["POST /api/v1/admin/material-prices"] = () => reply({}, status);
    mount();
    await ready();
    const a = await fillPrice();
    await userEvent.click(
      within(a).getByRole("button", { name: "Create manual Price" }),
    );
    await waitFor(() =>
      expect(
        within(a).getByRole("button", { name: "Retry same Price intention" }),
      ).toBeEnabled(),
    );
    expect(post("/api/v1/admin/material-prices")).toHaveLength(1);
    expect(
      within(a).queryByRole("heading", { name: /outcome unknown/ }),
    ).toBeNull();
    if (status === 409)
      expect(
        within(a).getByText(/existing Price fact or its evidence/),
      ).toBeVisible();
  },
);
test("Price history uses opaque cursor and does not fan out evidence per row", async () => {
  overrides[`GET /api/v1/material-listings/${lid}/prices`] = (c) =>
    reply(
      c.url.searchParams.has("cursor")
        ? { items: [{ ...price(), id: id(60) }] }
        : { items: [price()], nextCursor: "opaque+cursor/=abc" },
    );
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Show price history" }),
  );
  await screen.findByText("1 price facts loaded");
  expect(
    calls.some(
      (c) =>
        c.url.pathname.includes("material-prices/") &&
        c.url.pathname.endsWith("sources"),
    ),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "Load more price history" }),
  );
  await screen.findByText("2 price facts loaded");
  expect(
    calls.some(
      (c) => c.url.searchParams.get("cursor") === "opaque+cursor/=abc",
    ),
  ).toBe(true);
});
test("malformed Price blocks management without raw object rendering", async () => {
  prices = [{ ...price(), amount: { unsafe: "Never render this" } } as never];
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Show price history" }),
  );
  await screen.findByText(/Price management unavailable/);
  expect(screen.queryByText(/Never render this/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Manage Price/ })).toBeNull();
});
test("selected Price loads protected evidence once with bounded pagination; append is versionless", async () => {
  prices = [price()];
  overrides[`GET /api/v1/admin/material-prices/${pid}/sources`] = (c) =>
    reply(
      c.url.searchParams.get("offset") === "25"
        ? []
        : Array.from({ length: 25 }, (_, i) => ({
            observationId: id(100 + i),
            createdAt: at,
          })),
    );
  mount();
  await ready();
  await manage();
  await screen.findByText("25 supporting observations loaded");
  await userEvent.click(
    screen.getByRole("button", { name: "Load more supporting observations" }),
  );
  await waitFor(() =>
    expect(calls.some((c) => c.url.searchParams.get("offset") === "25")).toBe(
      true,
    ),
  );
  const a = area("Selected Price evidence");
  fill("Additional Price Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Append Price evidence" }),
  );
  await within(a).findByText(/Price version is unchanged/);
  expect(post(`/api/v1/admin/material-prices/${pid}/sources`)[0]?.body).toEqual(
    { observationId: oid },
  );
  expect(prices[0]?.version).toBe(0);
});
test("evidence malformed rows and provider 409 render safe fallback and request reference", async () => {
  prices = [price()];
  evidence = [
    { observationId: { unsafe: "private" }, createdAt: "bad" } as never,
  ];
  overrides[`POST /api/v1/admin/material-prices/${pid}/sources`] = () =>
    reply({}, 409);
  mount();
  await ready();
  await manage();
  await screen.findByText(
    "Citation data is unavailable in a supported format.",
  );
  const a = area("Selected Price evidence");
  fill("Additional Price Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Append Price evidence" }),
  );
  await within(a).findByText(/provider or current integrity/);
  expect(within(a).getByText("commercial-safe-reference")).toBeVisible();
  expect(
    within(a).getByLabelText("Additional Price Observation UUID"),
  ).toHaveValue(oid);
});
test("Close uses Price version, irreversible confirmation and microsecond time; successful response removes action", async () => {
  prices = [price()];
  mount();
  await ready();
  await manage();
  const a = area("One-time Price close");
  fill("Close Price valid to (UTC)", "2026-10-21T00:00:00.000002Z", a);
  expect(within(a).getByRole("button", { name: "Close Price" })).toBeDisabled();
  await userEvent.click(
    within(a).getByLabelText("Confirm irreversible Price closure"),
  );
  await userEvent.click(within(a).getByRole("button", { name: "Close Price" }));
  await screen.findByRole("heading", { name: "Closed Price" });
  expect(post(`/api/v1/admin/material-prices/${pid}/close`)[0]?.body).toEqual({
    version: 0,
    validTo: "2026-10-21T00:00:00.000002Z",
  });
  expect(screen.queryByRole("button", { name: "Close Price" })).toBeNull();
});
test.each(["intended", "different", "open", "unseen"])(
  "Close ambiguity recovery: %s",
  async (mode) => {
    prices = [price()];
    overrides[`POST /api/v1/admin/material-prices/${pid}/close`] = (c) => {
      prices =
        mode === "unseen"
          ? []
          : [
              {
                ...price(),
                validTo:
                  mode === "open"
                    ? null
                    : mode === "intended"
                      ? (c.body.validTo as string)
                      : "2026-10-23T00:00:00Z",
                version: mode === "open" ? 2 : 1,
              } as never,
            ];
      throw new TypeError("Network lost");
    };
    mount();
    await ready();
    await manage();
    const a = area("One-time Price close");
    fill("Close Price valid to (UTC)", "2026-10-22T00:00:00.123456Z", a);
    await userEvent.click(
      within(a).getByLabelText("Confirm irreversible Price closure"),
    );
    await userEvent.click(
      within(a).getByRole("button", { name: "Close Price" }),
    );
    await within(a).findByRole("heading", {
      name: "Price close outcome unknown",
    });
    await within(a).findByText(
      mode === "intended"
        ? "The Price is already closed at the requested time."
        : mode === "different"
          ? /different actual closure/
          : mode === "open"
            ? /refreshed Price remains open/
            : /unresolved in this bounded history/,
    );
    expect(post(`/api/v1/admin/material-prices/${pid}/close`)).toHaveLength(1);
    expect(within(a).getByLabelText("Close Price valid to (UTC)")).toHaveValue(
      "2026-10-22T00:00:00.123456Z",
    );
    if (mode === "open") {
      await userEvent.click(
        within(a).getByRole("button", {
          name: "Confirm refreshed open Price for explicit retry",
        }),
      );
      expect(
        within(a).getByRole("button", { name: "Close Price" }),
      ).toBeDisabled();
    }
  },
);
test.each([400, 404, 409])(
  "Close HTTP %i keeps intended time and does not resubmit",
  async (status) => {
    prices = [price()];
    overrides[`POST /api/v1/admin/material-prices/${pid}/close`] = () =>
      reply({}, status);
    mount();
    await ready();
    await manage();
    const a = area("One-time Price close");
    fill("Close Price valid to (UTC)", "2026-10-22T00:00:00Z", a);
    await userEvent.click(
      within(a).getByLabelText("Confirm irreversible Price closure"),
    );
    await userEvent.click(
      within(a).getByRole("button", { name: "Close Price" }),
    );
    await waitFor(() =>
      expect(
        within(a).getByRole("button", { name: "Refresh Price closure" }),
      ).toBeVisible(),
    );
    expect(post(`/api/v1/admin/material-prices/${pid}/close`)).toHaveLength(1);
    expect(within(a).getByLabelText("Close Price valid to (UTC)")).toHaveValue(
      "2026-10-22T00:00:00Z",
    );
  },
);
test("already closed historical Price has no Close action", async () => {
  prices = [{ ...price(), validTo: "2026-10-22T00:00:00Z" }];
  mount();
  await ready();
  await manage();
  await screen.findByRole("heading", { name: "Closed Price" });
  expect(screen.queryByRole("button", { name: "Close Price" })).toBeNull();
});
test("MANUAL Inventory zero, archived Variant and third-party Facility transport no Actor/version/evidence", async () => {
  mount();
  await ready();
  const a = await fillInventory();
  await within(a).findByRole("option", { name: "Third-party Warehouse" });
  fill("Observation Variant (optional)", vid, a);
  fill("Observation Facility (optional)", fid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Record manual observation" }),
  );
  await within(a).findByText(/Manual Snapshot confirmed/);
  const b = post("/api/v1/admin/material-inventory-snapshots")[0]?.body;
  expect(b).toEqual({
    listingId: lid,
    quantity: "0",
    unit: "KG",
    observedAt: at,
    captureMode: "MANUAL",
    manualIdempotencyKey: expect.any(String),
    materialVariantId: vid,
    facilityId: fid,
  });
});
test("known archived Facility requires resolved detail, not raw UUID transport", async () => {
  mount();
  await ready();
  const a = await fillInventory();
  fill("Known Facility UUID", fid.toUpperCase(), a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Resolve known Facility" }),
  );
  await userEvent.click(
    await within(a).findByRole("button", { name: "Use resolved Facility" }),
  );
  expect(
    within(a).getByLabelText("Observation Facility (optional)"),
  ).toHaveValue(fid);
});
test("Inventory ambiguity locks fields and preserves exact manual body/key across explicit retry", async () => {
  let fail = true;
  overrides["POST /api/v1/admin/material-inventory-snapshots"] = (c) => {
    if (fail) {
      fail = false;
      throw new TypeError("Network lost");
    }
    return reply({
      ...c.body,
      id: id(50),
      materialId: mid,
      actorIssuer: "fixture",
      actorSubject: "commercial-admin-a",
      recordedAt: at,
      createdAt: at,
    });
  };
  mount();
  await ready();
  const a = await fillInventory();
  await userEvent.click(
    within(a).getByRole("button", { name: "Record manual observation" }),
  );
  await within(a).findByRole("heading", {
    name: "Inventory recording outcome unknown",
  });
  expect(within(a).getByLabelText("Manual Inventory quantity")).toBeDisabled();
  expect(post("/api/v1/admin/material-inventory-snapshots")).toHaveLength(1);
  await userEvent.click(
    within(a).getByRole("button", { name: "Retry same Inventory intention" }),
  );
  await within(a).findByText(/Manual Snapshot confirmed/);
  const cs = post("/api/v1/admin/material-inventory-snapshots");
  expect(cs[0]?.body).toEqual(cs[1]?.body);
  await userEvent.click(
    within(a).getByRole("button", { name: "Record a new observation" }),
  );
  expect(
    within(a).getByText(/Inventory command reference:/).textContent,
  ).not.toContain(cs[0]?.body.manualIdempotencyKey);
});
test("unrelated commercial/Listing refetch preserves dirty drafts", async () => {
  const cache = mount();
  await ready();
  await fillPrice();
  await fillInventory();
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.listing(getSession().key, lid),
    });
  });
  expect(
    within(area("Manual Price creation")).getByLabelText("Price amount"),
  ).toHaveValue("999999999999999.9999");
  expect(
    within(area("Manual Inventory observation")).getByLabelText(
      "Manual Inventory quantity",
    ),
  ).toHaveValue("0");
});
test("Actor switch clears Price/Inventory drafts and command keys and protected evidence", async () => {
  prices = [price()];
  const cache = mount();
  await ready();
  await fillPrice();
  await fillInventory();
  await manage();
  const old = getSession().key,
    key = within(area("Manual Price creation")).getByText(
      /Price command reference:/,
    ).textContent;
  await act(async () => setLocalSubject("commercial-admin-b"));
  await ready();
  expect(
    within(area("Manual Price creation")).getByLabelText("Price amount"),
  ).toHaveValue("");
  expect(
    within(area("Manual Inventory observation")).getByLabelText(
      "Manual Inventory quantity",
    ),
  ).toHaveValue("");
  expect(
    within(area("Manual Price creation")).getByText(/Price command reference:/)
      .textContent,
  ).not.toBe(key);
  expect(
    screen.queryByRole("heading", { name: "Selected Price evidence" }),
  ).toBeNull();
  expect(
    cache.getQueryCache().findAll({ queryKey: queryKeys.admin(old) }),
  ).toHaveLength(0);
});
test("runtime revocation removes commercial UI, keys, evidence cache and Curation navigation", async () => {
  prices = [price()];
  const cache = mount();
  await ready();
  await fillPrice();
  await manage();
  const scope = getSession().key;
  admin = false;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: queryKeys.capabilities(scope) });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(
    screen.queryByRole("heading", { name: "Manual Price creation" }),
  ).toBeNull();
  expect(screen.queryByRole("link", { name: "Curation" })).toBeNull();
  expect(
    cache.getQueryCache().findAll({ queryKey: queryKeys.admin(scope) }),
  ).toHaveLength(0);
});

test("stable evidence rows retain neighbor DOM/value identity after removal", async () => {
  mount();
  await ready();
  const a = await fillPrice();
  await userEvent.click(
    within(a).getByRole("button", { name: "Add supporting Observation" }),
  );
  fill("Price Observation UUID 2", id(90), a);
  const second = within(a).getByLabelText("Price Observation UUID 2");
  await userEvent.click(
    within(a).getByRole("button", { name: "Remove Price Observation 1" }),
  );
  expect(within(a).getByLabelText("Price Observation UUID 1")).toBe(second);
  expect(second).toHaveValue(id(90));
});
test("malformed successful Price response preserves command but does not enable management", async () => {
  overrides["POST /api/v1/admin/material-prices"] = () => reply({ id: pid });
  mount();
  await ready();
  const a = await fillPrice();
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await within(a).findByText(/success response was received/);
  expect(
    screen.queryByRole("heading", { name: "Selected Price management" }),
  ).toBeNull();
  expect(within(a).getByLabelText("Price amount")).toBeDisabled();
});
test("matching Price visible after transport loss shows actual validTo rather than fabricating submitted end", async () => {
  overrides["POST /api/v1/admin/material-prices"] = (c) => {
    prices = [
      {
        ...price(),
        ...c.body,
        id: c.request.headers.get("Idempotency-Key")!,
        validTo: "2026-10-25T00:00:00Z",
      } as never,
    ];
    throw new TypeError("Lost response");
  };
  mount();
  await ready();
  const a = await fillPrice();
  fill("Price valid to (UTC, optional)", "2026-10-22T00:00:00Z", a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await within(a).findByText(/A Price with this command reference is visible/);
  expect(within(a).getByText("2026-10-25T00:00:00Z")).toBeVisible();
  expect(
    within(a).getByLabelText("Price valid to (UTC, optional)"),
  ).toHaveValue("2026-10-22T00:00:00Z");
});
test("invalid Close success cannot authorize another POST without explicitly confirmed open server state", async () => {
  prices = [price()];
  overrides[`POST /api/v1/admin/material-prices/${pid}/close`] = () =>
    reply({ id: pid });
  mount();
  await ready();
  await manage();
  const a = area("One-time Price close");
  fill("Close Price valid to (UTC)", "2026-10-22T00:00:00Z", a);
  await userEvent.click(
    within(a).getByLabelText("Confirm irreversible Price closure"),
  );
  await userEvent.click(within(a).getByRole("button", { name: "Close Price" }));
  await within(a).findByText(/closure state is unsafe/);
  await userEvent.click(
    within(a).getByLabelText("Confirm irreversible Price closure"),
  );
  expect(within(a).getByRole("button", { name: "Close Price" })).toBeDisabled();
  expect(post(`/api/v1/admin/material-prices/${pid}/close`)).toHaveLength(1);
});
test("Price evidence refresh does not reset dirty close time", async () => {
  prices = [price()];
  mount();
  await ready();
  await manage();
  const close = area("One-time Price close");
  fill("Close Price valid to (UTC)", "2026-10-22T00:00:00.123456Z", close);
  const e = area("Selected Price evidence");
  fill("Additional Price Observation UUID", oid, e);
  await userEvent.click(
    within(e).getByRole("button", { name: "Append Price evidence" }),
  );
  await within(e).findByText(/Price version is unchanged/);
  expect(
    within(close).getByLabelText("Close Price valid to (UTC)"),
  ).toHaveValue("2026-10-22T00:00:00.123456Z");
});
test.each(["empty", "zero", "failure"])(
  "admin Inventory truth state stays distinct: %s",
  async (state) => {
    if (state === "zero")
      inventory = [
        {
          id: id(80),
          quantity: "0.0000",
          unit: "KG",
          captureMode: "MANUAL",
          observedAt: at,
        },
      ];
    if (state === "failure")
      overrides[`GET /api/v1/material-listings/${lid}/inventory`] = () =>
        reply({}, 503);
    mount();
    await ready();
    const a = area("Inventory knowledge");
    await within(a).findByText(
      state === "empty"
        ? "No stock observation within this scope · stock unknown."
        : state === "zero"
          ? "Known zero quantity for this observation scope"
          : "Inventory information unavailable",
    );
  },
);
test("Inventory scopes are not summed", async () => {
  inventory = [
    { id: id(80), quantity: "2.5001", unit: "KG", captureMode: "MANUAL" },
    { id: id(81), quantity: "3.5001", unit: "KG", captureMode: "IMPORTED" },
  ];
  mount();
  await ready();
  const a = area("Inventory knowledge");
  await within(a).findByText("2 observation scopes loaded");
  expect(within(a).queryByText(/6\.0002/)).toBeNull();
});
test("incomplete parent refetch retains commercial draft but blocks further writes", async () => {
  const cache = mount();
  await ready();
  await fillPrice();
  delete listing.materialId;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.listing(getSession().key, lid),
    });
  });
  expect(
    within(area("Manual Price creation")).getByLabelText("Price amount"),
  ).toHaveValue("999999999999999.9999");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create manual Price" }),
    ).toBeDisabled(),
  );
});
test("late Price and Inventory successes after Actor switch cannot restore command state", async () => {
  let priceRelease!: (r: Response) => void,
    inventoryRelease!: (r: Response) => void;
  overrides["POST /api/v1/admin/material-prices"] = () =>
    new Promise((r) => (priceRelease = r));
  overrides["POST /api/v1/admin/material-inventory-snapshots"] = () =>
    new Promise((r) => (inventoryRelease = r));
  mount();
  await ready();
  const a = await fillPrice(),
    b = await fillInventory();
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await userEvent.click(
    within(b).getByRole("button", { name: "Record manual observation" }),
  );
  await waitFor(() =>
    expect(post("/api/v1/admin/material-inventory-snapshots")).toHaveLength(1),
  );
  const oldPrice = post("/api/v1/admin/material-prices")[0]!,
    oldInventory = post("/api/v1/admin/material-inventory-snapshots")[0]!;
  await act(async () => setLocalSubject("commercial-admin-b"));
  await ready();
  await act(async () => {
    priceRelease(
      reply({
        ...price(),
        ...oldPrice.body,
        id: oldPrice.request.headers.get("Idempotency-Key"),
      }),
    );
    inventoryRelease(
      reply({
        ...oldInventory.body,
        id: id(70),
        materialId: mid,
        actorIssuer: "fixture",
        actorSubject: "commercial-admin-a",
        recordedAt: at,
        createdAt: at,
      }),
    );
  });
  expect(screen.queryByText(/Price fact confirmed/)).toBeNull();
  expect(screen.queryByText(/Manual Snapshot confirmed/)).toBeNull();
  expect(
    within(area("Manual Price creation")).getByLabelText("Price amount"),
  ).toHaveValue("");
  expect(screen.queryByRole("heading", { name: /outcome unknown/ })).toBeNull();
});

function ChangeListing() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/admin/listings/${id(90)}`)}>
      Test another Listing
    </button>
  );
}
test("Listing context change creates fresh command keys and discards previous drafts", async () => {
  overrides[`GET /api/v1/material-listings/${id(90)}`] = () =>
    reply({ ...listing, id: id(90) });
  mount(`/admin/listings/${lid}`, <ChangeListing />);
  await ready();
  await fillPrice();
  await fillInventory();
  const priceKey = within(area("Manual Price creation")).getByText(
    /Price command reference:/,
  ).textContent;
  const stockKey = within(area("Manual Inventory observation")).getByText(
    /Inventory command reference:/,
  ).textContent;
  await userEvent.click(
    screen.getByRole("button", { name: "Test another Listing" }),
  );
  await waitFor(() =>
    expect(
      within(area("Manual Price creation")).getByLabelText("Price amount"),
    ).toHaveValue(""),
  );
  expect(
    within(area("Manual Price creation")).getByText(/Price command reference:/)
      .textContent,
  ).not.toBe(priceKey);
  expect(
    within(area("Manual Inventory observation")).getByText(
      /Inventory command reference:/,
    ).textContent,
  ).not.toBe(stockKey);
});
test("confirmed Price creation does not fetch protected evidence until explicit selection", async () => {
  mount();
  await ready();
  const a = await fillPrice();
  await userEvent.click(
    within(a).getByRole("button", { name: "Create manual Price" }),
  );
  await within(a).findByText(/Price fact confirmed/);
  expect(
    calls.some(
      (c) =>
        c.url.pathname.startsWith("/api/v1/admin/material-prices/") &&
        c.url.pathname.endsWith("/sources"),
    ),
  ).toBe(false);
  await userEvent.click(
    within(a).getByRole("button", { name: "Manage this Price" }),
  );
  await screen.findByRole("heading", { name: "Selected Price evidence" });
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.url.pathname.startsWith("/api/v1/admin/material-prices/") &&
          c.url.pathname.endsWith("/sources"),
      ),
    ).toBe(true),
  );
});
test("Close recovery finds a selected fact in refreshed filtered history outside the unfiltered first page", async () => {
  prices = [{ ...price(), currency: "JPY" }];
  overrides[`GET /api/v1/material-listings/${lid}/prices`] = (c) =>
    reply({
      items: c.url.searchParams.get("currency") === "JPY" ? prices : [],
    });
  overrides[`POST /api/v1/admin/material-prices/${pid}/close`] = () => {
    prices = [
      { ...prices[0], validTo: "2026-10-23T00:00:00.123456Z", version: 1 },
    ];
    return reply({}, 409);
  };
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Show price history" }),
  );
  fill("History currency", "JPY");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply history scope" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: `Manage Price · ${pid}` }),
  );
  const a = area("One-time Price close");
  fill("Close Price valid to (UTC)", "2026-10-22T00:00:00Z", a);
  await userEvent.click(
    within(a).getByLabelText("Confirm irreversible Price closure"),
  );
  await userEvent.click(within(a).getByRole("button", { name: "Close Price" }));
  await within(a).findByText(/different actual closure/);
  expect(within(a).getByLabelText("Close Price valid to (UTC)")).toHaveValue(
    "2026-10-22T00:00:00Z",
  );
});
test("ambiguous evidence append preserves submitted UUID case but recognizes canonical returned identity", async () => {
  prices = [price()];
  overrides[`POST /api/v1/admin/material-prices/${pid}/sources`] = (c) => {
    evidence = [
      {
        observationId: (c.body.observationId as string).toLowerCase(),
        createdAt: at,
      },
    ];
    throw new TypeError("Response lost");
  };
  mount();
  await ready();
  await manage();
  const a = area("Selected Price evidence");
  fill("Additional Price Observation UUID", oid.toUpperCase(), a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Append Price evidence" }),
  );
  await within(a).findByText(/supporting Observation association is visible/);
  expect(
    within(a).getByLabelText("Additional Price Observation UUID"),
  ).toHaveValue(oid.toUpperCase());
  expect(post(`/api/v1/admin/material-prices/${pid}/sources`)[0]?.body).toEqual(
    { observationId: oid.toUpperCase() },
  );
  expect(post(`/api/v1/admin/material-prices/${pid}/sources`)).toHaveLength(1);
});
