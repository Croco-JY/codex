import { test, expect, type Locator } from "@playwright/test";
import {
  networkId as id,
  provisionNetwork,
  supplierA,
} from "./network-fixture";
test.beforeAll(async ({ request }) => provisionNetwork(request));
test("review Supply Network desktop and mobile with real PostgreSQL records", async ({
  page,
}, info) => {
  const capture = async (name: string, locator?: Locator) => {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const path = info.outputPath(name + ".png");
    if (locator) await locator.screenshot({ path });
    else await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: "image/png" });
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/suppliers");
  await page.getByLabel("Local development identity").fill("network-visual");
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(
    page.getByText("25 suppliers loaded", { exact: true }),
  ).toBeVisible();
  await capture("01-supplier-directory-desktop");
  await page.getByLabel("Keyword", { exact: true }).fill("Network Kyoto");
  await page.getByLabel("Supplier country").selectOption("JP");
  await page.getByLabel("Facility country").selectOption("CN");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByText("1 suppliers loaded", { exact: true }),
  ).toBeVisible();
  await capture("02-filtered-supplier-directory-desktop");
  await page.getByRole("link", { name: supplierA, exact: true }).click();
  await expect(
    page.getByText("Synthetic audit reviewed", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("2 facilities loaded")).toBeVisible();
  await capture("03-supplier-detail-desktop");
  await capture(
    "04-supplier-child-sections-desktop",
    page.locator(".supplier-related-records"),
  );
  await page
    .getByRole("link", { name: "Network Kyoto weaving mill", exact: true })
    .click();
  await expect(
    page.getByText("999999999999999.9999", { exact: true }),
  ).toBeVisible();
  await capture("05-facility-detail-desktop");
  await capture(
    "06-facility-capabilities-desktop",
    page.getByRole("region", { name: "Facility capabilities" }),
  );
  await page.getByRole("link", { name: "Facilities", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Network Kyoto weaving mill", exact: true }),
  ).toBeVisible();
  await capture("07-facility-directory-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".network-filter-disclosure summary").click();
  await capture("08-facility-directory-mobile");
  await page
    .getByRole("link", { name: "Network Kyoto weaving mill", exact: true })
    .click();
  await expect(page.getByText("35.123456", { exact: true })).toBeVisible();
  await expect(
    page.getByText("999999999999999.9999", { exact: true }),
  ).toBeVisible();
  await capture("09-facility-detail-mobile");
  await page.getByRole("link", { name: supplierA, exact: true }).click();
  await expect(
    page.getByText("Synthetic audit reviewed", { exact: true }),
  ).toBeVisible();
  await capture("10-supplier-detail-mobile");
  await page.getByRole("link", { name: "Suppliers", exact: true }).click();
  await page.locator(".network-filter-disclosure summary").click();
  await page.getByLabel("Keyword", { exact: true }).fill("Network Kyoto");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    page.getByRole("link", { name: supplierA, exact: true }),
  ).toBeVisible();
  await capture("11-supplier-directory-mobile");
  await page.locator(".network-filter-disclosure summary").click();
  await capture("12-supplier-filters-mobile");
  // Native form controls remain keyboard reachable with a visible focus indicator.
  await page.getByLabel("Keyword", { exact: true }).focus();
  await expect(page.getByLabel("Keyword", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Supplier country")).toBeFocused();
});
