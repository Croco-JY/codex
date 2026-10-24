import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionSelection, selectionSql } from "./selection-fixture";
const api = "http://127.0.0.1:8080",
  mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase2d-review/${mode}/`, import.meta.url),
);
const region = (page: Page) =>
  page.getByRole("region", { name: "Material Selections", exact: true });
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
async function choose(
  page: Page,
  f: Awaited<ReturnType<typeof provisionSelection>>,
) {
  const s = region(page);
  await s
    .getByRole("button", { name: "Choose catalog Material", exact: true })
    .click();
  await s.getByLabel("Catalog Material keyword").fill(f.name);
  await s.getByRole("button", { name: "Search active Materials" }).click();
  await s
    .getByRole("button", { name: `Choose ${f.name}`, exact: true })
    .click();
  await s.getByLabel("Optional Variant").selectOption(f.variant);
  await s.getByLabel("Optional Listing").selectOption(f.listing);
  await expect(
    s.getByRole("button", { name: "Add Material Selection", exact: true }),
  ).toBeEnabled();
}

test("real full-scope selection, private unlink, archived catalog retention and parent lifecycle", async ({
  page,
  request,
}) => {
  const f = await provisionSelection(request);
  const writes: { method: string; body: unknown }[] = [];
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname.startsWith(f.endpoint) &&
      r.method() !== "GET"
    )
      writes.push({
        method: r.method(),
        body: r.postData() ? r.postDataJSON() : null,
      });
  });
  await login(page, f.writer, f.route);
  const s = region(page);
  await expect(
    page.getByText("No Requirement sheet has been created for this Style."),
  ).toBeVisible();
  await expect(
    s.getByText("No materials selected for this Style."),
  ).toBeVisible();
  await shot(page, "01-empty-desktop");
  await choose(page, f);
  await expect(
    s.getByText("Scope: Material + Variant + Listing", { exact: true }),
  ).toBeVisible();
  await shot(page, "02-picker-desktop");
  await shot(page, "03-picker-tablet", 820, 1180);
  await shot(page, "04-picker-mobile", 390, 844);
  await s.getByLabel("Optional Variant").focus();
  await page.keyboard.press("Tab");
  await expect(s.getByLabel("Optional Listing")).toBeFocused();
  await s
    .getByRole("button", { name: "Add Material Selection", exact: true })
    .click();
  await expect(
    s.getByText("Material selection added.", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([{ method: "POST", body: f.input }]);
  let response = await request.get(api + f.endpoint, { headers: f.headers });
  const first = (await response.json()).items[0];
  expect(Object.keys(first).sort()).toEqual(
    [
      "id",
      "styleId",
      "materialId",
      "variantId",
      "listingId",
      "createdAt",
    ].sort(),
  );
  expect(first).toMatchObject(f.input);
  await expect(
    s.getByRole("link", { name: f.material, exact: true }),
  ).toBeVisible();
  await shot(page, "05-selected-desktop");
  const profile = page.getByRole("region", {
    name: "Style profile",
    exact: true,
  });
  await profile
    .getByRole("button", { name: "Archive Style", exact: true })
    .click();
  await expect(
    s.getByText(/read-only while Project or Style is archived/),
  ).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Remove selection", exact: true }),
  ).toHaveCount(0);
  await shot(page, "06-parent-archived-mobile", 390, 844);
  await profile
    .getByRole("button", { name: "Reactivate Style", exact: true })
    .click();
  await expect(
    s.getByRole("button", { name: "Remove selection", exact: true }),
  ).toBeEnabled();
  selectionSql(
    `BEGIN; UPDATE material SET status='ARCHIVED',version=version+1 WHERE id='${f.material}'; UPDATE material_variant SET status='ARCHIVED',version=version+1 WHERE id='${f.variant}'; UPDATE supplier_material_listing SET status='ARCHIVED',version=version+1 WHERE id='${f.listing}'; COMMIT;`,
  );
  await login(page, f.writer, f.route);
  await expect(
    s.getByRole("heading", { name: `${f.name} · ARCHIVED`, exact: true }),
  ).toBeVisible();
  await expect(
    s.getByText("Selection variant · ARCHIVED", { exact: false }),
  ).toBeVisible();
  await expect(
    s.getByText("Selection seller scope · ARCHIVED", { exact: false }),
  ).toBeVisible();
  response = await request.get(api + f.endpoint, { headers: f.headers });
  expect((await response.json()).items).toEqual([first]);
  await shot(page, "07-live-archived-tablet", 820, 1180);
  await s
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  await shot(page, "08-remove-confirm-mobile", 390, 844);
  await s.getByRole("button", { name: "Cancel remove" }).click();
  expect(writes.filter((r) => r.method === "DELETE")).toHaveLength(0);
  await s
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  await s.getByRole("button", { name: "Confirm remove" }).click();
  await expect(
    s.getByText("No materials selected for this Style."),
  ).toBeVisible();
  await expect(
    s.getByText("Material selection removed.", { exact: true }),
  ).toBeVisible();
  expect(writes.filter((r) => r.method === "DELETE")).toHaveLength(1);
  for (const [path, id] of [
    ["materials", f.material],
    ["material-variants", f.variant],
    ["material-listings", f.listing],
  ]) {
    const r = await request.get(`${api}/api/v1/${path}/${id}`, {
      headers: f.headers,
    });
    expect(await r.json()).toMatchObject({ status: "ARCHIVED", version: 1 });
  }
});
test("real duplicate and parent archive conflicts retain picker scope and prohibit automatic retries", async ({
  page,
  request,
}) => {
  const f = await provisionSelection(request);
  await login(page, f.writer, f.route);
  await choose(page, f);
  const s = region(page);
  expect(
    (
      await request.post(api + f.endpoint, {
        headers: f.headers,
        data: f.input,
      })
    ).status(),
  ).toBe(201);
  const statuses: number[] = [];
  page.on("response", (r) => {
    if (
      new URL(r.url()).pathname === f.endpoint &&
      r.request().method() === "POST"
    )
      statuses.push(r.status());
  });
  await s
    .getByRole("button", { name: "Add Material Selection", exact: true })
    .click();
  await expect(
    s.getByText(/This material scope is already selected/),
  ).toBeVisible();
  await expect(s.getByLabel("Optional Variant")).toHaveValue(f.variant);
  await expect(s.getByLabel("Optional Listing")).toHaveValue(f.listing);
  expect(statuses).toEqual([409]);
  await shot(page, "09-duplicate-draft-mobile", 390, 844);
  await s.getByRole("button", { name: "Cancel selection draft" }).click();
  expect(
    (
      await request.put(
        `${api}/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
        {
          headers: f.headers,
          data: {
            name: f.project.name,
            description: f.project.description,
            status: "ARCHIVED",
            version: 0,
          },
        },
      )
    ).status(),
  ).toBe(200);
  await s
    .getByRole("button", { name: "Remove selection", exact: true })
    .click();
  await s.getByRole("button", { name: "Confirm remove" }).click();
  await expect(
    s.getByText(/read-only while Project or Style is archived/),
  ).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Confirm remove" }),
  ).toBeDisabled();
  await expect(
    s.getByRole("link", { name: f.material, exact: true }),
  ).toBeVisible();
  await shot(page, "10-parent-conflict-desktop");
});
test("VIEWER reads selections and PLATFORM_ADMIN alone has no private bypass", async ({
  page,
  request,
}) => {
  const f = await provisionSelection(request);
  expect(
    (
      await request.post(api + f.endpoint, {
        headers: f.headers,
        data: f.input,
      })
    ).status(),
  ).toBe(201);
  await login(page, f.viewer, f.route);
  const s = region(page);
  await expect(
    s.getByRole("link", { name: f.material, exact: true }),
  ).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Choose catalog Material" }),
  ).toHaveCount(0);
  await expect(s.getByRole("button", { name: "Remove selection" })).toHaveCount(
    0,
  );
  await shot(page, "11-viewer-mobile", 390, 844);
  const calls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("/material-selections"))
      calls.push(r.method());
  });
  await page.getByLabel("Local development identity").fill(f.admin);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  await shot(page, "12-denied-mobile", 390, 844);
});
for (const held of ["requirement", "material-selections"] as const)
  test(`real child reads wait for Style while ${held} does not block its sibling`, async ({
    page,
    request,
  }) => {
    const f = await provisionSelection(request);
    let releaseStyle!: () => void,
      styleArrived!: () => void,
      releaseChild!: () => void;
    const styleHold = new Promise<void>((r) => {
        releaseStyle = r;
      }),
      arrived = new Promise<void>((r) => {
        styleArrived = r;
      }),
      childHold = new Promise<void>((r) => {
        releaseChild = r;
      });
    const reads: string[] = [];
    let projectSucceeded = false,
      styleSucceeded = false;
    const eligibility: boolean[] = [];
    page.on("response", (r) => {
      const p = new URL(r.url()).pathname;
      if (
        p === `/api/v1/organizations/${f.a.id}/projects/${f.project.id}` &&
        r.status() === 200
      )
        projectSucceeded = true;
      if (p === `/api/v1${f.route}` && r.status() === 200)
        styleSucceeded = true;
    });
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p === `/api/v1${f.route}`) eligibility.push(projectSucceeded);
      if (p === f.endpoint || p === `/api/v1${f.route}/requirement`) {
        reads.push(p);
        eligibility.push(styleSucceeded);
      }
    });
    await page.route(`**/api/v1${f.route}`, async (route) => {
      const r = await route.fetch();
      styleArrived();
      await styleHold;
      await route.fulfill({ response: r });
    });
    await page.route(`**/api/v1${f.route}/${held}*`, async (route) => {
      const r = await route.fetch();
      await childHold;
      await route.fulfill({ response: r });
    });
    try {
      await login(page, f.writer, f.route);
      await arrived;
      expect(reads).toEqual([]);
      releaseStyle();
      if (held === "requirement")
        await expect(
          region(page).getByText("No materials selected for this Style."),
        ).toBeVisible();
      else
        await expect(
          page.getByText(
            "No Requirement sheet has been created for this Style.",
          ),
        ).toBeVisible();
      expect(reads.sort()).toEqual(
        [f.endpoint, `/api/v1${f.route}/requirement`].sort(),
      );
      expect(eligibility).toEqual([true, true, true]);
    } finally {
      releaseStyle();
      releaseChild();
    }
  });
