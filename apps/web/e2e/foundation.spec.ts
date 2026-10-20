import { test, expect } from "@playwright/test";

test("real organization workflow preserves selection, keyboard access and session isolation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.getByText("API UP")).toBeVisible();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const subject = `e2e-${Date.now()}`;
  await page.getByLabel("Local development identity").fill(subject);
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(page.getByText("Session active")).toBeVisible();
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await expect(page.getByText("No organizations yet")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Organization", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".route-content")).toBeFocused();
  await page
    .getByLabel("Organization name", { exact: true })
    .fill("Smoke test organization");
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Smoke test organization", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Smoke test organization", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("New organization name")
    .fill("Renamed smoke organization");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: "Renamed smoke organization" }),
  ).toBeVisible();
  await page.getByLabel("Local development identity").fill(`${subject}-next`);
  await page.getByRole("button", { name: "Switch local identity" }).click();
  await expect(page.getByText("No organizations yet")).toBeVisible();
  await expect(page.getByText("Select an organization")).toBeVisible();
  await expect(page.getByText("Renamed smoke organization")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain(subject);
  expect(page.url()).not.toContain(subject);
  await page.getByRole("button", { name: "End local session" }).click();
  await expect(
    page.getByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Organization name", { exact: true }),
  ).toHaveCount(0);
});

test("direct admin route denies an ordinary actor while the backend independently enforces access", async ({
  page,
}) => {
  const adminRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/admin"))
      adminRequests.push(request.url());
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  const subject = `e2e-non-admin-${Date.now()}`;
  await page.getByLabel("Local development identity").fill(subject);
  await page.getByRole("button", { name: "Use local identity" }).click();
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  expect(adminRequests).toEqual([]);
  const denied = await page.request.get(
    "http://127.0.0.1:8080/api/v1/admin/sources",
    {
      headers: { "X-Dev-Subject": subject },
    },
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()).detail).toBe("Access denied");
});
