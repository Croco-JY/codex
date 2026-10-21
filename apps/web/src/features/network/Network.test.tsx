import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { endSession, setLocalSubject } from "../../api/session";
export const sid = "40000000-0000-4000-8000-000000000001",
  fid = "40000000-0000-4000-8000-000000000002",
  ref = "40000000-0000-4000-8000-000000000003";
let clients: QueryClient[],
  requests: URL[],
  overrides: Record<
    string,
    (url: URL, req: Request) => Response | Promise<Response>
  >;
const reply = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "network-reference",
    },
  });
beforeEach(() => {
  setLocalSubject("network-a");
  clients = [];
  requests = [];
  overrides = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const u = new URL(req.url);
      requests.push(u);
      if (overrides[u.pathname]) return overrides[u.pathname]!(u, req);
      if (u.pathname === "/api/identity")
        return reply({
          issuer: "local",
          subject: req.headers.get("X-Dev-Subject"),
        });
      if (u.pathname === "/api/identity/capabilities")
        return reply({ platformAdmin: false });
      if (u.pathname === "/api/v1/countries")
        return reply([
          {
            id: ref,
            alpha2: "JP",
            nameEn: "Japan",
            nameNative: "日本",
            active: true,
          },
          { id: fid, alpha2: "CN", nameEn: "China", active: true },
        ]);
      if (u.pathname === "/api/v1/regions")
        return reply([{ id: ref, nameEn: "Kyoto", active: true }]);
      if (u.pathname === "/api/v1/industrial-clusters")
        return reply([{ id: ref, nameEn: "Textile district", active: true }]);
      if (u.pathname === "/api/v1/capabilities")
        return reply([
          { id: ref, nameEn: "Weaving", category: "PROCESS", active: true },
        ]);
      if (u.pathname === "/api/v1/suppliers")
        return reply({
          items: [
            {
              id: sid,
              displayName: "Catalog mill A",
              country: "JP",
              verificationStatus: "AUDITED",
            },
          ],
          nextCursor: "opaque-token",
        });
      throw Error("Unexpected read " + u.pathname);
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  endSession();
  vi.unstubAllGlobals();
});
function Location() {
  const l = useLocation(),
    nav = useNavigate();
  return (
    <>
      <output aria-label="Route">
        {l.pathname}
        {l.search}
      </output>
      <button onClick={() => nav(-1)}>Browser back</button>
    </>
  );
}
function mount(route = "/suppliers") {
  const c = createQueryClient();
  clients.push(c);
  render(
    <QueryClientProvider client={c}>
      <MemoryRouter initialEntries={[route]}>
        <Location />
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return c;
}
const directoryReads = () =>
  requests.filter((u) => u.pathname === "/api/v1/suppliers");
test("Supplier Apply, alpha2 geography, typed roles, canonical URL, Clear and browser restore without card fanout", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole("link", { name: "Catalog mill A" });
  await user.type(screen.getByLabelText("Keyword"), "Kyoto");
  await user.selectOptions(screen.getByLabelText("Supplier country"), "JP");
  await user.selectOptions(screen.getByLabelText("Facility country"), "CN");
  await user.selectOptions(screen.getByLabelText("Supplier role"), "MILL");
  await user.selectOptions(
    screen.getByLabelText("Supplier verification"),
    "AUDITED",
  );
  for (const label of ["Region", "Industrial Cluster", "Capability"])
    await user.selectOptions(screen.getByLabelText(label), ref);
  expect(directoryReads()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(directoryReads()).toHaveLength(2));
  const q = directoryReads().at(-1)!.searchParams;
  expect(Object.fromEntries(q)).toEqual({
    q: "Kyoto",
    country: "JP",
    role: "MILL",
    verificationStatus: "AUDITED",
    facilityCountry: "CN",
    region: ref,
    cluster: ref,
    capability: ref,
    limit: "25",
  });
  expect(screen.getByLabelText("Route")).toHaveTextContent("country=JP");
  expect(
    requests.filter((u) => u.pathname.match(/\/suppliers\//)),
  ).toHaveLength(0);
  expect(screen.getByText("1 suppliers loaded")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Route")).toHaveTextContent(/^\/suppliers$/),
  );
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Keyword")).toHaveValue("Kyoto"),
  );
});
test("Supplier opaque cursor preserves filters and invalid cursor reload keeps scope", async () => {
  overrides["/api/v1/suppliers"] = (u) =>
    u.searchParams.has("cursor")
      ? reply({}, 400)
      : reply({
          items: [{ id: sid, displayName: "Catalog mill A" }],
          nextCursor: "opaque-token",
        });
  const user = userEvent.setup();
  mount("/suppliers?country=JP");
  await screen.findByRole("link", { name: "Catalog mill A" });
  await user.click(screen.getByRole("button", { name: "Load more suppliers" }));
  await screen.findByRole("button", { name: "Reload first results" });
  expect(directoryReads().at(-1)!.searchParams.get("cursor")).toBe(
    "opaque-token",
  );
  expect(directoryReads().at(-1)!.searchParams.get("country")).toBe("JP");
  await user.click(
    screen.getByRole("button", { name: "Reload first results" }),
  );
  await waitFor(() => expect(directoryReads()).toHaveLength(3));
  expect(directoryReads().at(-1)!.searchParams.has("cursor")).toBe(false);
  expect(screen.getByLabelText("Supplier country")).toHaveValue("JP");
});
test("unsupported private/cursor URL keys removed without sending them", async () => {
  mount("/suppliers?country=JP&token=secret&cursor=bad");
  await screen.findByRole("link", { name: "Catalog mill A" });
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    "/suppliers?country=JP",
  );
  expect(directoryReads()[0]!.searchParams.has("token")).toBe(false);
  expect(directoryReads()[0]!.searchParams.has("cursor")).toBe(false);
});
function supplierDetail(status = "ACTIVE") {
  overrides[`/api/v1/suppliers/${sid}`] = () =>
    reply({
      id: sid,
      displayName: "Catalog mill A",
      legalName: "Legal mill A",
      nativeName: "京都織物",
      englishName: "Kyoto mill",
      countryId: ref,
      roles: ["MILL", "MATERIAL_SUPPLIER"],
      verificationStatus: "AUDITED",
      status,
      websiteUrl: "https://example.com",
      description: "Recorded supplier",
    });
  overrides[`/api/v1/suppliers/${sid}/aliases`] = () =>
    reply([
      {
        id: ref,
        alias: "Kyoto textile alias",
        aliasType: "ROMANIZED",
        languageCode: "ja",
      },
    ]);
  overrides[`/api/v1/suppliers/${sid}/verification-events`] = () =>
    reply([
      {
        id: ref,
        previousStatus: "VERIFIED",
        newStatus: "AUDITED",
        occurredAt: "2026-10-20T00:00:00Z",
        reason: "Evidence reviewed",
        actorIssuer: "PRIVATE_ISSUER",
        actorSubject: "PRIVATE_SUBJECT",
      },
    ]);
  overrides[`/api/v1/suppliers/${sid}/facilities`] = () =>
    reply({
      items: [
        {
          id: fid,
          name: "Foreign facility",
          country: "CN",
          facilityType: "MILL",
        },
      ],
    });
  overrides[`/api/v1/suppliers/${sid}/catalog-materials`] = () =>
    reply({
      items: [
        {
          id: ref,
          displayName: "Catalog cloth",
          catalogSupplierId: sid,
          materialType: "FABRIC",
          status: "ACTIVE",
        },
      ],
    });
  overrides[`/api/v1/suppliers/${sid}/material-listings`] = () => reply([]);
}
test("Supplier identity, roles, aliases, foreign Facilities, Catalog relationships and history are distinct", async () => {
  supplierDetail();
  mount(`/suppliers/${sid}`);
  await screen.findByRole("heading", { name: "Catalog mill A" });
  await screen.findByText("Kyoto textile alias");
  await screen.findByText("Evidence reviewed");
  expect(screen.getByText("Material supplier")).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("region", { name: "Roles and verification" }),
    ).getByText("Mill", { exact: true }),
  ).toBeInTheDocument();
  expect(screen.getByText("Supplier verification:")).toHaveTextContent(
    "Audited",
  );
  expect(screen.getByText("Legal mill A")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Foreign facility" }),
  ).toHaveAttribute("href", `/facilities/${fid}`);
  expect(screen.getByRole("link", { name: "Catalog cloth" })).toHaveAttribute(
    "href",
    `/materials/${ref}`,
  );
  expect(
    screen.getByText("No seller Listings recorded for this Supplier."),
  ).toBeInTheDocument();
  expect(screen.queryByText("PRIVATE_ISSUER")).not.toBeInTheDocument();
  expect(screen.queryByText("PRIVATE_SUBJECT")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "https://example.com/" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  for (const suffix of ["facilities", "catalog-materials", "material-listings"])
    expect(
      requests
        .find((u) => u.pathname.endsWith("/" + suffix))
        ?.searchParams.get("limit"),
    ).toBe("25");
  expect(
    requests
      .find((u) => u.pathname.endsWith("/material-listings"))
      ?.searchParams.get("offset"),
  ).toBe("0");
});
test("Supplier child failure does not destroy identity and direct archived details work", async () => {
  supplierDetail("ARCHIVED");
  overrides[`/api/v1/suppliers/${sid}/aliases`] = () => reply({}, 403);
  mount(`/suppliers/${sid}`);
  await screen.findByRole("heading", { name: "Access denied" });
  expect(
    screen.getByRole("heading", { name: "Catalog mill A" }),
  ).toBeInTheDocument();
  expect(screen.getByText("ARCHIVED")).toBeInTheDocument();
  await screen.findByText("Evidence reviewed");
  expect(screen.getByText("network-reference")).toBeInTheDocument();
});
test("Catalog supplier A and Seller B never merge their relationships", async () => {
  supplierDetail();
  const b = "40000000-0000-4000-8000-000000000004";
  overrides[`/api/v1/suppliers/${b}`] = () =>
    reply({ id: b, displayName: "Seller B", roles: ["FACTORY"] });
  for (const suffix of ["aliases", "verification-events"])
    overrides[`/api/v1/suppliers/${b}/${suffix}`] = () => reply([]);
  for (const suffix of ["facilities", "catalog-materials"])
    overrides[`/api/v1/suppliers/${b}/${suffix}`] = () => reply({ items: [] });
  overrides[`/api/v1/suppliers/${b}/material-listings`] = () =>
    reply([
      {
        id: fid,
        materialId: ref,
        sellerSupplierId: b,
        sellerArticleNumber: "SELL-B",
        minimumOrderQuantity: "0",
        minimumColorQuantity: "999999999999999.9999",
        quantityUnit: "METER",
      },
    ]);
  mount(`/suppliers/${b}`);
  await screen.findByRole("link", { name: "Open seller Listing · SELL-B" });
  expect(
    screen.getByText("No catalog materials recorded for this Supplier."),
  ).toBeInTheDocument();
  expect(screen.getByText("999999999999999.9999")).toBeInTheDocument();
  expect(screen.getByText("0", { exact: true })).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Catalog cloth" }),
  ).not.toBeInTheDocument();
});
test("Supplier child cursor and offset pagination stay bounded", async () => {
  supplierDetail();
  overrides[`/api/v1/suppliers/${sid}/material-listings`] = (u) =>
    reply(
      u.searchParams.get("offset") === "0"
        ? Array.from({ length: 25 }, (_, i) => ({
            id: String(i),
            sellerArticleNumber: "Listing " + i,
          }))
        : [],
    );
  overrides[`/api/v1/suppliers/${sid}/facilities`] = (u) =>
    reply({
      items: [],
      nextCursor: u.searchParams.has("cursor") ? undefined : "child-opaque",
    });
  overrides[`/api/v1/suppliers/${sid}/catalog-materials`] = (u) =>
    reply({
      items: [],
      nextCursor: u.searchParams.has("cursor") ? undefined : "catalog-opaque",
    });
  const user = userEvent.setup();
  mount(`/suppliers/${sid}`);
  await screen.findByRole("button", { name: "Load more seller listings" });
  await user.click(
    screen.getByRole("button", { name: "Load more seller listings" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Load more facilities" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Load more catalog materials" }),
  );
  await waitFor(() =>
    expect(
      requests.some((u) => u.searchParams.get("cursor") === "catalog-opaque"),
    ).toBe(true),
  );
  expect(
    requests.some(
      (u) =>
        u.searchParams.get("offset") === "25" &&
        u.searchParams.get("limit") === "25",
    ),
  ).toBe(true);
  expect(
    requests.some((u) => u.searchParams.get("cursor") === "child-opaque"),
  ).toBe(true);
});
test("Facility filters use alpha2, reference UUIDs, supplier name selection; q is never offered or sent", async () => {
  overrides["/api/v1/facilities"] = () =>
    reply({
      items: [
        {
          id: fid,
          name: "Mill site",
          supplierId: sid,
          facilityType: "MILL",
          country: "CN",
          regionId: ref,
          industrialClusterId: ref,
        },
      ],
    });
  overrides[`/api/v1/suppliers/${sid}`] = () =>
    reply({ id: sid, displayName: "Catalog mill A" });
  const user = userEvent.setup();
  mount("/facilities?q=forbidden");
  await screen.findByRole("link", { name: "Mill site" });
  expect(screen.queryByLabelText("Keyword")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Country"), "CN");
  await user.selectOptions(screen.getByLabelText("Facility type"), "MILL");
  for (const label of ["Region", "Industrial Cluster", "Capability"])
    await user.selectOptions(screen.getByLabelText(label), ref);
  await user.type(screen.getByLabelText("Search supplier by name"), "Kyoto");
  await user.click(screen.getByRole("button", { name: "Find supplier" }));
  await user.click(
    await screen.findByRole("button", { name: "Catalog mill A · JP" }),
  );
  expect(
    requests.filter((u) => u.pathname === "/api/v1/facilities"),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(
      requests.filter((u) => u.pathname === "/api/v1/facilities"),
    ).toHaveLength(2),
  );
  const q = requests
    .filter((u) => u.pathname === "/api/v1/facilities")
    .at(-1)!.searchParams;
  expect(Object.fromEntries(q)).toEqual({
    country: "CN",
    region: ref,
    cluster: ref,
    type: "MILL",
    capability: ref,
    supplier: sid,
    limit: "25",
  });
  expect(screen.getByLabelText("Route")).not.toHaveTextContent("q=");
  expect(
    requests.filter((u) => u.pathname.match(/\/facilities\//)),
  ).toHaveLength(0);
  expect(
    requests.filter((u) => u.pathname === `/api/v1/suppliers/${sid}`),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: /^Clear$/ }));
  await waitFor(() => expect(screen.getByLabelText("Country")).toHaveValue(""));
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Facility type")).toHaveValue("MILL"),
  );
});
test("Facility cursor error preserves scope and recovers first page", async () => {
  overrides["/api/v1/facilities"] = (u) =>
    u.searchParams.has("cursor")
      ? reply({}, 400)
      : reply({ items: [], nextCursor: "facility-opaque" });
  const user = userEvent.setup();
  mount("/facilities?country=CN");
  await screen.findByText("No facilities match these filters.");
  await user.click(
    screen.getByRole("button", { name: "Load more facilities" }),
  );
  await screen.findByRole("button", { name: "Reload first results" });
  expect(requests.at(-1)?.searchParams.get("cursor")).toBe("facility-opaque");
  await user.click(
    screen.getByRole("button", { name: "Reload first results" }),
  );
  await waitFor(() =>
    expect(
      requests.filter((u) => u.pathname === "/api/v1/facilities"),
    ).toHaveLength(3),
  );
  expect(screen.getByLabelText("Country")).toHaveValue("CN");
});
function facilityDetail() {
  overrides[`/api/v1/facilities/${fid}`] = () =>
    reply({
      id: fid,
      name: "Foreign facility",
      supplierId: sid,
      facilityType: "MILL",
      countryId: fid,
      regionId: ref,
      industrialClusterId: ref,
      addressLine1: "Long street address",
      addressLine2: "Unit 4",
      postalCode: "10000",
      phone: "+86 1234",
      email: "site@example.com",
      latitude: "35.123456",
      longitude: "135.999999",
      status: "ARCHIVED",
    });
  overrides[`/api/v1/suppliers/${sid}`] = () =>
    reply({ displayName: "Catalog mill A", verificationStatus: "PROVEN" });
  overrides[`/api/v1/facilities/${fid}/capabilities`] = () =>
    reply([
      {
        capabilityId: ref,
        proficiencyLevel: "SPECIALIST",
        verificationStatus: "DOCUMENTED",
        minimumOrderQuantity: "0",
        maximumOrderQuantity: "999999999999999.9999",
        quantityUnit: "METER",
      },
    ]);
}
test("Facility identity, parent Supplier, geography, exact coordinates and capability quantities remain distinct", async () => {
  facilityDetail();
  mount(`/facilities/${fid}`);
  await screen.findByRole("heading", { name: "Foreign facility" });
  await screen.findByRole("heading", { name: "Weaving" });
  expect(screen.getByRole("link", { name: "Catalog mill A" })).toHaveAttribute(
    "href",
    `/suppliers/${sid}`,
  );
  for (const value of [
    "ARCHIVED",
    "Kyoto",
    "Textile district",
    "Long street address",
    "10000",
    "+86 1234",
    "site@example.com",
    "35.123456",
    "135.999999",
    "Specialist",
    "Documented",
    "0",
    "999999999999999.9999",
    "METER",
  ])
    expect(
      screen.getByText(value, { exact: value !== "Long street address" }),
    ).toBeInTheDocument();
  expect(screen.queryByText("Proven")).not.toBeInTheDocument();
});
test.each(["regions", "industrial-clusters"])(
  "known %s reference label failure differs from no reference",
  async (kind) => {
    facilityDetail();
    overrides["/api/v1/" + kind] = () => reply({}, 403);
    mount(`/facilities/${fid}`);
    const noun = kind === "regions" ? "Region" : "Industrial Cluster";
    await screen.findByText(`${noun} label unavailable · Reference: ${ref}`);
    expect(screen.queryByText(`${noun} not recorded`)).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "Weaving" });
  },
);
test("missing Facility optional geography and quantities remain unknown, empty capabilities honest", async () => {
  facilityDetail();
  overrides[`/api/v1/facilities/${fid}`] = () =>
    reply({ id: fid, name: "Basic site", facilityType: "OFFICE" });
  overrides[`/api/v1/facilities/${fid}/capabilities`] = () => reply([]);
  mount(`/facilities/${fid}`);
  await screen.findByRole("heading", { name: "Basic site" });
  expect(screen.getByText("Region not recorded")).toBeInTheDocument();
  expect(
    screen.getByText("Industrial Cluster not recorded"),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Unknown")).toHaveLength(2);
  await screen.findByText("No capabilities recorded for this Facility.");
});
test("Facility capability failure remains isolated", async () => {
  facilityDetail();
  overrides[`/api/v1/facilities/${fid}/capabilities`] = () => reply({}, 403);
  mount(`/facilities/${fid}`);
  await screen.findByRole("heading", { name: "Access denied" });
  expect(
    screen.getByRole("heading", { name: "Foreign facility" }),
  ).toBeInTheDocument();
  expect(screen.getByText("35.123456")).toBeInTheDocument();
});
test.each(["suppliers", "facilities"])(
  "%s 404 is a record failure",
  async (kind) => {
    overrides[`/api/v1/${kind}/${sid}`] = () => reply({}, 404);
    mount(`/${kind}/${sid}`);
    await screen.findByRole("heading", {
      name: kind === "suppliers" ? "Supplier not found" : "Facility not found",
    });
  },
);
test.each(["suppliers", "facilities"])(
  "%s actor switch cancels late response and clears old cache and drafts",
  async (kind) => {
    let release!: (r: Response) => void;
    const held = new Promise<Response>((r) => (release = r));
    overrides[`/api/v1/${kind}`] = (_u, req) =>
      req.headers.get("X-Dev-Subject") === "network-a"
        ? held
        : reply({
            items: [
              kind === "suppliers"
                ? { id: sid, displayName: "Actor B record" }
                : { id: fid, name: "Actor B record" },
            ],
          });
    const cache = mount("/" + kind);
    await screen.findByRole("status", { name: `Searching ${kind}` });
    await act(async () => setLocalSubject("network-b"));
    await screen.findByRole("link", { name: "Actor B record" });
    await act(async () => {
      release(
        reply({
          items: [
            kind === "suppliers"
              ? { id: sid, displayName: "Actor A stale" }
              : { id: fid, name: "Actor A stale" },
          ],
        }),
      );
      await held;
    });
    expect(screen.queryByText("Actor A stale")).not.toBeInTheDocument();
    expect(
      JSON.stringify(
        cache
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("Actor A stale");
  },
);
test("reference choices are bounded, cached and load further pages only explicitly", async () => {
  overrides["/api/v1/regions"] = (u) =>
    reply(
      u.searchParams.get("offset") === "0"
        ? Array.from({ length: 100 }, (_, i) => ({
            id: `region-${i}`,
            nameEn: `Region ${i}`,
            active: true,
          }))
        : [],
    );
  const user = userEvent.setup();
  mount();
  await screen.findByRole("button", { name: "Load more region choices" });
  expect(requests.filter((u) => u.pathname === "/api/v1/regions")).toHaveLength(
    1,
  );
  expect(
    requests
      .find((u) => u.pathname === "/api/v1/regions")
      ?.searchParams.toString(),
  ).toBe("limit=100&offset=0");
  await user.click(
    screen.getByRole("button", { name: "Load more region choices" }),
  );
  await waitFor(() =>
    expect(
      requests.filter((u) => u.pathname === "/api/v1/regions"),
    ).toHaveLength(2),
  );
  expect(
    requests
      .filter((u) => u.pathname === "/api/v1/regions")
      .at(-1)
      ?.searchParams.get("offset"),
  ).toBe("100");
  expect(
    requests.filter((u) => u.pathname === "/api/v1/countries"),
  ).toHaveLength(1);
});
test("Facility capability unknown quantities remain unknown rather than zero", async () => {
  facilityDetail();
  overrides[`/api/v1/facilities/${fid}/capabilities`] = () =>
    reply([
      {
        capabilityId: ref,
        proficiencyLevel: "SUPPORTED",
        verificationStatus: "UNVERIFIED",
      },
    ]);
  mount(`/facilities/${fid}`);
  const section = await screen.findByRole("region", {
    name: "Facility capabilities",
  });
  await within(section).findByText("Supported");
  expect(within(section).getAllByText("Unknown")).toHaveLength(3);
  expect(
    within(section).queryByText("0", { exact: true }),
  ).not.toBeInTheDocument();
});
test("narrow directory filters disclose on demand and collapse after Apply", async () => {
  vi.stubGlobal("innerWidth", 390);
  const user = userEvent.setup();
  mount();
  await screen.findByRole("link", { name: "Catalog mill A" });
  expect(screen.getByLabelText("Keyword")).not.toBeVisible();
  await user.click(screen.getByText("Search filters", { exact: true }));
  await user.type(screen.getByLabelText("Keyword"), "Kyoto");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Keyword")).not.toBeVisible(),
  );
  expect(screen.getByText("1 applied")).toBeInTheDocument();
});
