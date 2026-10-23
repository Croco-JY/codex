import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { provisionWorkspace } from "./workspace-fixture";
import { selectionSql } from "./selection-fixture";
const api = "http://127.0.0.1:8080",
  mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const root = fileURLToPath(
  new URL(`../../../.local/phase2f-review/${mode}/`, import.meta.url),
);
const region = (page: Page) =>
  page.getByRole("region", { name: "Development References", exact: true });
async function fixture(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    route = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return { ...f, route, endpoint: `/api/v1${route}/development-references` };
}
async function login(page: Page, actor: string, route: string) {
  await page.goto(route);
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
async function draft(page: Page) {
  await region(page)
    .getByLabel("Reference file", { exact: true })
    .setInputFiles({
      name: "untrusted.html",
      mimeType: "text/html",
      buffer: Buffer.from("Synthetic private reference bytes\n"),
    });
  await region(page)
    .getByLabel("Display name", { exact: true })
    .fill("샘플 자료 01");
}
async function uploadApi(
  request: APIRequestContext,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const r = await request.post(api + f.endpoint, {
    headers: f.headers,
    multipart: {
      displayName: "Synthetic READY",
      file: {
        name: "source.bin",
        mimeType: "image/png",
        buffer: Buffer.from("synthetic"),
      },
    },
  });
  expect(r.status()).toBe(201);
  return r.json();
}

test("real upload, exact-byte attachment download, detach and responsive states", async ({
  page,
  request,
}) => {
  const f = await fixture(request),
    writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      writes.push(r.url());
  });
  await login(page, f.writer, f.route);
  await expect(
    region(page).getByText("No Development References in this view."),
  ).toBeVisible();
  await shot(page, "01-empty-desktop");
  await draft(page);
  await region(page).getByLabel("Display name", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    region(page).getByRole("button", { name: "Upload reference", exact: true }),
  ).toBeFocused();
  await shot(page, "02-upload-tablet", 768, 1024);
  const result = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === f.endpoint,
  );
  await region(page)
    .getByRole("button", { name: "Upload reference", exact: true })
    .click();
  const response = await result;
  expect(response.status()).toBe(201);
  const v = await response.json();
  expect(v.state).toBe("READY");
  expect(v.version).toBe(1);
  expect(v.mediaType).toBe("application/octet-stream");
  await expect(
    region(page).getByText("READY · Available to download", { exact: true }),
  ).toBeVisible();
  await shot(page, "03-ready-mobile", 390, 844);
  const event = page.waitForEvent("download");
  await region(page)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toBe("샘플 자료 01");
  const file = await download.path();
  expect(file).toBeTruthy();
  expect(readFileSync(file!)).toEqual(
    Buffer.from("Synthetic private reference bytes\n"),
  );
  await region(page)
    .getByRole("button", { name: "Detach reference", exact: true })
    .click();
  await expect(
    region(page).getByRole("group", { name: "Confirm reference detach" }),
  ).toBeVisible();
  await shot(page, "04-confirm-mobile", 390, 844);
  await region(page)
    .getByRole("button", { name: "Confirm detach", exact: true })
    .click();
  await expect(
    region(page).getByText("DETACHED · Detached", { exact: true }),
  ).toBeVisible();
  await expect(
    region(page).getByRole("button", {
      name: "Download reference",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(2);
  await shot(page, "05-detached-desktop");
});
test("archived parents retain READY download and VIEWER remains read-only", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await uploadApi(request, f);
  await login(page, f.writer, f.route);
  const profile = page.getByRole("region", {
    name: "Style profile",
    exact: true,
  });
  await profile
    .getByRole("button", { name: "Archive Style", exact: true })
    .click();
  await expect(
    region(page).getByText(/Project or Style is archived/),
  ).toBeVisible();
  await expect(
    region(page).getByLabel("Reference file", { exact: true }),
  ).toBeDisabled();
  await expect(
    region(page).getByRole("button", { name: "Detach reference", exact: true }),
  ).toHaveCount(0);
  const d = page.waitForEvent("download");
  await region(page)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  expect((await d).suggestedFilename()).toBe("Synthetic READY");
  await shot(page, "06-archived-tablet", 768, 1024);
  await profile
    .getByRole("button", { name: "Reactivate Style", exact: true })
    .click();
  await expect(
    region(page).getByLabel("Reference file", { exact: true }),
  ).toBeEnabled();
  await expect(
    region(page).getByRole("button", { name: "Detach reference", exact: true }),
  ).toBeEnabled();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname.startsWith(f.endpoint)
    )
      writes.push(r.url());
  });
  await login(page, f.viewer, f.route);
  for (const name of [
    "Style Requirement",
    "Material Selections",
    "Facility Candidates",
    "Development References",
  ])
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect(
    region(page).getByLabel("Reference file", { exact: true }),
  ).toHaveCount(0);
  await expect(
    region(page).getByRole("button", { name: "Detach reference", exact: true }),
  ).toHaveCount(0);
  const vd = page.waitForEvent("download");
  await region(page)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  expect((await vd).suggestedFilename()).toBe("Synthetic READY");
  expect(writes).toEqual([]);
  await shot(page, "07-viewer-mobile", 390, 844);
});
test("retained PENDING and FAILED metadata is readable and explicitly detachable, never retried in place", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  for (const state of ["PENDING", "FAILED"])
    selectionSql(
      `INSERT INTO style_development_reference(id,style_id,storage_object_id,display_name,media_type,size_bytes,state,version) VALUES('${randomUUID()}','${f.style.id}','${randomUUID()}','Synthetic ${state}','application/octet-stream',3,'${state}',${state === "PENDING" ? 0 : 1});`,
    );
  await login(page, f.viewer, f.route);
  await expect(
    region(page).getByText("PENDING · Upload not confirmed", { exact: true }),
  ).toBeVisible();
  await expect(
    region(page).getByText("FAILED · Upload failed", { exact: true }),
  ).toBeVisible();
  await expect(
    region(page).getByRole("button", {
      name: "Download reference",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    region(page).getByRole("button", { name: "Detach reference", exact: true }),
  ).toHaveCount(0);
  await shot(page, "08-pending-failed-viewer-desktop");
  await login(page, f.writer, f.route);
  await expect(
    region(page).getByRole("button", { name: "Detach reference", exact: true }),
  ).toHaveCount(2);
  await region(page)
    .getByRole("button", { name: "Detach reference", exact: true })
    .first()
    .click();
  await region(page)
    .getByRole("button", { name: "Confirm detach", exact: true })
    .click();
  await expect(
    region(page).getByText("DETACHED · Detached", { exact: true }),
  ).toBeVisible();
  await shot(page, "09-retained-tablet", 768, 1024);
});
test("lost response after real READY commit retains draft and never repeats POST", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  let posts = 0;
  await login(page, f.writer, f.route);
  await draft(page);
  await page.route(`**${f.endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await region(page)
    .getByRole("button", { name: "Upload reference", exact: true })
    .click();
  await expect(
    region(page).getByText(/Upload outcome is uncertain/),
  ).toBeVisible();
  await expect(
    region(page).getByText("READY · Available to download", { exact: true }),
  ).toBeVisible();
  await expect(
    region(page).getByLabel("Display name", { exact: true }),
  ).toHaveValue("샘플 자료 01");
  await expect(
    region(page).getByRole("button", { name: "Upload reference", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
  await shot(page, "10-ambiguous-mobile", 390, 844);
});
test("late real download cannot save bytes after Organization generation changes", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await uploadApi(request, f);
  await login(page, f.writer, f.route);
  let release!: () => void, arrive!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    arrived = new Promise<void>((r) => (arrive = r));
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.route(`**${f.endpoint}/*/content`, async (route) => {
    const response = await route.fetch();
    arrive();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await region(page)
      .getByRole("button", { name: "Download reference", exact: true })
      .click();
    await arrived;
    await page.getByRole("link", { name: "Organization", exact: true }).click();
    await page.getByRole("button", { name: f.b.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true, level: 1 }),
    ).toBeVisible();
    release();
    await page.getByRole("link", { name: f.pb.name, exact: true }).click();
    await page.getByRole("link", { name: f.sb.name, exact: true }).click();
    await expect(
      region(page).getByText("No Development References in this view."),
    ).toBeVisible();
    expect(downloads).toEqual([]);
  } finally {
    release();
  }
});
test("bounded UI oversize, safe download error and access denial", async ({
  page,
  request,
}) => {
  const f = await fixture(request);
  await login(page, f.writer, f.route);
  await region(page)
    .getByLabel("Reference file", { exact: true })
    .setInputFiles({
      name: "synthetic.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(10485761),
    });
  await region(page)
    .getByRole("button", { name: "Upload reference", exact: true })
    .click();
  await expect(
    region(page).getByText("Choose a file of 1 byte through 10 MiB.", {
      exact: true,
    }),
  ).toBeVisible();
  await shot(page, "11-oversize-mobile", 390, 844);
  const v = await uploadApi(request, f);
  await login(page, f.writer, f.route);
  await expect(
    region(page).getByRole("button", {
      name: "Download reference",
      exact: true,
    }),
  ).toBeVisible();
  await page.route(`**${f.endpoint}/${v.id}/content`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({ status: 404, requestId: "synthetic-missing" }),
    }),
  );
  await region(page)
    .getByRole("button", { name: "Download reference", exact: true })
    .click();
  await expect(
    region(page).getByRole("heading", { name: "Not found", exact: true }),
  ).toBeVisible();
  await shot(page, "12-download-error-tablet", 768, 1024);
  await login(page, f.admin, f.route);
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  await expect(region(page)).toHaveCount(0);
  await shot(page, "13-denied-mobile", 390, 844);
});
for (const kind of ["upload", "detach"] as const)
  test(`late committed ${kind} cannot restore old draft or notice across A→B→A`, async ({
    page,
    request,
  }) => {
    const f = await fixture(request);
    if (kind === "detach") await uploadApi(request, f);
    await login(page, f.writer, f.route);
    if (kind === "upload") await draft(page);
    let release!: () => void,
      arrive!: () => void,
      posts = 0;
    const held = new Promise<void>((r) => (release = r)),
      arrived = new Promise<void>((r) => (arrive = r));
    await page.route(
      `**${f.endpoint}${kind === "detach" ? "/*/detach" : ""}`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts++;
        const response = await route.fetch();
        expect(response.status()).toBe(kind === "upload" ? 201 : 200);
        arrive();
        await held;
        await route.fulfill({ response }).catch(() => {});
      },
    );
    try {
      if (kind === "upload")
        await region(page)
          .getByRole("button", { name: "Upload reference", exact: true })
          .click();
      else {
        await region(page)
          .getByRole("button", { name: "Detach reference", exact: true })
          .click();
        await region(page)
          .getByRole("button", { name: "Confirm detach", exact: true })
          .click();
      }
      await arrived;
      for (const [org, project, style] of [
        [f.b, f.pb, f.sb],
        [f.a, f.project, f.style],
      ]) {
        await page
          .getByRole("link", { name: "Organization", exact: true })
          .click();
        await page.getByRole("button", { name: org.name, exact: true }).click();
        await page
          .getByRole("link", { name: project.name, exact: true })
          .click();
        await page.getByRole("link", { name: style.name, exact: true }).click();
        await expect(region(page)).toBeVisible();
      }
      await expect(
        region(page).getByText(
          kind === "upload"
            ? "READY · Available to download"
            : "DETACHED · Detached",
          { exact: true },
        ),
      ).toBeVisible();
      release();
      await expect(
        region(page).getByLabel("Display name", { exact: true }),
      ).toHaveValue("");
      await expect(
        region(page).getByText("Reference uploaded · READY.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        region(page).getByText(
          "Reference detached. Metadata and any bytes remain retained.",
          { exact: true },
        ),
      ).toHaveCount(0);
      expect(posts).toBe(1);
      const authoritative = await request.get(api + f.endpoint, {
        headers: f.headers,
      });
      expect(authoritative.status()).toBe(200);
      const data = await authoritative.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].state).toBe(
        kind === "upload" ? "READY" : "DETACHED",
      );
    } finally {
      release();
    }
  });
