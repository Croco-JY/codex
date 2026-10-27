import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { provisionWorkspace } from "./workspace-fixture";

const api = "http://127.0.0.1:8080",
  mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const captures = fileURLToPath(
  new URL(`../../../.local/phase3e-review/${mode}/`, import.meta.url),
);
async function setup(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    styleRoute = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  const r = await request.post(api + "/api/v1" + styleRoute + "/patterns", {
    headers: f.headers,
    data: { name: "Exact QA Pattern" },
  });
  expect(r.status()).toBe(201);
  const pattern = await r.json(),
    endpoint = "/api/v1" + styleRoute + "/patterns/" + pattern.id;
  return {
    ...f,
    pattern,
    endpoint,
    styleRoute,
    patternRoute: styleRoute + "/patterns/" + pattern.id,
  };
}
type F = Awaited<ReturnType<typeof setup>>;
const qaPath = (f: F, revision = f.pattern.latestRevision.id) =>
  f.endpoint + "/revisions/" + revision + "/qa";
const route = (f: F, revision = f.pattern.latestRevision.id) =>
  qaPath(f, revision).replace("/api/v1", "");
const body = (head = 0, notes = "Authenticated human observation") => ({
  expectedLatestAssessmentNumber: head,
  outcome: "OBSERVED",
  evidenceBasis: "METADATA_ONLY",
  artifactId: null,
  notes,
});
async function assess(request: APIRequestContext, f: F, head = 0) {
  const r = await request.post(api + qaPath(f) + "/assessments", {
    headers: f.headers,
    data: body(head),
  });
  expect(r.status()).toBe(201);
  return r.json();
}
async function login(page: Page, f: F, path = route(f), subject = f.writer) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(subject);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function empty(page: Page) {
  await expect(
    page.getByText("This exact revision has no assessments.", { exact: true }),
  ).toBeVisible();
}
async function edit(
  page: Page,
  notes = "A human reviewed the immutable metadata.",
) {
  await page
    .getByRole("button", { name: "Record QA assessment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submit QA assessment", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Human review notes", { exact: true }).fill(notes);
}
async function latest(page: Page, n: number) {
  await expect(
    page.getByRole("heading", {
      name: `Latest QA assessment ${n}`,
      exact: true,
    }),
  ).toBeVisible();
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
      mkdirSync(captures, { recursive: true });
      await page.screenshot({
        path: captures + name + "-" + width + ".png",
        fullPage: true,
      });
    }
  }
}
function traffic(page: Page) {
  const calls: {
    path: string;
    query: string;
    method: string;
    origin: string;
  }[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      calls.push({
        path: u.pathname,
        query: u.search,
        method: r.method(),
        origin: u.origin,
      });
  });
  return calls;
}
function noHidden(calls: ReturnType<typeof traffic>) {
  expect(
    calls.filter((c) =>
      /measurement-spec|grade-rule-sets|pattern-releases|\/artifact\/content|\/materials(?:\/|$)|\/facilities(?:\/|$)|\/suppliers(?:\/|$)/.test(
        c.path,
      ),
    ),
  ).toHaveLength(0);
  expect([...new Set(calls.map((c) => c.origin))]).toEqual([
    new URL(process.env.VITE_API_BASE_URL || "http://127.0.0.1:5173").origin,
  ]);
}
test("lazy navigation, exact UNREVIEWED, observations, immutable history and strict QA request budgets", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = traffic(page),
    endpoint = qaPath(f);
  await login(page, f, f.styleRoute);
  await expect(
    page.getByRole("link", { name: "Patterns", exact: true }),
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
  expect(
    calls.filter(
      (c) =>
        c.path.includes("/qa") ||
        /\/patterns|measurement-spec|grade-rule-sets/.test(c.path),
    ),
  ).toHaveLength(0);
  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await page
    .getByRole("link", { name: "Exact QA Pattern", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Human QA for revision 1", exact: true }),
  ).toBeVisible();
  expect(calls.filter((c) => c.path.includes("/qa"))).toHaveLength(0);
  await page
    .getByRole("link", { name: "Human QA for revision 1", exact: true })
    .click();
  await empty(page);
  expect(calls.filter((c) => c.path === endpoint)).toHaveLength(1);
  expect(
    calls.filter((c) => c.path === endpoint.replace(/\/qa$/, "")),
  ).toHaveLength(1);
  expect(calls.filter((c) => c.path.includes("/qa/assessments"))).toHaveLength(
    0,
  );
  expect(calls.filter((c) => c.path.endsWith("/artifact"))).toHaveLength(0);
  await capture(page, "unreviewed");
  await edit(page, "Observation one 🧵");
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await latest(page, 1);
  await capture(page, "observed");
  await edit(page, "Changes requested for this exact revision");
  await page
    .getByLabel("QA outcome", { exact: true })
    .selectOption("CHANGES_REQUESTED");
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await latest(page, 2);
  await capture(page, "changes");
  await page
    .getByRole("button", { name: "Expand QA history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open QA assessment 1", exact: true }),
  ).toBeVisible();
  const histories = calls.filter(
    (c) => c.path === endpoint + "/assessments" && c.method === "GET",
  );
  expect(histories).toHaveLength(1);
  expect(
    new URLSearchParams(histories[0].query).get("maxAssessmentNumber"),
  ).toBe("2");
  expect(calls.filter((c) => /\/qa\/assessments\//.test(c.path))).toHaveLength(
    0,
  );
  await page
    .getByRole("button", { name: "Open QA assessment 1", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Historical QA assessment 1",
      exact: true,
    }),
  ).toContainText("Observation one 🧵");
  await capture(page, "historical");
  expect(calls.filter((c) => /\/qa\/assessments\//.test(c.path))).toHaveLength(
    1,
  );
  const stable = await request.get(api + f.endpoint, { headers: f.headers });
  const p = await stable.json();
  expect(p.version).toBe(0);
  expect(p.latestRevision).toEqual(f.pattern.latestRevision);
  noHidden(calls);
});
test("R01 real background QA refresh preserves anchor2 and selected assessment1 until explicit reopen", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    first = await assess(request, f),
    second = await assess(request, f, 1),
    endpoint = qaPath(f),
    calls = traffic(page);
  await login(page, f);
  await latest(page, 2);
  await page
    .getByRole("button", { name: "Expand QA history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open QA assessment 1", exact: true })
    .click();
  const selected = page.getByRole("region", {
    name: "Historical QA assessment 1",
    exact: true,
  });
  await expect(selected).toContainText(first.notes);
  const historyCalls = () =>
      calls.filter(
        (c) => c.method === "GET" && c.path === endpoint + "/assessments",
      ),
    anchors = () =>
      historyCalls().map((c) =>
        new URLSearchParams(c.query).get("maxAssessmentNumber"),
      );
  expect(anchors()).toEqual(["2"]);
  expect(second.assessmentNumber).toBe(2);
  const originalUrl = page.url();
  await page.evaluate(() => {
    document.documentElement.dataset.r01SameDocument = "pinned-history";
  });
  // Advance browser time, not wall time, to exercise the existing stale-on-focus
  // policy without changing production query configuration or navigating away.
  await page.clock.install();
  const third = await assess(request, f, 2);
  expect(third.assessmentNumber).toBe(3);
  const refreshed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === endpoint && r.request().method() === "GET",
  );
  await page.clock.fastForward(31_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  const current = await refreshed;
  expect(current.status()).toBe(200);
  expect((await current.json()).latestAssessment.id).toBe(third.id);
  await latest(page, 3);
  await expect(selected).toContainText(first.notes);
  await expect.poll(() => historyCalls().length).toBe(2);
  expect(anchors()).toEqual(["2", "2"]); // initial + focus refresh of the same bound
  await expect(
    page.getByRole("button", { name: "Open QA assessment 3", exact: true }),
  ).toHaveCount(0);
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  expect(page.url()).toBe(originalUrl);
  expect(
    await page.evaluate(() => document.documentElement.dataset.r01SameDocument),
  ).toBe("pinned-history");
  await capture(page, "r01-pinned-history");
  await page
    .getByRole("button", { name: "Close QA history", exact: true })
    .click();
  await expect(selected).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand QA history", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open QA assessment 3", exact: true }),
  ).toBeVisible();
  expect(anchors()).toEqual(["2", "2", "3"]);
  await expect(selected).toHaveCount(0);
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  noHidden(calls);
  await capture(page, "r01-reopened-history");
  const metricsPath = test
    .info()
    .outputPath("r01-history-snapshot-requests.json");
  writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        currentQaGets: calls.filter((c) => c.path === endpoint).length,
        historyAnchors: anchors(),
        exactAssessmentGets: calls.filter((c) =>
          /\/qa\/assessments\//.test(c.path),
        ).length,
        browserMutations: calls.filter((c) => c.method !== "GET").length,
        requests: calls,
      },
      null,
      2,
    ),
  );
  await test.info().attach("r01-history-snapshot-requests", {
    path: metricsPath,
    contentType: "application/json",
  });
});
test("exact READY artifact human attestation is explicit, truthful and not inherited by a new revision", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    pdf = Buffer.from("%PDF-1.4\nsynthetic QA artifact\n%%EOF\n");
  const r = await request.post(api + f.endpoint + "/artifact-revisions", {
    headers: f.headers,
    multipart: {
      metadata: {
        name: "metadata",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            expectedLatestRevisionNumber: 1,
            name: "Exact artifact QA",
            purpose: null,
            measurementRevisionId: null,
            declaredFormat: "PDF",
            displayName: "Human-review.pdf",
          }),
        ),
      },
      file: { name: "untrusted.html", mimeType: "text/html", buffer: pdf },
    },
  });
  expect(r.status()).toBe(201);
  const result = await r.json(),
    revision = result.revision.id,
    calls = traffic(page);
  await login(page, f, route(f, revision));
  await empty(page);
  await edit(
    page,
    "I inspected the identified artifact; no production validation is claimed.",
  );
  await page
    .getByLabel("QA outcome", { exact: true })
    .selectOption("HUMAN_REVIEWED");
  await page
    .getByLabel("Review basis", { exact: true })
    .selectOption("READY_ARTIFACT");
  await capture(page, "ready-draft");
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(result.artifact.id);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  await capture(page, "attestation");
  await page
    .getByRole("button", {
      name: "Confirm human review attestation",
      exact: true,
    })
    .click();
  await latest(page, 1);
  await expect(page.getByText(/^Human review recorded\./)).toBeVisible();
  await capture(page, "human-reviewed");
  const next = await request.post(api + f.endpoint + "/revisions", {
    headers: f.headers,
    data: {
      expectedLatestRevisionNumber: 2,
      name: "New unreviewed metadata",
      purpose: null,
      measurementRevisionId: null,
    },
  });
  expect(next.status()).toBe(201);
  const newer = await next.json();
  const old = await request.get(api + qaPath(f, revision), {
    headers: f.headers,
  });
  expect((await old.json()).state).toBe("HUMAN_REVIEWED");
  const fresh = await request.get(api + qaPath(f, newer.id), {
    headers: f.headers,
  });
  expect((await fresh.json()).state).toBe("UNREVIEWED");
  noHidden(calls);
});
for (const state of ["PENDING", "FAILED"] as const)
  test(`${state} artifact cannot support HUMAN_REVIEWED in UI or API`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      revision = randomUUID(),
      artifact = randomUUID(),
      db = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
    if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(db))
      throw Error("Synthetic local database required");
    execFileSync(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "source_os",
        "-d",
        db,
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        stdio: ["pipe", "pipe", "pipe"],
        input: `BEGIN;
INSERT INTO pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected) VALUES('${revision}','${f.pattern.id}','${f.style.id}',2,'Not READY','urn:source-os:local','${f.writer}',true);
INSERT INTO pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,state) VALUES('${artifact}','${revision}','${f.style.id}','${randomUUID()}','PDF','Retained.pdf',1,repeat('a',64),'PENDING');
${state === "FAILED" ? `UPDATE pattern_artifact SET state='FAILED',failure_code='STORAGE_WRITE_FAILED',version=1,updated_at=clock_timestamp()+interval '1 microsecond' WHERE id='${artifact}';` : ""}
COMMIT;`,
      },
    );
    const calls = traffic(page);
    await login(page, f, route(f, revision));
    await empty(page);
    await edit(page);
    await expect(
      page.getByRole("option", { name: "READY_ARTIFACT", exact: true }),
    ).toBeDisabled();
    await capture(page, state.toLowerCase());
    const denied = await request.post(
      api + qaPath(f, revision) + "/assessments",
      {
        headers: f.headers,
        data: {
          ...body(),
          outcome: "HUMAN_REVIEWED",
          evidenceBasis: "READY_ARTIFACT",
          artifactId: artifact,
        },
      },
    );
    expect(denied.status()).toBe(409);
    const current = await request.get(api + qaPath(f, revision), {
      headers: f.headers,
    });
    expect((await current.json()).state).toBe("UNREVIEWED");
    noHidden(calls);
  });
test("real stale assessment409 preserves full draft and requires explicit reconciliation", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = traffic(page);
  await login(page, f);
  await empty(page);
  await edit(page, "Keep this QA conflict draft");
  await assess(request, f);
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await expect(
    page.getByText("Draft baseline assessment 0; current latest 1.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Human review notes", { exact: true }),
  ).toHaveValue("Keep this QA conflict draft");
  await capture(page, "conflict");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await page
    .getByRole("button", {
      name: "Reconcile QA baseline without changing draft",
      exact: true,
    })
    .click();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await latest(page, 2);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  noHidden(calls);
});
for (const parent of ["project", "style", "pattern"] as const)
  test(`archived ${parent} retains QA reads and rejects assessments`, async ({
    page,
    request,
  }) => {
    const f = await setup(request);
    await assess(request, f);
    const path =
      parent === "pattern"
        ? f.endpoint
        : parent === "style"
          ? "/api/v1" + f.styleRoute
          : `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`;
    const current =
      parent === "pattern"
        ? { status: "ARCHIVED", version: 0 }
        : parent === "style"
          ? {
              name: f.style.name,
              styleCode: f.style.styleCode,
              description: f.style.description,
              status: "ARCHIVED",
              version: 0,
            }
          : {
              name: f.project.name,
              description: f.project.description,
              status: "ARCHIVED",
              version: 0,
            };
    expect(
      (
        await request.put(api + path, { headers: f.headers, data: current })
      ).status(),
    ).toBe(200);
    const calls = traffic(page);
    await login(page, f);
    await latest(page, 1);
    await expect(
      page.getByText(
        "QA is read-only while the Project, Style or Pattern is archived.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Record QA assessment", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Expand QA history", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open QA assessment 1", exact: true }),
    ).toBeVisible();
    await capture(page, "archived-" + parent);
    expect(
      (
        await request.post(api + qaPath(f) + "/assessments", {
          headers: f.headers,
          data: body(1),
        })
      ).status(),
    ).toBe(409);
    noHidden(calls);
  });
test("VIEWER sees notes/history and no submission actions", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  await assess(request, f);
  const calls = traffic(page);
  await login(page, f, route(f), f.viewer);
  await latest(page, 1);
  await expect(
    page.getByRole("button", { name: "Record QA assessment", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand QA history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open QA assessment 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Historical QA assessment 1",
      exact: true,
    }),
  ).toBeVisible();
  await capture(page, "viewer");
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  noHidden(calls);
});
test("same-UUID historical summary contradiction safely rejects502 without rendering", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    first = await assess(request, f);
  await assess(request, f, 1);
  const calls = traffic(page);
  await page.route("**" + qaPath(f) + "/assessments/" + first.id, async (r) => {
    const actual = await r.fetch();
    expect(actual.status()).toBe(200);
    await r.fulfill({
      response: actual,
      json: { ...(await actual.json()), assessmentNumber: 999 },
    });
  });
  await login(page, f);
  await latest(page, 2);
  await page
    .getByRole("button", { name: "Expand QA history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open QA assessment 1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Service unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /Historical QA assessment/ }),
  ).toHaveCount(0);
  await capture(page, "malformed-history");
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  noHidden(calls);
});
test("committed QA response loss keeps draft without attribution, automatic resend or durable storage", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = traffic(page);
  await login(page, f);
  await empty(page);
  await edit(page, "Private ambiguous human QA marker");
  await page.route("**" + qaPath(f) + "/assessments", async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    expect((await r.fetch()).status()).toBe(201);
    await r.abort("failed");
  });
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await expect(
    page.getByText("Draft baseline assessment 0; current latest 1.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Human review notes", { exact: true }),
  ).toHaveValue("Private ambiguous human QA marker");
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
    /Private ambiguous human QA marker|access_token|Bearer/,
  );
  expect(storage.databases).toHaveLength(0);
  noHidden(calls);
});
test("Actor switch discards held old QA response and private selection", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route("**" + qaPath(f), async (r) => {
    const actual = await r.fetch();
    if (first) {
      first = false;
      await held;
      return r.fulfill({
        response: actual,
        json: { ...(await actual.json()), patternRevisionNumber: 999 },
      });
    }
    await r.fulfill({ response: actual });
  });
  await login(page, f);
  await expect(
    page.getByRole("status", { name: "Loading Pattern QA", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Local development identity").fill(f.viewer);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await empty(page);
  release();
  await expect(
    page.getByText("Your VIEWER membership provides read-only QA access.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Service unavailable", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Record QA assessment", exact: true }),
  ).toHaveCount(0);
  await capture(page, "actor-isolation");
});
test("Organization switch discards a late committed assessment response and old notice", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let notifyCommitted!: () => void;
  const committed = new Promise<void>((r) => (notifyCommitted = r));
  await login(page, f);
  await empty(page);
  await edit(page, "Old Organization QA private notes");
  await page.route("**" + qaPath(f) + "/assessments", async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const actual = await r.fetch();
    expect(actual.status()).toBe(201);
    notifyCommitted();
    await held;
    await r.fulfill({ response: actual });
  });
  await page
    .getByRole("button", { name: "Submit QA assessment", exact: true })
    .click();
  await committed;
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name: f.b.name, exact: true }).click();
  await expect(
    page.getByRole("link", { name: f.pb.name, exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("QA assessment recorded.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Human review notes", { exact: true }),
  ).toHaveCount(0);
});
