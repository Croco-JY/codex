import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { provisionWorkspace } from "./workspace-fixture";
const api = "http://127.0.0.1:8080";
const pdf = Buffer.from("%PDF-1.4\nsynthetic 3C bytes\n%%EOF\n");
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const captureRoot = fileURLToPath(
  new URL(`../../../.local/phase3c-review/${mode}/`, import.meta.url),
);
async function setup(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    style = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  const endpoint = "/api/v1" + style + "/patterns";
  const r = await request.post(api + endpoint, {
    headers: f.headers,
    data: {
      name: "Artifact family",
      purpose: "Synthetic 3C",
      measurementRevisionId: null,
    },
  });
  expect(r.status()).toBe(201);
  const pattern = await r.json();
  return {
    ...f,
    endpoint: endpoint + "/" + pattern.id,
    path: style + "/patterns/" + pattern.id,
    styleRoute: style,
    pattern,
  };
}
type F = Awaited<ReturnType<typeof setup>>;
async function login(page: Page, f: F, subject = f.writer, path = f.path) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(subject);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function ready(page: Page, n = 1) {
  await expect(
    page.getByRole("heading", { name: "Latest Pattern revision " + n }),
  ).toBeVisible();
}
async function edit(page: Page) {
  await page
    .getByRole("button", {
      name: "Import artifact as new revision",
      exact: true,
    })
    .click();
  await page.getByLabel("Artifact revision name").fill("New artifact revision");
  await page.getByLabel("Declared artifact format").selectOption("PDF");
  await page.getByLabel("Artifact file (1 byte through 10 MiB)").setInputFiles({
    name: "untrusted.html",
    mimeType: "text/html",
    buffer: pdf,
  });
  await page.getByLabel("Artifact display name").fill("패턴 자료.pdf");
}
async function uploaded(request: APIRequestContext, f: F) {
  const r = await request.post(api + f.endpoint + "/artifact-revisions", {
    headers: f.headers,
    multipart: {
      metadata: {
        name: "metadata",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            expectedLatestRevisionNumber: 1,
            name: "Stored artifact",
            purpose: null,
            measurementRevisionId: null,
            declaredFormat: "PDF",
            displayName: "패턴 자료.pdf",
          }),
        ),
      },
      file: { name: "untrusted.html", mimeType: "text/html", buffer: pdf },
    },
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
async function exactDownload(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Pattern artifact" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("패턴 자료.pdf");
  expect(readFileSync((await download.path())!)).toEqual(pdf);
}
test("real artifact revision upload, no eager fanout, immutable old revision, safe exact download and archived read", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    artifactReads: string[] = [],
    measurements: string[] = [],
    child: string[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() !== "GET" || !p.startsWith("/api/")) return;
    if (/\/artifact(?:\/content)?$/.test(p)) artifactReads.push(p);
    if (p.includes("/measurement-spec")) measurements.push(p);
    if (
      /requirement|material-selections|facility-candidates|development-references/.test(
        p,
      )
    )
      child.push(p);
  });
  await login(page, f, f.writer, f.styleRoute);
  await expect(
    page.getByRole("link", { name: "Patterns", exact: true }),
  ).toBeVisible();
  await expect.poll(() => child).toHaveLength(4);
  expect(artifactReads).toHaveLength(0);
  await page.getByRole("link", { name: "Patterns", exact: true }).click();
  await page
    .getByRole("link", { name: "Artifact family", exact: true })
    .click();
  await ready(page);
  expect(artifactReads).toHaveLength(0);
  await edit(page);
  expect(artifactReads).toHaveLength(0);
  expect(measurements).toHaveLength(0);
  await capture(page, "import-draft");
  await page
    .getByRole("button", { name: "Upload new artifact revision" })
    .click();
  await ready(page, 2);
  await expect(
    page.getByText("Artifact revision created · READY."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect artifact", exact: true })
    .click();
  await expect(page.getByText("Artifact state: READY")).toBeVisible();
  expect(artifactReads).toHaveLength(1);
  await capture(page, "ready");
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Pattern artifact" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("패턴 자료.pdf");
  expect(readFileSync((await download.path())!)).toEqual(pdf);
  await expect(page.getByText(/geometry validation/)).toBeVisible();
  const old = page.getByRole("button", {
    name: "Open Pattern revision 1",
    exact: true,
  });
  await old.click();
  const historical = page.getByRole("region", {
    name: "Artifact for Pattern revision 1",
  });
  await historical
    .getByRole("button", { name: "Inspect artifact", exact: true })
    .click();
  await expect(
    historical.getByText("This revision has no artifact."),
  ).toBeVisible();
  await capture(page, "artifactless");
  const archive = await request.put(api + f.endpoint, {
    headers: f.headers,
    data: { status: "ARCHIVED", version: 0 },
  });
  expect(archive.status()).toBe(200);
  await login(page, f);
  await ready(page, 2);
  await expect(
    page.getByRole("button", { name: "Import artifact as new revision" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect artifact", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download Pattern artifact" }),
  ).toBeEnabled();
  await capture(page, "archived");
  await exactDownload(page);
  const reactivated = await request.put(api + f.endpoint, {
    headers: f.headers,
    data: { status: "ACTIVE", version: 1 },
  });
  expect(reactivated.status()).toBe(200);
  await login(page, f);
  await ready(page, 2);
  await expect(
    page.getByRole("button", { name: "Import artifact as new revision" }),
  ).toBeVisible();
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    databases:
      typeof indexedDB.databases === "function" ? indexedDB.databases() : [],
  }));
  expect(JSON.stringify(storage)).not.toMatch(
    /패턴 자료|untrusted.html|New artifact revision|synthetic 3C bytes|access_token/i,
  );
});
test("real stale head keeps selected File and metadata until explicit reconciliation, no resend", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/artifact-revisions"))
      writes.push(r.url());
  });
  await login(page, f);
  await ready(page);
  await edit(page);
  const r = await request.post(api + f.endpoint + "/revisions", {
    headers: f.headers,
    data: {
      expectedLatestRevisionNumber: 1,
      name: "Concurrent head",
      purpose: null,
      measurementRevisionId: null,
    },
  });
  expect(r.status()).toBe(201);
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith("/artifact-revisions") && r.status() === 409,
  );
  await page
    .getByRole("button", { name: "Upload new artifact revision" })
    .click();
  await conflict;
  await expect(
    page.getByRole("button", { name: "Reconcile artifact draft" }),
  ).toBeVisible();
  await ready(page, 2);
  await expect(page.getByLabel("Artifact revision name")).toHaveValue(
    "New artifact revision",
  );
  expect(
    await page
      .getByLabel("Artifact file (1 byte through 10 MiB)")
      .evaluate((e: HTMLInputElement) => e.files?.[0].name),
  ).toBe("untrusted.html");
  expect(writes).toHaveLength(1);
  await capture(page, "conflict");
  await page.getByRole("button", { name: "Reconcile artifact draft" }).click();
  expect(writes).toHaveLength(1);
  await expect(page.getByText(/Baseline reconciled/)).toBeVisible();
});
test("committed READY response lost is ambiguous, retained draft, authoritative recovery without attribution or resend", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  let attempts = 0;
  const matcher = "**" + f.endpoint + "/artifact-revisions";
  await page.route(matcher, async (route) => {
    attempts++;
    const r = await route.fetch();
    expect(r.status()).toBe(201);
    await route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        status: 500,
        title: "Unavailable",
        requestId: "artifact-response-loss",
      }),
    });
  });
  try {
    await login(page, f);
    await ready(page);
    await edit(page);
    await page
      .getByRole("button", { name: "Upload new artifact revision" })
      .click();
    await expect(
      page.getByRole("button", { name: "Reconcile artifact draft" }),
    ).toBeVisible();
    await ready(page, 2);
    expect(attempts).toBe(1);
    await expect(page.getByLabel("Artifact display name")).toHaveValue(
      "패턴 자료.pdf",
    );
    await expect(
      page.getByText("Artifact revision created · READY."),
    ).toHaveCount(0);
    await capture(page, "ambiguous");
  } finally {
    await page.unroute(matcher);
  }
});
test("VIEWER can inspect/download READY but cannot import", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  await uploaded(request, f);
  await login(page, f, f.viewer);
  await ready(page, 2);
  await expect(
    page.getByRole("button", { name: "Import artifact as new revision" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect artifact", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download Pattern artifact" }),
  ).toBeEnabled();
  await capture(page, "viewer");
  await exactDownload(page);
});
for (const state of ["PENDING", "FAILED"] as const)
  test(`${state} reserved artifact is retained with no download/retry`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      revisionId = randomUUID(),
      artifactId = randomUUID();
    const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
    if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
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
        database,
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        input: `BEGIN;
INSERT INTO pattern_revision(id,pattern_id,style_id,revision_number,name,created_by_issuer,created_by_subject,artifact_expected) VALUES('${revisionId}','${f.pattern.id}','${f.style.id}',2,'Reserved artifact','urn:source-os:local','${f.writer}',true);
INSERT INTO pattern_artifact(id,pattern_revision_id,style_id,storage_object_id,declared_format,display_name,size_bytes,sha256,probe_version,state,version) VALUES('${artifactId}','${revisionId}','${f.style.id}','${randomUUID()}','PDF','Retained.pdf',1,repeat('a',64),1,'PENDING',0);
${state === "FAILED" ? `UPDATE pattern_artifact SET state='FAILED',failure_code='STORAGE_WRITE_FAILED',version=1,updated_at=clock_timestamp() WHERE id='${artifactId}';` : ""}
COMMIT;`,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    await login(page, f);
    await ready(page, 2);
    await page
      .getByRole("button", { name: "Inspect artifact", exact: true })
      .click();
    await expect(page.getByText("Artifact state: " + state)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download Pattern artifact" }),
    ).toHaveCount(0);
    await capture(page, state.toLowerCase());
  });
test("client rejects oversized file without POST and exposes labelled keyboard controls", async ({
  page,
  request,
}) => {
  const f = await setup(request);
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/artifact-revisions"))
      writes++;
  });
  await login(page, f);
  await ready(page);
  await edit(page);
  await page.getByLabel("Artifact file (1 byte through 10 MiB)").setInputFiles({
    name: "large.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(10485761),
  });
  await page
    .getByRole("button", { name: "Upload new artifact revision" })
    .click();
  await expect(page.getByText(/too large|10 MiB/i).last()).toBeVisible();
  expect(writes).toBe(0);
  await page.getByLabel("Artifact revision name").focus();
  await expect(page.getByLabel("Artifact revision name")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Artifact revision purpose")).toBeFocused();
  expect(
    await page.getByLabel("Artifact revision purpose").evaluate((e) => {
      const s = getComputedStyle(e);
      return s.outlineStyle !== "none" || s.boxShadow !== "none";
    }),
  ).toBe(true);
});
