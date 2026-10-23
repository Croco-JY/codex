import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionWorkspace } from "./workspace-fixture";
const api = "http://127.0.0.1:8080";
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase2c-review/${mode}/`, import.meta.url),
);
const stylePath = (f: Awaited<ReturnType<typeof provisionWorkspace>>) =>
  `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
const region = (page: Page) =>
  page.getByRole("region", { name: "Style Requirement", exact: true });
async function login(page: Page, actor: string, path: string) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function shot(page: Page, name: string, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.env.SOURCE_OS_VISUAL_REVIEW) {
    mkdirSync(root, { recursive: true });
    await page.screenshot({ path: `${root}${name}.png`, fullPage: true });
  }
}
test("real Requirement writer creates exact planning targets, updates, clears and respects parent lifecycle", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request),
    route = stylePath(f),
    endpoint = `/api/v1${route}/requirement`;
  const writes: {
    header: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && new URL(r.url()).pathname === endpoint)
      writes.push({
        header: r.headers()["if-none-match"],
        body: r.postDataJSON(),
      });
  });
  await login(page, f.writer, route);
  const section = region(page);
  await expect(
    section.getByText("No Requirement sheet has been created for this Style."),
  ).toBeVisible();
  await shot(page, "01-absent-desktop");
  await section
    .getByLabel("Product type")
    .fill(
      "Synthetic early development coat planning target with a long descriptive product label",
    );
  await section.getByLabel("Target quantity").fill("999999999999999.9999");
  await section.getByLabel("Target unit cost").fill("0.0001");
  await section.getByLabel("Currency").fill("USD");
  await section.getByLabel("Quantity unit").selectOption("PCS");
  await section.getByLabel("Target delivery date").fill("2000-02-29");
  await section
    .getByLabel("Requirement notes")
    .fill(
      "Synthetic private development planning notes. No quotation, BOM or commercial commitment.",
    );
  await shot(page, "02-create-tablet", 820, 1180);
  await shot(page, "03-create-mobile", 390, 844);
  await section.getByLabel("Target quantity").focus();
  await page.keyboard.press("Tab");
  await expect(section.getByLabel("Quantity unit")).toBeFocused();
  await section
    .getByRole("button", { name: "Create Requirement", exact: true })
    .click();
  await expect(
    section.getByText("Requirement saved.", { exact: true }),
  ).toBeVisible();
  expect(writes[0]).toMatchObject({
    header: "*",
    body: {
      version: 0,
      targetQuantity: "999999999999999.9999",
      targetCost: "0.0001",
    },
  });
  let response = await request.get(api + endpoint, { headers: f.headers });
  expect(response.status()).toBe(200);
  let stored = await response.json();
  expect(stored).toMatchObject({
    version: 0,
    targetQuantity: "999999999999999.9999",
    targetCost: "0.0001",
    targetDeliveryDate: "2000-02-29",
  });
  await shot(page, "04-recorded-desktop");
  await section.getByLabel("Target quantity").fill("0");
  await section
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(
    section
      .getByRole("region", { name: "Recorded Requirement", exact: true })
      .getByText("1", { exact: true }),
  ).toBeVisible();
  expect(writes[1].header).toBeUndefined();
  expect(writes[1].body.targetQuantity).toBe("0");
  expect(writes[1].body.version).toBe(0);
  for (const label of [
    "Product type",
    "Target quantity",
    "Target unit cost",
    "Currency",
    "Target delivery date",
    "Requirement notes",
  ])
    await section.getByLabel(label).fill("");
  await section.getByLabel("Quantity unit").selectOption("");
  await section
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(
    section
      .getByRole("region", { name: "Recorded Requirement", exact: true })
      .getByText("2", { exact: true }),
  ).toBeVisible();
  stored = await (
    await request.get(api + endpoint, { headers: f.headers })
  ).json();
  expect(stored).toMatchObject({
    version: 2,
    productType: null,
    targetQuantity: null,
    targetCost: null,
    currency: null,
    quantityUnit: null,
    targetDeliveryDate: null,
    notes: null,
  });
  expect(
    await (
      await request.get(api + `/api/v1${route}`, { headers: f.headers })
    ).json(),
  ).toMatchObject({ version: 0 });
  const profile = page.getByRole("region", {
    name: "Style profile",
    exact: true,
  });
  await profile
    .getByRole("button", { name: "Archive Style", exact: true })
    .click();
  await expect(section.getByText(/Requirement is read-only/)).toBeVisible();
  await expect(section.getByLabel("Product type")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    section.getByRole("button", { name: "Save Requirement" }),
  ).toHaveCount(0);
  await shot(page, "05-archived-mobile", 390, 844);
  await profile
    .getByRole("button", { name: "Reactivate Style", exact: true })
    .click();
  await expect(
    section.getByRole("button", { name: "Save Requirement" }),
  ).toBeEnabled();
  await shot(page, "06-reactivated-tablet", 820, 1180);
});
test("real competing create produces 412, preserves draft and needs explicit reconciliation", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request),
    route = stylePath(f),
    endpoint = `/api/v1${route}/requirement`;
  await login(page, f.writer, route);
  const section = region(page);
  await expect(
    section.getByRole("button", { name: "Create Requirement" }),
  ).toBeEnabled();
  await section.getByLabel("Product type").fill("Retained create draft");
  const competitor = await request.put(api + endpoint, {
    headers: { ...f.headers, "If-None-Match": "*" },
    data: { productType: "Competing writer sheet", version: 0 },
  });
  expect(competitor.status()).toBe(201);
  const results: number[] = [];
  page.on("response", (r) => {
    if (
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === endpoint
    )
      results.push(r.status());
  });
  await section
    .getByRole("button", { name: "Create Requirement", exact: true })
    .click();
  await expect(
    section.getByRole("heading", { name: "A Requirement already exists." }),
  ).toBeVisible();
  await expect(
    section
      .getByRole("region", { name: "Current server Requirement" })
      .getByText("Competing writer sheet"),
  ).toBeVisible();
  await expect(section.getByLabel("Product type")).toHaveValue(
    "Retained create draft",
  );
  await expect(section.getByText(/Request reference:/)).toBeVisible();
  expect(results).toEqual([412]);
  await shot(page, "07-conflict-desktop");
  await shot(page, "08-conflict-mobile", 390, 844);
  await section
    .getByRole("button", { name: "Reconcile draft with existing", exact: true })
    .click();
  expect(results).toEqual([412]);
  await section
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(
    section.getByText("Requirement saved.", { exact: true }),
  ).toBeVisible();
  expect(results).toEqual([412, 200]);
  expect(
    await (await request.get(api + endpoint, { headers: f.headers })).json(),
  ).toMatchObject({ productType: "Retained create draft", version: 1 });
});
test("real stale update and parent archive refresh preserve draft and remove write controls", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request),
    route = stylePath(f),
    endpoint = `/api/v1${route}/requirement`;
  expect(
    (
      await request.put(api + endpoint, {
        headers: { ...f.headers, "If-None-Match": "*" },
        data: { productType: "Initial", version: 0 },
      })
    ).status(),
  ).toBe(201);
  await login(page, f.writer, route);
  const section = region(page);
  await expect(section.getByLabel("Product type")).toHaveValue("Initial");
  await section.getByLabel("Product type").fill("My stale revision");
  expect(
    (
      await request.put(api + endpoint, {
        headers: f.headers,
        data: { productType: "Current server revision", version: 0 },
      })
    ).status(),
  ).toBe(200);
  await section
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(
    section
      .getByRole("region", { name: "Current server Requirement" })
      .getByText("Current server revision"),
  ).toBeVisible();
  await expect(section.getByLabel("Product type")).toHaveValue(
    "My stale revision",
  );
  await section
    .getByRole("button", { name: "Reconcile draft with existing" })
    .click();
  expect(
    (
      await request.put(
        api + `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
        {
          headers: f.headers,
          data: {
            name: f.project.name,
            description: f.project.description,
            status: "ARCHIVED",
            version: f.project.version,
          },
        },
      )
    ).status(),
  ).toBe(200);
  await section
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(section.getByText(/Requirement is read-only/)).toBeVisible();
  await expect(section.getByLabel("Product type")).toHaveValue(
    "My stale revision",
  );
  await expect(section.getByLabel("Product type")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    section.getByRole("button", { name: "Save Requirement" }),
  ).toHaveCount(0);
  await shot(page, "09-parent-conflict-tablet", 820, 1180);
});
test("VIEWER can read absent and existing sheets while PLATFORM_ADMIN alone cannot enter tenant workspace", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request),
    route = stylePath(f),
    endpoint = `/api/v1${route}/requirement`;
  await login(page, f.viewer, route);
  let section = region(page);
  await expect(
    section.getByText("No Requirement sheet has been created for this Style."),
  ).toBeVisible();
  await expect(section.getByRole("button")).toHaveCount(0);
  expect(
    (
      await request.put(api + endpoint, {
        headers: { ...f.headers, "If-None-Match": "*" },
        data: { notes: "Visible synthetic private planning note", version: 0 },
      })
    ).status(),
  ).toBe(201);
  await login(page, f.viewer, route);
  section = region(page);
  await expect(
    section.getByText("Visible synthetic private planning note"),
  ).toBeVisible();
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await shot(page, "10-viewer-mobile", 390, 844);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === endpoint) calls.push(r.method());
  });
  await page.getByLabel("Local development identity").fill(f.admin);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  await shot(page, "11-denied-mobile", 390, 844);
});
