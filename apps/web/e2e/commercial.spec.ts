import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { commerceId as id, provisionCommerce } from "./commercial-fixture";
test.beforeAll(async ({ request }) => {
  await provisionCommerce(request);
});
async function login(
  page: import("@playwright/test").Page,
  route = "/materials",
) {
  await page.goto(route);
  await page
    .getByLabel("Local development identity")
    .fill(`commerce-${Date.now()}`);
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("Session active")).toBeVisible();
}
test("real sourcing journey distinguishes catalog, Variant, Listing, price and inventory scopes", async ({
  page,
}, info) => {
  const requests: { url: URL; subject: string | undefined }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/"))
      requests.push({
        url: new URL(request.url()),
        subject: request.headers()["x-dev-subject"],
      });
  });
  await login(page);
  if (
    !(await page
      .locator(".filter-panel")
      .evaluate((node) => (node as HTMLDetailsElement).open))
  )
    await page.getByText("Search filters", { exact: true }).click();
  await page.getByLabel("Keyword", { exact: true }).fill("Commerce wool twill");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".material-card")).toHaveCount(1);
  const discovery = page.url();
  const materialStart = requests.length;
  await page.getByRole("link", { name: "Commerce wool twill" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Commerce wool twill" }),
  ).toBeVisible();
  await expect(page.getByText("Midnight blue", { exact: true })).toBeVisible();
  await expect(page.getByText("280.0001")).toBeVisible();
  await expect(page.getByText("2 listings loaded")).toBeVisible();
  await expect(
    page.getByText("Demo seller company", { exact: true }).first(),
  ).toBeVisible();
  const materialEnd = requests.length;
  await page
    .getByRole("link", { name: "Open seller Listing · SELL-CT01", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Seller Listing · SELL-CT01" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Catalog Material context" }),
  ).toContainText("Demo catalog mill");
  await expect(
    page.getByRole("region", { name: "Listing terms" }),
  ).toContainText("Demo seller company");
  const price = page.getByRole("region", { name: "Price resolver" });
  await expect(price.locator(".price-amount")).toContainText(
    "999999999999999.9999",
  );
  await expect(price.getByText("Unknown terms", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Inventory knowledge" })
      .getByText("3 observation scopes loaded"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Inventory knowledge" })
      .getByText("Demo secondary warehouse", { exact: false }),
  ).toBeVisible();
  const metricsPath = info.outputPath("request-counts.json");
  writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        material: requests
          .slice(materialStart, materialEnd)
          .map((r) => r.url.pathname),
        listing: requests.slice(materialEnd).map((r) => r.url.pathname),
      },
      null,
      2,
    ),
  );
  await info.attach("initial-route-reads", {
    path: metricsPath,
    contentType: "application/json",
  });
  await page.getByLabel("Price variant", { exact: true }).selectOption(id(201));
  await page.getByLabel("Requested quantity (in price unit)").fill("100.0001");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(price.getByText("Variant exact", { exact: true })).toBeVisible();
  await expect(price.locator(".price-amount")).toContainText("55.0001");
  await expect(price.getByText("Eligible under current terms")).toBeVisible();
  await page.getByLabel("Price variant", { exact: true }).selectOption(id(202));
  await page.getByLabel("Allow Material-level fallback").check();
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(price.getByText(/Material-level fallback result/)).toBeVisible();
  await page.getByLabel("Price mode").selectOption("historical");
  await page
    .getByLabel("Historical price instant (UTC)")
    .fill("2025-06-01T00:00:00Z");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(
    price.getByText("Not evaluated for historical query", { exact: true }),
  ).toBeVisible();
  await expect(price.locator(".price-amount")).toContainText("40.1234");
  await page.getByRole("button", { name: "Show price history" }).click();
  await expect(page.getByText("25 price facts loaded")).toBeVisible();
  await page.getByRole("button", { name: "Load more price history" }).click();
  await expect(page.getByText("29 price facts loaded")).toBeVisible();
  const inventory = page.getByRole("region", { name: "Inventory knowledge" });
  await expect(inventory).toContainText("999999999999999.9999");
  await page
    .getByLabel("Inventory variant", { exact: true })
    .selectOption(id(201));
  await page.getByLabel("Inventory capture mode").selectOption("MANUAL");
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText("Known zero quantity for this observation scope"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show inventory history" }).click();
  await expect(
    page.getByText("2 historical observations loaded"),
  ).toBeVisible();
  await page
    .getByLabel("Inventory variant", { exact: true })
    .selectOption(id(203));
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText(
      "No stock observation within this scope · stock unknown.",
    ),
  ).toBeVisible();
  const currentFirst = requests.find((request) =>
    request.url.pathname.endsWith("/effective-prices"),
  )!.url;
  expect(currentFirst.searchParams.has("asOf")).toBe(false);
  expect(currentFirst.searchParams.has("requestedQuantity")).toBe(false);
  expect(
    requests.filter((request) => request.url.pathname.includes("/admin/")),
  ).toHaveLength(0);
  await page.getByRole("link", { name: "Return to catalog Material" }).click();
  await page.getByRole("link", { name: "Browse active materials" }).click();
  await expect(page).toHaveURL(discovery);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain("55.0001");
});
test("switching Actor resets applied commercial scope and rejects a late prior response", async ({
  page,
}) => {
  await login(page, `/material-listings/${id(300)}`);
  const price = page.getByRole("region", { name: "Price resolver" });
  await expect(price.locator(".price-amount")).toContainText(
    "999999999999999.9999",
  );
  let finishOld!: () => void;
  const oldHandled = new Promise<void>((done) => {
    finishOld = done;
  });
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  let captured!: () => void;
  const ready = new Promise<void>((done) => {
    captured = done;
  });
  await page.route("**/effective-prices?*", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("requestedQuantity") ===
      "100"
    ) {
      const response = await route.fetch();
      captured();
      await pending;
      await route.fulfill({ response }).catch(() => {});
      finishOld();
    } else await route.continue();
  });
  await page.getByLabel("Price variant", { exact: true }).selectOption(id(201));
  await page.getByLabel("Requested quantity (in price unit)").fill("100");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await ready;
  await page
    .getByLabel("Local development identity")
    .fill(`commerce-next-${Date.now()}`);
  await page.getByRole("button", { name: "Switch local identity" }).click();
  await expect(
    page.getByLabel("Requested quantity (in price unit)"),
  ).toHaveValue("");
  await expect(price.locator(".price-amount")).toContainText(
    "999999999999999.9999",
  );
  release();
  await oldHandled;
  await expect(price.locator(".price-amount")).not.toContainText("55.0001");
  await page.getByRole("button", { name: "End local session" }).click();
  await expect(
    page.getByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
});
