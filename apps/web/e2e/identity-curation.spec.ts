import {
  provisionIdentity,
  revokeIdentity,
  identityRevocable,
  identityId,
} from "./identity-curation-fixture";
import {
  test,
  expect,
  type Page,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  curationAdmin,
  curationBuyer,
  curationOwner,
  curationId,
  countryJP,
} from "./curation-fixture";
import {
  provisionCommercialCuration,
  commercialCurationId,
  commercialListing,
  commercialRevocable,
  revokeCommercialAdmin,
} from "./commercial-curation-fixture";
const api = "http://127.0.0.1:8080",
  headers = { "X-Dev-Subject": curationAdmin };
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase1c5e-review/${mode}/`, import.meta.url),
);
const types = [
  "supplier",
  "facility",
  "material",
  "variant",
  "listing",
] as const;
type Kind = (typeof types)[number];
const names = {
  supplier: "Supplier",
  facility: "Facility",
  material: "Material",
  variant: "Variant",
  listing: "Seller Listing",
};
const kinds = {
  supplier: "SUPPLIER",
  facility: "FACILITY",
  material: "MATERIAL",
  variant: "MATERIAL_VARIANT",
  listing: "MATERIAL_LISTING",
};
const paths = {
  supplier: "suppliers",
  facility: "facilities",
  material: "materials",
  variant: "material-variants",
  listing: "material-listings",
};
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeAll(async ({ request }) => {
  await provisionCommercialCuration(request);
  provisionIdentity();
});
async function login(page: Page, path: string, actor = curationAdmin) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}
function area(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .locator("..");
}
async function shot(
  page: Page,
  name: string,
  target?: Locator,
  mobile = false,
) {
  if (!process.env.SOURCE_OS_VISUAL_REVIEW) return;
  mkdirSync(root, { recursive: true });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  if (target)
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "start", inline: "nearest" }),
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: root + name + ".png" });
  if (mobile) await page.setViewportSize({ width: 1440, height: 1000 });
}
async function post(request: APIRequestContext, path: string, data: unknown) {
  const r = await request.post(api + path, { headers, data });
  expect(r.ok(), `${path} ${r.status()}`).toBe(true);
  return r.json();
}
async function evidence(request: APIRequestContext, type: Kind) {
  const record = await post(request, "/api/v1/admin/source-records", {
    dataSourceId: commercialCurationId(100),
    recordKind: kinds[type],
    externalRecordKey: `identity-${type}-${randomUUID()}`,
  });
  const obs = await post(request, "/api/v1/admin/source-observations", {
    sourceRecordId: record.id,
    observationKey: "first",
    observedAt: "2026-10-21T00:00:00.123456Z",
  });
  return { record: record.id as string, observation: obs.id as string };
}
async function strategy(a: Locator, r: string) {
  await a.getByLabel("Creation mode").selectOption("resolve");
  await a.getByLabel("Resolve SourceRecord UUID").fill(r);
  await a.getByLabel(/I acknowledge permanent/).check();
}
async function submitResolve(page: Page, a: Locator, type: Kind) {
  const url = `/api/v1/admin/${type === "variant" ? "material-variant" : type === "listing" ? "material-listing" : type}-identities`;
  const done = page.waitForResponse(
    (r) => new URL(r.url()).pathname === url && r.request().method() === "POST",
  );
  await a
    .getByRole("button", { name: "Resolve external identity", exact: true })
    .click();
  const r = await done;
  expect(r.status()).toBe(200);
  const v = await r.json();
  await expect(
    a.getByRole("heading", {
      name: `Identity resolved to canonical ${names[type]}`,
    }),
  ).toBeVisible();
  return v;
}
async function bind(
  page: Page,
  request: APIRequestContext,
  type: Kind,
  id: string,
  extra?: { record: string },
) {
  const e = extra ?? (await evidence(request, type)),
    a = page.getByRole("region", {
      name: `${names[type]} permanent identity binding`,
      exact: true,
    });
  await expect(a).toBeVisible();
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(e.record);
  await a.getByLabel(/I confirm this permanent/).check();
  await shot(page, `${type}-binding`, a);
  if (type === "supplier") {
    await shot(page, "21-binding-mobile", a.locator("form"), true);
    await shot(
      page,
      "24-confirmation-mobile",
      a.getByLabel(/I confirm this permanent/).locator(".."),
      true,
    );
  }
  const done = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/v1/admin/${paths[type]}/${id}/external-records` &&
      r.request().method() === "POST",
  );
  await a
    .getByRole("button", { name: "Permanently bind external identity" })
    .click();
  expect((await done).status()).toBe(200);
  await expect(
    a.getByText(/No complete binding-list read exists/),
  ).toBeVisible();
  return e;
}
test("all five real typed Resolve and permanent bindings form a public read-after-write sourcing chain", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  const events: { path: string; method: string }[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/v1/")) events.push({ path, method: r.method() });
  });
  // First identity's SourceRecord + Observation are registered through the real Sources workflow.
  await login(page, "/admin/sources");
  const stamp = Date.now(),
    sourceName = `Identity 5E operator provenance ${stamp}`;
  await page.getByRole("button", { name: "New Source", exact: true }).click();
  await page
    .getByLabel("Source code", { exact: true })
    .fill(`000-000-000-000-5e-${stamp}`);
  await page.getByLabel("Source name", { exact: true }).fill(sourceName);
  let response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/sources" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create Source", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.getByText(/sources loaded/)).toBeVisible();
  while (
    (await page
      .getByRole("button", {
        name: `Select Source ${sourceName} · 000-000-000-000-5e-${stamp}`,
        exact: true,
      })
      .count()) === 0
  ) {
    const more = page.getByRole("button", {
      name: "Load more sources",
      exact: true,
    });
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.getByText(/sources loaded/)).not.toContainText(
      "refreshing",
    );
  }
  await page
    .getByRole("button", {
      name: `Select Source ${sourceName} · 000-000-000-000-5e-${stamp}`,
      exact: true,
    })
    .click();
  await page
    .getByLabel("Record kind", { exact: true })
    .selectOption("SUPPLIER");
  await page
    .getByLabel("External record key", { exact: true })
    .fill(`Identity-supplier-${stamp}`);
  response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-records" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register / reuse record", exact: true })
    .click();
  const record = await (await response).json();
  await page
    .getByLabel("Observation key", { exact: true })
    .fill(`Identity-evidence-${stamp}`);
  await page
    .getByLabel("Observed at (UTC)", { exact: true })
    .fill("2026-10-21T12:00");
  response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-observations" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  const observation = await (await response).json();
  const sup = {
    record: record.id as string,
    observation: observation.id as string,
  };
  await go(page, "/admin/suppliers");
  await page.getByRole("button", { name: "New Supplier", exact: true }).click();
  let a = page.getByRole("region", {
    name: "Create Supplier form",
    exact: true,
  });
  await strategy(a, sup.record);
  await a
    .getByLabel("Display name", { exact: true })
    .fill(`Identity sourcing canonical textile Supplier ${Date.now()}`);
  await a.getByLabel("Country", { exact: true }).selectOption(countryJP);
  await a.getByLabel("Observation UUID").fill(sup.observation);
  await shot(page, "supplier-resolve", a);
  await shot(page, "22-resolve-mobile", a, true);
  const supplier = await submitResolve(page, a, "supplier");
  await shot(
    page,
    "supplier-result",
    a.getByRole("region", { name: "Identity resolution result" }),
  );
  await a
    .getByRole("link", {
      name: "Open resolved canonical Supplier",
      exact: true,
    })
    .click();
  const supBind = await bind(page, request, "supplier", supplier.id);
  await shot(
    page,
    "17-identity-vs-citations",
    page.getByRole("region", { name: "Supplier permanent identity binding" }),
  );
  // Same-target replay is a command, never a passive lookup.
  a = page.getByRole("region", { name: "Supplier permanent identity binding" });
  await a
    .getByRole("button", { name: "Abandon / reset binding intention" })
    .click();
  await bind(page, request, "supplier", supplier.id, supBind);
  await page.getByRole("link", { name: "Add Facility", exact: true }).click();
  a = page.getByRole("region", { name: "Create Facility form" });
  const fac = await evidence(request, "facility");
  await strategy(a, fac.record);
  await a
    .getByLabel("Facility name", { exact: true })
    .fill(
      "Identity production Facility with a long international manufacturing name",
    );
  await a.getByLabel("Country", { exact: true }).selectOption(countryJP);
  await a.getByLabel("Observation UUID").fill(fac.observation);
  const facility = await submitResolve(page, a, "facility");
  await a
    .getByRole("link", {
      name: "Open resolved canonical Facility",
      exact: true,
    })
    .click();
  await bind(page, request, "facility", facility.id);
  await go(page, `/admin/suppliers/${supplier.id}`);
  await page.getByRole("link", { name: "Add Material", exact: true }).click();
  await page.getByRole("button", { name: "New Material", exact: true }).click();
  a = area(page, "Create Material");
  const mat = await evidence(request, "material");
  await strategy(a, mat.record);
  await a
    .getByLabel("Material name", { exact: true })
    .fill("Identity canonical precision textile");
  await a.getByLabel("Material status").selectOption("ACTIVE");
  await a.getByLabel("Observation UUID").fill(mat.observation);
  await shot(page, "material-resolve", a);
  const material = await submitResolve(page, a, "material");
  await a
    .getByRole("link", {
      name: "Open resolved canonical Material",
      exact: true,
    })
    .click();
  await bind(page, request, "material", material.id);
  await page
    .getByRole("button", { name: "Create Variant", exact: true })
    .click();
  a = area(page, "Create Variant");
  const va = await evidence(request, "variant");
  await strategy(a, va.record);
  await a
    .getByLabel("Variant name", { exact: true })
    .fill("Identity midnight indigo Variant");
  await a.getByLabel("Observation UUID").fill(va.observation);
  const variant = await submitResolve(page, a, "variant");
  await a
    .getByRole("button", {
      name: "Abandon identity resolution intention and unlock draft",
    })
    .click();
  await a.getByRole("button", { name: "Close Variant", exact: true }).click();
  await page
    .getByRole("button", { name: /Open Variant · Identity midnight/ })
    .click();
  await bind(page, request, "variant", variant.id);
  await page.getByRole("link", { name: "Add Listing", exact: true }).click();
  a = area(page, "Create Seller Listing");
  const li = await evidence(request, "listing");
  await strategy(a, li.record);
  await a.getByLabel("Search seller by name").fill("Curation prerequisite");
  await a.getByRole("button", { name: "Find seller", exact: true }).click();
  await a
    .getByRole("button", { name: /Curation prerequisite Supplier/ })
    .click();
  await a.getByLabel("Seller article number").fill("Identity-source-Listing");
  await a.getByLabel("Observation UUID").fill(li.observation);
  const listing = await submitResolve(page, a, "listing");
  await a
    .getByRole("link", {
      name: "Open resolved canonical Seller Listing",
      exact: true,
    })
    .click();
  await bind(page, request, "listing", listing.id);
  // Existing 5D UI writes remain independent Price/Inventory facts, not identity bindings.
  a = page.getByRole("region", { name: "Manual Price creation" });
  await a
    .getByLabel("Provider Source", { exact: true })
    .selectOption(commercialCurationId(100));
  await a.getByLabel("Price amount", { exact: true }).fill("58.0001");
  await a.getByLabel("Commercial currency", { exact: true }).fill("USD");
  await a.getByLabel("Fact price unit", { exact: true }).selectOption("METER");
  await a
    .getByLabel("Price valid from (UTC)", { exact: true })
    .fill("2020-01-01T00:00:00.000001Z");
  await a
    .getByLabel("Price observed at (UTC)", { exact: true })
    .fill("2026-10-21T00:00:00.123456Z");
  await a
    .getByLabel("Price Observation UUID 1", { exact: true })
    .fill(li.observation);
  await a
    .getByRole("button", { name: "Create manual Price", exact: true })
    .click();
  await expect(a.getByText(/Price fact confirmed/)).toBeVisible();
  a = page.getByRole("region", { name: "Manual Inventory observation" });
  await a.getByLabel("Manual Inventory quantity", { exact: true }).fill("0");
  await a
    .getByLabel("Observation quantity unit", { exact: true })
    .selectOption("METER");
  await a
    .getByLabel("Inventory observed at (UTC)", { exact: true })
    .fill("2026-10-21T00:00:00.123456Z");
  await a
    .getByRole("button", { name: "Record manual observation", exact: true })
    .click();
  await expect(a.getByText(/Manual Snapshot confirmed/)).toBeVisible();
  const buyer = { "X-Dev-Subject": curationBuyer };
  const publicFacility = await request.get(
    `${api}/api/v1/facilities/${facility.id}`,
    { headers: buyer },
  );
  expect((await publicFacility.json()).supplierId).toBe(supplier.id);
  const publicListings = await request.get(
    `${api}/api/v1/materials/${material.id}/listings`,
    { headers: buyer },
  );
  expect(
    (await publicListings.json()).some(
      (v: { id: string }) => v.id === listing.id,
    ),
  ).toBe(true);
  expect(
    events.filter(
      (r) => r.method === "GET" && r.path.includes("external-records"),
    ),
  ).toEqual([]);
  if (process.env.SOURCE_OS_VISUAL_REVIEW) {
    mkdirSync(root, { recursive: true });
    writeFileSync(root + "requests.json", JSON.stringify(events, null, 2));
  }
});
async function createContext(
  page: Page,
  type: Kind,
  material: string,
  observation: string,
  record: string,
) {
  if (type === "supplier") {
    await go(page, "/admin/suppliers");
    await page
      .getByRole("button", { name: "New Supplier", exact: true })
      .click();
  }
  if (type === "facility") {
    await go(page, `/admin/suppliers/${curationId(1)}`);
    await page.getByRole("link", { name: "Add Facility", exact: true }).click();
  }
  if (type === "material") {
    await go(page, `/admin/suppliers/${curationId(1)}`);
    await page.getByRole("link", { name: "Add Material", exact: true }).click();
    await page
      .getByRole("button", { name: "New Material", exact: true })
      .click();
  }
  if (type === "variant") {
    await go(page, `/admin/materials/${material}`);
    await page
      .getByRole("button", { name: "Create Variant", exact: true })
      .click();
  }
  if (type === "listing") {
    await go(page, `/admin/materials/${material}`);
    await page.getByRole("link", { name: "Add Listing", exact: true }).click();
  }
  const a =
    type === "supplier"
      ? page.getByRole("region", { name: "Create Supplier form" })
      : type === "facility"
        ? page.getByRole("region", { name: "Create Facility form" })
        : area(
            page,
            type === "material"
              ? "Create Material"
              : type === "variant"
                ? "Create Variant"
                : "Create Seller Listing",
          );
  await strategy(a, record);
  if (type === "supplier") {
    await a
      .getByLabel("Display name", { exact: true })
      .fill("Different ignored Supplier draft");
    await a.getByLabel("Country", { exact: true }).selectOption(countryJP);
  }
  if (type === "facility") {
    await a
      .getByLabel("Facility name", { exact: true })
      .fill("Different ignored Facility draft");
    await a.getByLabel("Country", { exact: true }).selectOption(countryJP);
  }
  if (type === "material")
    await a
      .getByLabel("Material name", { exact: true })
      .fill("Different ignored Material draft");
  if (type === "variant")
    await a
      .getByLabel("Variant name", { exact: true })
      .fill("Different ignored Variant draft");
  if (type === "listing") {
    await a.getByLabel("Search seller by name").fill("Curation prerequisite");
    await a.getByRole("button", { name: "Find seller", exact: true }).click();
    await a
      .getByRole("button", { name: /Curation prerequisite Supplier/ })
      .click();
    await a
      .getByLabel("Seller article number")
      .fill("Different ignored Listing draft");
  }
  await a.getByLabel("Observation UUID").fill(observation);
  return a;
}
test("all five existing identities reuse authoritative state, including Facility/Variant/Listing parent divergence", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const source = await commercialListing(request),
    context = await commercialListing(request);
  const targetListing = await post(request, "/api/v1/admin/material-listings", {
    materialId: source.listing.materialId,
    sellerSupplierId: commercialCurationId(1),
    status: "ACTIVE",
    observationId: commercialCurationId(102),
    version: 0,
  });
  const targets = {
    supplier: curationId(1),
    facility: commercialCurationId(10),
    material: source.listing.materialId,
    variant: source.variant.id,
    listing: targetListing.id,
  };
  await login(page, "/admin");
  for (const type of types) {
    const ev = await evidence(request, type),
      target = targets[type];
    const bound = await request.post(
      `${api}/api/v1/admin/${paths[type]}/${target}/external-records`,
      { headers, data: { sourceRecordId: ev.record } },
    );
    expect(bound.status()).toBe(200);
    const before = await (
      await request.get(`${api}/api/v1/${paths[type]}/${target}`, { headers })
    ).json();
    const a = await createContext(
      page,
      type,
      context.listing.materialId,
      ev.observation,
      ev.record,
    );
    const returned = await submitResolve(page, a, type);
    expect(returned.id).toBe(target);
    await expect(
      a.getByText(/Existing canonical data was returned/),
    ).toBeVisible();
    expect(
      await (
        await request.get(`${api}/api/v1/${paths[type]}/${target}`, { headers })
      ).json(),
    ).toEqual(before);
    if (type === "facility") {
      expect(returned.supplierId).toBe(commercialCurationId(1));
      await expect(
        a.getByText(commercialCurationId(1), { exact: true }),
      ).toBeVisible();
    }
    if (type === "variant") {
      expect(returned.materialId).not.toBe(context.listing.materialId);
      await expect(
        a.getByRole("link", { name: "Open resolved canonical Variant" }),
      ).toHaveAttribute("href", `/admin/materials/${returned.materialId}`);
    }
    if (type === "listing") {
      expect(returned.materialId).not.toBe(context.listing.materialId);
      expect(returned.sellerSupplierId).toBe(commercialCurationId(1));
    }
    await shot(
      page,
      `${type}-reused-parent-result`,
      a.getByRole("region", { name: "Identity resolution result" }),
    );
    if (type === "facility")
      await shot(
        page,
        "23-returned-context-mobile",
        a.getByRole("region", { name: "Identity resolution result" }),
        true,
      );
    const link = a.getByRole("link", {
      name: `Open resolved canonical ${names[type]}`,
      exact: true,
    });
    await link.click();
    await expect(page).toHaveURL(
      type === "variant"
        ? new RegExp(`/admin/materials/${returned.materialId}$`)
        : new RegExp(
            `/admin/${type === "listing" ? "listings" : paths[type]}/${target}$`,
          ),
    );
  }
});
test("wrong kind, unrelated Observation, permanent-binding conflict and exact lost-response replay remain safe", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const ev = await evidence(request, "supplier"),
    material = await commercialListing(request);
  await login(page, `/admin/materials/${material.listing.materialId}`);
  let a = page.getByRole("region", {
    name: "Material permanent identity binding",
  });
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(ev.record);
  await a.getByLabel(/I confirm this permanent/).check();
  await a
    .getByRole("button", { name: "Permanently bind external identity" })
    .click();
  await expect(
    a.getByText(/SourceRecord is missing, has the wrong/),
  ).toBeVisible();
  await shot(page, "12-wrong-kind400", a);
  // Valid Supplier Record already belongs to one Supplier; binding to a different Supplier fails409.
  await request.post(
    `${api}/api/v1/admin/suppliers/${curationId(1)}/external-records`,
    { headers, data: { sourceRecordId: ev.record } },
  );
  await go(page, `/admin/suppliers/${commercialCurationId(1)}`);
  a = page.getByRole("region", { name: "Supplier permanent identity binding" });
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(ev.record);
  await a.getByLabel(/I confirm this permanent/).check();
  await a
    .getByRole("button", { name: "Permanently bind external identity" })
    .click();
  await expect(
    a.getByText(/already bound to another canonical target/),
  ).toBeVisible();
  await shot(page, "13-binding409", a);
  await shot(page, "25-conflict-mobile", a, true);
  // A real committed bind response is lost; only explicit same-target replay confirms it.
  await go(page, `/admin/suppliers/${curationId(1)}`);
  a = page.getByRole("region", { name: "Supplier permanent identity binding" });
  const lost = await evidence(request, "supplier"),
    path = `/api/v1/admin/suppliers/${curationId(1)}/external-records`;
  let attempts = 0;
  await page.route(`**${path}`, async (route) => {
    attempts++;
    if (attempts === 1) {
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(lost.record);
  await a.getByLabel(/I confirm this permanent/).check();
  await a
    .getByRole("button", { name: "Permanently bind external identity" })
    .click();
  await expect(a.getByText(/outcome is unknown because/)).toBeVisible();
  expect(attempts).toBe(1);
  await shot(page, "15-binding-status0", a);
  await shot(
    page,
    "26-status0-mobile",
    a.getByText(/outcome is unknown because/).locator(".."),
    true,
  );
  await a
    .getByRole("button", { name: "Retry exact same permanent binding" })
    .click();
  await expect(
    a.getByText(/No complete binding-list read exists/),
  ).toBeVisible();
  expect(attempts).toBe(2);
  await page.unroute(`**${path}`);
  // Observation mismatch400 creates no canonical or binding; use real unrelated known evidence.
  const mismatch = await evidence(request, "supplier");
  a = await createContext(
    page,
    "supplier",
    material.listing.materialId,
    commercialCurationId(102),
    mismatch.record,
  );
  await a
    .getByRole("button", { name: "Resolve external identity", exact: true })
    .click();
  await expect(
    a.getByText(
      /SourceRecord kind or its supporting Observation does not match/,
    ),
  ).toBeVisible();
  // The same genuine identity may be retried only after abandoning that rejected intention.
  await a
    .getByRole("button", {
      name: "Abandon identity resolution intention and unlock draft",
    })
    .click();
  await a.getByLabel("Observation UUID").fill(mismatch.observation);
  await a.getByLabel(/I acknowledge permanent/).check();
  const resolvePath = "/api/v1/admin/supplier-identities";
  const bodies: unknown[] = [];
  await page.route(`**${resolvePath}`, async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await a
    .getByRole("button", { name: "Resolve external identity", exact: true })
    .click();
  await expect(
    a.getByText(/identity-resolution outcome is unknown/),
  ).toBeVisible();
  expect(bodies).toHaveLength(1);
  await expect(a.getByLabel("Display name", { exact: true })).toBeDisabled();
  await shot(
    page,
    "14-resolve-status0",
    a.getByRole("region", { name: "Identity resolution result" }),
  );
  await a
    .getByRole("button", { name: "Retry exact same identity resolution" })
    .click();
  await expect(
    a.getByRole("heading", { name: "Identity resolved to canonical Supplier" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
});
test("cross-slice authority, delayed identity completion, Actor switch and runtime revocation fail closed", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { listing } = await commercialListing(request);
  for (const actor of [curationBuyer, curationOwner]) {
    await login(page, "/admin/sources", actor);
    for (const path of [
      "/admin/sources",
      `/admin/suppliers/${curationId(1)}`,
      `/admin/materials/${listing.materialId}`,
      `/admin/listings/${listing.id}`,
    ]) {
      const protectedReads: string[] = [];
      const observe = (r: import("@playwright/test").Request) => {
        if (new URL(r.url()).pathname.startsWith("/api/v1/admin/"))
          protectedReads.push(r.url());
      };
      page.on("request", observe);
      await go(page, path);
      await expect(
        page.getByRole("heading", { name: "Access denied" }),
      ).toBeVisible();
      expect(protectedReads).toEqual([]);
      page.off("request", observe);
    }
  }
  await shot(
    page,
    "28-access-denied-mobile",
    page.getByRole("heading", { name: "Access denied" }),
    true,
  );
  await page.getByLabel("Local development identity").fill(curationAdmin);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  const a = page.getByRole("region", {
    name: "Seller Listing permanent identity binding",
  });
  const ev = await evidence(request, "listing");
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(ev.record);
  await a.getByLabel(/I confirm this permanent/).check();
  const inv = page.getByRole("region", {
    name: "Manual Inventory observation",
  });
  await inv
    .getByLabel("Manual Inventory quantity", { exact: true })
    .fill("999999999999999.9999");
  let captured!: () => void, release!: () => void, finished!: () => void;
  const ready = new Promise<void>((r) => (captured = r)),
    held = new Promise<void>((r) => (release = r)),
    done = new Promise<void>((r) => (finished = r));
  const endpoint = `/api/v1/admin/material-listings/${listing.id}/external-records`;
  await page.route(`**${endpoint}`, async (route) => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  await a
    .getByRole("button", { name: "Permanently bind external identity" })
    .click();
  await ready;
  await page.getByLabel("Local development identity").fill(identityRevocable);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(a.getByLabel("SourceRecord UUID", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    inv.getByLabel("Manual Inventory quantity", { exact: true }),
  ).toHaveValue("");
  release();
  await done;
  await expect(a.getByText(/No complete binding-list read exists/)).toHaveCount(
    0,
  );
  await shot(page, "20-actor-switched", a);
  await a.getByLabel("SourceRecord UUID", { exact: true }).fill(ev.record);
  revokeIdentity();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(a).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  await shot(page, "19-revoked-admin");
});
test("inactive Fiber round-trips only in its original Composition row and stays unavailable to new rows", async ({
  page,
  request,
}) => {
  const material = await post(request, "/api/v1/admin/materials", {
    catalogSupplierId: curationId(1),
    materialType: "FABRIC",
    displayName: "Historical Fiber preservation Material",
    compositionCompleteness: "PARTIAL",
    composition: [{ fiberTypeId: identityId(100), percentage: "100.0000" }],
    status: "ACTIVE",
    observationId: commercialCurationId(102),
    version: 0,
  });
  await login(page, `/admin/materials/${material.id}`);
  await page
    .getByRole("button", { name: "Replace Composition", exact: true })
    .click();
  const a = area(page, "Replace Composition");
  const first = a.getByLabel("Fiber", { exact: true }).first();
  await expect(first).toHaveValue(identityId(100));
  await expect(
    first.getByRole("option", {
      name: /Historical inactive textile Fiber.*inactive/,
    }),
  ).toHaveCount(1);
  await a.getByRole("button", { name: "Add Fiber part", exact: true }).click();
  await expect(
    a
      .getByLabel("Fiber", { exact: true })
      .nth(1)
      .getByRole("option", { name: /Historical inactive/ }),
  ).toHaveCount(0);
  await shot(page, "18-inactive-fiber", a);
  await shot(page, "27-inactive-fiber-mobile", a, true);
  await a.getByRole("button", { name: "Remove Fiber part 2" }).click();
  await a
    .getByLabel("Observation UUID", { exact: true })
    .fill(commercialCurationId(102));
  await a
    .getByRole("button", { name: "Save Composition", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Replace Composition", exact: true }),
  ).toHaveCount(0);
  const after = await (
    await request.get(`${api}/api/v1/materials/${material.id}`, { headers })
  ).json();
  expect(after.compositionCompleteness).toBe("PARTIAL");
  expect(after.composition[0].fiberTypeId).toBe(identityId(100));
  expect(after.composition[0].percentage).toBe("100.0000");
});

test("detail identity panels add zero reads or POST probes; representative fanout stays bounded", async ({
  page,
  request,
}) => {
  const { listing, variant } = await commercialListing(request);
  await login(page, "/admin");
  const results: { context: string; gets: string[]; posts: string[] }[] = [];
  for (const [context, path] of [
    ["Supplier", `/admin/suppliers/${curationId(1)}`],
    ["Facility", `/admin/facilities/${commercialCurationId(10)}`],
    ["Material", `/admin/materials/${listing.materialId}`],
    ["Listing", `/admin/listings/${listing.id}`],
  ]) {
    const events: { path: string; method: string }[] = [];
    const pending = new Set<import("@playwright/test").Request>();
    const finished = (r: import("@playwright/test").Request) =>
      pending.delete(r);
    const observe = (r: import("@playwright/test").Request) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/v1/")) {
        pending.add(r);
        events.push({ path: u.pathname, method: r.method() });
      }
    };
    page.on("request", observe);
    // Count dispatched reads through HTTP response headers; an intentionally
    // unread safe-error body must not make the browser network-idle a UX gate.
    const responded = (r: import("@playwright/test").Response) =>
      pending.delete(r.request());
    page.on("response", responded);
    page.on("requestfinished", finished);
    page.on("requestfailed", finished);
    await go(page, path);
    const panel = page.getByRole("region", {
      name: `${context === "Listing" ? "Seller Listing" : context} permanent identity binding`,
      exact: true,
    });
    await expect(
      panel.getByText(
        new RegExp(`Canonical target: ${path.split("/").at(-1)}`),
      ),
    ).toBeVisible();
    await expect
      .poll(() => [...pending].map((r) => new URL(r.url()).pathname))
      .toEqual([]);
    page.off("request", observe);
    page.off("response", responded);
    page.off("requestfinished", finished);
    page.off("requestfailed", finished);
    expect(events.filter((e) => e.method === "POST")).toEqual([]);
    expect(
      events.filter(
        (e) =>
          e.path.includes("external-record") ||
          e.path.includes("source-records") ||
          e.path.includes("source-observations"),
      ),
    ).toEqual([]);
    results.push({
      context,
      gets: events.filter((e) => e.method === "GET").map((e) => e.path),
      posts: [],
    });
  }
  await go(page, `/admin/materials/${listing.materialId}`);
  await page
    .getByRole("button", { name: /Open Variant · Archived midnight/ })
    .click();
  await expect(
    page.getByRole("region", { name: "Variant permanent identity binding" }),
  ).toBeVisible();
  if (process.env.SOURCE_OS_VISUAL_REVIEW) {
    mkdirSync(root, { recursive: true });
    writeFileSync(
      root + "request-fanout.json",
      JSON.stringify(results, null, 2),
    );
  }
});
