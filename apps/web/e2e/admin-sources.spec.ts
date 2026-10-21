import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  activeSourceName,
  adminActor,
  buyerActor,
  evidenceId,
  inactiveSourceName,
  ownerActor,
  provisionAdminEvidence,
  revocableAdmin,
  revokeFixtureAdmin,
  secondAdmin,
} from "./admin-sources-fixture";
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin";
const reviewRoot = fileURLToPath(
  new URL(`../../../.local/phase1c5a-review/${mode}/`, import.meta.url),
);
test.beforeAll(async ({ request }) => {
  await provisionAdminEvidence(request);
});
async function login(page: Page, actor: string, path = "/admin/sources") {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
async function screenshot(
  page: Page,
  name: string,
  target?: Locator,
  mobile = false,
) {
  if (!process.env.SOURCE_OS_VISUAL_REVIEW) return;
  mkdirSync(reviewRoot, { recursive: true });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  if (target)
    await target.evaluate((node) =>
      node.scrollIntoView({ block: "start", inline: "nearest" }),
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: reviewRoot + name + ".png" });
  if (mobile) await page.setViewportSize({ width: 1440, height: 1000 });
}
async function selectLoaded(page: Page, name: string, edit = false) {
  const button = page.getByRole("button", {
    name: new RegExp(`^${edit ? "Edit" : "Select"} Source ${name}`),
  });
  await expect(
    page.getByText(/sources loaded/, { exact: false }).first(),
  ).not.toContainText("refreshing");
  for (
    let attempt = 0;
    attempt < 4 && (await button.count()) === 0;
    attempt++
  ) {
    const more = page.getByRole("button", {
      name: "Load more sources",
      exact: true,
    });
    if (!(await more.count())) break;
    await more.click();
    await expect(
      page.getByText(/sources loaded/, { exact: false }).first(),
    ).not.toContainText("refreshing");
  }
  await button.click();
}
test("buyers and ORG_OWNER are denied before protected reads; mobile denial is usable", async ({
  page,
}) => {
  const protectedReads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/admin/"))
      protectedReads.push(r.url());
  });
  await login(page, buyerActor);
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  expect(protectedReads).toEqual([]);
  await screenshot(
    page,
    "12-access-denied-mobile",
    page.getByRole("heading", { name: "Access denied" }),
    true,
  );
  await page.getByLabel("Local development identity").fill(ownerActor);
  await page.getByRole("button", { name: "Switch local identity" }).click();
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  expect(protectedReads).toEqual([]);
});
test("real protected Source → Record → Observation → Review workflow preserves contract semantics", async ({
  page,
}) => {
  const requests: { path: string; method: string; offset: string | null }[] =
    [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/v1/admin/"))
      requests.push({
        path: u.pathname,
        method: r.method(),
        offset: u.searchParams.get("offset"),
      });
  });
  await login(page, adminActor, "/admin");
  await expect(
    page.getByRole("heading", { name: "Curation workspace" }),
  ).toBeVisible();
  await screenshot(page, "01-admin-desktop");
  await page.getByRole("link", { name: "Open Sources & Evidence" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sources & Evidence" }),
  ).toBeVisible();
  await expect(
    page.getByText("25 sources loaded", { exact: true }),
  ).toBeVisible();
  expect(requests.filter((r) => r.method === "GET")).toEqual([
    { path: "/api/v1/admin/sources", method: "GET", offset: "0" },
  ]);
  await screenshot(page, "02-sources-desktop");
  await page
    .locator(".admin-source-list details")
    .first()
    .evaluate((node) => {
      (node as HTMLDetailsElement).open = true;
    });
  await screenshot(
    page,
    "13-source-properties-mobile",
    page.getByRole("heading", { name: "Data Sources", exact: true }),
    true,
  );
  await page
    .getByRole("button", { name: "Load more sources", exact: true })
    .click();
  await expect
    .poll(() =>
      requests
        .filter((r) => r.path === "/api/v1/admin/sources" && r.method === "GET")
        .map((r) => r.offset),
    )
    .toContain("25");
  const suffix = `${mode}-${Date.now()}`,
    code = `000-1c5a-0.Mixed-${suffix}`,
    name = `Operator provenance Source ${suffix}`,
    updated = `Updated operator Source ${suffix}`;
  await page.getByRole("button", { name: "New Source" }).click();
  await page.getByLabel("Source code", { exact: true }).fill(code);
  await page.getByLabel("Source name", { exact: true }).fill(name);
  await page
    .getByLabel("Namespace (optional)")
    .fill("Synthetic operator namespace");
  const baseUrl =
    "https://Example.com:443/Directory/Original?source=MiXeD%2Ftest";
  await page.getByLabel("Base URL (optional)").fill(baseUrl);
  await page
    .getByLabel("Source type", { exact: true })
    .selectOption("PUBLIC_DIRECTORY");
  await page
    .getByLabel("Normalization policy", { exact: true })
    .selectOption("TRIM");
  await expect(page.getByLabel("Active Source", { exact: true })).toBeChecked();
  await screenshot(
    page,
    "03-source-create-desktop",
    page.getByRole("heading", { name: "Create Source", exact: true }),
  );
  await screenshot(
    page,
    "09-source-form-mobile",
    page.getByRole("heading", { name: "Create Source", exact: true }),
    true,
  );
  const createResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/sources" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create Source", exact: true })
    .click();
  const created = await createResponse;
  expect(created.status()).toBe(200);
  expect(created.request().postDataJSON()).toMatchObject({
    sourceCode: code,
    baseUrl,
    version: 0,
    active: true,
  });
  await expect(page.getByText(/Source created\. Reference:/)).toBeVisible();
  await selectLoaded(page, name, true);
  await expect(
    page.getByRole("button", { name: new RegExp(`^Edit Source ${name}`) }),
  ).toBeVisible();
  await expect(page.getByLabel("Source code", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByLabel("Normalization policy", { exact: true }),
  ).toHaveAttribute("readonly", "");
  await page.getByLabel("Source name", { exact: true }).fill(updated);
  await screenshot(
    page,
    "04-source-edit-desktop",
    page.getByRole("heading", { name: "Edit Source", exact: true }),
  );
  await page.getByRole("button", { name: "Save Source", exact: true }).click();
  await expect(
    page.getByText(
      "Source updated. The current loaded pages and server version have been refreshed.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Loaded version: 1")).toBeVisible();
  await selectLoaded(page, updated);
  const raw = `  MiXeD-会社-${suffix}  `;
  await page
    .getByLabel("Record kind", { exact: true })
    .selectOption("MATERIAL_LISTING");
  await page.getByLabel("External record key", { exact: true }).fill(raw);
  const recordResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-records" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register / reuse record", exact: true })
    .click();
  const recordHttp = await recordResponse,
    record = await recordHttp.json();
  expect(recordHttp.status()).toBe(200);
  expect(recordHttp.request().postDataJSON().externalRecordKey).toBe(raw);
  expect(record.externalRecordKey).toBe(raw);
  expect(record.normalizedExternalRecordKey).toBe(raw.replace(/^ +| +$/g, ""));
  await expect(
    page.getByText("No observations recorded for this SourceRecord."),
  ).toBeVisible();
  await screenshot(
    page,
    "05-record-workflow-desktop",
    page.getByRole("heading", { name: "Current Record context" }),
  );
  const observationKey = `Operator-fact-${suffix}`;
  await page
    .getByLabel("Observation key", { exact: true })
    .fill(observationKey);
  await page
    .getByLabel("Observed at (UTC)", { exact: true })
    .fill("2026-10-21T10:30");
  await page
    .getByLabel("Retrieved at (UTC, optional)")
    .fill("2026-10-21T11:00");
  await page.getByLabel("Content hash (optional)").fill("b".repeat(64));
  await expect(page.getByLabel("Hash algorithm", { exact: true })).toHaveValue(
    "SHA-256",
  );
  const observationResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-observations" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  const observationHttp = await observationResponse,
    observation = await observationHttp.json();
  expect(observationHttp.status()).toBe(200);
  expect(observationHttp.request().postDataJSON()).toMatchObject({
    observedAt: "2026-10-21T10:30:00Z",
    retrievedAt: "2026-10-21T11:00:00Z",
    contentHash: "b".repeat(64),
    hashAlgorithm: "SHA-256",
  });
  await expect(
    page.getByText("1 observations loaded", { exact: true }),
  ).toBeVisible();
  await screenshot(
    page,
    "06-observation-desktop",
    page.getByRole("heading", { name: "Immutable Observations" }),
  );
  await screenshot(
    page,
    "10-observation-mobile",
    page.getByRole("heading", { name: "Immutable Observations" }),
    true,
  );
  // A second explicit submission with unchanged facts reuses this exact identity.
  const repeated = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/admin/source-observations" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  expect((await (await repeated).json()).id).toBe(observation.id);
  await expect(
    page.getByRole("button", { name: "Register Observation", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Observed at (UTC)", { exact: true })
    .fill("2026-10-22T10:30");
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "An Observation with this identity conflicts with the submitted facts.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Observation key", { exact: true })).toHaveValue(
    observationKey,
  );
  await screenshot(
    page,
    "08-conflict-preserved-draft-desktop",
    page.getByRole("heading", { name: "Immutable Observations" }),
  );
  await page.getByRole("button", { name: "Reset Observation draft" }).click();
  await page
    .getByRole("button", {
      name: `Open Reviews for ${observationKey}`,
      exact: true,
    })
    .click();
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("ACCEPTED");
  await page.getByLabel("License status (optional)").selectOption("PERMITTED");
  await page.getByLabel("Terms status (optional)").selectOption("UNKNOWN");
  await page
    .getByLabel("Review notes (optional)")
    .fill(
      "Synthetic operator evidence assessment; this Review does not modify the observed fact.",
    );
  const reviewResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname ===
        `/api/v1/admin/source-observations/${observation.id}/reviews` &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Append review", exact: true })
    .click();
  const reviewHttp = await reviewResponse;
  expect(reviewHttp.status()).toBe(200);
  expect(reviewHttp.request().postDataJSON()).toEqual({
    reviewStatus: "ACCEPTED",
    licenseStatus: "PERMITTED",
    termsStatus: "UNKNOWN",
    notes:
      "Synthetic operator evidence assessment; this Review does not modify the observed fact.",
  });
  await expect(
    page.getByText("1 reviews loaded", { exact: true }),
  ).toBeVisible();
  await screenshot(
    page,
    "07-review-desktop",
    page.getByRole("heading", { name: "Observation Reviews" }),
  );
  await screenshot(
    page,
    "11-review-mobile",
    page.getByRole("heading", { name: "Observation Reviews" }),
    true,
  );
  await screenshot(
    page,
    "14-observation-history-mobile",
    page.getByRole("heading", { name: "Observation history", exact: true }),
    true,
  );
  await screenshot(
    page,
    "15-review-history-mobile",
    page.getByRole("heading", { name: "Review history", exact: true }),
    true,
  );
  await selectLoaded(page, inactiveSourceName);
  await page
    .getByRole("button", { name: "Change Source and clear context" })
    .click();
  await expect(
    page.getByText(
      "New/reused SourceRecord registration requires an active Source.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Register / reuse record", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Observation key", { exact: true })).toHaveCount(
    0,
  );
  await login(page, adminActor); // reload gives a new memory-only session/context.
  await expect(page.getByLabel("Known SourceRecord UUID")).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Current Record context" }),
  ).toHaveCount(0);
  await page.getByLabel("Known SourceRecord UUID").fill(record.id);
  await page.getByRole("button", { name: "Open Record history" }).click();
  await expect(
    page.getByText(
      "An empty observation result does not prove whether this SourceRecord exists.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "UUID-only context: Source, provider, Record kind and external key are not known from this read.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    ),
  ).not.toContain(record.id);
  if (process.env.SOURCE_OS_VISUAL_REVIEW)
    writeFileSync(
      reviewRoot + "request-counts.json",
      JSON.stringify(requests, null, 2),
    );
});
test("real runtime PLATFORM_ADMIN revocation removes the open workspace and drafts", async ({
  page,
}) => {
  await login(page, revocableAdmin);
  await selectLoaded(page, activeSourceName);
  await page
    .getByLabel("External record key", { exact: true })
    .fill("Synthetic revocation draft");
  await page.getByRole("button", { name: "New Source" }).click();
  await page
    .getByLabel("Source name", { exact: true })
    .fill("Draft before revocation");
  await page.getByLabel("Known SourceRecord UUID").fill(evidenceId(20));
  await page.getByRole("button", { name: "Open Record history" }).click();
  await page
    .getByLabel("Observation key", { exact: true })
    .fill("Observation draft before revocation");
  revokeFixtureAdmin();
  const check = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/identity/capabilities",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  expect((await (await check).json()).platformAdmin).toBe(false);
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Observation key", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(activeSourceName, { exact: false })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Source name", { exact: true })).toHaveCount(0);
});
test("late Actor A history cannot restore Record context or drafts for Actor B", async ({
  page,
}) => {
  await login(page, adminActor);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
      started = resolve;
    }),
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
  await page.route(
    `**/api/v1/admin/source-records/${evidenceId(20)}/observations*`,
    async (route) => {
      const response = await route.fetch();
      started();
      await hold;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await page.getByLabel("Known SourceRecord UUID").fill(evidenceId(20));
  await page.getByRole("button", { name: "Open Record history" }).click();
  await ready;
  await page
    .getByLabel("Observation key", { exact: true })
    .fill("Old Actor A observation draft");
  await page.getByLabel("Local development identity").fill(secondAdmin);
  await page.getByRole("button", { name: "Switch local identity" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sources & Evidence" }),
  ).toBeVisible();
  release();
  await expect(page.getByLabel("Known SourceRecord UUID")).toHaveValue("");
  await expect(page.getByLabel("Observation key", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Current Record context" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open Reviews for Fixture prerequisite Observation",
    }),
  ).toHaveCount(0);
});
