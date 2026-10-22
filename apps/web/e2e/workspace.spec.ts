import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionWorkspace } from "./workspace-fixture";
test.use({ viewport: { width: 1440, height: 1000 } });
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase2b-review/${mode}/`, import.meta.url),
);
const url = (org: string, p?: string, s?: string) =>
  `/organizations/${org}/projects${p ? `/${p}` : ""}${s ? `/styles/${s}` : ""}`;
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
  await page.setViewportSize({ width: 1440, height: 1000 });
}
const profile = (page: Page, kind: string) =>
  page.getByRole("region", { name: `${kind} profile`, exact: true });
test("real writer journey creates Organization Project Style and performs independent metadata/lifecycle commands", async ({
  page,
}) => {
  const actor = `workspace2b-ui-${Date.now()}-${mode}`;
  await login(page, actor, "/organization");
  const orgName = `Product development studio ${Date.now()}`;
  await page.getByLabel("Organization name", { exact: true }).fill(orgName);
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  const select = page.getByRole("button", { name: orgName, exact: true });
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await select.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true, level: 1 }),
  ).toBeVisible();
  const orgId = new URL(page.url()).pathname.split("/")[2];
  await shot(page, "01-projects-desktop");
  await shot(page, "02-projects-mobile", 390, 844);
  await shot(page, "03-projects-tablet", 820, 1180);
  const create = page.getByRole("region", {
    name: "Create Project",
    exact: true,
  });
  await create
    .getByLabel("Name", { exact: true })
    .fill("Long development Project for reusable seasonal product identity");
  await create
    .getByLabel("Description (optional)")
    .fill("Private product development reference text.");
  await create
    .getByRole("button", { name: "Create Project", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open created Project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Long development Project for reusable seasonal product identity",
      exact: true,
    }),
  ).toBeVisible();
  const projectId = new URL(page.url()).pathname.split("/")[4];
  await shot(page, "04-project-detail");
  const pf = profile(page, "Project");
  await pf
    .getByLabel("Name", { exact: true })
    .fill("Updated development Project");
  await pf.getByRole("button", { name: "Save Project metadata" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Updated development Project",
      exact: true,
    }),
  ).toBeVisible();
  const styles = page.getByRole("region", {
    name: "Create Style",
    exact: true,
  });
  await styles
    .getByLabel("Name", { exact: true })
    .fill(
      "Long tailored Style design identity for a future development workflow",
    );
  await styles.getByLabel("Style code (optional)").fill("Case-Keep");
  await styles
    .getByRole("button", { name: "Create Style", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Open created Style", exact: true })
    .click();
  const sf = profile(page, "Style");
  await expect(sf.getByLabel("Style code (optional)")).toHaveValue("Case-Keep");
  await sf
    .getByLabel("Description (optional)")
    .fill("Private Style notes that must wrap on a small screen.");
  await sf.getByRole("button", { name: "Save Style metadata" }).click();
  await expect(sf.getByText("Style saved.", { exact: true })).toBeVisible();
  await shot(page, "05-style-desktop");
  await shot(page, "06-style-mobile", 390, 844);
  await sf.getByRole("button", { name: "Archive Style", exact: true }).click();
  await expect(sf.getByLabel("Name", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await shot(page, "07-archived-style-mobile", 390, 844);
  await sf
    .getByRole("button", { name: "Reactivate Style", exact: true })
    .click();
  await expect(sf.getByLabel("Name", { exact: true })).not.toHaveAttribute(
    "readonly",
  );
  await page
    .getByRole("link", { name: "Updated development Project", exact: true })
    .click();
  await pf
    .getByRole("button", { name: "Archive Project", exact: true })
    .click();
  await expect(page.getByText(/This project is archived/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Create Style", exact: true }),
  ).toHaveCount(0);
  await shot(page, "08-archived-project");
  await page
    .getByRole("link", {
      name: "Long tailored Style design identity for a future development workflow",
      exact: true,
    })
    .click();
  await expect(page.getByText(/The parent Project is archived/)).toBeVisible();
  await expect(sf.getByRole("button", { name: "Archive Style" })).toHaveCount(
    0,
  );
  await page
    .getByRole("link", { name: "Updated development Project", exact: true })
    .click();
  await pf
    .getByRole("button", { name: "Reactivate Project", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Create Style", exact: true }),
  ).toBeVisible();
  expect(page.url()).toContain(url(orgId, projectId));
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain("Private Style");
});
test("VIEWER direct nested URL is read-only; PLATFORM_ADMIN without membership has no private bypass", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request);
  const privateReads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/organizations/"))
      privateReads.push(r.url());
  });
  await login(page, f.viewer, url(f.a.id, f.project.id, f.style.id));
  await expect(
    page.getByRole("heading", { name: f.style.name, exact: true }),
  ).toBeVisible();
  await expect(profile(page, "Style").getByRole("button")).toHaveCount(0);
  await shot(page, "09-viewer-mobile", 390, 844);
  await login(page, f.admin, url(f.a.id, f.project.id));
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  expect(privateReads).toHaveLength(2);
  await shot(page, "10-access-denied-mobile", 390, 844);
});
test("Organization A→B→A aborts a delayed real read and never renders old-generation data", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  const pattern = `**/api/v1/organizations/${f.a.id}/projects?*`;
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    entered();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await login(page, f.writer, url(f.a.id));
  await started;
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: f.b.name, exact: true }).click();
  await expect(
    page.getByRole("link", { name: f.pb.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: f.project.name, exact: true }),
  ).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: f.a.name, exact: true }).click();
  await expect(
    page.getByRole("link", { name: f.project.name, exact: true }),
  ).toBeVisible();
  release();
  await expect(page.locator(".topbar")).toContainText(f.a.name);
  await expect(
    page.getByRole("link", { name: f.pb.name, exact: true }),
  ).toHaveCount(0);
});
test("authorized deep link adopts B display and retains nested B route after selecting A", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request);
  await login(page, f.writer, url(f.a.id));
  await expect(
    page.getByRole("link", { name: f.project.name, exact: true }),
  ).toBeVisible();
  // Browser history navigation keeps the SPA and its selected A state alive.
  await page.evaluate(
    (path) => {
      history.pushState(null, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    },
    url(f.b.id, f.pb.id, f.sb.id),
  );
  await expect(
    page.getByRole("heading", { name: f.sb.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".topbar")).toContainText(f.b.name);
  await expect(page).toHaveURL(new RegExp(url(f.b.id, f.pb.id, f.sb.id) + "$"));
  await expect(
    page.getByRole("link", { name: "Projects", exact: true }),
  ).toHaveAttribute("href", url(f.b.id));
});
test("real stale metadata/lifecycle and concurrent parent archive require explicit reconciliation", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request),
    path = `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`;
  await login(page, f.writer, url(f.a.id, f.project.id));
  const pf = profile(page, "Project");
  await pf.getByLabel("Name", { exact: true }).fill("Preserved metadata draft");
  const update = await request.put(`http://127.0.0.1:8080${path}`, {
    headers: f.headers,
    data: {
      name: "Server renamed Project",
      description: null,
      status: "ACTIVE",
      version: 0,
    },
  });
  expect(update.status()).toBe(200);
  await pf.getByRole("button", { name: "Save Project metadata" }).click();
  const comparison = page.getByRole("alert", { name: "Metadata conflict" });
  await expect(comparison).toBeVisible();
  await expect(comparison).toContainText("Server renamed Project");
  await expect(pf.getByLabel("Name", { exact: true })).toHaveValue(
    "Preserved metadata draft",
  );
  await expect(pf.getByText(/Request reference:/)).toBeVisible();
  await shot(page, "11-metadata-conflict-mobile", 390, 844);
  await pf.getByRole("button", { name: "Reconcile draft with latest" }).click();
  await pf.getByRole("button", { name: "Save Project metadata" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Preserved metadata draft",
      exact: true,
    }),
  ).toBeVisible();
  const external = await request.put(`http://127.0.0.1:8080${path}`, {
    headers: f.headers,
    data: {
      name: "Preserved metadata draft",
      description: null,
      status: "ACTIVE",
      version: 2,
    },
  });
  expect(external.status()).toBe(200);
  await pf
    .getByRole("button", { name: "Archive Project", exact: true })
    .click();
  await expect(page.getByText(/The lifecycle command conflicts/)).toBeVisible();
  await expect(comparison).toHaveCount(0);
  await shot(page, "12-lifecycle-conflict");
  await page.getByRole("link", { name: f.style.name, exact: true }).click();
  const sf = profile(page, "Style");
  await sf
    .getByLabel("Name", { exact: true })
    .fill("Draft blocked by archived parent");
  const archived = await request.put(`http://127.0.0.1:8080${path}`, {
    headers: f.headers,
    data: {
      name: "Preserved metadata draft",
      description: null,
      status: "ARCHIVED",
      version: 3,
    },
  });
  expect(archived.status()).toBe(200);
  await sf.getByRole("button", { name: "Save Style metadata" }).click();
  await expect(page.getByText(/The parent Project is archived/)).toBeVisible();
  await expect(sf.getByLabel("Name", { exact: true })).toHaveValue(
    "Draft blocked by archived parent",
  );
  await expect(
    sf.getByRole("button", { name: "Save Style metadata" }),
  ).toHaveCount(0);
  await shot(page, "13-parent-archived-conflict");
});

test("scoped wrong-Organization Project and wrong-Project Style show 404 without foreign labels", async ({
  page,
  request,
}) => {
  const f = await provisionWorkspace(request);
  await login(page, f.writer, url(f.b.id, f.project.id));
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(f.project.name, { exact: true })).toHaveCount(0);
  await login(page, f.writer, url(f.b.id, f.pb.id, f.style.id));
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(f.style.name, { exact: true })).toHaveCount(0);
});
