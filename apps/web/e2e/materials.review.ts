import { test, expect, type Page } from "@playwright/test";
import { fixtureId, provisionMaterials } from "./material-fixture";

test.beforeAll(async ({ request }) => {
  await provisionMaterials(request);
});
test("capture real Material workspace for visual review", async ({
  page,
}, info) => {
  const capture = async (name: string, fullPage = false) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage });
    await info.attach(name, { path, contentType: "image/png" });
  };
  const expand = async (page: Page, selector: string) => {
    const details = page.locator(selector);
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await details.locator(":scope > summary").click();
  };
  let release!: () => void;
  const pending = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/v1/materials?*", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByLabel("Local development identity")
    .fill("visual-material-review");
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("Session active")).toBeVisible();
  await page.getByRole("link", { name: "Materials", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Searching materials" }),
  ).toBeVisible();
  await capture("07-loading");
  release();
  await expect(page.locator(".material-card").first()).toBeVisible();
  await page.unroute("**/api/v1/materials?*");
  await expect(
    page.getByText("Review Kyoto Textiles", { exact: true }).first(),
  ).toBeVisible();
  await capture("01-desktop-default");

  await page.getByLabel("Keyword", { exact: true }).fill("Review wool");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".material-card")).toHaveCount(2);
  await page.getByText("Technical filters", { exact: true }).click();
  await page
    .getByLabel("Maximum thickness (mm)", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Apply filters" }),
  ).toBeInViewport();
  await capture("02-desktop-expanded-filters", true);
  await page.getByText("Technical filters", { exact: true }).click();
  await page.getByText("Commercial filters", { exact: true }).click();
  await page.getByLabel("Maximum MOQ", { exact: true }).fill("80");
  await page.getByLabel("Quantity unit", { exact: true }).selectOption("METER");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".material-card")).toHaveCount(1);
  await capture("03-desktop-commercial-active", true);
  await page.getByRole("link", { name: "Review wool gabardine" }).click();
  await expect(
    page.getByRole("heading", { name: "Review wool gabardine", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Review Kyoto Textiles", { exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain(fixtureId(101));
  await capture("04-desktop-detail");
  await page.goBack();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.locator(".material-card")).toHaveCount(25);
  await expect(
    page.getByText("Updating results. Previous search results remain visible."),
  ).toHaveCount(0);
  await capture("05-mobile-materials");
  await expand(page, ".filter-panel");
  await page
    .getByLabel("Keyword", { exact: true })
    .fill("no-match-visual-fixture");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByText("No materials match these filters"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expand(page, ".filter-panel");
  await capture("06-filtered-empty");

  await page.route("**/api/v1/materials?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      headers: { "X-Request-ID": "visual-service-reference" },
      body: "{}",
    }),
  );
  await page
    .getByLabel("Keyword", { exact: true })
    .fill("error-state-visual-fixture");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "Service unavailable" }),
  ).toBeVisible();
  await capture("08-recoverable-error");
});
