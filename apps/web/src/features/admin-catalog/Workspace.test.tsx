import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { Suspense, useLayoutEffect, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { endSession, setLocalSubject, getSession } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import { fabricDefaults, leatherDefaults, type Schemas } from "./model";
const id = (n: number) =>
  `1c5c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mid = id(1),
  sid = id(2),
  oid = id(3),
  fiber = id(4),
  vid = id(5),
  lid = id(6);
type Call = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  request: Request;
  url: URL;
};
let calls: Call[],
  clients: QueryClient[],
  admin: boolean,
  capStatus: number,
  material: Record<string, unknown>,
  fabric: Record<string, unknown> | undefined,
  leather: Record<string, unknown> | undefined,
  variant: Record<string, unknown>,
  listing: Record<string, unknown>,
  overrides: Record<string, (c: Call) => Response | Promise<Response>>;
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "catalog-reference",
    },
  });
const materialView = () => ({
  id: mid,
  catalogSupplierId: sid,
  materialType: "FABRIC",
  displayName: "Canonical cloth",
  catalogArticleNumber: null,
  description: null,
  originCountryId: null,
  compositionCompleteness: "PARTIAL",
  composition: [{ fiberTypeId: fiber, percentage: "100.0000" }],
  status: "ACTIVE",
  version: 7,
});
beforeEach(() => {
  setLocalSubject("catalog-admin-a");
  calls = [];
  clients = [];
  admin = true;
  capStatus = 200;
  overrides = {};
  material = materialView();
  fabric = undefined;
  leather = undefined;
  variant = {
    id: vid,
    materialId: mid,
    variantName: "Indigo",
    catalogVariantSku: null,
    colorName: null,
    colorCode: null,
    batchNumber: null,
    attributes: null,
    status: "ACTIVE",
    version: 3,
  };
  listing = {
    id: lid,
    materialId: mid,
    sellerSupplierId: sid,
    sellerArticleNumber: null,
    minimumOrderQuantity: "0.0000",
    minimumColorQuantity: "999999999999999.9999",
    quantityUnit: "METER",
    standardLeadTimeDays: 0,
    reproductionLeadTimeDays: null,
    status: "ACTIVE",
    version: 2,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url),
        path = url.pathname,
        c: Call = {
          url,
          path,
          method: request.method,
          request,
          body: request.method === "GET" ? {} : await request.clone().json(),
        };
      calls.push(c);
      if (overrides[`${c.method} ${path}`])
        return overrides[`${c.method} ${path}`]!(c);
      if (path === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject"),
        });
      if (path === "/api/identity/capabilities")
        return reply({ platformAdmin: admin }, capStatus);
      if (path === "/api/health") return reply({ status: "UP" });
      if (path === "/api/v1/organizations") return reply([]);
      if (path === "/api/v1/countries")
        return reply([
          { id: id(10), nameEn: "Japan", alpha2: "JP", active: true },
        ]);
      if (path === "/api/v1/fiber-types")
        return reply([
          { id: fiber, code: "WOOL", nameEn: "Wool", active: false },
        ]);
      if (path === "/api/v1/suppliers")
        return reply({ items: [{ id: sid, displayName: "Catalog Supplier" }] });
      if (path === `/api/v1/suppliers/${sid}`)
        return reply({ id: sid, displayName: "Catalog Supplier" });
      if (path === "/api/v1/materials") return reply({ items: [material] });
      if (path === `/api/v1/materials/${mid}`) return reply(material);
      if (path.endsWith("/sources"))
        return c.method === "GET"
          ? reply([])
          : new Response(null, { status: 200 });
      if (path === `/api/v1/materials/${mid}/variants`) return reply([variant]);
      if (path === `/api/v1/material-variants/${vid}`) return reply(variant);
      if (path === `/api/v1/material-listings/${lid}`) return reply(listing);
      if (
        path.endsWith("/listings") ||
        path === `/api/v1/suppliers/${sid}/material-listings`
      )
        return reply([listing]);
      if (path === `/api/v1/materials/${mid}/fabric-spec`)
        return fabric ? reply(fabric) : reply({}, 404);
      if (path === `/api/v1/materials/${mid}/leather-spec`)
        return leather ? reply(leather) : reply({}, 404);
      if (path === `/api/v1/admin/materials/${mid}/composition`) {
        if (c.body.version !== material.version) return reply({}, 409);
        material = {
          ...material,
          compositionCompleteness: c.body.completeness,
          composition: c.body.parts,
          version: (material.version as number) + 1,
        };
        return reply(material);
      }
      if (path === `/api/v1/admin/materials/${mid}`) {
        if (c.body.version !== material.version) return reply({}, 409);
        material = {
          ...material,
          ...c.body,
          version: (material.version as number) + 1,
        };
        return reply(material);
      }
      if (
        path === `/api/v1/admin/materials/${mid}/fabric-spec` ||
        path === `/api/v1/admin/materials/${mid}/leather-spec`
      ) {
        const isFabric = path.endsWith("fabric-spec"),
          prior = isFabric ? fabric : leather,
          create = request.headers.get("If-None-Match") === "*";
        if (create && prior) return reply({}, 412);
        if (!create && !prior) return reply({}, 404);
        if (!create && c.body.version !== prior?.version) return reply({}, 409);
        const v = {
          ...(isFabric ? fabricDefaults : leatherDefaults),
          ...c.body,
          materialId: mid,
          materialType: isFabric ? "FABRIC" : "LEATHER",
          version: create ? 0 : (prior!.version as number) + 1,
        };
        if (isFabric) fabric = v;
        else leather = v;
        return reply(v);
      }
      if (path === `/api/v1/admin/material-listings/${lid}`) {
        listing = { ...listing, ...c.body, version: 3 };
        return reply(listing);
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
function mount(path: string, probe?: ReactNode) {
  const cache = createQueryClient();
  cache.setDefaultOptions({ queries: { retry: false } });
  clients.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <Suspense fallback={<p>Navigation suspended</p>}>
          <App />
          {probe}
        </Suspense>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
const fill = (
  label: string,
  value: string,
  area: HTMLElement = document.body,
) =>
  fireEvent.change(within(area).getByLabelText(label, { exact: true }), {
    target: { value },
  });
const area = (heading: string) =>
  screen.getByRole("heading", { name: heading }).closest("section")!;
const puts = (path: string) =>
  calls.filter((c) => c.method === "PUT" && c.path === path);
async function ready() {
  await screen.findByRole("heading", { name: "Canonical cloth", level: 1 });
  await screen.findByRole("heading", { name: "Create Fabric specification" });
}
test.each([
  "/admin/materials",
  `/admin/materials/${mid}`,
  "/admin/listings",
  `/admin/listings/${lid}`,
])("buyer/ORG_OWNER denied %s", async (route) => {
  admin = false;
  mount(route);
  await screen.findByRole("heading", { name: "Access denied" });
  expect(calls.filter((c) => c.path.startsWith("/api/v1/admin/"))).toHaveLength(
    0,
  );
});
test.each([
  "/admin/materials",
  `/admin/materials/${mid}`,
  "/admin/listings",
  `/admin/listings/${lid}`,
])("capability ERROR fail closed %s", async (route) => {
  capStatus = 503;
  mount(route);
  await screen.findByRole("heading", { name: "Curation access unavailable" });
  expect(calls.filter((c) => c.path.startsWith("/api/v1/admin/"))).toHaveLength(
    0,
  );
});
test("PENDING has no protected requests or page", async () => {
  let release!: (r: Response) => void;
  overrides["GET /api/identity/capabilities"] = () =>
    new Promise((r) => {
      release = r;
    });
  mount(`/admin/materials/${mid}`);
  await screen.findByLabelText("Checking curation access");
  expect(calls.some((c) => c.path.startsWith("/api/v1/admin/"))).toBe(false);
  await act(async () => release(reply({ platformAdmin: true })));
  await ready();
});
test.each(["DRAFT", "ACTIVE", "ARCHIVED"])(
  "directory explicit status %s and no row fanout",
  async (status) => {
    mount(`/admin/materials?status=${status}`);
    await screen.findByRole("link", {
      name: "Open Material · Canonical cloth",
    });
    const c = calls.find((c) => c.path === "/api/v1/materials")!;
    expect(c.url.searchParams.get("status")).toBe(status);
    expect(c.url.searchParams.get("limit")).toBe("25");
    expect(
      calls.filter(
        (c) =>
          c.path.includes("/sources") ||
          c.path.includes("/fabric-spec") ||
          c.path.includes("/variants"),
      ),
    ).toHaveLength(0);
  },
);
test("directory draft filters apply only; no price filter", async () => {
  mount("/admin/materials");
  await screen.findByRole("link", { name: "Open Material · Canonical cloth" });
  const n = calls.length;
  fill("Material keyword", "exact weave");
  expect(calls).toHaveLength(n);
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Material filters" }),
  );
  await waitFor(() =>
    expect(
      calls.some((c) => c.url.searchParams.get("q") === "exact weave"),
    ).toBe(true),
  );
  expect(screen.queryByLabelText(/max.*price/i)).toBeNull();
});
test("Composition then Profile uses refetched parent version and preserves latest composition", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Replace Composition" }),
  );
  let a = area("Replace Composition");
  fill("Percentage", "80.1234", a);
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Composition" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Replace Composition" }),
    ).toBeNull(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  a = area("Edit Material profile");
  fill("Material name", "Updated cloth", a);
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Material profile" }),
  );
  await waitFor(() =>
    expect(puts(`/api/v1/admin/materials/${mid}`)).toHaveLength(1),
  );
  expect(
    puts(`/api/v1/admin/materials/${mid}/composition`)[0]!.body.version,
  ).toBe(7);
  expect(puts(`/api/v1/admin/materials/${mid}`)[0]!.body).toMatchObject({
    version: 8,
    compositionCompleteness: "PARTIAL",
    composition: [{ fiberTypeId: fiber, percentage: "80.1234" }],
    materialType: "FABRIC",
    catalogSupplierId: sid,
  });
});
test("Profile then Composition uses newly read parent version", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  fill("Observation UUID", oid, area("Edit Material profile"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save Material profile" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Edit Material profile" }),
    ).toBeNull(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Replace Composition" }),
  );
  fill("Observation UUID", oid, area("Replace Composition"));
  await userEvent.click(
    screen.getByRole("button", { name: "Save Composition" }),
  );
  await waitFor(() =>
    expect(puts(`/api/v1/admin/materials/${mid}/composition`)).toHaveLength(1),
  );
  expect(
    puts(`/api/v1/admin/materials/${mid}/composition`)[0]!.body.version,
  ).toBe(8);
});
test("only one parent command may own a draft; inactive Fiber retained", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  expect(
    screen.getByRole("button", { name: "Replace Composition" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Cancel Material form" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Replace Composition" }),
  );
  expect(
    screen.getByRole("option", { name: "Wool · WOOL · inactive" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Fiber")).toHaveValue(fiber);
});
test.each(["composition", "version", "catalogSupplierId", "description"])(
  "unsafe missing %s blocks Material parent writes",
  async (field) => {
    delete material[field];
    mount(`/admin/materials/${mid}`);
    await screen.findByRole("heading", { name: "Canonical cloth" });
    expect(
      screen.getByRole("button", { name: "Edit Material profile" }),
    ).toBeDisabled();
  },
);
test("Profile 409 preserves draft and shows current server composition, no automatic retry", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  const a = area("Edit Material profile");
  fill("Material name", "Retain draft", a);
  fill("Observation UUID", oid, a);
  material = {
    ...material,
    version: 10,
    composition: [{ fiberTypeId: fiber, percentage: "75.0000" }],
  };
  await userEvent.click(
    screen.getByRole("button", { name: "Save Material profile" }),
  );
  await screen.findByRole("heading", { name: "Current server Material" });
  expect(screen.getByLabelText("Material name")).toHaveValue("Retain draft");
  expect(screen.getAllByText(/75.0000%/).length).toBeGreaterThan(0);
  expect(puts(`/api/v1/admin/materials/${mid}`)).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Save Material profile" }),
  ).toBeDisabled();
});
test.each(["FABRIC", "LEATHER", "BUTTON"])(
  "only appropriate subtype read mounted for %s",
  async (type) => {
    material.materialType = type;
    mount(`/admin/materials/${mid}`);
    await screen.findByRole("heading", { name: "Canonical cloth" });
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith("/sources"))).toBe(true),
    );
    expect(calls.some((c) => c.path.endsWith("/fabric-spec"))).toBe(
      type === "FABRIC",
    );
    expect(calls.some((c) => c.path.endsWith("/leather-spec"))).toBe(
      type === "LEATHER",
    );
  },
);
test.each(["FABRIC", "LEATHER"] as const)(
  "%s create typed response then authoritative edit with header omitted",
  async (type) => {
    material.materialType = type;
    mount(`/admin/materials/${mid}`);
    const noun = type === "FABRIC" ? "Fabric" : "Leather";
    await screen.findByRole("heading", {
      name: `Create ${noun} specification`,
    });
    fill("Observation UUID", oid, area(`Create ${noun} specification`));
    await userEvent.click(
      screen.getByRole("button", { name: `Save ${noun} specification` }),
    );
    await screen.findByRole("heading", { name: `Edit ${noun} specification` });
    const path = `/api/v1/admin/materials/${mid}/${noun.toLowerCase()}-spec`;
    expect(puts(path)[0]!.request.headers.get("If-None-Match")).toBe("*");
    expect(puts(path)[0]!.body.version).toBe(0);
    fill("Observation UUID", oid, area(`Edit ${noun} specification`));
    await userEvent.click(
      screen.getByRole("button", { name: `Save ${noun} specification` }),
    );
    await waitFor(() => expect(puts(path)).toHaveLength(2));
    expect(puts(path)[1]!.request.headers.has("If-None-Match")).toBe(false);
    expect(puts(path)[1]!.body.version).toBe(0);
    await screen.findByText("Specification saved. Server version: 1.");
  },
);
test.each(["FABRIC", "LEATHER"] as const)(
  "%s 412 draft/request reference preserved, explicit edit switch only",
  async (type) => {
    material.materialType = type;
    mount(`/admin/materials/${mid}`);
    const noun = type === "FABRIC" ? "Fabric" : "Leather";
    await screen.findByRole("heading", {
      name: `Create ${noun} specification`,
    });
    const a = area(`Create ${noun} specification`);
    fill("Finish", "My retained finish", a);
    fill("Observation UUID", oid, a);
    const winner = {
      ...(type === "FABRIC" ? fabricDefaults : leatherDefaults),
      materialId: mid,
      materialType: type,
      version: 0,
      attributes: null,
      finish: "Competing server finish",
    };
    if (type === "FABRIC") fabric = winner;
    else leather = winner;
    await userEvent.click(
      screen.getByRole("button", { name: `Save ${noun} specification` }),
    );
    await screen.findByRole("button", { name: "Switch to edit mode" });
    expect(
      screen.getByRole("heading", {
        name: "Create-only precondition failed (412)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Finish")).toHaveValue("My retained finish");
    expect(screen.getByText(/catalog-reference/)).toBeInTheDocument();
    expect(screen.getByText("Competing server finish")).toBeInTheDocument();
    const path = `/api/v1/admin/materials/${mid}/${noun.toLowerCase()}-spec`;
    expect(puts(path)).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", { name: "Switch to edit mode" }),
    );
    expect(puts(path)).toHaveLength(1);
    expect(screen.getByLabelText("Finish")).toHaveValue("My retained finish");
  },
);
test.each([404, 409])(
  "Spec update %s no automatic mode conversion",
  async (status) => {
    fabric = {
      ...fabricDefaults,
      materialId: mid,
      materialType: "FABRIC",
      version: 4,
      attributes: null,
    };
    overrides[`PUT /api/v1/admin/materials/${mid}/fabric-spec`] = () =>
      reply({}, status);
    mount(`/admin/materials/${mid}`);
    await screen.findByRole("heading", { name: "Edit Fabric specification" });
    fill("Observation UUID", oid, area("Edit Fabric specification"));
    await userEvent.click(
      screen.getByRole("button", { name: "Save Fabric specification" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save Fabric specification" }),
      ).toBeDisabled(),
    );
    expect(
      screen.queryByRole("heading", { name: "Create Fabric specification" }),
    ).toBeNull();
    expect(puts(`/api/v1/admin/materials/${mid}/fabric-spec`)).toHaveLength(1);
  },
);
test("unsafe loaded attributes block spec and Variant writes without stringification", async () => {
  fabric = {
    ...fabricDefaults,
    materialId: mid,
    materialType: "FABRIC",
    version: 0,
    attributes: { size: 1.1 },
  };
  variant.attributes = { size: 9007199254740992 };
  mount(`/admin/materials/${mid}`);
  await screen.findByText(/Specification preservation warning/);
  await userEvent.click(
    screen.getByRole("button", { name: "Open Variant · Indigo" }),
  );
  await screen.findByText(/Variant preservation warning/);
  expect(screen.queryByRole("button", { name: "Save Variant" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save Fabric specification" }),
  ).toBeNull();
});
test("Listing exact quantities, independent version, immutable identities and zero lead time", async () => {
  mount(`/admin/listings/${lid}`);
  await screen.findByRole("heading", { name: "Edit Seller Listing" });
  expect(screen.getByLabelText("Listing MOQ")).toHaveValue("0.0000");
  fill("Observation UUID", oid, area("Edit Seller Listing"));
  await userEvent.click(screen.getByRole("button", { name: "Save Listing" }));
  await waitFor(() =>
    expect(puts(`/api/v1/admin/material-listings/${lid}`)).toHaveLength(1),
  );
  expect(puts(`/api/v1/admin/material-listings/${lid}`)[0]!.body).toMatchObject(
    {
      materialId: mid,
      sellerSupplierId: sid,
      version: 2,
      minimumColorQuantity: "999999999999999.9999",
      minimumOrderQuantity: "0.0000",
      standardLeadTimeDays: 0,
    },
  );
  expect(
    within(area("Edit Seller Listing"))
      .getAllByRole("option")
      .filter((o) =>
        ["FT2", "ROLL", "HIDE", "SET", "PACK"].includes(o.textContent ?? ""),
      ),
  ).toHaveLength(5);
});
test("Listing context does not scan global children until a context is selected", async () => {
  mount("/admin/listings");
  await screen.findByRole("heading", { name: "Listing context workspace" });
  expect(calls.some((c) => c.path.endsWith("/listings"))).toBe(false);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Select Material · Canonical cloth",
    }),
  );
  await screen.findByText(/1 listings loaded/);
  expect(calls.filter((c) => c.path.endsWith("/listings"))).toHaveLength(1);
  expect(calls.some((c) => /prices|inventory/.test(c.path))).toBe(false);
});
test("runtime capability revocation removes protected citations and all drafts", async () => {
  const cache = mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  fill("Material name", "Secret draft");
  admin = false;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(screen.queryByDisplayValue("Secret draft")).toBeNull();
  await waitFor(() =>
    expect(
      cache.getQueryCache().findAll({ queryKey: ["admin", getSession().key] }),
    ).toHaveLength(0),
  );
});
test("Actor switch clears drafts and old protected cache", async () => {
  const cache = mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit Material profile" }),
  );
  fill("Material name", "Actor A draft");
  const scope = getSession().key;
  admin = false;
  await act(async () => setLocalSubject("catalog-buyer-b"));
  await screen.findByRole("heading", { name: "Access denied" });
  expect(screen.queryByDisplayValue("Actor A draft")).toBeNull();
  expect(
    cache.getQueryCache().findAll({ queryKey: ["admin", scope] }),
  ).toHaveLength(0);
});

test.each([{}, [{ fiberTypeId: fiber, percentage: 2 }], null])(
  "malformed Composition is displayed safely and blocks Profile %j",
  async (composition) => {
    material.composition = composition;
    mount(`/admin/materials/${mid}`);
    await screen.findByRole("heading", { name: "Canonical cloth" });
    expect(
      screen.getByRole("button", { name: "Edit Material profile" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Material preservation warning/),
    ).toBeInTheDocument();
  },
);
test("dynamic Composition rows keep neighboring values and stable identities on removal", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Replace Composition" }),
  );
  const a = area("Replace Composition");
  await userEvent.click(
    within(a).getByRole("button", { name: "Add Fiber part" }),
  );
  const fields = within(a).getAllByLabelText("Percentage");
  fireEvent.change(fields[1]!, { target: { value: "12.3456" } });
  const stable = fields[1];
  await userEvent.click(
    within(a).getByRole("button", { name: "Remove Fiber part 1" }),
  );
  expect(within(a).getByLabelText("Percentage")).toBe(stable);
  expect(stable).toHaveValue("12.3456");
});
test("construction changes clear incompatible fields immediately", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  const a = area("Create Fabric specification");
  fill("Construction", "WOVEN", a);
  fill("Weave type", "Twill", a);
  fill("Construction", "KNIT", a);
  fill("Knit type", "Jersey", a);
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Fabric specification" }),
  );
  await waitFor(() =>
    expect(puts(`/api/v1/admin/materials/${mid}/fabric-spec`)).toHaveLength(1),
  );
  expect(
    puts(`/api/v1/admin/materials/${mid}/fabric-spec`)[0]!.body,
  ).toMatchObject({ construction: "KNIT", knitType: "Jersey" });
  expect(
    puts(`/api/v1/admin/materials/${mid}/fabric-spec`)[0]!.body,
  ).not.toHaveProperty("weaveType");
});
test("status0 Spec ambiguity preserves draft and compares fetched state without automatic update", async () => {
  overrides[`PUT /api/v1/admin/materials/${mid}/fabric-spec`] = () => {
    fabric = {
      ...fabricDefaults,
      attributes: null,
      materialId: mid,
      materialType: "FABRIC",
      version: 0,
      finish: "Possibly saved",
    };
    throw new TypeError("network");
  };
  mount(`/admin/materials/${mid}`);
  await ready();
  const a = area("Create Fabric specification");
  fill("Finish", "Draft finish", a);
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Fabric specification" }),
  );
  await screen.findByRole("heading", { name: "Specification outcome unknown" });
  await screen.findByRole("button", { name: "Switch to edit mode" });
  expect(within(a).getByLabelText("Finish")).toHaveValue("Draft finish");
  expect(puts(`/api/v1/admin/materials/${mid}/fabric-spec`)).toHaveLength(1);
});
test("malformed conflict refresh retains Spec draft and blocks writes", async () => {
  mount(`/admin/materials/${mid}`);
  await ready();
  const a = area("Create Fabric specification");
  fill("Finish", "Preserve unsafe-refresh draft", a);
  fill("Observation UUID", oid, a);
  fabric = {
    ...fabricDefaults,
    attributes: { size: 1.1 },
    materialId: mid,
    materialType: "FABRIC",
    version: 0,
  };
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Fabric specification" }),
  );
  await screen.findByText(/current server state is unsafe/);
  expect(within(a).getByLabelText("Finish")).toHaveValue(
    "Preserve unsafe-refresh draft",
  );
  expect(
    within(a).getByRole("button", { name: "Save Fabric specification" }),
  ).toBeDisabled();
});
test("late protected citation completion cannot repopulate next Actor", async () => {
  let release!: (r: Response) => void;
  overrides[`GET /api/v1/admin/materials/${mid}/sources`] = () =>
    new Promise((r) => {
      release = r;
    });
  const cache = mount(`/admin/materials/${mid}`);
  await ready();
  const old = getSession().key;
  admin = false;
  await act(async () => setLocalSubject("catalog-buyer-b"));
  await screen.findByRole("heading", { name: "Access denied" });
  await act(async () =>
    release(
      reply([
        {
          observationId: oid,
          fieldName: "NAME",
          createdAt: "2026-10-21T12:00:00Z",
        },
      ]),
    ),
  );
  expect(screen.queryByText(oid)).toBeNull();
  expect(
    cache.getQueryCache().findAll({ queryKey: ["admin", old] }),
  ).toHaveLength(0);
});
test("Variant edit uses independent version and immutable parent", async () => {
  overrides[`PUT /api/v1/admin/material-variants/${vid}`] = (c) => {
    variant = { ...variant, ...c.body, version: 4 };
    return reply(variant);
  };
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Open Variant · Indigo" }),
  );
  await screen.findByRole("heading", { name: "Edit Variant" });
  const a = area("Edit Variant");
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Variant" }),
  );
  await screen.findByText("Variant saved. Server version: 4.");
  expect(puts(`/api/v1/admin/material-variants/${vid}`)[0]!.body).toMatchObject(
    { version: 3, materialId: mid },
  );
});
test("Listing 409 retains draft with current server comparison", async () => {
  overrides[`PUT /api/v1/admin/material-listings/${lid}`] = () => {
    listing = { ...listing, version: 6, sellerArticleNumber: "Server article" };
    return reply({}, 409);
  };
  mount(`/admin/listings/${lid}`);
  await screen.findByRole("heading", { name: "Edit Seller Listing" });
  const a = area("Edit Seller Listing");
  fill("Seller article number", "Retained article", a);
  fill("Observation UUID", oid, a);
  await userEvent.click(
    within(a).getByRole("button", { name: "Save Listing" }),
  );
  await screen.findByRole("heading", { name: "Current server Listing" });
  expect(screen.getByLabelText("Seller article number")).toHaveValue(
    "Retained article",
  );
  expect(puts(`/api/v1/admin/material-listings/${lid}`)).toHaveLength(1);
});
test("citations paginate and malformed typed rows never render raw fields", async () => {
  overrides[`GET /api/v1/admin/materials/${mid}/sources`] = (c) =>
    reply(
      c.url.searchParams.get("offset") === "0"
        ? Array.from({ length: 25 }, (_, i) => ({
            observationId: id(100 + i),
            fieldName: "NAME",
            createdAt: "2026-10-21T12:00:00Z",
          }))
        : [
            {
              observationId: { raw: "DO NOT RENDER" },
              fieldName: "NAME",
              createdAt: "today",
            },
          ],
    );
  mount(`/admin/materials/${mid}`);
  await ready();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more citations" }),
  );
  await screen.findByText(
    "Citation data is unavailable in a supported format.",
  );
  expect(screen.queryByText("DO NOT RENDER")).toBeNull();
  expect(
    calls
      .filter(
        (c) =>
          c.path.endsWith(`/materials/${mid}/sources`) && c.method === "GET",
      )
      .at(-1)!
      .url.searchParams.get("offset"),
  ).toBe("25");
});

function EditAtAppliedNavigationCommit() {
  const { search } = useLocation();
  useLayoutEffect(() => {
    if (search === "?status=DRAFT")
      fireEvent.change(screen.getByLabelText("Discovery status"), {
        target: { value: "ACTIVE" },
      });
  }, [search]);
  return null;
}
test("a new status draft entered as navigation commits is not overwritten by a delayed URL effect", async () => {
  mount("/admin/materials", <EditAtAppliedNavigationCommit />);
  await screen.findByRole("link", { name: "Open Material · Canonical cloth" });
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Material filters" }),
  );
  expect(screen.getByLabelText("Discovery status")).toHaveValue("ACTIVE");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Material filters" }),
  );
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.path === "/api/v1/materials" &&
          c.url.searchParams.get("status") === "ACTIVE",
      ),
    ).toBe(true),
  );
});

test.each([
  { initial: "/admin/materials", applied: "DRAFT" },
  { initial: "/admin/materials?status=ACTIVE", applied: "ARCHIVED" },
])(
  "edits before an applied $applied navigation commits survive that navigation",
  async ({ initial, applied }) => {
    let release!: () => void;
    let blocked = true;
    const navigation = new Promise<void>((resolve) => {
      release = () => {
        blocked = false;
        resolve();
      };
    });
    function HoldAppliedNavigation() {
      const { search } = useLocation();
      if (search === `?status=${applied}` && blocked) throw navigation;
      return <p data-testid="committed-search">{search || "initial"}</p>;
    }
    mount(initial, <HoldAppliedNavigation />);
    await screen.findByRole("link", {
      name: "Open Material · Canonical cloth",
    });
    fill("Discovery status", applied);
    await userEvent.click(
      screen.getByRole("button", { name: "Apply Material filters" }),
    );
    expect(screen.getByTestId("committed-search")).toHaveTextContent(
      initial.includes("?") ? "?status=ACTIVE" : "initial",
    );
    fill("Discovery status", "ACTIVE");
    fill("Material keyword", "newer draft");
    fill("Material type filter", "BUTTON");
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByTestId("committed-search")).toHaveTextContent(
        `?status=${applied}`,
      ),
    );
    expect(screen.getByLabelText("Discovery status")).toHaveValue("ACTIVE");
    expect(screen.getByLabelText("Material keyword")).toHaveValue(
      "newer draft",
    );
    expect(screen.getByLabelText("Material type filter")).toHaveValue("BUTTON");
    expect(calls.some((c) => c.url.searchParams.has("q"))).toBe(false);
    await userEvent.click(
      screen.getByRole("button", { name: "Apply Material filters" }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === "/api/v1/materials" &&
            c.url.searchParams.get("status") === "ACTIVE" &&
            c.url.searchParams.get("q") === "newer draft" &&
            c.url.searchParams.get("materialType") === "BUTTON",
        ),
      ).toBe(true),
    );
  },
);

function HistoryControls() {
  const navigate = useNavigate();
  const { search } = useLocation();
  return (
    <>
      <p data-testid="committed-search">{search || "initial"}</p>
      <button onClick={() => navigate(-1)}>Test Back</button>
      <button onClick={() => navigate(1)}>Test Forward</button>
    </>
  );
}
test("Back and Forward restore applied filters, and Clear resets them", async () => {
  mount(
    "/admin/materials?status=ACTIVE&q=original&materialType=FABRIC",
    <HistoryControls />,
  );
  await screen.findByRole("link", { name: "Open Material · Canonical cloth" });
  fill("Discovery status", "ARCHIVED");
  fill("Material keyword", "applied next");
  fill("Material type filter", "BUTTON");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Material filters" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("committed-search")).toHaveTextContent(
      "status=ARCHIVED&q=applied+next&materialType=BUTTON",
    ),
  );
  fill("Material keyword", "unsaved");
  await userEvent.click(screen.getByRole("button", { name: "Test Back" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Discovery status")).toHaveValue("ACTIVE"),
  );
  expect(screen.getByLabelText("Material keyword")).toHaveValue("original");
  expect(screen.getByLabelText("Material type filter")).toHaveValue("FABRIC");
  await userEvent.click(screen.getByRole("button", { name: "Test Forward" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Discovery status")).toHaveValue("ARCHIVED"),
  );
  expect(screen.getByLabelText("Material keyword")).toHaveValue("applied next");
  expect(screen.getByLabelText("Material type filter")).toHaveValue("BUTTON");
  await userEvent.click(
    screen.getByRole("button", { name: "Clear Material filters" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("committed-search")).toHaveTextContent(
      "?status=DRAFT",
    ),
  );
  expect(screen.getByLabelText("Discovery status")).toHaveValue("DRAFT");
  expect(screen.getByLabelText("Material keyword")).toHaveValue("");
  expect(screen.getByLabelText("Material type filter")).toHaveValue("");
});
