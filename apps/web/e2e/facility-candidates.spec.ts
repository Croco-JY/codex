import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionCandidate, candidateSql } from "./candidate-fixture";
const api = "http://127.0.0.1:8080",
  mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase2e-review/${mode}/`, import.meta.url),
);
const region = (page: Page) =>
  page.getByRole("region", { name: "Facility Candidates", exact: true });
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
  f: Awaited<ReturnType<typeof provisionCandidate>>,
) {
  const s = region(page);
  await s.getByRole("button", { name: "Choose Facility", exact: true }).click();
  const filters = s.getByRole("region", {
    name: "Facility filters",
    exact: true,
  });
  await filters.locator("details").evaluate((e: HTMLDetailsElement) => {
    e.open = true;
    e.dispatchEvent(new Event("toggle"));
  });
  await filters.getByLabel("Country", { exact: true }).selectOption("KR");
  await filters.getByLabel("Country", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    filters.getByLabel("Facility type", { exact: true }),
  ).toBeFocused();
  await filters
    .getByLabel("Facility type", { exact: true })
    .selectOption("FACTORY");
  await filters.getByRole("button", { name: "Apply", exact: true }).click();
  await s
    .getByRole("button", { name: `Choose ${f.name}`, exact: true })
    .click();
  await expect(
    s.getByRole("button", { name: "Add Facility Candidate", exact: true }),
  ).toBeEnabled();
}
test("real Candidate discovery, Facility-only registration, retained Supplier/Facility archives and private unlink", async ({
  page,
  request,
}) => {
  const f = await provisionCandidate(request);
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
    s.getByText("No Facility candidates have been added for this Style."),
  ).toBeVisible();
  await shot(page, "01-empty-desktop");
  await choose(page, f);
  await shot(page, "02-picker-desktop");
  await shot(page, "03-picker-tablet", 820, 1180);
  await shot(page, "04-picker-mobile", 390, 844);
  // Supplier can archive after discoverability, without changing Facility eligibility.
  candidateSql(
    `UPDATE supplier_profile SET status='ARCHIVED',version=version+1 WHERE id='${f.supplier}'`,
  );
  await s.getByRole("button", { name: "Refresh chosen Facility" }).click();
  await expect(s.getByText(/ARCHIVED · DISCOVERED/)).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Add Facility Candidate", exact: true }),
  ).toBeEnabled();
  await shot(page, "05-supplier-archived-tablet", 820, 1180);
  await s
    .getByRole("button", { name: "Add Facility Candidate", exact: true })
    .click();
  await expect(
    s.getByText("Facility candidate added.", { exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([{ method: "POST", body: f.input }]);
  const before = (
    await (await request.get(api + f.endpoint, { headers: f.headers })).json()
  ).items[0];
  expect(Object.keys(before).sort()).toEqual(
    ["id", "styleId", "facilityId", "createdAt"].sort(),
  );
  expect(before.facilityId).toBe(f.facility);
  await shot(page, "06-list-desktop");
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
    s.getByRole("button", { name: "Remove candidate", exact: true }),
  ).toHaveCount(0);
  await shot(page, "07-parent-archived-mobile", 390, 844);
  await profile
    .getByRole("button", { name: "Reactivate Style", exact: true })
    .click();
  await expect(
    s.getByRole("button", { name: "Remove candidate", exact: true }),
  ).toBeEnabled();
  candidateSql(
    `UPDATE facility SET status='ARCHIVED',version=version+1 WHERE id='${f.facility}'`,
  );
  await login(page, f.writer, f.route);
  await expect(
    s.getByRole("heading", {
      name: `${f.name} · FACTORY · ARCHIVED`,
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get(api + f.endpoint, { headers: f.headers })).json())
      .items,
  ).toEqual([before]);
  await shot(page, "08-facility-archived-desktop");
  await s
    .getByRole("button", { name: "Remove candidate", exact: true })
    .click();
  await shot(page, "09-confirm-remove-mobile", 390, 844);
  await s.getByRole("button", { name: "Cancel remove" }).click();
  expect(writes.filter((r) => r.method === "DELETE")).toHaveLength(0);
  await s
    .getByRole("button", { name: "Remove candidate", exact: true })
    .click();
  await s.getByRole("button", { name: "Confirm remove", exact: true }).click();
  await expect(
    s.getByText("No Facility candidates have been added for this Style."),
  ).toBeVisible();
  expect(writes.filter((r) => r.method === "DELETE")).toHaveLength(1);
  for (const [kind, id] of [
    ["facilities", f.facility],
    ["suppliers", f.supplier],
  ])
    expect(
      await (
        await request.get(`${api}/api/v1/${kind}/${id}`, { headers: f.headers })
      ).json(),
    ).toMatchObject({ status: "ARCHIVED", version: 1 });
});
test("real duplicate and parent conflicts preserve Candidate draft and require explicit commands", async ({
  page,
  request,
}) => {
  const f = await provisionCandidate(request);
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
    .getByRole("button", { name: "Add Facility Candidate", exact: true })
    .click();
  await expect(s.getByText(/Your Facility draft is retained/)).toBeVisible();
  await expect(
    s.getByText(/This Facility is already a candidate/),
  ).toBeVisible();
  await expect(
    s.getByText(`Chosen Facility: ${f.facility}`, { exact: true }),
  ).toBeVisible();
  expect(statuses).toEqual([409]);
  await shot(page, "10-duplicate-mobile", 390, 844);
  await s.getByRole("button", { name: "Cancel Facility draft" }).click();
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
    .getByRole("button", { name: "Remove candidate", exact: true })
    .click();
  await s.getByRole("button", { name: "Confirm remove", exact: true }).click();
  await expect(
    s.getByText(/read-only while Project or Style is archived/),
  ).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Confirm remove", exact: true }),
  ).toBeDisabled();
  await shot(page, "11-parent-conflict-desktop");
});
test("VIEWER reads all Style sections and PLATFORM_ADMIN alone cannot enter private Candidates", async ({
  page,
  request,
}) => {
  const f = await provisionCandidate(request);
  expect(
    (
      await request.post(api + f.endpoint, {
        headers: f.headers,
        data: f.input,
      })
    ).status(),
  ).toBe(201);
  const mutations: string[] = [];
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname.startsWith(f.endpoint) &&
      r.method() !== "GET"
    )
      mutations.push(r.method());
  });
  await login(page, f.viewer, f.route);
  const s = region(page);
  await expect(
    s.getByRole("link", { name: f.facility, exact: true }),
  ).toBeVisible();
  for (const name of [
    "Style Requirement",
    "Material Selections",
    "Facility Candidates",
  ])
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  await expect(
    s.getByRole("button", { name: "Remove candidate", exact: true }),
  ).toHaveCount(0);
  await expect(
    s.getByRole("button", { name: "Choose Facility", exact: true }),
  ).toHaveCount(0);
  expect(mutations).toEqual([]);
  await shot(page, "12-viewer-mobile", 390, 844);
  const reads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith(f.endpoint)) reads.push(r.url());
  });
  await login(page, f.admin, f.route);
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  expect(reads).toEqual([]);
  await shot(page, "13-denied-mobile", 390, 844);
});
for (const failure of ["Facility", "Supplier"] as const)
  test(`real retained edge with unavailable ${failure} keeps IDs and controls dependent hydration`, async ({
    page,
    request,
  }) => {
    const f = await provisionCandidate(request);
    expect(
      (
        await request.post(api + f.endpoint, {
          headers: f.headers,
          data: f.input,
        })
      ).status(),
    ).toBe(201);
    const supplierReads: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === `/api/v1/suppliers/${f.supplier}`)
        supplierReads.push(r.url());
    });
    await page.route(
      `**/api/v1/${failure === "Facility" ? "facilities/" + f.facility : "suppliers/" + f.supplier}`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({ status: 503 }),
        }),
    );
    await login(page, f.writer, f.route);
    const s = region(page);
    await expect(
      s.getByText(
        failure === "Facility"
          ? "Facility label unavailable"
          : "Supplier label/status unavailable",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      s.getByRole("link", { name: f.facility, exact: true }),
    ).toBeVisible();
    expect(supplierReads).toHaveLength(failure === "Facility" ? 0 : 1);
    await shot(
      page,
      failure === "Facility"
        ? "14-facility-unavailable-desktop"
        : "15-supplier-unavailable-mobile",
      failure === "Facility" ? 1440 : 390,
      failure === "Facility" ? 1000 : 844,
    );
  });
for (const held of [
  "requirement",
  "material-selections",
  "facility-candidates",
] as const)
  test(`real Style-gated siblings stay independent while ${held} is held`, async ({
    page,
    request,
  }) => {
    const f = await provisionCandidate(request);
    let releaseStyle!: () => void,
      arrivedStyle!: () => void,
      releaseChild!: () => void;
    const styleHold = new Promise<void>((r) => {
        releaseStyle = r;
      }),
      arrived = new Promise<void>((r) => {
        arrivedStyle = r;
      }),
      childHold = new Promise<void>((r) => {
        releaseChild = r;
      });
    const reads: string[] = [],
      eligibility: boolean[] = [];
    let projectSucceeded = false,
      styleSucceeded = false;
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
      if (
        ["requirement", "material-selections", "facility-candidates"].some(
          (child) => p === `/api/v1${f.route}/${child}`,
        )
      ) {
        reads.push(p);
        eligibility.push(styleSucceeded);
      }
    });
    await page.route(`**/api/v1${f.route}`, async (route) => {
      const r = await route.fetch();
      arrivedStyle();
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
      if (held !== "requirement")
        await expect(
          page.getByText(
            "No Requirement sheet has been created for this Style.",
          ),
        ).toBeVisible();
      if (held !== "material-selections")
        await expect(
          page.getByText("No materials selected for this Style."),
        ).toBeVisible();
      if (held !== "facility-candidates")
        await expect(
          region(page).getByText(
            "No Facility candidates have been added for this Style.",
          ),
        ).toBeVisible();
      expect(reads.sort()).toEqual(
        ["requirement", "material-selections", "facility-candidates"]
          .map((child) => `/api/v1${f.route}/${child}`)
          .sort(),
      );
      expect(eligibility).toEqual([true, true, true, true]);
    } finally {
      releaseStyle();
      releaseChild();
    }
  });
