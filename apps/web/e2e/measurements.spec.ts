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
  new URL(`../../../.local/phase3a-review/${mode}/`, import.meta.url),
);
const input = {
  baseSize: "M",
  unitSystem: "CM",
  points: [
    {
      code: "CHEST",
      label: "Chest",
      value: "50.0000",
      tolerancePlus: "1.2500",
      toleranceMinus: "0.5000",
      notes: "Synthetic initial POM",
    },
  ],
};
async function fixture(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    styleRoute = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return {
    ...f,
    styleRoute,
    route: styleRoute + "/measurements",
    endpoint: "/api/v1" + styleRoute + "/measurement-spec",
  };
}
async function login(page: Page, who: string, route: string) {
  await page.goto(route);
  await page.getByLabel("Local development identity").fill(who);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function createApi(
  request: APIRequestContext,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const r = await request.put(api + f.endpoint, {
    headers: { ...f.headers, "If-None-Match": "*" },
    data: input,
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function capture(page: Page, state: string) {
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
        path: `${captureRoot}${state}-${width}.png`,
        fullPage: true,
      });
    }
  }
}
const reads = (page: Page, f: Awaited<ReturnType<typeof fixture>>) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      seen.push(r.url());
  });
  return seen;
};
const initialBudget = (
  seen: string[],
  f: Awaited<ReturnType<typeof fixture>>,
  existing: boolean,
) => {
  expect(seen.map((u) => new URL(u).pathname)).toEqual(
    existing ? [f.endpoint, f.endpoint + "/revisions"] : [f.endpoint],
  );
  if (existing) {
    expect(new URL(seen[1]).searchParams.get("limit")).toBe("25");
    expect(new URL(seen[1]).searchParams.get("maxRevisionNumber")).toBe("1");
  }
};

test("real Style navigation, atomic revision 1, exact POMs, new snapshot and historical detail", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    seen = reads(page, f),
    writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      writes.push(r.url());
  });
  await login(page, f.writer, f.styleRoute);
  for (const name of [
    "Style Requirement",
    "Material Selections",
    "Facility Candidates",
    "Development References",
  ])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  expect(seen).toEqual([]);
  await page.getByRole("link", { name: "Measurements", exact: true }).click();
  await expect(
    page.getByText("No Measurement Spec has been created for this Style.", {
      exact: true,
    }),
  ).toBeVisible();
  initialBudget(seen, f, false);
  await capture(page, "01-empty");
  await page.getByLabel("Base size", { exact: true }).fill(" M ");
  await page.getByLabel("Unit system", { exact: true }).selectOption("CM");
  await page.getByLabel("Code · POM 1", { exact: true }).fill("CHEST");
  await page.getByLabel("Label · POM 1", { exact: true }).fill(" Chest ");
  await page
    .getByLabel("Value · POM 1", { exact: true })
    .fill("999999999999999.9999");
  await page
    .getByLabel("Tolerance plus · POM 1", { exact: true })
    .fill("1.2500");
  await page.getByRole("button", { name: "Add POM", exact: true }).click();
  await page.getByLabel("Code · POM 2", { exact: true }).fill("CB_LENGTH");
  await page
    .getByLabel("Label · POM 2", { exact: true })
    .fill("Center back length");
  await page.getByLabel("Value · POM 2", { exact: true }).fill("0.0000");
  const marker = `Synthetic private draft ${f.a.id}`;
  await page.getByLabel("Notes · POM 1", { exact: true }).fill(marker);
  const durable = await page.evaluate(async () => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    databases: await indexedDB.databases(),
    url: location.href,
  }));
  expect(JSON.stringify(durable)).not.toContain(marker);
  expect(durable.databases).toEqual([]);
  expect(JSON.stringify(durable)).not.toContain("Bearer ");
  await page.getByLabel("Notes · POM 1", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Remove POM 1", exact: true }),
  ).toBeFocused();
  await capture(page, "02-multi-pom-edit");
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === f.endpoint,
  );
  await page
    .getByRole("button", { name: "Create Measurement Spec", exact: true })
    .click();
  const initial = await response;
  expect(initial.status()).toBe(201);
  const created = await initial.json();
  expect(Object.keys(initial.request().postDataJSON()).sort()).toEqual([
    "baseSize",
    "points",
    "unitSystem",
  ]);
  expect(
    created.latestRevision.points.map((p: { position: number }) => p.position),
  ).toEqual([0, 1]);
  expect(created.latestRevision.points[0].value).toBe("999999999999999.9999");
  expect(created.latestRevision.points[1].value).toBe("0.0000");
  expect(created.latestRevision).not.toHaveProperty("sealed");
  expect(created.latestRevision).not.toHaveProperty("createdBySubject");
  await expect(
    page.getByRole("heading", { name: "Latest revision 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open revision 1", exact: true }),
  ).toBeVisible();
  await capture(page, "03-revision-one");
  await page
    .getByRole("button", { name: "Create new revision", exact: true })
    .click();
  await page.getByLabel("Value · POM 1", { exact: true }).fill("52.5000");
  const nextResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === f.endpoint + "/revisions",
  );
  await page
    .getByRole("button", { name: "Create revision", exact: true })
    .click();
  const next = await nextResponse;
  expect(next.status()).toBe(201);
  expect(next.request().postDataJSON().expectedLatestRevisionNumber).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Latest revision 2", exact: true }),
  ).toBeVisible();
  const history = page.getByRole("region", {
    name: "Measurement revision history",
    exact: true,
  });
  await expect(
    history.getByRole("button", { name: "Open revision 2", exact: true }),
  ).toBeVisible();
  expect(
    await history
      .getByRole("button", { name: /Open revision/ })
      .allTextContents(),
  ).toEqual(["Open revision 2", "Open revision 1"]);
  await capture(page, "04-history");
  expect(
    seen.filter((u) => new URL(u).pathname.includes("/revisions/")),
  ).toHaveLength(0);
  await history
    .getByRole("button", { name: "Open revision 1", exact: true })
    .click();
  const old = page.getByRole("region", {
    name: "Selected revision 1",
    exact: true,
  });
  await expect(old.getByText(/999999999999999.9999/)).toBeVisible();
  expect(
    seen.filter((u) => new URL(u).pathname.includes("/revisions/")),
  ).toHaveLength(1);
  await capture(page, "05-historical-detail");
  expect(writes).toHaveLength(2);
});

test("real existing Spec has exactly one anchored history request and no latest detail or unrelated domain reads", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await createApi(request, f);
  const seen = reads(page, f),
    other: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/.*\/(patterns|grading|pattern-releases)/.test(r.url()))
      other.push(r.url());
  });
  await login(page, f.writer, f.route);
  await expect(
    page.getByRole("button", { name: "Open revision 1", exact: true }),
  ).toBeVisible();
  initialBudget(seen, f, true);
  expect(other).toEqual([]);
});
test("real stale-head 409 preserves draft and requires explicit non-submitting reconciliation", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await createApi(request, f);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === f.endpoint + "/revisions"
    )
      writes.push(r.url());
  });
  await login(page, f.writer, f.route);
  await page
    .getByRole("button", { name: "Create new revision", exact: true })
    .click();
  await page
    .getByLabel("Notes · POM 1", { exact: true })
    .fill("Retained conflicting POM draft");
  const concurrent = await request.post(api + f.endpoint + "/revisions", {
    headers: f.headers,
    data: { ...input, baseSize: "L", expectedLatestRevisionNumber: 1 },
  });
  expect(concurrent.status()).toBe(201);
  const lost = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === f.endpoint + "/revisions",
  );
  await page
    .getByRole("button", { name: "Create revision", exact: true })
    .click();
  expect((await lost).status()).toBe(409);
  await expect(
    page.getByRole("heading", { name: "Latest revision 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Review authoritative measurements before submitting again",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Notes · POM 1", { exact: true })).toHaveValue(
    "Retained conflicting POM draft",
  );
  await expect(
    page.getByText("Draft baseline revision: 1", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create revision", exact: true }),
  ).toBeDisabled();
  expect(writes).toHaveLength(1);
  await capture(page, "06-stale-head-conflict");
  await page
    .getByRole("button", {
      name: "Reconcile draft with latest revision",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Draft baseline revision: 2", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
});
test("VIEWER reads latest and historical measurements with zero mutation actions or requests", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await createApi(request, f);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() !== "GET" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      writes.push(r.url());
  });
  await login(page, f.viewer, f.route);
  await expect(
    page.getByRole("button", { name: "Open revision 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your VIEWER membership provides read-only measurement access.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const name of [
    "Create Measurement Spec",
    "Create new revision",
    "Create revision",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await capture(page, "07-viewer");
  expect(writes).toEqual([]);
});
for (const parent of ["project", "style"] as const)
  test(`archived ${parent} preserves Measurement history and blocks revision controls`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    await createApi(request, f);
    const target =
      parent === "project"
        ? `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`
        : "/api/v1" + f.styleRoute;
    const old = await request.get(api + target, { headers: f.headers });
    const data = await old.json();
    const archived = await request.put(api + target, {
      headers: f.headers,
      data: {
        name: data.name,
        description: data.description,
        status: "ARCHIVED",
        version: data.version,
        ...(parent === "style" ? { styleCode: data.styleCode } : {}),
      },
    });
    expect(archived.status()).toBe(200);
    await login(page, f.writer, f.route);
    await expect(
      page.getByRole("button", { name: "Open revision 1", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Measurements are read-only while the Project or Style is archived.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create new revision", exact: true }),
    ).toHaveCount(0);
    if (parent === "style") await capture(page, "08-archived-parent");
  });
for (const parent of ["project", "style"] as const)
  test(`real held ${parent} response suppresses deeper Measurement reads`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request),
      seen = reads(page, f),
      target =
        parent === "project"
          ? `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`
          : "/api/v1" + f.styleRoute;
    let release!: () => void, arrive!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      arrived = new Promise<void>((r) => (arrive = r));
    const match = (u: URL) => u.pathname === target,
      handler = async (r: Route) => {
        const response = await r.fetch();
        expect(response.status()).toBe(200);
        arrive();
        await held;
        await r.fulfill({ response });
      };
    await page.route(match, handler);
    try {
      await login(page, f.writer, f.route);
      await arrived;
      expect(seen).toEqual([]);
      release();
      await expect(
        page.getByText("No Measurement Spec has been created for this Style.", {
          exact: true,
        }),
      ).toBeVisible();
      initialBudget(seen, f, false);
    } finally {
      release();
      await page.unroute(match, handler);
    }
  });
test("wrong Style suppresses Measurement requests and PLATFORM_ADMIN alone cannot enter", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    seen = reads(page, f);
  await login(page, f.writer, f.route.replace(f.style.id, f.sb.id));
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true, level: 1 }),
  ).toBeVisible();
  expect(seen).toEqual([]);
  await login(page, f.admin, f.route);
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true, level: 1 }),
  ).toBeVisible();
  expect(seen).toEqual([]);
});
