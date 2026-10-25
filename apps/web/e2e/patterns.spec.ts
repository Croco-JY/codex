import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type Route,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionWorkspace } from "./workspace-fixture";
const api = "http://127.0.0.1:8080",
  mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const captureRoot = fileURLToPath(
  new URL(`../../../.local/phase3b-review/${mode}/`, import.meta.url),
);
const body = {
  name: "Main Pattern",
  purpose: "Synthetic pattern purpose",
  measurementRevisionId: null,
};
async function fixture(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    styleRoute = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return {
    ...f,
    styleRoute,
    route: styleRoute + "/patterns",
    endpoint: "/api/v1" + styleRoute + "/patterns",
    measurement: "/api/v1" + styleRoute + "/measurement-spec",
  };
}
async function login(page: Page, who: string, url: string) {
  await page.goto(url);
  await page.getByLabel("Local development identity").fill(who);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function create(
  request: APIRequestContext,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const r = await request.post(api + f.endpoint, {
    headers: f.headers,
    data: body,
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function capture(page: Page, name: string) {
  for (const width of [1440, 820, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.SOURCE_OS_VISUAL_REVIEW) {
      mkdirSync(captureRoot, { recursive: true });
      await page.screenshot({
        path: captureRoot + name + "-" + width + ".png",
        fullPage: true,
      });
    }
  }
}
function reads(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  const rows: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      rows.push(r.url());
  });
  return rows;
}
test("real lazy Pattern vault, immutable revisions and Measurement pin, history and lifecycle", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    seen = reads(page, f),
    measurementReads: string[] = [],
    writes: string[] = [],
    forbidden: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith(f.measurement) && r.method() === "GET")
      measurementReads.push(r.url());
    if (p.startsWith(f.endpoint) && r.method() !== "GET") writes.push(r.url());
    if (p.includes("/patterns") && /artifact|content|storage|upload/.test(p))
      forbidden.push(p);
  });
  const mbody = {
    baseSize: "M",
    unitSystem: "CM",
    points: [{ code: "CHEST", label: "Chest", value: "50.0000" }],
  };
  const m1 = await request.put(api + f.measurement, {
    headers: { ...f.headers, "If-None-Match": "*" },
    data: mbody,
  });
  expect(m1.status()).toBe(201);
  const m = await m1.json();
  const m2 = await request.post(api + f.measurement + "/revisions", {
    headers: f.headers,
    data: { ...mbody, expectedLatestRevisionNumber: 1 },
  });
  expect(m2.status()).toBe(201);
  await login(page, f.writer, f.styleRoute);
  for (const name of [
    "Style Requirement",
    "Material Selections",
    "Facility Candidates",
    "Development References",
  ])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  expect(seen).toEqual([]);
  expect(measurementReads).toEqual([]);
  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await expect(page.getByText("No Patterns in this page.")).toBeVisible();
  expect(seen.map((u) => new URL(u).pathname)).toEqual([f.endpoint]);
  expect(measurementReads).toHaveLength(0);
  await capture(page, "01-empty");
  await page
    .getByRole("button", { name: "Create Pattern", exact: true })
    .click();
  const privateDraft = "Synthetic private Pattern " + f.style.id;
  await page.getByLabel("Pattern name", { exact: true }).fill("Main Pattern");
  await page.getByLabel("Pattern purpose", { exact: true }).fill(privateDraft);
  await page.getByLabel("Pattern name", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Pattern purpose", { exact: true }),
  ).toBeFocused();
  expect(measurementReads).toHaveLength(0);
  await capture(page, "02-create-draft");
  const createdResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(f.endpoint),
  );
  await page
    .getByRole("button", { name: "Save new Pattern", exact: true })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const p = await created.json();
  expect(p.version).toBe(0);
  expect(p.latestRevision.revisionNumber).toBe(1);
  expect(p.latestRevision.measurementRevisionId).toBeNull();
  expect(p.latestRevision).not.toHaveProperty("createdBySubject");
  await expect(
    page.getByRole("link", { name: "Main Pattern", exact: true }),
  ).toBeVisible();
  seen.length = 0;
  await page.getByRole("link", { name: "Main Pattern", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Pattern revision 1", exact: true }),
  ).toBeVisible();
  expect(seen.map((u) => new URL(u).pathname)).toEqual([
    f.endpoint + "/" + p.id,
    f.endpoint + "/" + p.id + "/revisions",
  ]);
  expect(new URL(seen[1]).searchParams.get("maxRevisionNumber")).toBe("1");
  expect(measurementReads).toHaveLength(0);
  await page
    .getByRole("button", { name: "Create new Pattern revision", exact: true })
    .click();
  await page
    .getByLabel("Pattern name", { exact: true })
    .fill("Revised Main Pattern");
  await page
    .getByRole("button", { name: "Pin measurement revision", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Use Measurement revision 1",
      exact: true,
    }),
  ).toBeVisible();
  expect(measurementReads.map((u) => new URL(u).pathname)).toEqual([
    f.measurement,
    f.measurement + "/revisions",
  ]);
  expect(
    new URL(measurementReads[1]).searchParams.get("maxRevisionNumber"),
  ).toBe("2");
  await capture(page, "03-measurement-picker");
  await page
    .getByRole("button", { name: "Use Measurement revision 1", exact: true })
    .click();
  const revisedResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(f.endpoint + "/" + p.id + "/revisions"),
  );
  await page
    .getByRole("button", { name: "Create Pattern revision", exact: true })
    .click();
  const revised = await revisedResponse;
  expect(revised.status()).toBe(201);
  const r2 = await revised.json();
  expect(r2.measurementRevisionId).toBe(m.latestRevision.id);
  expect(r2.revisionNumber).toBe(2);
  await expect(
    page.getByRole("button", { name: "Open Pattern revision 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Pattern revision 1", exact: true }),
  ).toBeVisible();
  await capture(page, "04-history");
  await page
    .getByRole("button", { name: "Open Pattern revision 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Selected Pattern revision 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Selected Pattern revision 1",
      exact: true,
    }),
  ).toContainText("No Measurement pin");
  await capture(page, "05-historical-detail");
  expect(measurementReads).toHaveLength(2);
  await page
    .getByRole("button", { name: "Archive Pattern", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(p.id);
  await capture(page, "06-archive-confirmation");
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reactivate Pattern", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create new Pattern revision",
      exact: true,
    }),
  ).toHaveCount(0);
  await capture(page, "07-archived-pattern");
  await page
    .getByRole("button", { name: "Reactivate Pattern", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm reactivation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Archive Pattern", exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(4);
  expect(forbidden).toEqual([]);
  const stored = await page.evaluate(async () => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    databases: await indexedDB.databases(),
    url: location.href,
  }));
  expect(JSON.stringify(stored)).not.toContain(privateDraft);
  expect(stored.databases).toEqual([]);
  const final = await request.get(api + f.endpoint + "/" + p.id, {
    headers: f.headers,
  });
  expect(final.status()).toBe(200);
  const saved = await final.json();
  expect(saved.version).toBe(2);
  expect(saved.latestRevision.id).toBe(r2.id);
});
test("real stale revision head retains draft until explicit reconciliation, no automatic retry", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    p = await create(request, f);
  let posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      r.url().endsWith(f.endpoint + "/" + p.id + "/revisions")
    )
      posts++;
  });
  await login(page, f.writer, f.route + "/" + p.id);
  await page
    .getByRole("button", { name: "Create new Pattern revision", exact: true })
    .click();
  await page
    .getByLabel("Pattern name", { exact: true })
    .fill("Unsaved conflicting Pattern");
  const other = await request.post(
    api + f.endpoint + "/" + p.id + "/revisions",
    {
      headers: f.headers,
      data: {
        ...body,
        name: "Authoritative other Pattern",
        expectedLatestRevisionNumber: 1,
      },
    },
  );
  expect(other.status()).toBe(201);
  const failed = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(f.endpoint + "/" + p.id + "/revisions"),
  );
  await page
    .getByRole("button", { name: "Create Pattern revision", exact: true })
    .click();
  expect((await failed).status()).toBe(409);
  await expect(
    page.getByText("Draft baseline revision: 1. Current latest: 2."),
  ).toBeVisible();
  await expect(page.getByLabel("Pattern name", { exact: true })).toHaveValue(
    "Unsaved conflicting Pattern",
  );
  expect(posts).toBe(1);
  await capture(page, "08-stale-conflict");
  await page
    .getByRole("button", { name: "Reconcile Pattern draft", exact: true })
    .click();
  expect(posts).toBe(1);
  await expect(
    page.getByText("Draft baseline revision: 2. Current latest: 2."),
  ).toBeVisible();
});
test("VIEWER reads Pattern/history and cannot mutate", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    p = await create(request, f);
  await login(page, f.viewer, f.route + "/" + p.id);
  await expect(
    page.getByRole("heading", {
      name: "Latest Pattern revision 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Your VIEWER membership provides read-only Pattern access."),
  ).toBeVisible();
  for (const name of [
    "Archive Pattern",
    "Reactivate Pattern",
    "Create new Pattern revision",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await capture(page, "09-viewer");
});
for (const parent of ["project", "style"] as const)
  test(`archived ${parent} permits Pattern history and blocks writes`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request),
      p = await create(request, f),
      target = parent === "project" ? f.project : f.style;
    const r = await request.put(
      api +
        "/api/v1" +
        (parent === "project"
          ? f.styleRoute.split("/styles")[0]
          : f.styleRoute),
      {
        headers: f.headers,
        data: {
          name: target.name,
          description: target.description,
          status: "ARCHIVED",
          version: target.version,
          ...(parent === "style" ? { styleCode: f.style.styleCode } : {}),
        },
      },
    );
    expect(r.status()).toBe(200);
    await login(page, f.writer, f.route + "/" + p.id);
    await expect(
      page.getByText(
        "Patterns are read-only while the Project or Style is archived.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Open Pattern revision 1",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Archive Pattern", exact: true }),
    ).toHaveCount(0);
    if (parent === "style") await capture(page, "10-archived-parent");
  });
for (const parent of ["project", "style"] as const)
  test(`real held ${parent} gates Pattern collection`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request),
      seen = reads(page, f);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const target =
      "/api/v1" +
      (parent === "project" ? f.styleRoute.split("/styles")[0] : f.styleRoute);
    const handler = async (route: Route) => {
      const r = await route.fetch();
      await gate;
      await route.fulfill({ response: r });
    };
    await page.route((u) => u.pathname === target, handler);
    try {
      await login(page, f.writer, f.route);
      await expect(
        page.getByRole("status", {
          name:
            parent === "project" ? "Loading parent Project" : "Loading Style",
          exact: true,
        }),
      ).toBeVisible();
      expect(seen).toEqual([]);
      release();
      await expect(
        page.getByRole("heading", { name: "Pattern families", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("No Patterns in this page.")).toBeVisible();
      expect(seen.map((u) => new URL(u).pathname)).toEqual([f.endpoint]);
    } finally {
      release();
      await page.unroute((u) => u.pathname === target, handler);
    }
  });
test("wrong Pattern suppresses history and PLATFORM_ADMIN membership cannot bypass tenant", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    seen = reads(page, f);
  await login(
    page,
    f.writer,
    f.route + "/00000000-0000-4000-8000-000000000099",
  );
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true }),
  ).toBeVisible();
  expect(seen).toHaveLength(1);
  expect(seen[0]).not.toContain("/revisions");
  await page.getByLabel("Local development identity").fill(f.admin);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  expect(seen).toHaveLength(1);
});
