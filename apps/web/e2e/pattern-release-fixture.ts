import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export const api = "http://127.0.0.1:8080",
  pdf = Buffer.from("%PDF-1.4\nsynthetic exact Phase 3F artifact\n%%EOF\n");
export function sql(statement: string) {
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw Error("Synthetic local database required");
  return execFileSync(
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
      encoding: "utf8",
      input: statement,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
export async function setup(request: APIRequestContext) {
  const suffix = randomUUID(),
    owner = "release-owner-" + suffix,
    recipient = "release-recipient-" + suffix,
    viewer = "release-viewer-" + suffix,
    sourceViewer = "release-source-viewer-" + suffix,
    sourceAdmin = "release-source-admin-" + suffix,
    both = "release-both-" + suffix;
  const headers = { "X-Dev-Subject": owner },
    recipientHeaders = { "X-Dev-Subject": recipient };
  const create = async (path: string, data: unknown, h = headers) => {
    const r = await request.post(api + path, { headers: h, data });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const a = await create("/api/organizations", {
      name: "Release Source " + suffix,
    }),
    b = await create(
      "/api/organizations",
      { name: "Release Recipient " + suffix },
      recipientHeaders,
    );
  const project = await create(`/api/v1/organizations/${a.id}/projects`, {
    name: "Release source Project",
  });
  const style = await create(
    `/api/v1/organizations/${a.id}/projects/${project.id}/styles`,
    { name: "Release source Style" },
  );
  const patternRoot = `/api/v1/organizations/${a.id}/projects/${project.id}/styles/${style.id}/patterns`,
    pattern = await create(patternRoot, { name: "Exact release Pattern" }),
    endpoint = patternRoot + "/" + pattern.id;
  const uploaded = await request.post(api + endpoint + "/artifact-revisions", {
    headers,
    multipart: {
      metadata: {
        name: "metadata",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            expectedLatestRevisionNumber: 1,
            name: "Exact release artifact",
            purpose: null,
            measurementRevisionId: null,
            declaredFormat: "PDF",
            displayName: "검토용 exact.pdf",
          }),
        ),
      },
      file: { name: "ignored.pdf", mimeType: "application/pdf", buffer: pdf },
    },
  });
  expect(uploaded.status()).toBe(201);
  const ready = await uploaded.json();
  sql(
    `BEGIN;INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES ('${randomUUID()}','${b.id}','urn:source-os:local','${viewer}','VIEWER'),('${randomUUID()}','${a.id}','urn:source-os:local','${sourceViewer}','VIEWER'),('${randomUUID()}','${a.id}','urn:source-os:local','${sourceAdmin}','ORG_ADMIN'),('${randomUUID()}','${a.id}','urn:source-os:local','${both}','ORG_ADMIN'),('${randomUUID()}','${b.id}','urn:source-os:local','${both}','ORG_ADMIN');COMMIT;`,
  );
  const sourceApi = endpoint + `/revisions/${ready.revision.id}/releases`,
    consentApi = `/api/v1/organizations/${b.id}/release-consents`,
    inboxApi = `/api/v1/organizations/${b.id}/received-pattern-releases`;
  return {
    a,
    b,
    project,
    style,
    pattern,
    ready,
    endpoint,
    sourceApi,
    sourceRoute: sourceApi.replace("/api/v1", ""),
    consentApi,
    consentRoute: consentApi.replace("/api/v1", ""),
    inboxApi,
    inboxRoute: inboxApi.replace("/api/v1", ""),
    owner,
    recipient,
    viewer,
    sourceViewer,
    sourceAdmin,
    both,
    headers,
    recipientHeaders,
  };
}
export type F = Awaited<ReturnType<typeof setup>>;
export async function issue(request: APIRequestContext, f: F) {
  const r = await request.post(api + f.consentApi, {
    headers: f.recipientHeaders,
    data: { sourceOrganizationId: f.a.id },
  });
  expect(r.status()).toBe(201);
  return r.json();
}
export async function release(
  request: APIRequestContext,
  f: F,
  seconds = 86400,
  subject = f.owner,
) {
  const consent = await issue(request, f),
    r = await request.post(api + f.sourceApi, {
      headers: { "X-Dev-Subject": subject },
      data: {
        consentId: consent.id,
        expectedLatestConsentEventNumber: 1,
        purpose: "Explicit outbound exact artifact",
        accessDurationSeconds: seconds,
      },
    });
  expect(r.status()).toBe(201);
  return { consent, ...(await r.json()) };
}
export async function login(
  page: Page,
  f: F,
  path = f.inboxRoute,
  subject = f.recipient,
) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(subject);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
export async function createForm(page: Page, consent: string) {
  await page
    .getByRole("button", { name: "Prepare exact release", exact: true })
    .click();
  await expect(page.getByText(/검토용 exact.pdf · PDF/)).toBeVisible();
  await page
    .getByLabel("Recipient-issued consent ID", { exact: true })
    .fill(consent);
  await page
    .getByLabel("Purpose shared with recipient", { exact: true })
    .fill("Explicit outbound exact artifact");
  await page.getByLabel(/I verified this consent/).check();
}
export async function choose(page: Page, name: string) {
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Received releases", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recipient inbox", exact: true }),
  ).toBeVisible();
}
