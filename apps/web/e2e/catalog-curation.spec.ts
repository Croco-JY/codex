import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  curationAdmin,
  curationBuyer,
  curationOwner,
  curationId,
  provisionCuration,
} from "./curation-fixture";
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase1c5c-review/${mode}/`, import.meta.url),
);
const oid = curationId(102),
  supplier = curationId(1),
  api = "http://127.0.0.1:8080",
  hdr = { "X-Dev-Subject": curationAdmin };
test.beforeAll(async ({ request }) => {
  await provisionCuration(request);
  for (const status of ["DRAFT", "ACTIVE", "ARCHIVED"]) {
    const r = await request.post(`${api}/api/v1/admin/materials`, {
      headers: hdr,
      data: {
        catalogSupplierId: supplier,
        materialType: "BUTTON",
        displayName: `5C ${status} curation prerequisite ${mode} ${Date.now()}`,
        compositionCompleteness: "UNKNOWN",
        composition: [],
        status,
        observationId: oid,
        version: 0,
      },
    });
    expect(r.ok()).toBe(true);
  }
});
async function login(page: Page, path: string, actor = curationAdmin) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
const area = (page: Page, heading: string) =>
  page.getByRole("heading", { name: heading, exact: true }).locator("..");
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
async function evidence(a: Locator) {
  await a.getByLabel("Observation UUID", { exact: true }).fill(oid);
}
async function cite(page: Page, heading: string, field: string) {
  const a = area(page, heading);
  await a.getByLabel("Fact field").selectOption(field);
  await evidence(a);
  await a
    .getByRole("button", { name: "Append fact citation", exact: true })
    .click();
  await expect(
    a.getByText("Fact citation appended.", { exact: true }),
  ).toBeVisible();
}
test("5C routes deny buyer and ORG_OWNER without protected requests", async ({
  page,
}) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/admin/"))
      seen.push(r.url());
  });
  for (const actor of [curationBuyer, curationOwner])
    for (const path of [
      "/admin/materials",
      `/admin/materials/${curationId(700)}`,
      "/admin/listings",
      `/admin/listings/${curationId(701)}`,
    ]) {
      await login(page, path, actor);
      await expect(
        page.getByRole("heading", { name: "Access denied" }),
      ).toBeVisible();
    }
  expect(seen).toEqual([]);
  await shot(page, "27-access-denied", undefined, true);
});
test("real evidence Material Composition spec Variant citations and Listing read-after-write", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const name = `Catalog curation ${mode} ${Date.now()}`,
    requests: { path: string; method: string }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/v1/"))
      requests.push({ path: u.pathname, method: r.method() });
  });
  await login(page, "/admin");
  await expect(
    page.getByRole("heading", { name: "Curation workspace", exact: true }),
  ).toBeVisible();
  await shot(page, "01-admin");
  await page
    .getByRole("link", { name: "Open Sources & Evidence", exact: true })
    .click();
  await page.getByLabel("Known SourceRecord UUID").fill(curationId(101));
  await page
    .getByRole("button", { name: "Open Record history", exact: true })
    .click();
  await expect(
    page.getByText(`Observation reference: ${oid}`, { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Curation", exact: true }).click();
  await page
    .getByRole("link", { name: "Open Material curation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Material directory" }),
  ).toBeVisible();
  for (const status of ["DRAFT", "ACTIVE", "ARCHIVED"]) {
    await page.getByLabel("Discovery status").selectOption(status);
    await expect(page.getByLabel("Discovery status")).toHaveValue(status);
    const appliedRequest =
      status === "DRAFT"
        ? undefined
        : page.waitForRequest((r) => {
            const url = new URL(r.url());
            return (
              r.method() === "GET" &&
              url.pathname === "/api/v1/materials" &&
              url.searchParams.get("status") === status
            );
          });
    // Observe request and URL together so a failed assertion cannot leave an
    // unhandled request waiter. The initial DRAFT scope may already be cached.
    await Promise.all([
      appliedRequest,
      (async () => {
        await page
          .getByRole("button", { name: "Apply Material filters" })
          .click();
        await expect(page).toHaveURL(
          (url) => url.searchParams.get("status") === status,
        );
      })(),
    ]);
    await expect(page.getByLabel("Discovery status")).toHaveValue(status);
    await expect(
      page.getByText(new RegExp(`materials loaded · ${status}`)),
    ).toBeVisible();
    await shot(
      page,
      `0${status === "DRAFT" ? 2 : status === "ACTIVE" ? 3 : 4}-directory-${status}`,
    );
  }
  await page.getByRole("button", { name: "New Material", exact: true }).click();
  let a = area(page, "Create Material");
  await a
    .getByLabel("Search catalog supplier by name")
    .fill("Curation prerequisite");
  await a
    .getByRole("button", { name: "Find catalog supplier", exact: true })
    .click();
  await a
    .getByRole("button", {
      name: "Curation prerequisite Supplier",
      exact: false,
    })
    .click();
  await a.getByLabel("Material name", { exact: true }).fill(name);
  await evidence(a);
  await shot(page, "05-material-create", a);
  await shot(page, "21-material-form", a, true);
  await shot(
    page,
    "07-composition-unknown",
    a.getByRole("group", { name: "Composition parts" }),
  );
  await a.getByRole("button", { name: "Create Material", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/materials\/[0-9a-f-]+$/);
  const mid = page.url().split("/").at(-1)!;
  await page
    .getByRole("button", { name: "Edit Material profile", exact: true })
    .click();
  a = area(page, "Edit Material profile");
  await a
    .getByLabel("Material description")
    .fill(
      "Long textile description with exact canonical identity, independent seller and safely wrapped catalog references.",
    );
  await evidence(a);
  await shot(page, "06-profile-edit", a);
  await a.getByRole("button", { name: "Save Material profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Material profile" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Replace Composition", exact: true })
    .click();
  a = area(page, "Replace Composition");
  await a.getByLabel("Composition completeness").selectOption("PARTIAL");
  await a.getByRole("button", { name: "Add Fiber part" }).click();
  await a
    .getByLabel("Fiber", { exact: true })
    .selectOption({ label: "Wool · WOOL" });
  await a.getByLabel("Percentage", { exact: true }).fill("33.3333");
  await a.getByRole("button", { name: "Add Fiber part" }).click();
  await a
    .getByLabel("Fiber", { exact: true })
    .nth(1)
    .selectOption({ label: "Cotton · COTTON" });
  await a.getByLabel("Percentage", { exact: true }).nth(1).fill("66.6667");
  await evidence(a);
  await shot(page, "08-composition-partial", a);
  await shot(page, "22-composition-mobile", a, true);
  await a
    .getByRole("button", { name: "Save Composition", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Replace Composition" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit Material profile", exact: true })
    .click();
  a = area(page, "Edit Material profile");
  await a.getByLabel("Material status").selectOption("ACTIVE");
  await evidence(a);
  const before = await (
    await request.get(`${api}/api/v1/materials/${mid}`, { headers: hdr })
  ).json();
  await a.getByRole("button", { name: "Save Material profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Material profile" }),
  ).toHaveCount(0);
  const after = await (
    await request.get(`${api}/api/v1/materials/${mid}`, { headers: hdr })
  ).json();
  expect(after.version).toBe(before.version + 1);
  expect(after.composition).toEqual(before.composition);
  expect(after.compositionCompleteness).toBe("PARTIAL");
  a = area(page, "Create Fabric specification");
  await a.getByLabel("Construction", { exact: true }).selectOption("WOVEN");
  await a.getByLabel("Weave type").fill("Twill");
  await a.getByLabel("GSM", { exact: true }).fill("123.4567");
  await a.getByLabel("Warp stretch (%)").fill("0");
  await a.getByLabel("Warp shrinkage (%)").fill("-1.2345");
  await evidence(a);
  await shot(page, "10-fabric-create", a);
  await shot(page, "23-spec-mobile", a, true);
  await a.getByRole("button", { name: "Save Fabric specification" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Fabric specification" }),
  ).toBeVisible();
  a = area(page, "Edit Fabric specification");
  await a.getByLabel("Finish", { exact: true }).fill("Soft brushed finish");
  await evidence(a);
  await a.getByRole("button", { name: "Save Fabric specification" }).click();
  await expect(
    a.getByText("Specification saved. Server version: 1."),
  ).toBeVisible();
  await shot(page, "11-fabric-edit", a);
  await cite(page, "Material fact citations", "DESCRIPTION");
  await shot(
    page,
    "16-material-citations",
    area(page, "Material fact citations"),
  );
  await page
    .getByRole("button", { name: "Create Variant", exact: true })
    .click();
  a = area(page, "Create Variant");
  await a
    .getByLabel("Variant name", { exact: true })
    .fill("Indigo long-name Variant with independent color and batch");
  await a.getByLabel("Catalog Variant SKU").fill("INDIGO-EXACT-001");
  await evidence(a);
  await shot(page, "14-variant-create", a);
  await shot(page, "24-variant-mobile", a, true);
  await a.getByRole("button", { name: "Save Variant" }).click();
  await page.getByRole("button", { name: /Open Variant · Indigo/ }).click();
  a = area(page, "Edit Variant");
  await a.getByLabel("Color name").fill("Deep indigo");
  await evidence(a);
  await a.getByRole("button", { name: "Save Variant" }).click();
  await expect(a.getByText("Variant saved. Server version: 1.")).toBeVisible();
  await shot(page, "15-variant-edit", a);
  await cite(page, "Variant fact citations", "COLOR");
  await shot(
    page,
    "17-variant-citations",
    area(page, "Variant fact citations"),
  );
  await page.getByRole("link", { name: "Add Listing", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Listing context workspace" }),
  ).toBeVisible();
  await shot(page, "18-listing-context");
  a = area(page, "Create Seller Listing");
  await a.getByLabel("Search seller by name").fill("Curation prerequisite");
  await a.getByRole("button", { name: "Find seller", exact: true }).click();
  await a
    .getByRole("button", {
      name: "Curation prerequisite Supplier",
      exact: false,
    })
    .click();
  await a.getByLabel("Seller article number").fill(`SELLER-${Date.now()}`);
  await a.getByLabel("Listing MOQ").fill("0");
  await a.getByLabel("Listing MCQ").fill("999999999999999.9999");
  await a.getByLabel("Listing quantity unit").selectOption("METER");
  await a.getByLabel("Standard lead time (days)").fill("0");
  await evidence(a);
  await shot(page, "19-listing-create", a);
  await shot(page, "25-listing-mobile", a, true);
  await a.getByRole("button", { name: "Save Listing" }).click();
  await expect(page).toHaveURL(/\/admin\/listings\/[0-9a-f-]+$/);
  const lid = page.url().split("/").at(-1)!;
  a = area(page, "Edit Seller Listing");
  await a.getByLabel("Listing status").selectOption("ARCHIVED");
  await evidence(a);
  await a.getByRole("button", { name: "Save Listing" }).click();
  await expect(a.getByText("Listing saved. Server version: 1.")).toBeVisible();
  await a.getByLabel("Listing status").selectOption("ACTIVE");
  await evidence(a);
  await a.getByRole("button", { name: "Save Listing" }).click();
  await expect(a.getByText("Listing saved. Server version: 2.")).toBeVisible();
  await cite(page, "Listing fact citations", "MOQ");
  await shot(page, "20-listing-edit-citations", a);
  const publicListing = await (
    await request.get(`${api}/api/v1/material-listings/${lid}`, {
      headers: { "X-Dev-Subject": curationBuyer },
    })
  ).json();
  expect(publicListing.minimumOrderQuantity).toBe("0.0000");
  expect(publicListing.minimumColorQuantity).toBe("999999999999999.9999");
  expect(publicListing.standardLeadTimeDays).toBe(0);
  expect(publicListing.materialId).toBe(mid);
  expect(publicListing.sellerSupplierId).toBe(supplier);
  expect(
    requests.some(
      (r) =>
        /external-records|identities|material-prices|inventory-snapshots/.test(
          r.path,
        ) && r.method !== "GET",
    ),
  ).toBe(false);
  if (process.env.SOURCE_OS_VISUAL_REVIEW)
    writeFileSync(root + "requests.json", JSON.stringify(requests, null, 2));
});
test("real Fabric first-writer 412 preserves draft, server state and explicit switch", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const create = await request.post(`${api}/api/v1/admin/materials`, {
    headers: hdr,
    data: {
      catalogSupplierId: supplier,
      materialType: "FABRIC",
      displayName: `Race fabric ${mode} ${Date.now()}`,
      compositionCompleteness: "UNKNOWN",
      composition: [],
      status: "DRAFT",
      observationId: oid,
      version: 0,
    },
  });
  expect(create.ok()).toBe(true);
  const parent = await create.json();
  await login(page, `/admin/materials/${parent.id}`);
  let a = area(page, "Create Fabric specification");
  await expect(a).toBeVisible();
  await a.getByLabel("Finish", { exact: true }).fill("Losing retained finish");
  await evidence(a);
  const winner = await request.put(
    `${api}/api/v1/admin/materials/${parent.id}/fabric-spec`,
    {
      headers: { ...hdr, "If-None-Match": "*" },
      data: { finish: "Winning server finish", observationId: oid, version: 0 },
    },
  );
  expect(winner.status()).toBe(200);
  expect((await winner.json()).version).toBe(0);
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT") writes++;
  });
  const response = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.status() === 412,
  );
  await a.getByRole("button", { name: "Save Fabric specification" }).click();
  const failed = await response;
  await expect(
    page.getByRole("button", { name: "Switch to edit mode" }),
  ).toBeVisible();
  await expect(a.getByLabel("Finish", { exact: true })).toHaveValue(
    "Losing retained finish",
  );
  await expect(
    page.getByText("Winning server finish", { exact: true }),
  ).toBeVisible();
  const requestId = failed.headers()["x-request-id"];
  expect(requestId).toBeTruthy();
  await expect(page.getByText(new RegExp(requestId))).toBeVisible();
  expect(writes).toBe(1);
  await shot(
    page,
    "12-fabric-412",
    page
      .getByRole("heading", { name: "Create-only precondition failed (412)" })
      .locator(".."),
  );
  await shot(
    page,
    "26-conflict-mobile",
    page
      .getByRole("heading", { name: "Create-only precondition failed (412)" })
      .locator(".."),
    true,
  );
  await page.getByRole("button", { name: "Switch to edit mode" }).click();
  expect(writes).toBe(1);
  expect(
    (
      await (
        await request.get(`${api}/api/v1/materials/${parent.id}/fabric-spec`, {
          headers: hdr,
        })
      ).json()
    ).version,
  ).toBe(0);
});
test("Leather typed create/update and real Material conflict preserve drafts", async ({
  page,
  request,
}) => {
  const r = await request.post(`${api}/api/v1/admin/materials`, {
    headers: hdr,
    data: {
      catalogSupplierId: supplier,
      materialType: "LEATHER",
      displayName: `Leather curation ${mode} ${Date.now()}`,
      compositionCompleteness: "UNKNOWN",
      composition: [],
      status: "DRAFT",
      observationId: oid,
      version: 0,
    },
  });
  expect(r.ok()).toBe(true);
  const v = await r.json();
  await login(page, `/admin/materials/${v.id}`);
  let a = area(page, "Create Leather specification");
  await a.getByLabel("Hide type").selectOption("BOVINE");
  await a.getByLabel("Tanning method").selectOption("VEGETABLE");
  await a.getByLabel("Minimum thickness (mm)").fill("1.2345");
  await a.getByLabel("Maximum thickness (mm)").fill("1.2346");
  await a.getByLabel("Average hide area (m²)").fill("5.0001");
  await evidence(a);
  await a.getByRole("button", { name: "Save Leather specification" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Leather specification" }),
  ).toBeVisible();
  a = area(page, "Edit Leather specification");
  await evidence(a);
  await a.getByRole("button", { name: "Save Leather specification" }).click();
  await expect(
    a.getByText("Specification saved. Server version: 1."),
  ).toBeVisible();
  await shot(page, "13-leather-edit", a);
  await page
    .getByRole("button", { name: "Edit Material profile", exact: true })
    .click();
  a = area(page, "Edit Material profile");
  await a
    .getByLabel("Material name", { exact: true })
    .fill("Preserved operator Material draft");
  await evidence(a);
  const competing = await request.put(`${api}/api/v1/admin/materials/${v.id}`, {
    headers: hdr,
    data: {
      catalogSupplierId: v.catalogSupplierId,
      materialType: v.materialType,
      compositionCompleteness: v.compositionCompleteness,
      composition: v.composition,
      version: v.version,
      status: v.status,
      displayName: "Competing server Material",
      observationId: oid,
    },
  });
  expect(competing.ok()).toBe(true);
  await a.getByRole("button", { name: "Save Material profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Current server Material" }),
  ).toBeVisible();
  await expect(a.getByLabel("Material name", { exact: true })).toHaveValue(
    "Preserved operator Material draft",
  );
  await shot(page, "09-parent-conflict", a);
});
