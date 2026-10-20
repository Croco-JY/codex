import { writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  networkId as id,
  provisionNetwork,
  supplierA,
} from "./network-fixture";
test.beforeAll(async ({ request }) => provisionNetwork(request));
async function login(page: Page, route = "/suppliers") {
  await page.goto(route);
  await page
    .getByLabel("Local development identity")
    .fill("network-" + Date.now());
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("Session active")).toBeVisible();
}
test("real Supply Network journeys preserve catalog, Seller and Facility meaning and bounded reads", async ({
  page,
}, info) => {
  const requests: URL[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) requests.push(new URL(r.url()));
  });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Active suppliers" }),
  ).toBeVisible();
  await page.getByLabel("Keyword", { exact: true }).fill("Network");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("25 suppliers loaded", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more suppliers" }).click();
  await expect(
    page.getByText("28 suppliers loaded", { exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((u) => /^\/api\/v1\/suppliers\/[^/]+$/.test(u.pathname)),
  ).toHaveLength(0);
  await page.getByLabel("Keyword", { exact: true }).fill("Network Kyoto");
  await page.getByLabel("Supplier country").selectOption("JP");
  await page.getByLabel("Facility country").selectOption("CN");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("1 suppliers loaded", { exact: true }),
  ).toBeVisible();
  const directory = page.url();
  const detailStart = requests.length;
  await page.getByRole("link", { name: supplierA, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: supplierA, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic audit reviewed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2 facilities loaded")).toBeVisible();
  await expect(page.getByText("1 catalog materials loaded")).toBeVisible();
  await expect(
    page.getByText("1 listings loaded", { exact: true }),
  ).toBeVisible();
  const detailRequests = requests.slice(detailStart).map((u) => u.pathname);
  const supplier = page.url();
  await page
    .getByRole("link", { name: "Network catalog cloth A", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Network catalog cloth A" }),
  ).toBeVisible();
  await expect(
    page.getByText("Network Seoul Manufacturing", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Return to Supply Network", exact: true })
    .click();
  await expect(page).toHaveURL(supplier);
  await page
    .getByRole("link", {
      name: "Open seller Listing · NETWORK-SELL-A",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Seller Listing · NETWORK-SELL-A",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Catalog Material context" }),
  ).toContainText("Network Seoul Manufacturing");
  await expect(
    page.getByRole("region", { name: "Listing terms" }),
  ).toContainText(supplierA);
  await page
    .getByRole("link", { name: "Return to Supply Network", exact: true })
    .click();
  await expect(page).toHaveURL(supplier);
  await page
    .getByRole("link", { name: "Network Kyoto weaving mill", exact: true })
    .click();
  await expect(page.getByText("35.123456", { exact: true })).toBeVisible();
  await expect(
    page.getByText("999999999999999.9999", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: supplierA, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: supplierA, level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Network Kyoto weaving mill", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Return to Supply Network", exact: true })
    .click();
  await expect(page).toHaveURL(supplier);
  await page
    .getByRole("link", { name: "Return to Supply Network", exact: true })
    .click();
  await expect(page).toHaveURL(directory);
  await expect(page.getByLabel("Supplier country")).toHaveValue("JP");
  await expect(page.getByLabel("Facility country")).toHaveValue("CN");
  await page.getByRole("link", { name: "Facilities", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Active facilities" }),
  ).toBeVisible();
  expect(await page.getByLabel("Keyword", { exact: true }).count()).toBe(0);
  await page.getByLabel("Country", { exact: true }).selectOption("JP");
  await page.getByLabel("Facility type").selectOption("MILL");
  await page.getByLabel("Capability", { exact: true }).selectOption(id(400));
  await page.getByLabel("Search supplier by name").fill("Network Kyoto");
  await page
    .getByRole("button", { name: "Find supplier", exact: true })
    .click();
  await page
    .getByRole("button", { name: supplierA + " · JP", exact: true })
    .click();
  const facilityStart = requests.length;
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("1 facilities loaded", { exact: true }),
  ).toBeVisible();
  const facilityRequests = requests.slice(facilityStart).map((u) => u.pathname);
  expect(facilityRequests.some((p) => p.endsWith("/capabilities"))).toBe(false);
  expect(
    requests
      .filter((u) => u.pathname === "/api/v1/facilities")
      .every((u) => !u.searchParams.has("q")),
  ).toBe(true);
  const facilityDirectory = page.url();
  await page
    .getByRole("link", { name: "Network Kyoto weaving mill", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Facility capabilities" }),
  ).toContainText("Specialist");
  await expect(
    page.getByRole("region", { name: "Facility capabilities" }),
  ).toContainText("Documented");
  await page
    .getByRole("link", { name: "Return to Supply Network", exact: true })
    .click();
  await expect(page).toHaveURL(facilityDirectory);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Network Kyoto weaving mill", level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  expect(requests.some((u) => u.pathname.includes("/admin/"))).toBe(false);
  const path = info.outputPath("request-counts.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        supplierDetail: detailRequests,
        filteredFacilityDirectory: facilityRequests,
      },
      null,
      2,
    ),
  );
  await info.attach("request-counts", {
    path,
    contentType: "application/json",
  });
});
test("real directory read completing after actor switch cannot restore old Actor state", async ({
  page,
}) => {
  await login(page, "/suppliers?country=JP");
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  let completed!: () => void;
  const finished = new Promise<void>((r) => (completed = r));
  let heldOnce = false;
  await page.route("**/api/v1/suppliers?**", async (route) => {
    if (heldOnce) {
      await route.continue();
      return;
    }
    heldOnce = true;
    const response = await route.fetch();
    const body = await response.json();
    body.items = [
      { id: id(1), displayName: "Stale actor A supplier", country: "JP" },
    ];
    entered();
    await held;
    await route.fulfill({ response, json: body }).catch(() => {});
    completed();
  });
  await page.getByLabel("Keyword", { exact: true }).fill("Network Kyoto");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await started;
  await page.getByLabel("Local development identity").fill("network-actor-b");
  await page.getByRole("button", { name: "Switch local identity" }).click();
  await expect(
    page.getByRole("link", { name: supplierA, exact: true }),
  ).toBeVisible();
  release();
  await finished;
  await expect(page.getByText("Stale actor A supplier")).toHaveCount(0);
  await page.getByRole("button", { name: "End local session" }).click();
  await expect(
    page.getByRole("heading", { name: "Authentication required", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: supplierA, exact: true }),
  ).toHaveCount(0);
});
test("Facility directory resolves repeated parent Supplier IDs once without Facility detail/capability fanout", async ({
  page,
}, info) => {
  const requests: URL[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) requests.push(new URL(r.url()));
  });
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/facilities" && r.status() === 200,
  );
  await login(page, "/facilities");
  const body = await (await response).json();
  await expect(
    page.getByText(`${body.items.length} facilities loaded`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading supplier label…", { exact: true }),
  ).toHaveCount(0);
  const ids = new Set<string>(
    body.items.map((f: { supplierId: string }) => f.supplierId),
  );
  const reads = requests.filter((u) =>
    /^\/api\/v1\/suppliers\/[^/]+$/.test(u.pathname),
  );
  expect(reads).toHaveLength(ids.size);
  expect(new Set(reads.map((u) => u.pathname.split("/").at(-1)))).toEqual(ids);
  expect(
    requests.filter((u) => /^\/api\/v1\/facilities\//.test(u.pathname)),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText(`${body.items.length} facilities loaded`, { exact: true }),
  ).toBeVisible();
  expect(
    requests.filter((u) => /^\/api\/v1\/suppliers\/[^/]+$/.test(u.pathname)),
  ).toHaveLength(ids.size);
  expect(
    requests.filter((u) => u.pathname === "/api/v1/countries"),
  ).toHaveLength(1);
  const path = info.outputPath("facility-fanout.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        loadedFacilities: body.items.length,
        distinctParentSuppliers: ids.size,
        initialSupplierReads: reads.length,
        paths: requests.map((u) => u.pathname),
      },
      null,
      2,
    ),
  );
  await info.attach("facility-fanout", {
    path,
    contentType: "application/json",
  });
});
