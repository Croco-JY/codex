import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  curationId,
  curationAdmin,
  curationBuyer,
  curationOwner,
  curationRevocable,
  evidenceSourceName,
  countryJP,
  capabilityName,
  raceCapabilityName,
  provisionCuration,
  revokeCurationAdmin,
} from "./curation-fixture";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const reviewRoot = fileURLToPath(
  new URL(`../../../.local/phase1c5b-review/${mode}/`, import.meta.url),
);
let raceFacilityId: string;
test.beforeAll(async ({ request }) => {
  ({ raceFacilityId } = await provisionCuration(request));
});
async function login(page: Page, actor: string, path: string) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function shot(
  page: Page,
  name: string,
  target?: Locator,
  mobile = false,
) {
  if (!process.env.SOURCE_OS_VISUAL_REVIEW) return;
  mkdirSync(reviewRoot, { recursive: true });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  if (target)
    await target.evaluate((node) =>
      node.scrollIntoView({ block: "start", inline: "nearest" }),
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: reviewRoot + name + ".png" });
  if (mobile) await page.setViewportSize({ width: 1440, height: 1000 });
}
const form = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
const evidence = async (area: Locator, id: string) =>
  area.getByLabel("Observation UUID", { exact: true }).fill(id);
const apiUrl = (path: string) => `http://127.0.0.1:8080${path}`;
test("buyers and ORG_OWNER-only Actors cannot mount any 5B route or query its data", async ({
  page,
}) => {
  const protectedRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/admin/"))
      protectedRequests.push(r.url());
  });
  for (const actor of [curationBuyer, curationOwner]) {
    for (const path of [
      "/admin/suppliers",
      `/admin/suppliers/${curationId(1)}`,
      "/admin/facilities",
      `/admin/facilities/${curationId(10)}`,
    ]) {
      await login(page, actor, path);
      await expect(
        page.getByRole("heading", { name: "Access denied" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Curation", exact: true }),
      ).toHaveCount(0);
    }
  }
  expect(protectedRequests).toEqual([]);
  await shot(
    page,
    "20-access-denied-mobile",
    page.getByRole("heading", { name: "Access denied" }),
    true,
  );
});
test("real evidence → Supplier/Alias/Verification/citations → Facility/Capability workflow is visible to buyer reads", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const requests: { path: string; method: string; query: string }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/v1/"))
      requests.push({ path: u.pathname, method: r.method(), query: u.search });
  });
  const suffix = `${mode}-${Date.now()}`,
    supplierName = `Curation textile Supplier ${suffix}`,
    updatedSupplier = `Updated curation textile Supplier ${suffix}`,
    facilityName = `Curation textile Facility ${suffix}`,
    updatedFacility = `Updated curation textile Facility ${suffix}`;
  await login(page, curationAdmin, "/admin");
  await expect(
    page.getByRole("heading", { name: "Curation workspace" }),
  ).toBeVisible();
  await shot(page, "01-admin-desktop");
  await page.getByRole("link", { name: "Open Sources & Evidence" }).click();
  await page
    .getByRole("button", {
      name: `Select Source ${evidenceSourceName} · 000-000-curation5b-evidence`,
      exact: true,
    })
    .click();
  await page
    .getByLabel("Record kind", { exact: true })
    .selectOption("SUPPLIER");
  await page
    .getByLabel("External record key", { exact: true })
    .fill(`Original-${suffix}`);
  const recordResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-records" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register / reuse record", exact: true })
    .click();
  expect((await recordResponse).status()).toBe(200);
  await page
    .getByLabel("Observation key", { exact: true })
    .fill(`Curation evidence-${suffix}`);
  await page
    .getByLabel("Observed at (UTC)", { exact: true })
    .fill("2026-10-21T12:00");
  const observationResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-observations" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  const observed = await (await observationResponse).json();
  expect(observed.id).toMatch(/^[a-f0-9-]{36}$/);
  const observationId: string = observed.id;
  await page.getByRole("link", { name: "Curation", exact: true }).click();
  await page.getByRole("link", { name: "Open Supplier curation" }).click();
  await expect(
    page.getByRole("heading", { name: "Active suppliers" }),
  ).toBeVisible();
  const supplierDirectoryEnd = requests.length;
  expect(
    requests
      .slice(0, supplierDirectoryEnd)
      .filter((r) => /^\/api\/v1\/suppliers\/.+/.test(r.path)),
  ).toEqual([]);
  await shot(page, "02-supplier-directory-desktop");
  await page.getByRole("button", { name: "New Supplier", exact: true }).click();
  let area = form(page, "Create Supplier form");
  await area.getByLabel("Display name", { exact: true }).fill(supplierName);
  await area.getByLabel("Country", { exact: true }).selectOption(countryJP);
  await area
    .getByLabel("Legal name (optional)")
    .fill(
      "Synthetic international textile development and manufacturing legal entity",
    );
  await area
    .getByLabel("Native name (optional)")
    .fill("キュレーション国際織物製造開発株式会社");
  await area
    .getByLabel("English name (optional)")
    .fill("Synthetic textile development and sourcing company");
  await area
    .getByLabel("Business registration number (optional)")
    .fill("SYNTHETIC-CURATION-REGISTRATION-2026-00001");
  await area
    .getByLabel("Website URL (optional)")
    .fill("https://Example.com:443/Textiles/Original?source=MiXeD%2FReference");
  await area.getByLabel("MILL", { exact: true }).check();
  await area.getByLabel("MATERIAL SUPPLIER", { exact: true }).check();
  await evidence(area, observationId);
  await expect(
    area.getByText(
      "New Suppliers begin at DISCOVERED verification status. Verification can be adjusted after creation.",
    ),
  ).toBeVisible();
  await shot(
    page,
    "03-supplier-create-desktop",
    area.getByRole("heading", { name: "Create Supplier", exact: true }),
  );
  await shot(
    page,
    "15-supplier-form-mobile",
    area.getByRole("heading", { name: "Create Supplier", exact: true }),
    true,
  );
  await shot(
    page,
    "23-supplier-roles-mobile",
    area.getByRole("group", {
      name: "Supplier roles — multiple or none",
      exact: true,
    }),
    true,
  );
  const supplierResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/suppliers" &&
      r.request().method() === "POST",
  );
  await area
    .getByRole("button", { name: "Create Supplier", exact: true })
    .click();
  const created = await (await supplierResponse).json(),
    supplierId: string = created.id;
  expect(created.verificationStatus).toBe("DISCOVERED");
  expect(created.version).toBe(0);
  await expect(page).toHaveURL(new RegExp(`/admin/suppliers/${supplierId}$`));
  await page
    .getByRole("button", { name: "Edit Supplier", exact: true })
    .click();
  area = form(page, "Edit Supplier form");
  await area.getByLabel("Display name", { exact: true }).fill(updatedSupplier);
  await evidence(area, observationId);
  await shot(
    page,
    "04-supplier-edit-desktop",
    area.getByRole("heading", { name: "Edit Supplier", exact: true }),
  );
  const competitor = await request.put(
    apiUrl(`/api/v1/admin/suppliers/${supplierId}`),
    {
      headers: { "X-Dev-Subject": curationAdmin },
      data: {
        countryId: countryJP,
        displayName: `Concurrent server Supplier ${suffix}`,
        roles: ["MILL", "MATERIAL_SUPPLIER"],
        status: "ACTIVE",
        observationId,
        version: 0,
      },
    },
  );
  expect(competitor.status()).toBe(200);
  await area
    .getByRole("button", { name: "Save Supplier", exact: true })
    .click();
  await expect(
    area.getByRole("heading", {
      name: "The Supplier changed or conflicts with the current server state.",
    }),
  ).toBeVisible();
  await expect(area.getByLabel("Display name", { exact: true })).toHaveValue(
    updatedSupplier,
  );
  await shot(
    page,
    "14-supplier-409-preserved-draft-desktop",
    area.getByRole("heading", {
      name: "The Supplier changed or conflicts with the current server state.",
    }),
  );
  await area
    .getByRole("button", { name: "Use refreshed Supplier version, keep draft" })
    .click();
  await area
    .getByRole("button", { name: "Save Supplier", exact: true })
    .click();
  await expect(
    area.getByText(
      "Supplier updated. The server version was refetched before another versioned command.",
    ),
  ).toBeVisible();
  await area.getByRole("button", { name: "Cancel Supplier form" }).click();
  await shot(
    page,
    "21-supplier-profile-mobile",
    page.getByRole("heading", { name: "Supplier profile", exact: true }),
    true,
  );
  await page.getByRole("button", { name: "Append Alias", exact: true }).click();
  area = form(page, "Append Alias form");
  await area
    .getByLabel("Alias", { exact: true })
    .fill(`Original alias — textile sourcing division ${suffix}`);
  await area.getByLabel("Language code (optional)").fill("ja-JP");
  await area
    .getByLabel("Alias type", { exact: true })
    .selectOption("COMMERCIAL");
  await evidence(area, observationId);
  await shot(
    page,
    "05-alias-desktop",
    area.getByRole("heading", { name: "Append Alias", exact: true }),
  );
  await shot(
    page,
    "16-alias-mobile",
    area.getByRole("heading", { name: "Append Alias", exact: true }),
    true,
  );
  await area.getByRole("button", { name: "Append Alias", exact: true }).click();
  await expect(
    area.getByText(
      "Alias appended. Supplier parent version and alias history refetched.",
    ),
  ).toBeVisible();
  await area.getByRole("button", { name: "Close Alias form" }).click();
  await page
    .getByRole("button", { name: "Manual verification", exact: true })
    .click();
  area = form(page, "Manual Verification form");
  await area.getByLabel("Manual verification target").selectOption("AUDITED");
  await area
    .getByLabel("Verification reason")
    .fill(
      "Synthetic sourcing review of the explicitly selected immutable Observation; this does not assert a legal certification.",
    );
  await evidence(area, observationId);
  await shot(
    page,
    "06-verification-desktop",
    area.getByRole("heading", { name: "Manual verification", exact: true }),
  );
  await shot(
    page,
    "16b-verification-mobile",
    area.getByRole("heading", { name: "Manual verification", exact: true }),
    true,
  );
  await area
    .getByRole("button", { name: "Change verification", exact: true })
    .click();
  await expect(
    area.getByText(
      "Verification changed. Supplier parent version and verification history refetched.",
    ),
  ).toBeVisible();
  await area.getByRole("button", { name: "Close Verification form" }).click();
  area = form(page, "Supplier fact citations");
  await area.getByLabel("Fact field").selectOption("DISPLAY_NAME");
  await evidence(area, observationId);
  await area.getByRole("button", { name: "Append fact citation" }).click();
  await expect(
    area.getByText(
      "Fact citation appended. The parent profile version is unchanged by this command.",
    ),
  ).toBeVisible();
  await shot(
    page,
    "07-supplier-citations-desktop",
    area.getByRole("heading", { name: "Fact citations", exact: true }),
  );
  const supplierCitations = await request.get(
    apiUrl(`/api/v1/admin/suppliers/${supplierId}/sources`),
    { headers: { "X-Dev-Subject": curationAdmin } },
  );
  const supplierRows = await supplierCitations.json();
  expect(supplierRows.length).toBeGreaterThan(0);
  expect(Object.keys(supplierRows[0]).sort()).toEqual([
    "created_at",
    "field_name",
    "source_observation_id",
  ]);
  const supplierPublic = await (
    await request.get(apiUrl(`/api/v1/suppliers/${supplierId}`), {
      headers: { "X-Dev-Subject": curationBuyer },
    })
  ).json();
  expect(supplierPublic.displayName).toBe(updatedSupplier);
  expect(supplierPublic.roles.sort()).toEqual(["MATERIAL_SUPPLIER", "MILL"]);
  expect(supplierPublic.verificationStatus).toBe("AUDITED");
  await page.getByRole("link", { name: "Add Facility", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Active facilities" }),
  ).toBeVisible();
  area = form(page, "Create Facility form");
  await expect(
    area.getByText("Parent Supplier — read-only; fixed by Supplier context"),
  ).toBeVisible();
  await shot(
    page,
    "08-facility-directory-desktop",
    page.getByRole("heading", { name: "Filter facilities", exact: true }),
  );
  await area.getByLabel("Facility name", { exact: true }).fill(facilityName);
  await area.getByLabel("Facility type", { exact: true }).selectOption("MILL");
  await area.getByLabel("Country", { exact: true }).selectOption(countryJP);
  await area.getByLabel("Region (optional)").selectOption(curationId(200));
  await area
    .getByLabel("Industrial Cluster (optional)")
    .selectOption(curationId(201));
  await area
    .getByLabel("Address line 1 (optional)")
    .fill(
      "123 Synthetic Textile Research and International Manufacturing Development Avenue",
    );
  await area
    .getByLabel("Address line 2 (optional)")
    .fill(
      "Industrial research building, production wing and specialist weaving floor",
    );
  await area.getByLabel("Postal code (optional)").fill("600-0000");
  await area
    .getByLabel("Email (optional)")
    .fill("synthetic-textile-operations@example.com");
  await area.getByLabel("Latitude (optional)").fill("0");
  await area.getByLabel("Longitude (optional)").fill("135.123456");
  await evidence(area, observationId);
  await shot(
    page,
    "09-facility-create-desktop",
    area.getByRole("heading", { name: "Create Facility", exact: true }),
  );
  await shot(
    page,
    "17-facility-form-mobile",
    area.getByRole("heading", { name: "Create Facility", exact: true }),
    true,
  );
  const facilityResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/facilities" &&
      r.request().method() === "POST",
  );
  await area
    .getByRole("button", { name: "Create Facility", exact: true })
    .click();
  const createdFacility = await (await facilityResponse).json(),
    facilityId: string = createdFacility.id;
  expect(createdFacility.supplierId).toBe(supplierId);
  expect(createdFacility.version).toBe(0);
  expect(createdFacility.latitude).toBe("0");
  expect(createdFacility.longitude).toBe("135.123456");
  await expect(page).toHaveURL(new RegExp(`/admin/facilities/${facilityId}$`));
  await page
    .getByRole("button", { name: "Edit Facility", exact: true })
    .click();
  area = form(page, "Edit Facility form");
  await area.getByLabel("Facility name", { exact: true }).fill(updatedFacility);
  await area.getByLabel("Phone (optional)").fill("+81 75 000 0000");
  await evidence(area, observationId);
  await shot(
    page,
    "10-facility-edit-desktop",
    area.getByRole("heading", { name: "Edit Facility", exact: true }),
  );
  await area
    .getByRole("button", { name: "Save Facility", exact: true })
    .click();
  await expect(
    area.getByText(
      "Facility updated. The server profile version was refreshed.",
    ),
  ).toBeVisible();
  await area.getByRole("button", { name: "Cancel Facility form" }).click();
  await shot(
    page,
    "22-facility-geography-mobile",
    page.getByRole("heading", { name: "Geography / contact", exact: true }),
    true,
  );
  area = form(page, "Facility fact citations");
  await area.getByLabel("Fact field").selectOption("ADDRESS");
  await evidence(area, observationId);
  await area.getByRole("button", { name: "Append fact citation" }).click();
  await expect(
    area.getByText(
      "Fact citation appended. The parent profile version is unchanged by this command.",
    ),
  ).toBeVisible();
  const facilityRows = await (
    await request.get(
      apiUrl(`/api/v1/admin/facilities/${facilityId}/sources`),
      { headers: { "X-Dev-Subject": curationAdmin } },
    )
  ).json();
  expect(Object.keys(facilityRows[0]).sort()).toEqual([
    "created_at",
    "field_name",
    "source_observation_id",
  ]);
  await page
    .getByLabel("Capability to inspect / curate")
    .selectOption({ label: capabilityName });
  area = form(page, "Capability assignment form");
  await expect(
    area.getByRole("heading", { name: "Create Capability assignment" }),
  ).toBeVisible();
  await area
    .getByLabel("Capability proficiency (optional)")
    .selectOption("SUPPORTED");
  await area
    .getByLabel("Capability verification", { exact: true })
    .selectOption("DOCUMENTED");
  await area.getByLabel("Minimum order quantity (optional)").fill("0");
  await area
    .getByLabel("Maximum order quantity (optional)")
    .fill("999999999999999.9999");
  await area
    .getByLabel("Quantity unit (optional without quantities)")
    .selectOption("METER");
  await area
    .getByLabel("Protected Capability notes (optional)")
    .fill(
      "Protected synthetic operator notes about the documented weaving assignment; no buyer projection should expose these notes.",
    );
  await evidence(area, observationId);
  await shot(
    page,
    "11-capability-create-desktop",
    area.getByRole("heading", { name: "Create Capability assignment" }),
  );
  await shot(
    page,
    "18-capability-form-mobile",
    area.getByRole("heading", { name: "Create Capability assignment" }),
    true,
  );
  const assignmentPath = `/api/v1/admin/facilities/${facilityId}/capabilities/${curationId(300)}`,
    capPut = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === assignmentPath &&
        r.request().method() === "PUT",
    ),
    capGet = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === assignmentPath &&
        r.request().method() === "GET" &&
        r.status() === 200,
    );
  await area
    .getByRole("button", { name: "Create assignment", exact: true })
    .click();
  const putResult = await capPut;
  expect(putResult.status()).toBe(200);
  expect(putResult.headers()["content-length"]).toBe("0");
  expect(putResult.request().headers()["if-none-match"]).toBe("*");
  expect(putResult.request().postDataJSON()).toMatchObject({
    version: 0,
    minimumOrderQuantity: "0",
    maximumOrderQuantity: "999999999999999.9999",
  });
  expect((await (await capGet).json()).version).toBe(0);
  await expect(area.getByText(/Current server version: 0/)).toBeVisible();
  await area.getByLabel("Minimum order quantity (optional)").fill("100.0001");
  await area
    .getByLabel("Capability proficiency (optional)")
    .selectOption("SPECIALIST");
  await area
    .getByLabel("Protected Capability notes (optional)")
    .fill(
      "Updated protected notes from the current targeted admin assignment baseline.",
    );
  await evidence(area, observationId);
  await shot(
    page,
    "12-capability-edit-desktop",
    area.getByRole("heading", { name: "Edit Capability assignment" }),
  );
  const capUpdate = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === assignmentPath &&
        r.request().method() === "PUT",
    ),
    capUpdatedGet = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === assignmentPath &&
        r.request().method() === "GET" &&
        r.status() === 200,
    );
  await area
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  const update = await capUpdate;
  expect(update.status()).toBe(200);
  expect(update.headers()["content-length"]).toBe("0");
  expect(update.request().headers()["if-none-match"]).toBeUndefined();
  expect(update.request().postDataJSON().version).toBe(0);
  const updatedAssignment = await (await capUpdatedGet).json();
  expect(updatedAssignment.version).toBe(1);
  expect(updatedAssignment.minimumOrderQuantity).toBe("100.0001");
  await expect(area.getByText(/Current server version: 1/)).toBeVisible();
  const publicFacility = await (
    await request.get(apiUrl(`/api/v1/facilities/${facilityId}`), {
      headers: { "X-Dev-Subject": curationBuyer },
    })
  ).json();
  expect(publicFacility.name).toBe(updatedFacility);
  expect(publicFacility.version).toBe(1);
  expect(publicFacility.longitude).toBe("135.123456");
  const publicAssignments = await (
    await request.get(apiUrl(`/api/v1/facilities/${facilityId}/capabilities`), {
      headers: { "X-Dev-Subject": curationBuyer },
    })
  ).json();
  expect(publicAssignments[0].minimumOrderQuantity).toBe("100.0001");
  expect(publicAssignments[0]).not.toHaveProperty("notes");
  await page.getByRole("link", { name: "Open buyer Facility view" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: updatedFacility }),
  ).toBeVisible();
  await expect(page.getByText("100.0001", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Updated protected notes from the current targeted admin assignment baseline.",
    ),
  ).toHaveCount(0);
  await page.goBack();
  await page.getByRole("link", { name: updatedSupplier, exact: true }).click();
  await page.getByRole("link", { name: "Open buyer Supplier view" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: updatedSupplier }),
  ).toBeVisible();
  await expect(
    page.getByText(`Original alias — textile sourcing division ${suffix}`, {
      exact: true,
    }),
  ).toBeVisible();
  if (process.env.SOURCE_OS_VISUAL_REVIEW)
    writeFileSync(
      reviewRoot + "request-counts.json",
      JSON.stringify(requests, null, 2),
    );
});
test("real competing first writer produces 412 without overwriting and requires explicit switch to edit", async ({
  page,
  request,
}) => {
  await login(page, curationAdmin, `/admin/facilities/${raceFacilityId}`);
  await page
    .getByLabel("Capability to inspect / curate")
    .selectOption({ label: raceCapabilityName });
  const area = form(page, "Capability assignment form");
  await expect(
    area.getByRole("heading", { name: "Create Capability assignment" }),
  ).toBeVisible();
  await area
    .getByLabel("Protected Capability notes (optional)")
    .fill("Original losing create-only draft");
  await area.getByLabel("Minimum order quantity (optional)").fill("0");
  await area
    .getByLabel("Quantity unit (optional without quantities)")
    .selectOption("METER");
  await evidence(area, curationId(102));
  const path = `/api/v1/admin/facilities/${raceFacilityId}/capabilities/${curationId(301)}`;
  const winner = await request.put(apiUrl(path), {
    headers: { "X-Dev-Subject": curationAdmin, "If-None-Match": "*" },
    data: {
      version: 0,
      observationId: curationId(102),
      verificationStatus: "AUDITED",
      minimumOrderQuantity: "42.0001",
      quantityUnit: "METER",
      notes: "Winning protected assignment fact",
    },
  });
  expect(winner.status()).toBe(200);
  expect(await winner.text()).toBe("");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === path && r.method() === "PUT")
      writes.push(r.url());
  });
  const failed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === path && r.request().method() === "PUT",
  );
  await area
    .getByRole("button", { name: "Create assignment", exact: true })
    .click();
  const response = await failed;
  expect(response.status()).toBe(412);
  // The central client consumes/cancels bounded error streams. Assert the same
  // server request reference from the HTTP header and safe Problem Details UI.
  const requestId = response.headers()["x-request-id"];
  expect(requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  await expect(
    area.getByRole("heading", {
      name: "Create-only precondition failed (412)",
    }),
  ).toBeVisible();
  await expect(
    area.getByText(`Request reference: ${requestId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    area.getByLabel("Protected Capability notes (optional)"),
  ).toHaveValue("Original losing create-only draft");
  await expect(
    area.getByText("Winning protected assignment fact", { exact: true }),
  ).toBeVisible();
  await shot(
    page,
    "13-capability-412-desktop",
    area.getByRole("heading", {
      name: "Create-only precondition failed (412)",
    }),
  );
  await shot(
    page,
    "19-capability-412-mobile",
    area.getByRole("heading", {
      name: "Create-only precondition failed (412)",
    }),
    true,
  );
  expect(writes).toHaveLength(1);
  await area.getByRole("button", { name: "Switch to edit mode" }).click();
  await expect(
    area.getByRole("button", { name: "Save assignment", exact: true }),
  ).toBeVisible();
  await expect(
    area.getByLabel("Protected Capability notes (optional)"),
  ).toHaveValue("Original losing create-only draft");
  expect(writes).toHaveLength(1);
  const persisted = await (
    await request.get(apiUrl(path), {
      headers: { "X-Dev-Subject": curationAdmin },
    })
  ).json();
  expect(persisted).toMatchObject({
    version: 0,
    minimumOrderQuantity: "42.0001",
    notes: "Winning protected assignment fact",
  });
});
test("late protected Actor A notes cannot populate buyer Actor B after switching", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let fetched!: () => void;
  const arrived = new Promise<void>((r) => (fetched = r));
  await login(page, curationAdmin, `/admin/facilities/${curationId(10)}`);
  await page.route(
    `**/api/v1/admin/facilities/${curationId(10)}/capabilities/${curationId(300)}`,
    async (route) => {
      const response = await route.fetch();
      fetched();
      await held;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await page
    .getByLabel("Capability to inspect / curate")
    .selectOption({ label: capabilityName });
  await arrived;
  await page.getByLabel("Local development identity").fill(curationBuyer);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByLabel("Protected Capability notes (optional)"),
  ).toHaveCount(0);
  await expect(page.getByLabel("Capability to inspect / curate")).toHaveCount(
    0,
  );
  await expect(page.getByText(/outcome unknown/)).toHaveCount(0);
});
test("runtime revocation unmounts protected notes, evidence drafts and capability mode", async ({
  page,
}) => {
  await login(page, curationRevocable, `/admin/facilities/${curationId(10)}`);
  await page
    .getByLabel("Capability to inspect / curate")
    .selectOption({ label: capabilityName });
  const area = form(page, "Capability assignment form");
  await expect(
    area.getByLabel("Protected Capability notes (optional)"),
  ).toHaveValue("Protected curation prerequisite notes");
  await area
    .getByLabel("Protected Capability notes (optional)")
    .fill("Transient revoked Actor draft");
  await evidence(area, curationId(102));
  revokeCurationAdmin();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Protected Capability notes (optional)"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Facility fact citations" }),
  ).toHaveCount(0);
});
