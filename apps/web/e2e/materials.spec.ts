import { test, expect } from "@playwright/test";
import { provisionMaterials } from "./material-fixture";

test.beforeAll(async ({ request }) => {
  await provisionMaterials(request);
});
test("real Material discovery applies listing terms, opens detail and returns through browser history", async ({
  page,
}) => {
  const requests: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1")) requests.push(url);
  });
  await page.goto("/");
  await page
    .getByLabel("Local development identity")
    .fill(`material-e2e-${Date.now()}`);
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("Session active")).toBeVisible();
  await page.getByRole("link", { name: "Materials", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Active materials" }),
  ).toBeVisible();
  await expect(page.locator(".material-card").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Review unreleased draft" }),
  ).toHaveCount(0);
  if (
    !(await page
      .locator(".filter-panel")
      .evaluate((node) => (node as HTMLDetailsElement).open))
  )
    await page.getByText("Search filters", { exact: true }).click();
  await page.getByLabel("Keyword", { exact: true }).fill("Review");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=Review/);
  await expect(page.locator(".material-card")).toHaveCount(25);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator(".material-card")).toHaveCount(28);
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Keyword", { exact: true }).fill("Review wool");
  await page
    .getByLabel("Material type", { exact: true })
    .selectOption("FABRIC");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".material-card")).toHaveCount(2);
  await page.getByText("Commercial filters", { exact: true }).click();
  await page.getByLabel("Maximum MOQ", { exact: true }).fill("80");
  await page.getByLabel("Quantity unit", { exact: true }).selectOption("METER");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".material-card")).toHaveCount(1);
  await expect(
    page.getByText(
      "Materials with at least one seller listing matching these terms.",
    ),
  ).toBeVisible();
  const filteredUrl = page.url();
  expect(filteredUrl).toContain("maxMoq=80");
  await page.getByRole("link", { name: "Review wool gabardine" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Review wool gabardine" }),
  ).toBeVisible();
  await expect(
    page.getByText("Review Kyoto Textiles", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Complete composition:")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(page.getByLabel("Maximum MOQ", { exact: true })).toHaveValue(
    "80",
  );
  await expect(page.locator(".material-card")).toHaveCount(1);
  expect(
    requests.filter((url) =>
      /fabric-spec|leather-spec|listings|prices|inventory/.test(url.pathname),
    ),
  ).toHaveLength(0);
  expect(
    requests
      .filter((url) => url.pathname === "/api/v1/materials")
      .every((url) => url.searchParams.get("status") === "ACTIVE"),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain("Review wool");
});
