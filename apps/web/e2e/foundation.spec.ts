import { test, expect } from "@playwright/test";
test("shell reaches real API and local protected organization route", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByText("API UP")).toBeVisible();
  await page.getByLabel("Local development identity").fill(`e2e-${Date.now()}`);
  await page.getByRole("button", { name: "Use local identity" }).click();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(page.getByText("No organizations yet")).toBeVisible();
  await page
    .getByLabel("Organization name", { exact: true })
    .fill("Smoke test organization");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Smoke test organization" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Smoke test organization" }),
  ).toBeVisible();
});
