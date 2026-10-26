import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { provisionWorkspace } from "./workspace-fixture";

const api = "http://127.0.0.1:8080";
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const captures = fileURLToPath(
  new URL(`../../../.local/phase3d-review/${mode}/`, import.meta.url),
);
async function setup(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    styleRoute = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return {
    ...f,
    styleRoute,
    listRoute: styleRoute + "/grading",
    endpoint: "/api/v1" + styleRoute + "/grade-rule-sets",
  };
}
type F = Awaited<ReturnType<typeof setup>>;
function snapshot(sizes = 3, rules = 2) {
  const range = Array.from({ length: sizes }, (_, i) => ({
    code: "S" + i,
    label: "Size " + i,
  }));
  return {
    name: "Browser grading",
    baseSizeCode: "S1",
    unitSystem: "CM",
    notes: null,
    sizes: range,
    rules: Array.from({ length: rules }, (_, i) => ({
      code: "R" + i,
      label: "Rule " + i,
      notes: null,
      values: range.map((s, j) => ({
        sizeCode: s.code,
        delta: j === 1 ? "-0.0000" : "-2.5000",
      })),
    })),
  };
}
async function create(request: APIRequestContext, f: F, sizes = 3, rules = 2) {
  const r = await request.post(api + f.endpoint, {
    headers: f.headers,
    data: snapshot(sizes, rules),
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function login(page: Page, f: F, path = f.listRoute, subject = f.writer) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(subject);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
const ready = (page: Page, n = 1) =>
  expect(
    page.getByRole("heading", {
      name: `Latest grading revision ${n}`,
      exact: true,
    }),
  ).toBeVisible();
async function capture(page: Page, name: string) {
  for (const width of [1440, 820, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.SOURCE_OS_VISUAL_REVIEW) {
      mkdirSync(captures, { recursive: true });
      await page.screenshot({ path: captures + name + "-" + width + ".png" });
    }
  }
}
function privateTraffic(page: Page) {
  const calls: {
    path: string;
    origin: string;
    method: string;
    bytes: number;
  }[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/v1/"))
      calls.push({
        path,
        origin: new URL(r.url()).origin,
        method: r.method(),
        bytes: Buffer.byteLength(r.postData() ?? ""),
      });
  });
  return calls;
}
function noForeignDomains(calls: ReturnType<typeof privateTraffic>) {
  expect([...new Set(calls.map((c) => c.origin))]).toEqual([
    new URL(process.env.VITE_API_BASE_URL || "http://127.0.0.1:5173").origin,
  ]);
  expect(
    calls.filter((c) =>
      /\/patterns(?:\/|$)|\/measurement-spec(?:\/|$)|\/artifact(?:\/|$)/.test(
        c.path,
      ),
    ),
  ).toHaveLength(0);
}
for (const kind of ["revision-number", "size-count", "valid"] as const) {
  test(`historical summary consistency: ${kind}`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      g = await create(request, f);
    const endpoint = f.endpoint + "/" + g.id;
    const next = await request.post(api + endpoint + "/revisions", {
      headers: f.headers,
      data: { ...snapshot(), expectedLatestRevisionNumber: 1 },
    });
    expect(next.status()).toBe(201);
    const calls = privateTraffic(page);
    let intercepted = 0;
    await page.route(
      "**" + endpoint + "/revisions/" + g.latestRevision.id,
      async (route) => {
        const actual = await route.fetch();
        expect(actual.status()).toBe(200);
        const body = await actual.json();
        expect(body.id).toBe(g.latestRevision.id);
        expect(body.revisionNumber).toBe(1);
        if (kind === "revision-number") body.revisionNumber = 999;
        if (kind === "size-count") {
          body.sizes.pop();
          for (const rule of body.rules) rule.values.pop();
        }
        intercepted++;
        await route.fulfill({ response: actual, json: body });
      },
    );
    await login(page, f, f.listRoute + "/" + g.id);
    await ready(page, 2);
    await page
      .getByRole("button", { name: "Open grading revision 1", exact: true })
      .click();
    if (kind === "valid") {
      await expect(
        page.getByRole("region", {
          name: "Historical grading revision 1 matrix",
          exact: true,
        }),
      ).toContainText("-2.5000");
      await expect(
        page.getByRole("heading", { name: "Service unavailable", exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(
        page.getByRole("heading", { name: "Service unavailable", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", {
          name: /Historical grading revision .* matrix/,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", {
          name: "Historical grading revision 999",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    expect(intercepted).toBe(1);
    expect(calls.filter((c) => c.path === endpoint)).toHaveLength(1);
    expect(
      calls.filter((c) => c.path === endpoint + "/revisions"),
    ).toHaveLength(1);
    expect(calls.filter((c) => /\/revisions\//.test(c.path))).toHaveLength(1);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    noForeignDomains(calls);
  });
}
test("StyleDetail grading0, list1, detail1/history1 and immutable revisions/lifecycle", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = privateTraffic(page);
  await login(page, f, f.styleRoute);
  await expect(
    page.getByRole("link", { name: "Grading", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        calls.filter((c) =>
          /requirement|material-selections|facility-candidates|development-references/.test(
            c.path,
          ),
        ).length,
    )
    .toBe(4);
  expect(calls.filter((c) => c.path.includes("/grade-rule-sets"))).toHaveLength(
    0,
  );
  await page.getByRole("link", { name: "Grading", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Grade rule sets" }),
  ).toBeVisible();
  await expect
    .poll(() => calls.filter((c) => c.path.includes("/grade-rule-sets")).length)
    .toBe(1);
  await capture(page, "empty");
  const g = await create(request, f);
  await login(page, f, f.listRoute + "/" + g.id);
  await ready(page);
  await capture(page, "latest");
  const initial = calls.filter((c) =>
    c.path.startsWith(f.endpoint + "/" + g.id),
  );
  await expect
    .poll(
      () =>
        calls.filter((c) => c.path === f.endpoint + "/" + g.id + "/revisions")
          .length,
    )
    .toBe(1);
  expect(calls.filter((c) => c.path === f.endpoint + "/" + g.id)).toHaveLength(
    1,
  );
  expect(
    calls.filter((c) => /\/revisions\/[0-9a-f-]+$/.test(c.path)),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await page
    .getByLabel("Grading name", { exact: true })
    .fill("Browser revision two");
  await page.getByLabel("Delta rule 1 size 1", { exact: true }).fill("-3.1250");
  await capture(page, "editor");
  await page
    .getByRole("button", { name: "Save grading revision", exact: true })
    .click();
  await ready(page, 2);
  await page
    .getByRole("button", { name: "Open grading revision 1", exact: true })
    .click();
  const historical = page.getByRole("region", {
    name: "Historical grading revision 1 matrix",
    exact: true,
  });
  await expect(historical).toContainText("-2.5000");
  await capture(page, "historical");
  await page
    .getByRole("button", { name: "Archive grade rule set", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Reactivate grade rule set",
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "archived");
  const endpoint = api + f.endpoint + "/" + g.id;
  const archived = await request.get(endpoint, { headers: f.headers });
  expect(archived.status()).toBe(200);
  const before = await archived.json();
  const noop = await request.put(endpoint, {
    headers: f.headers,
    data: { status: "ARCHIVED", version: 1 },
  });
  expect(noop.status()).toBe(200);
  const compact = await noop.json();
  expect(compact.version).toBe(1);
  expect(compact.updatedAt).toBe(before.updatedAt);
  expect(compact.latestRevision.rules).toBeUndefined();
  const denied = await request.post(endpoint + "/revisions", {
    headers: f.headers,
    data: { ...snapshot(), expectedLatestRevisionNumber: 2 },
  });
  expect(denied.status()).toBe(409);
  await page
    .getByRole("button", { name: "Reactivate grade rule set", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm reactivation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save grading revision", exact: true })
    .click();
  await ready(page, 3);
  noForeignDomains(calls);
});
test("browser creates revision one from explicit ordered matrix strings", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = privateTraffic(page);
  await login(page, f);
  await page
    .getByRole("button", { name: "Create grade rule set", exact: true })
    .click();
  await page
    .getByLabel("Grading name", { exact: true })
    .fill("Created in browser");
  await page.getByLabel("Grading unit", { exact: true }).selectOption("IN");
  await page.getByLabel("Base size", { exact: true }).selectOption("M");
  await page.getByLabel("Rule 1 code", { exact: true }).fill("CHEST");
  await page.getByLabel("Rule 1 label", { exact: true }).fill("Chest");
  await page
    .getByLabel("Delta rule 1 size 1", { exact: true })
    .fill("-999999999999999.9999");
  await page.getByLabel("Delta rule 1 size 2", { exact: true }).fill("-0.0000");
  await page
    .getByRole("button", { name: "Save new grade rule set", exact: true })
    .click();
  await expect(
    page.getByText("Grade rule set and revision 1 created.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Created in browser", exact: true })
    .click();
  await ready(page);
  await expect(page.getByRole("table")).toContainText("-999999999999999.9999");
  expect(
    calls.filter((c) => c.path === f.endpoint && c.method === "POST"),
  ).toHaveLength(1);
  noForeignDomains(calls);
});
test("stale revision409 retains matrix and requires non-submitting explicit reconciliation", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    g = await create(request, f),
    calls = privateTraffic(page);
  await login(page, f, f.listRoute + "/" + g.id);
  await ready(page);
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await page
    .getByLabel("Grading name", { exact: true })
    .fill("Private retained conflict");
  await page.getByLabel("Delta rule 1 size 1", { exact: true }).fill("-9.1250");
  const concurrent = await request.post(
    api + f.endpoint + "/" + g.id + "/revisions",
    {
      headers: f.headers,
      data: { ...snapshot(), expectedLatestRevisionNumber: 1 },
    },
  );
  expect(concurrent.status()).toBe(201);
  await page
    .getByRole("button", { name: "Save grading revision", exact: true })
    .click();
  await expect(
    page.getByText("Draft baseline revision 1; current latest revision 2.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Delta rule 1 size 1", { exact: true }),
  ).toHaveValue("-9.1250");
  await capture(page, "conflict");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await page
    .getByRole("button", {
      name: "Reconcile baseline without changing draft",
      exact: true,
    })
    .click();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await expect(page.getByLabel("Grading name", { exact: true })).toHaveValue(
    "Private retained conflict",
  );
  await page
    .getByRole("button", { name: "Save grading revision", exact: true })
    .click();
  await ready(page, 3);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  noForeignDomains(calls);
});
test("committed response loss preserves draft without attribution or automatic resend", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    g = await create(request, f),
    calls = privateTraffic(page),
    endpoint = f.endpoint + "/" + g.id + "/revisions";
  await login(page, f, f.listRoute + "/" + g.id);
  await ready(page);
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await page
    .getByLabel("Grading name", { exact: true })
    .fill("Ambiguous retained grading");
  await page.route("**" + endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Save grading revision", exact: true })
    .click();
  await expect(
    page.getByText("Draft baseline revision 1; current latest revision 2.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Grading name", { exact: true })).toHaveValue(
    "Ambiguous retained grading",
  );
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await capture(page, "ambiguous");
  const storage = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases:
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [],
    url: location.href,
  }));
  expect(JSON.stringify(storage)).not.toMatch(
    /Ambiguous retained grading|access_token|private.*delta/i,
  );
  expect(storage.databases).toHaveLength(0);
  noForeignDomains(calls);
});
test("VIEWER, archived Project/Style and denied Actor preserve private read boundaries", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    g = await create(request, f),
    path = f.listRoute + "/" + g.id,
    calls = privateTraffic(page);
  await login(page, f, path, f.viewer);
  await ready(page);
  await expect(
    page.getByRole("button", {
      name: "Create new grading revision",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Archive grade rule set", exact: true }),
  ).toHaveCount(0);
  await capture(page, "viewer");
  const style = await request.put(api + "/api/v1" + f.styleRoute, {
    headers: f.headers,
    data: {
      name: f.style.name,
      styleCode: f.style.styleCode,
      description: f.style.description,
      status: "ARCHIVED",
      version: 0,
    },
  });
  expect(style.status()).toBe(200);
  const project = await request.put(
    api + `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`,
    {
      headers: f.headers,
      data: {
        name: f.project.name,
        description: f.project.description,
        status: "ARCHIVED",
        version: 0,
      },
    },
  );
  expect(project.status()).toBe(200);
  await login(page, f, path);
  await ready(page);
  await expect(
    page.getByText(
      "Grading is read-only while the Project or Style is archived.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Create new grading revision",
      exact: true,
    }),
  ).toHaveCount(0);
  await capture(page, "archived-parents");
  const write = await request.post(
    api + f.endpoint + "/" + g.id + "/revisions",
    {
      headers: f.headers,
      data: { ...snapshot(), expectedLatestRevisionNumber: 1 },
    },
  );
  expect(write.status()).toBe(409);
  await login(page, f, path, f.admin);
  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  const wrong = await request.get(api + f.endpoint + "/" + g.id, {
    headers: { "X-Dev-Subject": f.viewer },
  });
  expect(wrong.status()).toBe(200);
  noForeignDomains(calls);
});
test("maximum 30×100 matrix renders, edits, traverses, retains conflicts and clears on Organization switch", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    g = await create(request, f, 30, 100),
    calls = privateTraffic(page);
  let receivedAt: number | null = null;
  page.on("response", (r) => {
    if (
      new URL(r.url()).pathname === f.endpoint + "/" + g.id &&
      r.request().method() === "GET" &&
      receivedAt === null
    )
      receivedAt = performance.now();
  });
  await login(page, f, f.listRoute + "/" + g.id);
  await ready(page);
  await expect(page.getByRole("table").locator("tbody td")).toHaveCount(3000);
  expect(receivedAt).not.toBeNull();
  const responseToRenderedMs = performance.now() - receivedAt!;
  await capture(page, "maximum");
  await expect(page.locator('table thead th[scope="col"]')).toHaveCount(31);
  await expect(page.locator('table tbody th[scope="row"]')).toHaveCount(100);
  const hydration = await page.evaluate(
    async ({ g, style }) => {
      const modulePath = "/src/features/grading/model.ts",
        m = await import(modulePath),
        start = performance.now();
      const value = m.checkedGrading(g, style, g.id);
      return {
        ms: performance.now() - start,
        values: value.latestRevision.rules.reduce(
          (n: number, r: { values: unknown[] }) => n + r.values.length,
          0,
        ),
      };
    },
    { g, style: f.style.id },
  );
  expect(hydration.values).toBe(3000);
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await expect(page.locator('form input[id*="Delta rule "]')).toHaveCount(3000);
  const first = page.getByLabel("Delta rule 1 size 1", { exact: true });
  await first.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Delta rule 1 size 2", { exact: true }),
  ).toBeFocused();
  expect(
    await page
      .getByLabel("Delta rule 1 size 2", { exact: true })
      .evaluate((e) => getComputedStyle(e).outlineStyle),
  ).not.toBe("none");
  await capture(page, "maximum-editor");
  const editStart = performance.now();
  await page
    .getByLabel("Delta rule 100 size 30", { exact: true })
    .fill("-99.1234");
  const editMs = performance.now() - editStart;
  await page.locator('button[aria-label="Move rule 100 up"]').click();
  await expect(
    page.getByLabel("Delta rule 99 size 30", { exact: true }),
  ).toHaveValue("-99.1234");
  await page.locator('button[aria-label="Move size 30 up"]').click();
  await expect(
    page.getByLabel("Delta rule 99 size 29", { exact: true }),
  ).toHaveValue("-99.1234");
  const concurrent = await request.post(
    api + f.endpoint + "/" + g.id + "/revisions",
    {
      headers: f.headers,
      data: { ...snapshot(30, 100), expectedLatestRevisionNumber: 1 },
    },
  );
  expect(concurrent.status()).toBe(201);
  const refreshed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === f.endpoint + "/" + g.id &&
      r.request().method() === "GET",
  );
  await page
    .locator('form[aria-label="Grading snapshot editor"] button[type="submit"]')
    .click();
  expect((await (await refreshed).json()).latestRevision.revisionNumber).toBe(2);
  await expect(
    page.getByText("Draft baseline revision 1; current latest revision 2.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Delta rule 99 size 29", { exact: true }),
  ).toHaveValue("-99.1234");
  await page
    .getByRole("button", {
      name: "Reconcile baseline without changing draft",
      exact: true,
    })
    .click();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await page
    .locator('form[aria-label="Grading snapshot editor"] button[type="submit"]')
    .click();
  await ready(page, 3);
  await expect(
    page.locator('form[aria-label="Grading snapshot editor"]'),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create new grading revision", exact: true })
    .click();
  await page
    .getByLabel("Grading name", { exact: true })
    .fill("Private maximum draft");
  const observation = await page.evaluate(() => ({
    heapBytes:
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? null,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    containedScroll: Array.from(
      document.querySelectorAll<HTMLElement>(".grading-scroll"),
    ).some((e) => e.scrollWidth > e.clientWidth),
  }));
  expect(observation.documentWidth).toBeLessThanOrEqual(
    observation.viewportWidth,
  );
  expect(observation.containedScroll).toBe(true);
  const storage = await page.evaluate(async () => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases:
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [],
  }));
  expect(JSON.stringify(storage)).not.toContain("Private maximum draft");
  expect(storage.databases).toHaveLength(0);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: f.b.name, exact: true }).click();
  await expect(
    page.getByRole("link", { name: f.pb.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator('form input[id*="Delta rule "]')).toHaveCount(0);
  mkdirSync(captures, { recursive: true });
  writeFileSync(
    captures + "maximum-observations.json",
    JSON.stringify(
      {
        hydration,
        responseToRenderedMs,
        editMs,
        observation,
        requestBytes: calls
          .filter((c) => c.method === "POST")
          .map((c) => c.bytes),
        privateDraftCleared: true,
      },
      null,
      2,
    ),
  );
  noForeignDomains(calls);
});
