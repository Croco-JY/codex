import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { endSession, getSession, setLocalSubject } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import type { Supplier, Facility, Assignment } from "./model";
const id = (n: number) =>
  `1c5b0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sid = id(1),
  fid = id(10),
  oid = id(20),
  capid = id(30),
  country = id(40),
  country2 = id(41),
  region = id(50),
  cluster = id(60);
type Call = {
  request: Request;
  path: string;
  method: string;
  url: URL;
  body: Record<string, unknown>;
};
let calls: Call[],
  clients: QueryClient[],
  supplier: Supplier,
  facility: Facility,
  assignment: Assignment | undefined,
  aliases: Record<string, unknown>[],
  events: Record<string, unknown>[],
  citations: Record<string, unknown>[];
let admin: boolean,
  capabilityStatus: number,
  capabilityWait: Promise<Response> | undefined;
let overrides: Record<string, (call: Call) => Response | Promise<Response>>;
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "curation-reference",
    },
  });
const empty = () => new Response(null, { status: 200 });
// Match current Jackson views: optional mutable properties are present as null
// when absent. A truly omitted property remains an incomplete edit projection.
const supplierView = (v: Supplier) =>
  ({
    legalName: null,
    nativeName: null,
    englishName: null,
    businessRegistrationNumber: null,
    websiteUrl: null,
    description: null,
    ...v,
  }) as Supplier;
const facilityView = (v: Facility) =>
  ({
    regionId: null,
    industrialClusterId: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    ...v,
  }) as Facility;
const assignmentView = (v: Assignment) =>
  ({
    proficiencyLevel: null,
    minimumOrderQuantity: null,
    maximumOrderQuantity: null,
    quantityUnit: null,
    notes: null,
    ...v,
  }) as Assignment;
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  setLocalSubject("curation-admin-a");
  admin = true;
  capabilityStatus = 200;
  capabilityWait = undefined;
  calls = [];
  clients = [];
  overrides = {};
  supplier = supplierView({
    id: sid,
    countryId: country,
    displayName: "Canonical Supplier A",
    roles: ["MILL"],
    status: "ACTIVE",
    verificationStatus: "DISCOVERED",
    version: 3,
  });
  facility = facilityView({
    id: fid,
    supplierId: sid,
    facilityType: "MILL",
    name: "Physical Facility A",
    countryId: country,
    regionId: region,
    industrialClusterId: cluster,
    status: "ACTIVE",
    version: 7,
    latitude: "0.000000",
    longitude: "135.123456",
  });
  assignment = {
    facilityId: fid,
    capabilityId: capid,
    proficiencyLevel: "EXPERIENCED",
    minimumOrderQuantity: "0.0000",
    maximumOrderQuantity: "999999999999999.9999",
    quantityUnit: "METER",
    notes: "Protected existing assignment notes",
    verificationStatus: "DOCUMENTED",
    version: 2,
  };
  aliases = [];
  events = [];
  citations = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url),
        path = url.pathname,
        call: Call = {
          request,
          url,
          path,
          method: request.method,
          body: request.method === "GET" ? {} : await request.clone().json(),
        };
      calls.push(call);
      if (overrides[`${request.method} ${path}`])
        return overrides[`${request.method} ${path}`]!(call);
      if (path === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject"),
        });
      if (path === "/api/identity/capabilities")
        return (
          capabilityWait ?? reply({ platformAdmin: admin }, capabilityStatus)
        );
      if (path === "/api/health") return reply({ status: "UP" });
      if (path === "/api/v1/organizations") return reply([]);
      if (path === "/api/v1/countries")
        return reply([
          { id: country, alpha2: "JP", nameEn: "Japan", active: true },
          { id: country2, alpha2: "KR", nameEn: "Korea", active: true },
        ]);
      if (path === "/api/v1/regions")
        return reply(
          [
            {
              id: region,
              countryId: country,
              nameEn: "Kyoto Region",
              active: true,
            },
          ].filter(
            (r) =>
              !url.searchParams.has("country") ||
              r.countryId === url.searchParams.get("country"),
          ),
        );
      if (path === "/api/v1/industrial-clusters")
        return reply(
          [
            {
              id: cluster,
              countryId: country,
              nameEn: "Textile Industrial Cluster",
              active: true,
            },
          ].filter(
            (r) =>
              !url.searchParams.has("country") ||
              r.countryId === url.searchParams.get("country"),
          ),
        );
      if (path === "/api/v1/capabilities")
        return reply([
          {
            id: capid,
            nameEn: "Precision weaving",
            code: "WEAVING",
            category: "PROCESS",
            active: true,
          },
        ]);
      if (path === "/api/v1/suppliers")
        return reply({
          items:
            supplier.status === "ACTIVE"
              ? [
                  {
                    id: sid,
                    displayName: supplier.displayName,
                    country: "JP",
                    verificationStatus: supplier.verificationStatus,
                  },
                ]
              : [],
        });
      if (path === "/api/v1/facilities")
        return reply({
          items:
            facility.status === "ACTIVE"
              ? [
                  {
                    id: fid,
                    supplierId: sid,
                    name: facility.name,
                    country: "JP",
                    facilityType: facility.facilityType,
                  },
                ]
              : [],
        });
      if (path === `/api/v1/suppliers/${sid}`) return reply(supplier);
      if (path === `/api/v1/facilities/${fid}`) return reply(facility);
      if (path === `/api/v1/suppliers/${sid}/aliases`) return reply(aliases);
      if (path === `/api/v1/suppliers/${sid}/verification-events`)
        return reply(events);
      if (path === `/api/v1/suppliers/${sid}/facilities`)
        return reply({
          items:
            supplier.status === "ACTIVE"
              ? [
                  {
                    id: fid,
                    supplierId: sid,
                    name: facility.name,
                    country: "JP",
                    facilityType: "MILL",
                  },
                ]
              : [],
        });
      if (path === `/api/v1/facilities/${fid}/capabilities`) {
        const publicView = assignment ? { ...assignment } : undefined;
        if (publicView) delete publicView.notes;
        return reply(publicView ? [publicView] : []);
      }
      if (
        path === `/api/v1/admin/suppliers/${sid}/sources` ||
        path === `/api/v1/admin/facilities/${fid}/sources`
      ) {
        if (request.method === "POST") {
          citations.push({
            source_observation_id: call.body.observationId,
            field_name: call.body.fieldName,
            created_at: "2026-10-21T12:00:00Z",
          });
          return empty();
        }
        return reply(citations);
      }
      if (path === "/api/v1/admin/suppliers") {
        supplier = {
          ...call.body,
          id: sid,
          version: 0,
          verificationStatus: "DISCOVERED",
        } as Supplier;
        supplier = supplierView(supplier);
        return reply(supplier);
      }
      if (path === `/api/v1/admin/suppliers/${sid}`) {
        if (call.body.version !== supplier.version) return reply({}, 409);
        supplier = {
          ...call.body,
          id: sid,
          version: supplier.version! + 1,
          verificationStatus: supplier.verificationStatus,
        } as Supplier;
        supplier = supplierView(supplier);
        return reply(supplier);
      }
      if (path === `/api/v1/admin/suppliers/${sid}/aliases`) {
        if (call.body.version !== supplier.version) return reply({}, 409);
        supplier = { ...supplier, version: supplier.version! + 1 };
        aliases.push({ ...call.body, id: id(70 + aliases.length) });
        return reply(aliases.at(-1)!.id);
      }
      if (path === `/api/v1/admin/suppliers/${sid}/verification-events`) {
        if (
          call.body.version !== supplier.version ||
          call.body.status === supplier.verificationStatus
        )
          return reply({}, 409);
        events.unshift({
          ...call.body,
          id: id(80 + events.length),
          newStatus: call.body.status,
          previousStatus: supplier.verificationStatus,
          actorIssuer: "local",
          actorSubject: "curation-admin-a",
          occurredAt: "2026-10-21T12:00:00Z",
        });
        supplier = {
          ...supplier,
          version: supplier.version! + 1,
          verificationStatus: call.body
            .status as Supplier["verificationStatus"],
        };
        return reply(supplier);
      }
      if (path === "/api/v1/admin/facilities") {
        facility = { ...call.body, id: fid, version: 0 } as Facility;
        facility = facilityView(facility);
        return reply(facility);
      }
      if (path === `/api/v1/admin/facilities/${fid}`) {
        if (call.body.version !== facility.version) return reply({}, 409);
        if (call.body.supplierId !== facility.supplierId) return reply({}, 400);
        facility = {
          ...call.body,
          id: fid,
          version: facility.version! + 1,
        } as Facility;
        facility = facilityView(facility);
        return reply(facility);
      }
      if (path === `/api/v1/admin/facilities/${fid}/capabilities/${capid}`) {
        if (request.method === "GET")
          return assignment ? reply(assignment) : reply({}, 404);
        const creating = request.headers.get("If-None-Match") === "*";
        if (creating && assignment) return reply({}, 412);
        if (!creating && !assignment) return reply({}, 404);
        if (!creating && call.body.version !== assignment!.version)
          return reply({}, 409);
        assignment = {
          ...call.body,
          facilityId: fid,
          capabilityId: capid,
          version: creating ? 0 : assignment!.version! + 1,
        } as Assignment;
        assignment = assignmentView(assignment);
        return empty();
      }
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  endSession();
  vi.unstubAllGlobals();
});
function mount(path = `/admin/suppliers/${sid}`) {
  const cache = createQueryClient();
  clients.push(cache);
  cache.setDefaultOptions({
    ...cache.getDefaultOptions(),
    queries: { ...cache.getDefaultOptions().queries, retryDelay: 0 },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
const gets = (path: string) =>
  calls.filter((c) => c.path === path && c.method === "GET");
const writes = (path?: string) =>
  calls.filter((c) => c.method !== "GET" && (!path || c.path === path));
const fill = (label: string, value: string, region?: HTMLElement) =>
  fireEvent.change(
    (region ? within(region) : screen).getByLabelText(label, { exact: true }),
    { target: { value } },
  );
const evidence = (area: HTMLElement) => fill("Observation UUID", oid, area);
async function supplierReady() {
  await screen.findByRole("heading", { level: 1, name: supplier.displayName! });
  await screen.findByRole("heading", { name: "Fact citations" });
}
async function facilityReady() {
  await screen.findByRole("heading", { level: 1, name: facility.name! });
  await screen.findByLabelText("Capability to inspect / curate");
}
async function editSupplier() {
  await userEvent.click(screen.getByRole("button", { name: "Edit Supplier" }));
  return screen.getByRole("region", { name: "Edit Supplier form" });
}
async function aliasForm() {
  await userEvent.click(screen.getByRole("button", { name: "Append Alias" }));
  return screen.getByRole("region", { name: "Append Alias form" });
}
async function verificationForm() {
  await userEvent.click(
    screen.getByRole("button", { name: "Manual verification" }),
  );
  return screen.getByRole("region", { name: "Manual Verification form" });
}
async function assignmentForm() {
  await userEvent.selectOptions(
    screen.getByLabelText("Capability to inspect / curate"),
    capid,
  );
  return screen.findByRole("region", { name: "Capability assignment form" });
}

test.each([
  "/admin/suppliers",
  `/admin/suppliers/${sid}`,
  "/admin/facilities",
  `/admin/facilities/${fid}`,
])(
  "non-admin %s denies before protected children or directory reads",
  async (path) => {
    admin = false;
    mount(path);
    await screen.findByRole("heading", { name: "Access denied" });
    expect(calls.some((c) => c.path.startsWith("/api/v1/"))).toBe(false);
    expect(
      screen.queryByRole("link", { name: "Curation" }),
    ).not.toBeInTheDocument();
  },
);
test.each(["PENDING", "ERROR"])(
  "%s capability fails closed for nested curation",
  async (state) => {
    if (state === "PENDING") capabilityWait = deferred<Response>().promise;
    else capabilityStatus = 503;
    mount(`/admin/facilities/${fid}`);
    if (state === "PENDING")
      await screen.findByLabelText("Checking curation access");
    else
      await screen.findByRole("heading", {
        name: "Curation access unavailable",
      });
    expect(calls.some((c) => c.path.startsWith("/api/v1/"))).toBe(false);
  },
);
test("ADMIN landing exposes exactly Sources, Suppliers and Facilities tools and nested entry refresh", async () => {
  mount("/admin");
  await screen.findByRole("link", { name: "Open Supplier curation" });
  const before = gets("/api/identity/capabilities").length;
  await userEvent.click(
    screen.getByRole("link", { name: "Open Supplier curation" }),
  );
  await screen.findByRole("button", { name: "New Supplier" });
  await waitFor(() =>
    expect(gets("/api/identity/capabilities").length).toBeGreaterThan(before),
  );
  expect(
    screen.queryByRole("link", {
      name: /Open.*(?:Material|Listing|Price|Inventory|Identity)/i,
    }),
  ).not.toBeInTheDocument();
});
test("Supplier directory reuses filters/cursors and has no per-row detail, citation or history fanout", async () => {
  mount("/admin/suppliers?country=JP&role=MILL&q=Canonical");
  await screen.findByRole("link", { name: "Canonical Supplier A" });
  const call = gets("/api/v1/suppliers")[0]!;
  expect(call.url.searchParams.get("country")).toBe("JP");
  expect(call.url.searchParams.get("role")).toBe("MILL");
  expect(call.url.searchParams.get("q")).toBe("Canonical");
  expect(call.url.searchParams.get("limit")).toBe("25");
  expect(calls.filter((c) => /\/suppliers\//.test(c.path))).toEqual([]);
  expect(
    screen.getByRole("link", { name: "Canonical Supplier A" }),
  ).toHaveAttribute("href", `/admin/suppliers/${sid}`);
});
test("Facility directory never sends q or fetches per-row Facility/citation/capabilities", async () => {
  mount("/admin/facilities?country=JP&type=MILL&q=forbidden");
  await screen.findByRole("link", { name: "Physical Facility A" });
  expect(gets("/api/v1/facilities")[0]!.url.searchParams.has("q")).toBe(false);
  expect(screen.queryByLabelText("Keyword")).not.toBeInTheDocument();
  expect(calls.filter((c) => /\/facilities\//.test(c.path))).toEqual([]);
});
test("Supplier create sends version 0, Country UUID, empty roles and omitted optional strings; no initial verification selector", async () => {
  mount("/admin/suppliers");
  await userEvent.click(
    await screen.findByRole("button", { name: "New Supplier" }),
  );
  const area = screen.getByRole("region", { name: "Create Supplier form" });
  await userEvent.selectOptions(
    within(area).getByLabelText("Country", { exact: true }),
    country,
  );
  fill("Display name", "New canonical supplier", area);
  evidence(area);
  expect(
    within(area).queryByLabelText(/verification/i),
  ).not.toBeInTheDocument();
  expect(
    within(area).getByText(
      "New Suppliers begin at DISCOVERED verification status. Verification can be adjusted after creation.",
    ),
  ).toBeInTheDocument();
  await userEvent.click(
    within(area).getByRole("button", { name: "Create Supplier" }),
  );
  await screen.findByRole("heading", {
    level: 1,
    name: "New canonical supplier",
  });
  expect(writes("/api/v1/admin/suppliers")[0]!.body).toEqual({
    countryId: country,
    displayName: "New canonical supplier",
    status: "ACTIVE",
    roles: [],
    observationId: oid,
    version: 0,
  });
});
test("Supplier edit replaces roles, preserves original URL and uses exact server version", async () => {
  supplier = {
    ...supplier,
    legalName: "Old legal name",
    websiteUrl: "https://example.com/old",
  };
  mount();
  await supplierReady();
  const area = await editSupplier();
  fill("Legal name (optional)", "", area);
  fill(
    "Website URL (optional)",
    "https://Example.com:443/Original?Q=MiXeD",
    area,
  );
  await userEvent.click(within(area).getByLabelText("MILL"));
  await userEvent.click(within(area).getByLabelText("PROCESSOR"));
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Supplier" }),
  );
  await within(area).findByText(
    "Supplier updated. The server version was refetched before another versioned command.",
  );
  expect(writes(`/api/v1/admin/suppliers/${sid}`)[0]!.body).toMatchObject({
    version: 3,
    roles: ["PROCESSOR"],
    websiteUrl: "https://Example.com:443/Original?Q=MiXeD",
  });
  expect(writes(`/api/v1/admin/suppliers/${sid}`)[0]!.body).not.toHaveProperty(
    "legalName",
  );
});
test.each(["roles", "version", "countryId", "verificationStatus"])(
  "incomplete Supplier %s blocks versioned actions",
  async (field) => {
    delete (supplier as Record<string, unknown>)[field];
    mount();
    await supplierReady();
    for (const name of ["Edit Supplier", "Append Alias", "Manual verification"])
      expect(screen.getByRole("button", { name })).toBeDisabled();
  },
);
test("profile 409 retains draft and requires explicit server-version adoption", async () => {
  mount();
  await supplierReady();
  const area = await editSupplier();
  fill("Display name", "Unsubmitted operator draft", area);
  evidence(area);
  supplier = { ...supplier, displayName: "Concurrent server name", version: 8 };
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Supplier" }),
  );
  await within(area).findByRole("heading", {
    name: "The Supplier changed or conflicts with the current server state.",
  });
  expect(within(area).getByLabelText("Display name")).toHaveValue(
    "Unsubmitted operator draft",
  );
  expect(within(area).getByText("Concurrent server name")).toBeInTheDocument();
  expect(writes().length).toBe(1);
  await userEvent.click(
    within(area).getByRole("button", {
      name: "Use refreshed Supplier version, keep draft",
    }),
  );
  expect(writes().length).toBe(1);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Supplier" }),
  );
  await waitFor(() => expect(writes().length).toBe(2));
  expect(writes().at(-1)!.body.version).toBe(8);
});
test.each(["supplier", "facility"])(
  "known archived %s detail remains mounted",
  async (kind) => {
    if (kind === "supplier") supplier.status = "ARCHIVED";
    else facility.status = "ARCHIVED";
    mount(
      `/admin/${kind === "supplier" ? "suppliers" : "facilities"}/${kind === "supplier" ? sid : fid}`,
    );
    await screen.findByText(
      "This record is archived and may no longer appear in active directories.",
    );
    if (kind === "supplier")
      await screen.findByText(
        "No Facilities returned in this active-directory view. Known Facility detail links remain usable.",
      );
    expect(
      screen.getByRole("button", {
        name: kind === "supplier" ? "Edit Supplier" : "Edit Facility",
      }),
    ).toBeEnabled();
  },
);
test("Alias → Verification → Profile uses refetched parent versions 3 → 4 → 5", async () => {
  mount();
  await supplierReady();
  let area = await aliasForm();
  fill("Alias", "MiXeD external alias", area);
  fill("Language code (optional)", "en-US", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Append Alias" }),
  );
  await within(area).findByText(
    "Alias appended. Supplier parent version and alias history refetched.",
  );
  await userEvent.click(
    within(area).getByRole("button", { name: "Close Alias form" }),
  );
  area = await verificationForm();
  await userEvent.selectOptions(
    within(area).getByLabelText("Manual verification target"),
    "AUDITED",
  );
  fill("Verification reason", "Reviewed site evidence", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Change verification" }),
  );
  await within(area).findByText(
    "Verification changed. Supplier parent version and verification history refetched.",
  );
  await userEvent.click(
    within(area).getByRole("button", { name: "Close Verification form" }),
  );
  area = await editSupplier();
  fill("Display name", "After child commands", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Supplier" }),
  );
  await within(area).findByText(
    "Supplier updated. The server version was refetched before another versioned command.",
  );
  expect(writes().map((c) => c.body.version)).toEqual([3, 4, 5]);
});
test("Verification → Alias also reloads the shared Supplier version", async () => {
  supplier.verificationStatus = "AUDITED";
  mount();
  await supplierReady();
  let area = await verificationForm();
  expect(
    [
      ...within(area).getByLabelText<HTMLSelectElement>(
        "Manual verification target",
      ).options,
    ].map((o) => o.value),
  ).toEqual(["DISCOVERED", "VERIFIED"]);
  await userEvent.selectOptions(
    within(area).getByLabelText("Manual verification target"),
    "VERIFIED",
  );
  fill("Verification reason", "Non-monotonic reviewed transition", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Change verification" }),
  );
  await within(area).findByText(
    "Verification changed. Supplier parent version and verification history refetched.",
  );
  await userEvent.click(
    within(area).getByRole("button", { name: "Close Verification form" }),
  );
  area = await aliasForm();
  fill("Alias", "Second direction", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Append Alias" }),
  );
  await within(area).findByText(
    "Alias appended. Supplier parent version and alias history refetched.",
  );
  expect(writes().map((c) => c.body.version)).toEqual([3, 4]);
});
test("Verification only offers allowed different targets and supports VERIFIED → DISCOVERED", async () => {
  supplier.verificationStatus = "VERIFIED";
  mount();
  await supplierReady();
  const area = await verificationForm(),
    select = within(area).getByLabelText<HTMLSelectElement>(
      "Manual verification target",
    );
  expect([...select.options].map((o) => o.value)).toEqual([
    "DISCOVERED",
    "AUDITED",
  ]);
  await userEvent.selectOptions(select, "DISCOVERED");
  fill("Verification reason", "Return to discovery after new evidence", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Change verification" }),
  );
  await within(area).findByText(
    "Verification changed. Supplier parent version and verification history refetched.",
  );
  expect(writes()[0]!.body).toMatchObject({
    status: "DISCOVERED",
    version: 3,
    observationId: oid,
  });
});
test("Alias ambiguity preserves original draft, refetches parent/history and highlights matching visible alias", async () => {
  overrides[`POST /api/v1/admin/suppliers/${sid}/aliases`] = (c) => {
    aliases.push({ alias: c.body.alias, aliasType: c.body.aliasType });
    supplier.version = 4;
    throw new TypeError("network failed");
  };
  mount();
  await supplierReady();
  const area = await aliasForm();
  fill("Alias", "Exact original Alias", area);
  evidence(area);
  const before = gets(`/api/v1/suppliers/${sid}`).length;
  await userEvent.click(
    within(area).getByRole("button", { name: "Append Alias" }),
  );
  await within(area).findByRole("heading", {
    name: "Alias append outcome unknown",
  });
  await within(area).findByText(
    "A visible matching alias was returned. Inspect alias history before another explicit append.",
  );
  expect(within(area).getByLabelText("Alias", { exact: true })).toHaveValue(
    "Exact original Alias",
  );
  expect(gets(`/api/v1/suppliers/${sid}`).length).toBeGreaterThan(before);
  expect(writes().length).toBe(1);
  expect(
    screen.queryByRole("button", { name: /Delete Alias|Edit Alias/ }),
  ).not.toBeInTheDocument();
});
test.each(["suppliers", "facilities"])(
  "%s citations allowlist map fields, ignore extra values, and append without parent version",
  async (kind) => {
    citations = [
      {
        source_observation_id: oid,
        field_name: "RECORD",
        created_at: "2026-10-21T12:00:00Z",
        arbitrary: { secret: "DO-NOT-RENDER" },
      },
      { arbitrary: { secret: "RAW-JSON-SECRET" } },
    ];
    mount(`/admin/${kind}/${kind === "suppliers" ? sid : fid}`);
    const area = await screen.findByRole("region", {
      name: `${kind === "suppliers" ? "Supplier" : "Facility"} fact citations`,
    });
    await within(area).findByText(
      "Citation data is unavailable in a supported format.",
    );
    expect(
      screen.queryByText(/RAW-JSON-SECRET|DO-NOT-RENDER/),
    ).not.toBeInTheDocument();
    evidence(area);
    await userEvent.selectOptions(
      within(area).getByLabelText("Fact field"),
      kind === "suppliers" ? "DESCRIPTION" : "ADDRESS",
    );
    await userEvent.click(
      within(area).getByRole("button", { name: "Append fact citation" }),
    );
    await within(area).findByText(
      "Fact citation appended. The parent profile version is unchanged by this command.",
    );
    expect(writes()[0]!.body).toEqual({
      observationId: oid,
      fieldName: kind === "suppliers" ? "DESCRIPTION" : "ADDRESS",
    });
    expect(supplier.version).toBe(3);
    expect(facility.version).toBe(7);
  },
);
test("Facility create selects parent by name and submits Country UUID and exact zero coordinates", async () => {
  mount("/admin/facilities");
  await userEvent.click(
    await screen.findByRole("button", { name: "New Facility" }),
  );
  const area = screen.getByRole("region", { name: "Create Facility form" });
  fill("Search parent supplier by name", "Canonical", area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Find parent supplier" }),
  );
  await userEvent.click(
    await within(area).findByRole("button", {
      name: "Canonical Supplier A · JP",
    }),
  );
  fill("Facility name", "New physical site", area);
  await userEvent.selectOptions(
    within(area).getByLabelText("Country", { exact: true }),
    country,
  );
  fill("Latitude (optional)", "0", area);
  fill("Longitude (optional)", "135.123456", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Create Facility" }),
  );
  await screen.findByRole("heading", { level: 1, name: "New physical site" });
  expect(writes()[0]!.body).toMatchObject({
    supplierId: sid,
    countryId: country,
    version: 0,
    latitude: "0",
    longitude: "135.123456",
  });
});
test("Add Facility from a known archived Supplier fixes parent while ACTIVE picker is bypassed", async () => {
  supplier.status = "ARCHIVED";
  mount();
  await supplierReady();
  await userEvent.click(screen.getByRole("link", { name: "Add Facility" }));
  const area = await screen.findByRole("region", {
    name: "Create Facility form",
  });
  expect(
    within(area).getByText(
      "Parent Supplier — read-only; fixed by Supplier context",
    ),
  ).toBeInTheDocument();
  expect(
    within(area).queryByLabelText("Search parent supplier by name"),
  ).not.toBeInTheDocument();
  fill("Facility name", "Archived-parent site", area);
  await userEvent.selectOptions(
    within(area).getByLabelText("Country", { exact: true }),
    country,
  );
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Create Facility" }),
  );
  await waitFor(() => expect(writes().length).toBe(1));
  expect(writes()[0]!.body.supplierId).toBe(sid);
});
test("Facility edit keeps parent immutable and changing Country clears Region and Cluster", async () => {
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  await userEvent.click(screen.getByRole("button", { name: "Edit Facility" }));
  const area = screen.getByRole("region", { name: "Edit Facility form" });
  await waitFor(() =>
    expect(within(area).getByLabelText("Region (optional)")).toHaveValue(
      region,
    ),
  );
  expect(
    within(area).queryByLabelText("Search parent supplier by name"),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(
    within(area).getByLabelText("Country", { exact: true }),
    country2,
  );
  expect(within(area).getByLabelText("Region (optional)")).toHaveValue("");
  expect(
    within(area).getByLabelText("Industrial Cluster (optional)"),
  ).toHaveValue("");
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Facility" }),
  );
  await within(area).findByText(
    "Facility updated. The server profile version was refreshed.",
  );
  expect(writes()[0]!.body).toMatchObject({
    supplierId: sid,
    countryId: country2,
    version: 7,
  });
  expect(writes()[0]!.body).not.toHaveProperty("regionId");
  expect(
    gets("/api/v1/regions").some(
      (c) => c.url.searchParams.get("country") === country2,
    ),
  ).toBe(true);
  expect(
    gets("/api/v1/industrial-clusters").some(
      (c) => c.url.searchParams.get("country") === country2,
    ),
  ).toBe(true);
});
test("Facility 409 preserves draft and never automatically retries with a fetched version", async () => {
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  await userEvent.click(screen.getByRole("button", { name: "Edit Facility" }));
  const area = screen.getByRole("region", { name: "Edit Facility form" });
  fill("Facility name", "Local physical site draft", area);
  evidence(area);
  facility = { ...facility, name: "Concurrent facility", version: 12 };
  await userEvent.click(
    within(area).getByRole("button", { name: "Save Facility" }),
  );
  await within(area).findByRole("heading", {
    name: "The Facility changed or conflicts with the current server state.",
  });
  expect(within(area).getByLabelText("Facility name")).toHaveValue(
    "Local physical site draft",
  );
  expect(writes().length).toBe(1);
  expect(within(area).getByText("Concurrent facility")).toBeInTheDocument();
});
test("protected targeted read alone hydrates Capability notes and independent version", async () => {
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  expect(
    gets(`/api/v1/admin/facilities/${fid}/capabilities/${capid}`),
  ).toHaveLength(0);
  const area = await assignmentForm();
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Protected existing assignment notes");
  expect(
    within(area).getByText(/Protected assignment version: 2/),
  ).toBeInTheDocument();
  const options = within(area).getByLabelText<HTMLSelectElement>(
    "Quantity unit (optional without quantities)",
  );
  expect([...options.options].map((o) => o.value)).toEqual([
    "",
    "PCS",
    "METER",
    "YARD",
    "KG",
    "GRAM",
    "MM",
    "CM",
    "M2",
  ]);
});
test.each(["facilityId", "capabilityId", "version"])(
  "malformed protected assignment %s blocks edit",
  async (field) => {
    delete (assignment as Record<string, unknown>)[field];
    mount(`/admin/facilities/${fid}`);
    await facilityReady();
    await userEvent.selectOptions(
      screen.getByLabelText("Capability to inspect / curate"),
      capid,
    );
    await screen.findByText(
      "Protected assignment state is incomplete or unsafe. Editing is blocked.",
    );
    expect(
      screen.queryByRole("button", { name: "Save assignment" }),
    ).not.toBeInTheDocument();
  },
);
test("targeted 404 permits create only after independently loaded Facility, uses generated header and empty PUT response then GET", async () => {
  assignment = undefined;
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  await within(area).findByRole("heading", {
    name: "Create Capability assignment",
  });
  fill("Minimum order quantity (optional)", "999999999999999.9999", area);
  await userEvent.selectOptions(
    within(area).getByLabelText("Quantity unit (optional without quantities)"),
    "METER",
  );
  fill("Protected Capability notes (optional)", "New protected notes", area);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Create assignment" }),
  );
  await within(area).findByText(/Current server version: 0/);
  const write = writes()[0]!;
  expect(write.request.headers.get("If-None-Match")).toBe("*");
  expect(write.body).toMatchObject({
    version: 0,
    minimumOrderQuantity: "999999999999999.9999",
    notes: "New protected notes",
  });
  expect(
    gets(`/api/v1/admin/facilities/${fid}/capabilities/${capid}`).length,
  ).toBeGreaterThan(1);
  expect(gets(`/api/v1/facilities/${fid}/capabilities`).length).toBeGreaterThan(
    1,
  );
});
test("missing parent cannot be treated as missing assignment create context", async () => {
  overrides[`GET /api/v1/facilities/${fid}`] = () => reply({}, 404);
  mount(`/admin/facilities/${fid}`);
  await screen.findByRole("heading", { name: "Not found" });
  expect(
    screen.queryByLabelText("Capability to inspect / curate"),
  ).not.toBeInTheDocument();
  expect(
    gets(`/api/v1/admin/facilities/${fid}/capabilities/${capid}`),
  ).toHaveLength(0);
});
test("412 preserves draft, request reference and competing notes; switching edit is explicit and sends no automatic update", async () => {
  assignment = undefined;
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  fill("Protected Capability notes (optional)", "Original create draft", area);
  evidence(area);
  assignment = assignmentView({
    facilityId: fid,
    capabilityId: capid,
    notes: "Competing first writer notes",
    verificationStatus: "AUDITED",
    version: 0,
  });
  await userEvent.click(
    within(area).getByRole("button", { name: "Create assignment" }),
  );
  await within(area).findByRole("heading", {
    name: "Create-only precondition failed (412)",
  });
  expect(
    within(area).getByText("Request reference: curation-reference"),
  ).toBeInTheDocument();
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Original create draft");
  expect(
    within(area).getByText("Competing first writer notes"),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    within(area).getByRole("button", { name: "Switch to edit mode" }),
  );
  expect(writes()).toHaveLength(1);
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Original create draft");
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await within(area).findByText(/Current server version: 1/);
  expect(writes().at(-1)!.request.headers.has("If-None-Match")).toBe(false);
  expect(writes().at(-1)!.body.version).toBe(0);
});
test("Capability update omits header, uses assignment version and adopts returned GET version rather than guessing", async () => {
  overrides[`PUT /api/v1/admin/facilities/${fid}/capabilities/${capid}`] = (
    c,
  ) => {
    assignment = { ...assignment, ...c.body, version: 9 };
    return empty();
  };
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  fill(
    "Protected Capability notes (optional)",
    "Updated exact assignment",
    area,
  );
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await within(area).findByText(/Current server version: 9/);
  expect(writes()[0]!.body.version).toBe(2);
  expect(writes()[0]!.request.headers.has("If-None-Match")).toBe(false);
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1]!.body.version).toBe(9);
});
test("Capability stale 409 keeps draft and latest private baseline without auto-retry", async () => {
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  fill("Protected Capability notes (optional)", "Retained stale edit", area);
  evidence(area);
  assignment = {
    ...assignment,
    version: 8,
    notes: "Latest protected server notes",
  };
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await within(area).findByRole("heading", {
    name: "The Capability assignment changed or conflicts with the current server state.",
  });
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Retained stale edit");
  expect(
    within(area).getByText("Latest protected server notes"),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});
test("Capability missing update 404 refreshes parent/target but does not automatically create", async () => {
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  evidence(area);
  assignment = undefined;
  const before = gets(`/api/v1/facilities/${fid}`).length;
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await within(area).findByRole("button", { name: "Switch to create mode" });
  expect(writes()).toHaveLength(1);
  expect(writes()[0]!.request.headers.has("If-None-Match")).toBe(false);
  expect(gets(`/api/v1/facilities/${fid}`).length).toBeGreaterThan(before);
  expect(
    screen.queryByRole("button", { name: /Unassign|Delete Capability/ }),
  ).not.toBeInTheDocument();
});
test("Capability status-0 outcome preserves draft and compares a GET result without inferring original success", async () => {
  overrides[`PUT /api/v1/admin/facilities/${fid}/capabilities/${capid}`] =
    () => {
      assignment = { ...assignment, version: 3 };
      throw new TypeError("network uncertain");
    };
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  fill(
    "Protected Capability notes (optional)",
    "Ambiguous retained draft",
    area,
  );
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Save assignment" }),
  );
  await within(area).findByRole("heading", {
    name: "Capability write outcome unknown",
  });
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Ambiguous retained draft");
  expect(writes()).toHaveLength(1);
  await within(area).findByRole("button", {
    name: "Use refreshed assignment version, keep draft",
  });
});
test.each([400, 403, 404, 409, 412, 500])(
  "Supplier create explicit HTTP %s is not a transport-ambiguity warning",
  async (status) => {
    overrides["POST /api/v1/admin/suppliers"] = () => reply({}, status);
    mount("/admin/suppliers");
    await userEvent.click(
      await screen.findByRole("button", { name: "New Supplier" }),
    );
    const area = screen.getByRole("region", { name: "Create Supplier form" });
    fill("Display name", "Preserved failed draft", area);
    await userEvent.selectOptions(
      within(area).getByLabelText("Country", { exact: true }),
      country,
    );
    evidence(area);
    await userEvent.click(
      within(area).getByRole("button", { name: "Create Supplier" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() =>
      expect(within(area).getByRole("alert")).toBeInTheDocument(),
    );
    expect(within(area).queryByText(/outcome unknown/)).not.toBeInTheDocument();
    expect(within(area).getByLabelText("Display name")).toHaveValue(
      "Preserved failed draft",
    );
  },
);
test("runtime revocation removes protected notes/citations, draft and mode while public buyer-readable cache can remain", async () => {
  const cache = mount(`/admin/facilities/${fid}`);
  await facilityReady();
  const area = await assignmentForm();
  fill("Protected Capability notes (optional)", "Discard on revocation", area);
  const scope = getSession().key;
  expect(
    cache.getQueryData(queryKeys.adminAssignment(scope, fid, capid)),
  ).toBeDefined();
  admin = false;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: queryKeys.capabilities(scope) });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(
    screen.queryByDisplayValue("Discard on revocation"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(cache.getQueriesData({ queryKey: queryKeys.admin(scope) })).toEqual(
    [],
  );
  expect(cache.getQueryData(queryKeys.facility(scope, fid))).toBeDefined();
});
test("Actor switch cancels late protected assignment and removes all old drafts/context/cache", async () => {
  const late = deferred<Response>();
  overrides[`GET /api/v1/admin/facilities/${fid}/capabilities/${capid}`] = () =>
    late.promise;
  const cache = mount(`/admin/facilities/${fid}`);
  await facilityReady();
  await userEvent.selectOptions(
    screen.getByLabelText("Capability to inspect / curate"),
    capid,
  );
  await waitFor(() =>
    expect(
      gets(`/api/v1/admin/facilities/${fid}/capabilities/${capid}`),
    ).toHaveLength(1),
  );
  const old = getSession().key,
    request = gets(`/api/v1/admin/facilities/${fid}/capabilities/${capid}`)[0]!
      .request;
  admin = false;
  await act(async () => setLocalSubject("buyer-b"));
  await screen.findByRole("heading", { name: "Access denied" });
  await act(async () => late.resolve(reply(assignment)));
  expect(request.signal.aborted).toBe(true);
  expect(cache.getQueriesData({ queryKey: queryKeys.admin(old) })).toEqual([]);
  expect(
    screen.queryByDisplayValue("Protected existing assignment notes"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/outcome unknown/)).not.toBeInTheDocument();
});

test.each(["supplier", "facility"])(
  "%s malformed conflict refresh does not erase an existing draft",
  async (kind) => {
    mount(
      `/admin/${kind === "supplier" ? "suppliers" : "facilities"}/${kind === "supplier" ? sid : fid}`,
    );
    if (kind === "supplier") await supplierReady();
    else await facilityReady();
    const area =
      kind === "supplier"
        ? await editSupplier()
        : await (async () => {
            await userEvent.click(
              screen.getByRole("button", { name: "Edit Facility" }),
            );
            return screen.getByRole("region", { name: "Edit Facility form" });
          })();
    const label = kind === "supplier" ? "Display name" : "Facility name";
    fill(label, "Draft retained despite incomplete server view", area);
    evidence(area);
    const publicPath = `/api/v1/${kind === "supplier" ? "suppliers" : "facilities"}/${kind === "supplier" ? sid : fid}`,
      adminPath = publicPath.replace("/api/v1/", "/api/v1/admin/");
    overrides[`PUT ${adminPath}`] = () => reply({}, 409);
    overrides[`GET ${publicPath}`] = () =>
      reply({ id: kind === "supplier" ? sid : fid, version: 14 });
    await userEvent.click(
      within(area).getByRole("button", {
        name: kind === "supplier" ? "Save Supplier" : "Save Facility",
      }),
    );
    await within(area).findByRole("heading", {
      name:
        kind === "supplier"
          ? "The Supplier changed or conflicts with the current server state."
          : "The Facility changed or conflicts with the current server state.",
    });
    expect(within(area).getByLabelText(label)).toHaveValue(
      "Draft retained despite incomplete server view",
    );
    expect(
      within(area).getByRole("button", {
        name: kind === "supplier" ? "Save Supplier" : "Save Facility",
      }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(1);
  },
);
test("Supplier commands stay disabled until an Alias success has refetched the parent version", async () => {
  mount();
  await supplierReady();
  const area = await aliasForm();
  fill("Alias", "Pending parent refresh", area);
  evidence(area);
  const held = deferred<Response>();
  overrides[`POST /api/v1/admin/suppliers/${sid}/aliases`] = () => {
    supplier.version = 4;
    overrides[`GET /api/v1/suppliers/${sid}`] = () => held.promise;
    return reply(id(90));
  };
  await userEvent.click(
    within(area).getByRole("button", { name: "Append Alias" }),
  );
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(screen.getByRole("button", { name: "Edit Supplier" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Manual verification" }),
  ).toBeDisabled();
  await act(async () => held.resolve(reply(supplier)));
  await within(area).findByText(
    "Alias appended. Supplier parent version and alias history refetched.",
  );
  expect(
    screen.getByRole("button", { name: "Manual verification" }),
  ).toBeEnabled();
});
test("an empty public Capability summary never overrides an existing protected assignment", async () => {
  overrides[`GET /api/v1/facilities/${fid}/capabilities`] = () => reply([]);
  mount(`/admin/facilities/${fid}`);
  await facilityReady();
  await screen.findByText(
    "No capability assignments are shown in the public summary.",
  );
  const area = await assignmentForm();
  expect(
    within(area).getByRole("heading", { name: "Edit Capability assignment" }),
  ).toBeInTheDocument();
  expect(
    within(area).getByLabelText("Protected Capability notes (optional)"),
  ).toHaveValue("Protected existing assignment notes");
});
test("Supplier create uncertainty preserves an ARCHIVED draft without inventing a lookup or retry", async () => {
  overrides["POST /api/v1/admin/suppliers"] = () => {
    throw new TypeError("network uncertain");
  };
  mount("/admin/suppliers");
  await userEvent.click(
    await screen.findByRole("button", { name: "New Supplier" }),
  );
  const area = screen.getByRole("region", { name: "Create Supplier form" });
  fill("Display name", "Archived creation draft", area);
  await userEvent.selectOptions(
    within(area).getByLabelText("Country"),
    country,
  );
  await userEvent.selectOptions(
    within(area).getByLabelText("Supplier lifecycle"),
    "ARCHIVED",
  );
  evidence(area);
  await userEvent.click(
    within(area).getByRole("button", { name: "Create Supplier" }),
  );
  await within(area).findByRole("heading", {
    name: "Supplier creation outcome unknown",
  });
  expect(within(area).getByLabelText("Display name")).toHaveValue(
    "Archived creation draft",
  );
  expect(within(area).getByLabelText("Supplier lifecycle")).toHaveValue(
    "ARCHIVED",
  );
  expect(writes()).toHaveLength(1);
  expect(
    within(area).getByRole("link", { name: "Open Sources & Evidence" }),
  ).toHaveAttribute("target", "_blank");
  expect(Object.entries(localStorage)).toEqual([]);
  expect(Object.entries(sessionStorage)).toEqual([]);
});
test.each(["duplicate", "stale"])(
  "Alias %s 409 preserves draft and never assumes a specific conflict code",
  async (kind) => {
    mount();
    await supplierReady();
    const area = await aliasForm();
    fill("Alias", "Unchanged original Alias", area);
    evidence(area);
    if (kind === "stale") supplier.version = 11;
    else
      overrides[`POST /api/v1/admin/suppliers/${sid}/aliases`] = () =>
        reply({}, 409);
    await userEvent.click(
      within(area).getByRole("button", { name: "Append Alias" }),
    );
    await within(area).findByRole("heading", {
      name: "The Supplier changed or conflicts with the current server state.",
    });
    expect(within(area).getByLabelText("Alias")).toHaveValue(
      "Unchanged original Alias",
    );
    expect(writes()).toHaveLength(1);
    expect(
      within(area).getByRole("button", {
        name: "Use refreshed Supplier version, keep command draft",
      }),
    ).toBeInTheDocument();
  },
);
test("Verification uncertainty compares matching history and does not repeat the command", async () => {
  mount();
  await supplierReady();
  const area = await verificationForm();
  fill("Verification reason", "Explicit evidence review", area);
  evidence(area);
  overrides[`POST /api/v1/admin/suppliers/${sid}/verification-events`] = (
    c,
  ) => {
    supplier = {
      ...supplier,
      verificationStatus: c.body.status as Supplier["verificationStatus"],
      version: 4,
    };
    events.push({
      newStatus: c.body.status,
      reason: c.body.reason,
      observationId: c.body.observationId,
    });
    throw new TypeError("network uncertain");
  };
  await userEvent.click(
    within(area).getByRole("button", { name: "Change verification" }),
  );
  await within(area).findByRole("heading", {
    name: "Verification command outcome unknown",
  });
  await within(area).findByText(
    "A visible matching verification event was returned. Compare it before another explicit command.",
  );
  expect(within(area).getByLabelText("Verification reason")).toHaveValue(
    "Explicit evidence review",
  );
  expect(writes()).toHaveLength(1);
});
