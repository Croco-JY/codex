import { test, expect, type Locator } from "@playwright/test";
import { commerceId as id, provisionCommerce } from "./commercial-fixture";
test.beforeAll(async ({ request }) => {
  await provisionCommerce(request);
});
test("review Material and Listing commercial reads on desktop and mobile", async ({
  page,
}, info) => {
  const capture = async (
    name: string,
    options: { locator?: Locator; fullPage?: boolean } = {},
  ) => {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const path = info.outputPath(`${name}.png`);
    if (options.locator) await options.locator.screenshot({ path });
    else await page.screenshot({ path, fullPage: options.fullPage ?? false });
    await info.attach(name, { path, contentType: "image/png" });
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/materials/${id(100)}`);
  await page.getByLabel("Local development identity").fill("commerce-visual");
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("280.0001")).toBeVisible();
  await expect(page.getByText("3 variants loaded")).toBeVisible();
  await expect(page.getByText("2 listings loaded")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture("01-material-full-desktop", { fullPage: true });
  await capture("02-material-variants-listings-desktop", {
    locator: page.locator(".material-related-records"),
  });
  await page
    .getByRole("link", { name: "Open seller Listing · SELL-CT01", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Seller Listing · SELL-CT01" }),
  ).toBeVisible();
  const price = page.getByRole("region", { name: "Price resolver" }),
    inventory = page.getByRole("region", { name: "Inventory knowledge" });
  await expect(price.locator(".price-amount")).toContainText(
    "999999999999999.9999",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture("03-listing-desktop");
  await page.getByLabel("Price variant", { exact: true }).selectOption(id(201));
  await page.getByLabel("Requested quantity (in price unit)").fill("100.0001");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(price.getByText("Variant exact", { exact: true })).toBeVisible();
  await capture("04-effective-price-matched", { locator: price });
  await page.getByLabel("Price mode").selectOption("historical");
  await page
    .getByLabel("Historical price instant (UTC)")
    .fill("2025-06-01T00:00:00Z");
  await page.getByLabel("Price variant", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(
    price.getByText("Not evaluated for historical query", { exact: true }),
  ).toBeVisible();
  await capture("05-historical-price", { locator: price });
  await page.getByRole("button", { name: "Show price history" }).click();
  const history = page.getByRole("region", { name: "Price history" });
  await expect(history.getByText("25 price facts loaded")).toBeVisible();
  await history.scrollIntoViewIfNeeded();
  await capture("11-price-history-desktop");
  await page.getByLabel("Inventory unit", { exact: true }).selectOption("KG");
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText("1 observation scopes loaded"),
  ).toBeVisible();
  await capture("06-inventory-known-quantity", { locator: inventory });
  await page
    .getByLabel("Inventory unit", { exact: true })
    .selectOption("METER");
  await page
    .getByLabel("Inventory variant", { exact: true })
    .selectOption(id(201));
  await page.getByLabel("Inventory capture mode").selectOption("MANUAL");
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText("Known zero quantity for this observation scope"),
  ).toBeVisible();
  await capture("07-inventory-known-zero", { locator: inventory });
  await page.getByRole("button", { name: "Show inventory history" }).click();
  const inventoryHistory = page.getByRole("region", {
    name: "Inventory history",
  });
  await expect(
    inventoryHistory.getByText("2 historical observations loaded"),
  ).toBeVisible();
  await capture("12-inventory-history-desktop", { locator: inventoryHistory });
  await page
    .getByLabel("Inventory variant", { exact: true })
    .selectOption(id(203));
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText(
      "No stock observation within this scope · stock unknown.",
    ),
  ).toBeVisible();
  await capture("08-inventory-unknown", { locator: inventory });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Return to catalog Material" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Commerce wool twill" }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture("09-material-mobile");
  await capture("13-variants-listings-mobile", {
    locator: page.locator(".material-related-records"),
  });
  await page
    .getByRole("link", { name: "Open seller Listing · SELL-CT01", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Seller Listing · SELL-CT01" }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(price.locator(".price-amount")).toContainText(
    "999999999999999.9999",
  );
  await expect(
    inventory.getByText("3 observation scopes loaded"),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await capture("10-listing-mobile");
  await page.getByLabel("Price variant", { exact: true }).selectOption(id(201));
  await page.getByLabel("Requested quantity (in price unit)").fill("100.0001");
  await page.getByRole("button", { name: "Resolve price" }).click();
  await expect(price.getByText("Variant exact", { exact: true })).toBeVisible();
  await capture("14-price-resolver-mobile", { locator: price });
  await page.getByRole("button", { name: "Show price history" }).click();
  await expect(history.getByText("25 price facts loaded")).toBeVisible();
  await history.scrollIntoViewIfNeeded();
  await capture("15-price-history-mobile");
  await page
    .getByLabel("Inventory variant", { exact: true })
    .selectOption(id(201));
  await page.getByLabel("Inventory capture mode").selectOption("MANUAL");
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    inventory.getByText("Known zero quantity for this observation scope"),
  ).toBeVisible();
  await capture("16-inventory-mobile", { locator: inventory });
  await page.getByRole("button", { name: "Show inventory history" }).click();
  await expect(
    inventoryHistory.getByText("2 historical observations loaded"),
  ).toBeVisible();
  await capture("17-inventory-history-mobile", { locator: inventoryHistory });
  await page.getByLabel("Price mode").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Price variant", { exact: true })).toBeFocused();
  await page.route("**/inventory?*", (route) =>
    route.fulfill({
      status: 503,
      headers: { "X-Request-ID": "visual-inventory-reference" },
      contentType: "application/problem+json",
      body: "{}",
    }),
  );
  await page.getByLabel("Inventory unit", { exact: true }).selectOption("KG");
  await page.getByRole("button", { name: "Apply inventory scope" }).click();
  await expect(
    page.getByRole("heading", { name: "Inventory information unavailable" }),
  ).toBeVisible();
  await capture("18-inventory-unavailable-mobile", { locator: inventory });
});
