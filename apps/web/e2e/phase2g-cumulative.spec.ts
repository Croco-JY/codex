import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionPhaseTwo } from "./phase2g-fixture";
import { selectionSql } from "./selection-fixture";
const api = "http://127.0.0.1:8080",
  children = [
    "requirement",
    "material-selections",
    "facility-candidates",
    "development-references",
  ] as const;
const names = [
  "Style Requirement",
  "Material Selections",
  "Facility Candidates",
  "Development References",
] as const;
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin",
  captures = fileURLToPath(
    new URL(`../../../.local/phase2g-review/${mode}/`, import.meta.url),
  );
const section = (page: Page, n: number) =>
  page.getByRole("region", { name: names[n], exact: true });
async function login(page: Page, subject: string, route: string) {
  await page.goto(route);
  await page.getByLabel("Local development identity").fill(subject);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function all(page: Page) {
  for (const name of names)
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
}
async function shot(page: Page, name: string, width = 1440, height = 1000) {
  await page.setViewportSize({ width, height });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (process.env.SOURCE_OS_VISUAL_REVIEW) {
    mkdirSync(captures, { recursive: true });
    await page.screenshot({ path: `${captures}${name}.png`, fullPage: true });
  }
}
function initialReads(
  page: Page,
  f: Awaited<ReturnType<typeof provisionPhaseTwo>>,
) {
  const reads: string[] = [],
    eligibility: boolean[] = [];
  let project = false,
    style = false;
  page.on("response", (r) => {
    const p = new URL(r.url()).pathname;
    if (
      p === `/api/v1/organizations/${f.a.id}/projects/${f.project.id}` &&
      r.status() === 200
    )
      project = true;
    if (p === f.base && r.status() === 200) style = true;
  });
  page.on("request", (r) => {
    if (r.method() !== "GET") return;
    const p = new URL(r.url()).pathname;
    if (p === f.base) eligibility.push(project);
    if (
      [
        `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
        f.base,
        ...children.map((c) => f.base + "/" + c),
      ].includes(p)
    ) {
      reads.push(p);
      if (children.some((c) => p === f.base + "/" + c)) eligibility.push(style);
    }
  });
  return { reads, eligibility };
}
function exactInitial(
  e: ReturnType<typeof initialReads>,
  f: Awaited<ReturnType<typeof provisionPhaseTwo>>,
) {
  expect(e.reads.slice(0, 2)).toEqual([
    `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
    f.base,
  ]);
  expect(e.reads.slice(2).sort()).toEqual(
    children.map((c) => f.base + "/" + c).sort(),
  );
  expect(e.eligibility).toEqual([true, true, true, true, true]);
}

test("one real Style exposes four populated child workspaces with independent commands and memory-only drafts", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request),
    reads = initialReads(page, f);
  await login(page, f.writer, f.route);
  await all(page);
  await expect(
    section(page, 0).getByLabel("Product type", { exact: true }),
  ).toHaveValue("Synthetic cumulative target");
  await expect(
    section(page, 1).getByText(f.selection.id, { exact: true }),
  ).toBeVisible();
  await expect(
    section(page, 2).getByText(f.candidate.id, { exact: true }),
  ).toBeVisible();
  await expect(
    section(page, 3).getByText(f.reference.id, { exact: true }),
  ).toBeVisible();
  exactInitial(reads, f);
  await shot(page, "01-integrated-desktop");
  await shot(page, "02-integrated-tablet", 820, 1180);
  await shot(page, "03-integrated-mobile", 390, 844);
  await section(page, 0)
    .getByLabel("Product type", { exact: true })
    .fill("Explicit cumulative replacement");
  await section(page, 0)
    .getByRole("button", { name: "Save Requirement", exact: true })
    .click();
  await expect(
    section(page, 0).getByText("Requirement saved.", { exact: true }),
  ).toBeVisible();
  for (const [n, button] of [
    [1, "Remove selection"],
    [2, "Remove candidate"],
  ] as const) {
    await section(page, n)
      .getByRole("button", { name: button, exact: true })
      .click();
    await section(page, n)
      .getByRole("button", { name: "Confirm remove", exact: true })
      .click();
  }
  await expect(
    section(page, 1).getByText("No materials selected for this Style.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    section(page, 2).getByText(
      "No Facility candidates have been added for this Style.",
      { exact: true },
    ),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await section(page, 3)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(f.name);
  expect(readFileSync((await download.path())!)).toEqual(f.bytes);
  const row = section(page, 3)
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: f.name, exact: true }) });
  await row
    .getByRole("button", { name: "Detach reference", exact: true })
    .click();
  await shot(page, "04-detach-confirm-mobile", 390, 844);
  await row
    .getByRole("button", { name: "Confirm detach", exact: true })
    .click();
  await expect(
    row.getByText("DETACHED · Detached", { exact: true }),
  ).toBeVisible();
  const marker = `Synthetic unsent private draft ${f.a.id}`,
    filename = `private-draft-${f.a.id}.bin`;
  await section(page, 0)
    .getByLabel("Requirement notes", { exact: true })
    .fill(marker);
  await section(page, 3)
    .getByLabel("Reference file", { exact: true })
    .setInputFiles({
      name: filename,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(marker),
    });
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  const text = JSON.stringify(storage);
  for (const forbidden of [
    marker,
    filename,
    f.writer,
    f.name,
    "accessToken",
    "Bearer ",
  ])
    expect(text).not.toContain(forbidden);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: f.b.name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: f.pb.name, exact: true }),
  ).toBeVisible();
  await shot(page, "05-projects-desktop");
  await page.getByRole("link", { name: f.pb.name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: f.pb.name, exact: true, level: 1 }),
  ).toBeVisible();
  await shot(page, "06-project-tablet", 768, 1024);
  await page.getByRole("link", { name: f.sb.name, exact: true }).click();
  await all(page);
  await expect(
    section(page, 0).getByLabel("Requirement notes", { exact: true }),
  ).toHaveValue("");
  await expect(
    section(page, 3).getByLabel("Display name", { exact: true }),
  ).toHaveValue("");
});

test("real parent GET succeeds before held Style; all four children wait and then start once", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request),
    e = initialReads(page, f);
  let release!: () => void, arrive!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    arrived = new Promise<void>((r) => (arrive = r));
  const matcher = (u: URL) => u.pathname === f.base,
    handler = async (route: Route) => {
      const response = await route.fetch();
      arrive();
      await held;
      await route.fulfill({ response });
    };
  await page.route(matcher, handler);
  try {
    await login(page, f.writer, f.route);
    await arrived;
    expect(e.reads).toEqual([
      `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
      f.base,
    ]);
    release();
    await all(page);
    await expect(
      section(page, 3).getByText(f.reference.id, { exact: true }),
    ).toBeVisible();
    exactInitial(e, f);
  } finally {
    release();
    await page.unroute(matcher, handler);
  }
});

test("real wrong-Project Style 404 suppresses every private child", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request),
    childrenSeen: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (children.some((c) => p.endsWith("/" + c))) childrenSeen.push(p);
  });
  await login(
    page,
    f.writer,
    `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.sb.id}`,
  );
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true, level: 1 }),
  ).toBeVisible();
  expect(childrenSeen).toEqual([]);
});

test("PLATFORM_ADMIN membership denial sends no private hierarchy or child request", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request),
    reads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/organizations/"))
      reads.push(r.url());
  });
  await login(page, f.admin, f.route);
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true, level: 1 }),
  ).toBeVisible();
  expect(reads).toEqual([]);
  await shot(page, "07-access-denied-mobile", 390, 844);
});

for (const failed of children)
  test(`single real-child ${failed} 500 leaves three real siblings functional`, async ({
    page,
    request,
  }) => {
    const f = await provisionPhaseTwo(request),
      target = f.base + "/" + failed,
      match = (u: URL) => u.pathname === target;
    const handler = (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        headers: { "X-Request-ID": "cumulative-fault" },
        body: JSON.stringify({
          type: "urn:source-os:problem:500",
          title: "Internal Server Error",
          status: 500,
          detail: "Synthetic section unavailable",
          requestId: "cumulative-fault",
        }),
      });
    const responses = new Map<string, number>();
    page.on("response", (r) => {
      if (children.some((c) => new URL(r.url()).pathname === f.base + "/" + c))
        responses.set(new URL(r.url()).pathname, r.status());
    });
    await page.route(match, handler);
    try {
      await login(page, f.writer, f.route);
      await all(page);
      await expect(
        section(page, children.indexOf(failed)).getByRole("heading", {
          name: "Service unavailable",
          exact: true,
        }),
      ).toBeVisible();
      for (let n = 0; n < children.length; n++)
        if (children[n] !== failed) {
          await expect
            .poll(() => responses.get(f.base + "/" + children[n]))
            .toBe(200);
          await expect(
            section(page, n).getByRole("heading", {
              name: "Service unavailable",
              exact: true,
            }),
          ).toHaveCount(0);
        }
      if (failed !== "requirement")
        await expect(
          section(page, 0).getByRole("button", {
            name: "Save Requirement",
            exact: true,
          }),
        ).toBeEnabled();
      if (failed !== "material-selections")
        await expect(
          section(page, 1).getByRole("button", {
            name: "Remove selection",
            exact: true,
          }),
        ).toBeEnabled();
      if (failed !== "facility-candidates")
        await expect(
          section(page, 2).getByRole("button", {
            name: "Remove candidate",
            exact: true,
          }),
        ).toBeEnabled();
      if (failed !== "development-references")
        await expect(
          section(page, 3).getByRole("button", {
            name: "Download reference",
            exact: true,
          }),
        ).toBeEnabled();
    } finally {
      await page.unroute(match, handler);
    }
  });

test("committed membership revocation before current Reference auth denies the entire resolved workspace", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request),
    match = (u: URL) => u.pathname === f.base + "/development-references";
  let release!: () => void, arrive!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    arrived = new Promise<void>((r) => (arrive = r));
  const handler = async (route: Route) => {
    arrive();
    await held;
    const response = await route.fetch();
    expect(response.status()).toBe(403);
    await route.fulfill({ response });
  };
  await page.route(match, handler);
  try {
    await login(page, f.writer, f.route);
    await arrived;
    await expect(
      section(page, 0).getByRole("button", {
        name: "Save Requirement",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      section(page, 1).getByText(f.selection.id, { exact: true }),
    ).toBeVisible();
    await expect(
      section(page, 2).getByText(f.candidate.id, { exact: true }),
    ).toBeVisible();
    selectionSql(
      `UPDATE membership SET status='REVOKED',version=version+1 WHERE organization_id='${f.a.id}' AND subject='${f.writer}';`,
    );
    release();
    await expect(
      page.getByRole("heading", {
        name: "Access denied",
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    for (const name of names)
      await expect(page.getByRole("region", { name, exact: true })).toHaveCount(
        0,
      );
  } finally {
    release();
    await page.unroute(match, handler);
  }
});

test("archived Style and VIEWER retain populated child reads and READY bytes without mutations", async ({
  page,
  request,
}) => {
  const f = await provisionPhaseTwo(request);
  await login(page, f.writer, f.route);
  await all(page);
  await page
    .getByRole("region", { name: "Style profile", exact: true })
    .getByRole("button", { name: "Archive Style", exact: true })
    .click();
  await expect(
    section(page, 3).getByText(/Project or Style is archived/),
  ).toBeVisible();
  await shot(page, "08-archived-tablet", 768, 1024);
  await expect(
    section(page, 3).getByRole("button", {
      name: "Download reference",
      exact: true,
    }),
  ).toBeEnabled();
  const writes: string[] = [];
  await login(page, f.viewer, f.route);
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith(f.base))
      writes.push(r.url());
  });
  await all(page);
  for (const button of [
    "Save Requirement",
    "Remove selection",
    "Remove candidate",
    "Detach reference",
    "Upload reference",
  ])
    await expect(
      page.getByRole("button", { name: button, exact: true }),
    ).toHaveCount(0);
  await expect(
    section(page, 1).getByText(f.selection.id, { exact: true }),
  ).toBeVisible();
  await expect(
    section(page, 2).getByText(f.candidate.id, { exact: true }),
  ).toBeVisible();
  for (const state of [
    "PENDING · Upload not confirmed",
    "FAILED · Upload failed",
    "DETACHED · Detached",
  ])
    await expect(
      section(page, 3).getByText(state, { exact: true }),
    ).toBeVisible();
  await shot(page, "09-viewer-mobile", 390, 844);
  const d = page.waitForEvent("download");
  await section(page, 3)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  expect(readFileSync((await (await d).path())!)).toEqual(f.bytes);
  expect(writes).toEqual([]);
});
