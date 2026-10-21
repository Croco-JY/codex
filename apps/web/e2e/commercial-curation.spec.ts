import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  curationAdmin,
  curationBuyer,
  curationOwner,
  curationId,
} from "./curation-fixture";
import {
  commercialCurationId as id,
  commercialListing,
  provisionCommercialCuration,
  commercialOther,
  commercialRevocable,
  revokeCommercialAdmin,
} from "./commercial-curation-fixture";
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 1000 } });
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin",
  root = fileURLToPath(
    new URL(`../../../.local/phase1c5d-review/${mode}/`, import.meta.url),
  ),
  api = "http://127.0.0.1:8080",
  headers = { "X-Dev-Subject": curationAdmin },
  at = "2026-10-21T00:00:00.123456Z";
test.beforeAll(async ({ request }) => {
  await provisionCommercialCuration(request);
});
async function login(page: Page, path: string, actor = curationAdmin) {
  await page.goto(path);
  await page.getByLabel("Local development identity").fill(actor);
  await page
    .getByRole("button", { name: "Use local identity", exact: true })
    .click();
  await expect(page.getByText("Session active", { exact: true })).toBeVisible();
}
const region = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
async function shot(
  page: Page,
  name: string,
  target?: Locator,
  mobile = false,
) {
  if (!process.env.SOURCE_OS_VISUAL_REVIEW) return;
  mkdirSync(root, { recursive: true });
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
  );
  if (target)
    await target.evaluate((el) =>
      el.scrollIntoView({ block: "start", inline: "nearest" }),
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: root + name + ".png" });
  if (mobile) await page.setViewportSize({ width: 1440, height: 1000 });
}
async function priceDraft(page: Page, observation = id(102)) {
  const a = region(page, "Manual Price creation");
  await a.getByLabel("Provider Source", { exact: true }).selectOption(id(100));
  await a
    .getByLabel("Price amount", { exact: true })
    .fill("999999999999999.9999");
  await a.getByLabel("Commercial currency", { exact: true }).fill("usd");
  await a.getByLabel("Fact price unit", { exact: true }).selectOption("METER");
  await a
    .getByLabel("Price valid from (UTC)", { exact: true })
    .fill("2020-01-01T00:00:00.000001Z");
  await a.getByLabel("Price observed at (UTC)", { exact: true }).fill(at);
  await a
    .getByLabel("Price Observation UUID 1", { exact: true })
    .fill(observation);
  return a;
}
async function inventoryDraft(page: Page, quantity = "0") {
  const a = region(page, "Manual Inventory observation");
  await a
    .getByLabel("Manual Inventory quantity", { exact: true })
    .fill(quantity);
  await a
    .getByLabel("Observation quantity unit", { exact: true })
    .selectOption("KG");
  await a.getByLabel("Inventory observed at (UTC)", { exact: true }).fill(at);
  return a;
}
const postResponse = (page: Page, path: string) =>
  page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === path && r.request().method() === "POST",
  );
test("5D buyer/owner denied before commercial reads and mutation bundles mount", async ({
  page,
  request,
}) => {
  const { listing } = await commercialListing(request);
  const seen: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.includes("material-prices"))
      seen.push(r.url());
  });
  for (const actor of [curationBuyer, curationOwner]) {
    await login(page, `/admin/listings/${listing.id}`, actor);
    await expect(
      page.getByRole("heading", { name: "Access denied" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Manual Price creation" }),
    ).toHaveCount(0);
  }
  expect(seen).toEqual([]);
  await shot(page, "23-access-denied", undefined, true);
});
test("real provenance Price create/evidence/close and MANUAL zero/new observation update shared buyer reads", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const { listing, variant } = await commercialListing(request);
  const seen: { method: string; path: string }[] = [];
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith("/api/v1/")) seen.push({ method: r.method(), path: p });
  });
  await login(page, "/admin/sources");
  await page.getByLabel("Known SourceRecord UUID").fill(id(101));
  await page
    .getByRole("button", { name: "Open Record history", exact: true })
    .click();
  await page
    .getByLabel("Observation key", { exact: true })
    .fill(`5D-real-evidence-${mode}-${Date.now()}`);
  await page
    .getByLabel("Observed at (UTC)", { exact: true })
    .fill("2026-10-21T00:00");
  const observationResponse = postResponse(
    page,
    "/api/v1/admin/source-observations",
  );
  await page
    .getByRole("button", { name: "Register Observation", exact: true })
    .click();
  const observation = await (await observationResponse).json();
  const listingEntryStart = seen.length;
  await login(page, `/admin/listings/${listing.id}`);
  await expect(
    page.getByRole("heading", { name: "Manual Price creation" }),
  ).toBeVisible();
  await shot(page, "01-listing-base");
  const a = await priceDraft(page, observation.id);
  await shot(page, "02-price-create", a);
  await shot(page, "17-price-create", a, true);
  await a
    .getByRole("button", { name: "Add supporting Observation", exact: true })
    .click();
  await a.getByLabel("Price Observation UUID 2", { exact: true }).fill(id(103));
  await shot(
    page,
    "03-provider-evidence",
    a.getByRole("group", { name: "Supporting Observation rows", exact: true }),
  );
  await shot(
    page,
    "18-evidence-rows",
    a.getByRole("group", { name: "Supporting Observation rows", exact: true }),
    true,
  );
  const initialListingReads = seen
    .slice(listingEntryStart)
    .filter((r) => r.method === "GET");
  const createdResponse = postResponse(page, "/api/v1/admin/material-prices");
  await a
    .getByRole("button", { name: "Create manual Price", exact: true })
    .click();
  const createdHttp = await createdResponse,
    created = await createdHttp.json(),
    key = createdHttp.request().headers()["idempotency-key"];
  expect(createdHttp.status()).toBe(200);
  expect(created.id).toBe(key);
  expect(created.amount).toBe("999999999999999.9999");
  expect(createdHttp.request().postDataJSON().currency).toBe("USD");
  await expect(a.getByText(/Price fact confirmed/)).toBeVisible();
  expect(
    seen.filter(
      (r) =>
        r.method === "GET" &&
        r.path.startsWith("/api/v1/admin/material-prices/") &&
        r.path.endsWith("/sources"),
    ),
  ).toHaveLength(0);
  const selectionStart = seen.length;
  await a
    .getByRole("button", { name: "Manage this Price", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show price history", exact: true })
    .click();
  await expect(
    page.getByText("1 price facts loaded", { exact: true }),
  ).toBeVisible();
  await shot(page, "04-price-history", region(page, "Price history"));
  await shot(
    page,
    "05-selected-open",
    region(page, "Selected Price management"),
  );
  await expect(
    region(page, "Price resolver").locator(".price-amount"),
  ).toContainText("999999999999999.9999");
  // Real same-key comparison deliberately excludes validTo. This is a test command, never an edit UI.
  const retry = await request.post(`${api}/api/v1/admin/material-prices`, {
    headers: { ...headers, "Idempotency-Key": key },
    data: {
      ...createdHttp.request().postDataJSON(),
      validTo: "2021-01-01T00:00:00Z",
    },
  });
  expect(retry.status()).toBe(200);
  const retried = await retry.json();
  expect(retried.id).toBe(key);
  expect(retried.validTo).toBeNull();
  const history = await request.get(
    `${api}/api/v1/material-listings/${listing.id}/prices`,
    { headers },
  );
  expect((await history.json()).items).toHaveLength(1);
  const e = region(page, "Selected Price evidence");
  await expect(
    e.getByText("2 supporting observations loaded", { exact: true }),
  ).toBeVisible();
  const selectedPriceReads = seen
    .slice(selectionStart)
    .filter((r) => r.method === "GET");
  await e.getByLabel("Additional Price Observation UUID").fill(id(202));
  const badEvidence = postResponse(
    page,
    `/api/v1/admin/material-prices/${created.id}/sources`,
  );
  await e
    .getByRole("button", { name: "Append Price evidence", exact: true })
    .click();
  expect((await badEvidence).status()).toBe(409);
  await expect(e.getByText(/provider or current integrity/)).toBeVisible();
  await expect(e.getByText(/Request reference:/)).toBeVisible();
  await shot(page, "10-price-evidence-conflict", e);
  await e.getByLabel("Additional Price Observation UUID").fill(id(102));
  const goodEvidence = postResponse(
    page,
    `/api/v1/admin/material-prices/${created.id}/sources`,
  );
  await e
    .getByRole("button", { name: "Append Price evidence", exact: true })
    .click();
  expect((await goodEvidence).status()).toBe(200);
  await expect(e.getByText(/Price version is unchanged/)).toBeVisible();
  await shot(page, "06-price-evidence", e);
  const close = region(page, "One-time Price close");
  await close
    .getByLabel("Close Price valid to (UTC)")
    .fill("2021-01-01T00:00:00.000002Z");
  await close.getByLabel("Confirm irreversible Price closure").check();
  await shot(page, "07-close-confirmation", close);
  await shot(page, "19-close", close, true);
  const closedResponse = postResponse(
    page,
    `/api/v1/admin/material-prices/${created.id}/close`,
  );
  await close.getByRole("button", { name: "Close Price", exact: true }).click();
  const closed = await (await closedResponse).json();
  expect(closed.version).toBe(1);
  expect(closed.validTo).toBe("2021-01-01T00:00:00.000002Z");
  await expect(
    page.getByRole("heading", { name: "Closed Price", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close Price", exact: true }),
  ).toHaveCount(0);
  await shot(
    page,
    "08-closed-price",
    region(page, "Selected Price management"),
  );
  await expect(
    region(page, "Price resolver").getByText("No match", { exact: true }),
  ).toHaveCount(2);
  const inv = await inventoryDraft(page);
  await inv
    .getByLabel("Observation Variant (optional)")
    .selectOption(variant.id);
  await inv.getByLabel("Known Facility UUID", { exact: true }).fill(id(10));
  await inv
    .getByRole("button", { name: "Resolve known Facility", exact: true })
    .click();
  await inv
    .getByRole("button", { name: "Use resolved Facility", exact: true })
    .click();
  await shot(page, "11-inventory-create", inv);
  await shot(page, "20-inventory-create", inv, true);
  const invResponse = postResponse(
    page,
    "/api/v1/admin/material-inventory-snapshots",
  );
  await inv
    .getByRole("button", { name: "Record manual observation", exact: true })
    .click();
  const invHttp = await invResponse,
    snapshot = await invHttp.json(),
    body = invHttp.request().postDataJSON();
  expect(snapshot.quantity).toBe("0.0000");
  expect(body.captureMode).toBe("MANUAL");
  expect(body.sourceObservationId).toBeUndefined();
  expect(body.actorSubject).toBeUndefined();
  expect(body.version).toBeUndefined();
  await expect(
    region(page, "Inventory knowledge").getByText(
      "Known zero quantity for this observation scope",
      { exact: true },
    ),
  ).toBeVisible();
  await shot(page, "12-known-zero", region(page, "Inventory knowledge"));
  const same = await request.post(
    `${api}/api/v1/admin/material-inventory-snapshots`,
    { headers, data: body },
  );
  expect(same.status()).toBe(200);
  expect((await same.json()).id).toBe(snapshot.id);
  for (const changed of [
    { quantity: "1" },
    { unit: "GRAM" },
    { facilityId: undefined },
    { materialVariantId: undefined },
    { observedAt: "2026-10-21T00:00:00.123457Z" },
  ]) {
    const r = await request.post(
      `${api}/api/v1/admin/material-inventory-snapshots`,
      { headers, data: { ...body, ...changed } },
    );
    expect(r.status()).toBe(409);
  }
  const other = await request.post(
    `${api}/api/v1/admin/material-inventory-snapshots`,
    { headers: { "X-Dev-Subject": commercialOther }, data: body },
  );
  expect(other.status()).toBe(409);
  // Database identity is Listing + key; a controlled API probe verifies that
  // another Listing is distinct. The UI itself always generates a fresh key.
  const alternateResponse = await request.post(
    `${api}/api/v1/admin/material-listings`,
    {
      headers,
      data: {
        materialId: listing.materialId,
        sellerSupplierId: listing.sellerSupplierId,
        status: "ACTIVE",
        observationId: id(102),
        version: 0,
      },
    },
  );
  expect(alternateResponse.status()).toBe(200);
  const alternate = await alternateResponse.json();
  const distinct = await request.post(
    `${api}/api/v1/admin/material-inventory-snapshots`,
    { headers, data: { ...body, listingId: alternate.id } },
  );
  expect(distinct.status()).toBe(200);
  expect((await distinct.json()).id).not.toBe(snapshot.id);

  await inv
    .getByRole("button", { name: "Record a new observation", exact: true })
    .click();
  await inventoryDraft(page, "12.3456");
  await inv
    .getByLabel("Observation Variant (optional)")
    .selectOption(variant.id);
  await inv.getByLabel("Observation Facility (optional)").selectOption(id(10));
  await inv
    .getByLabel("Inventory observed at (UTC)")
    .fill("2026-10-21T00:00:00.123457Z");
  const inv2Response = postResponse(
    page,
    "/api/v1/admin/material-inventory-snapshots",
  );
  await inv
    .getByRole("button", { name: "Record manual observation", exact: true })
    .click();
  const inv2Http = await inv2Response;
  expect(inv2Http.request().postDataJSON().manualIdempotencyKey).not.toBe(
    body.manualIdempotencyKey,
  );
  await expect(
    region(page, "Inventory knowledge").getByText("12.3456", { exact: false }),
  ).toBeVisible();
  await expect(
    region(page, "Inventory knowledge").getByText(
      "1 observation scopes loaded",
      { exact: true },
    ),
  ).toBeVisible();
  await shot(
    page,
    "13-inventory-knowledge",
    region(page, "Inventory knowledge"),
  );
  await page
    .getByRole("button", { name: "Show inventory history", exact: true })
    .click();
  await expect(
    page.getByText("2 historical observations loaded", { exact: true }),
  ).toBeVisible();
  await shot(page, "14-inventory-history", region(page, "Inventory history"));
  await shot(
    page,
    "21-inventory-history",
    region(page, "Inventory history"),
    true,
  );
  await page
    .getByRole("link", { name: "Open buyer Listing view", exact: true })
    .click();
  await expect(
    region(page, "Inventory knowledge").getByText("12.3456", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show price history", exact: true })
    .click();
  await expect(
    page.getByText("1 price facts loaded", { exact: true }),
  ).toBeVisible();
  await expect(region(page, "Price history")).toContainText(
    "999999999999999.9999",
  );
  if (process.env.SOURCE_OS_VISUAL_REVIEW)
    writeFileSync(
      root + "request-fanout.json",
      JSON.stringify(
        {
          listing: listing.id,
          initialListingReads,
          selectedPriceReads,
          requests: seen,
        },
        null,
        2,
      ),
    );
});
test("real committed Price/Inventory transport loss retains exact commands and permits explicit deduplicated retry", async ({
  page,
  request,
}) => {
  const { listing } = await commercialListing(request);
  await login(page, `/admin/listings/${listing.id}`);
  const priceRequests: { key: string; body: unknown }[] = [];
  let losePrice = true;
  await page.route("**/api/v1/admin/material-prices", async (route) => {
    priceRequests.push({
      key: route.request().headers()["idempotency-key"]!,
      body: route.request().postDataJSON(),
    });
    if (losePrice) {
      losePrice = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  const a = await priceDraft(page);
  await a
    .getByLabel("Price valid to (UTC, optional)")
    .fill("2030-01-01T00:00:00.000001Z");
  await a
    .getByRole("button", { name: "Create manual Price", exact: true })
    .click();
  await expect(
    a.getByRole("heading", { name: "Price creation outcome unknown" }),
  ).toBeVisible();
  await expect(a.getByLabel("Price amount", { exact: true })).toBeDisabled();
  await expect(
    a.getByText(/A Price with this command reference is visible/),
  ).toBeVisible();
  expect(priceRequests).toHaveLength(1);
  await shot(
    page,
    "09-price-ambiguous",
    a
      .getByRole("heading", { name: "Price creation outcome unknown" })
      .locator(".."),
  );
  await shot(
    page,
    "22-ambiguous",
    a
      .getByRole("heading", { name: "Price creation outcome unknown" })
      .locator(".."),
    true,
  );
  await a
    .getByRole("button", { name: "Retry same Price intention", exact: true })
    .click();
  await expect(a.getByText(/Price fact confirmed/)).toBeVisible();
  expect(priceRequests).toHaveLength(2);
  expect(priceRequests[1]).toEqual(priceRequests[0]);
  const h = await request.get(
    `${api}/api/v1/material-listings/${listing.id}/prices`,
    { headers },
  );
  expect((await h.json()).items).toHaveLength(1);
  const inventoryRequests: unknown[] = [];
  let loseInventory = true;
  await page.route(
    "**/api/v1/admin/material-inventory-snapshots",
    async (route) => {
      inventoryRequests.push(route.request().postDataJSON());
      if (loseInventory) {
        loseInventory = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    },
  );
  const inv = await inventoryDraft(page, "12.3456");
  await inv
    .getByRole("button", { name: "Record manual observation", exact: true })
    .click();
  await expect(
    inv.getByRole("heading", { name: "Inventory recording outcome unknown" }),
  ).toBeVisible();
  await expect(inv.getByText(/The manual Snapshot exists/)).toBeVisible();
  await expect(inv.getByLabel("Manual Inventory quantity")).toBeDisabled();
  expect(inventoryRequests).toHaveLength(1);
  await shot(
    page,
    "15-inventory-ambiguous",
    inv
      .getByRole("heading", { name: "Inventory recording outcome unknown" })
      .locator(".."),
  );
  await inv
    .getByRole("button", {
      name: "Retry same Inventory intention",
      exact: true,
    })
    .click();
  await expect(inv.getByText(/Manual Snapshot confirmed/)).toBeVisible();
  expect(inventoryRequests[1]).toEqual(inventoryRequests[0]);
  const snapshots = await request.get(
    `${api}/api/v1/material-listings/${listing.id}/inventory-snapshots`,
    { headers },
  );
  expect((await snapshots.json()).items).toHaveLength(1);
});
test("archived Listing and real competing Close preserve intended draft without automatic second close", async ({
  page,
  request,
}) => {
  const { listing } = await commercialListing(request, "ARCHIVED"),
    key = randomUUID(),
    body = {
      listingId: listing.id,
      dataSourceId: id(100),
      amount: "58.0001",
      currency: "JPY",
      priceUnit: "METER",
      validFrom: "2020-01-01T00:00:00.000001Z",
      observedAt: at,
      observationIds: [id(102)],
    };
  const create = await request.post(`${api}/api/v1/admin/material-prices`, {
    headers: { ...headers, "Idempotency-Key": key },
    data: body,
  });
  expect(create.status()).toBe(200);
  await login(page, `/admin/listings/${listing.id}`);
  await expect(page.getByText(/This record is archived/)).toBeVisible();
  await shot(page, "16-archived-listing");
  await page
    .getByRole("button", { name: "Show price history", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Manage Price · ${key}`, exact: true })
    .click();
  const close = region(page, "One-time Price close");
  await close
    .getByLabel("Close Price valid to (UTC)")
    .fill("2022-01-01T00:00:00.123456Z");
  await close.getByLabel("Confirm irreversible Price closure").check();
  const competitor = await request.post(
    `${api}/api/v1/admin/material-prices/${key}/close`,
    { headers, data: { validTo: "2023-01-01T00:00:00.123456Z", version: 0 } },
  );
  expect(competitor.status()).toBe(200);
  let attempts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === `/api/v1/admin/material-prices/${key}/close`
    )
      attempts++;
  });
  const response = postResponse(
    page,
    `/api/v1/admin/material-prices/${key}/close`,
  );
  await close.getByRole("button", { name: "Close Price", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(close.getByText(/different actual closure/)).toBeVisible();
  await expect(close.getByLabel("Close Price valid to (UTC)")).toHaveValue(
    "2022-01-01T00:00:00.123456Z",
  );
  await expect(
    close.getByRole("button", { name: "Close Price", exact: true }),
  ).toBeDisabled();
  expect(attempts).toBe(1);
  await shot(page, "24-close-conflict", close);
  await shot(
    page,
    "25-close-conflict",
    close.getByRole("region", { name: "Refreshed server Price" }),
    true,
  );
});
test("late Actor A completion and runtime revocation discard command identities, drafts and evidence", async ({
  page,
  request,
}) => {
  const { listing } = await commercialListing(request);
  await login(page, `/admin/listings/${listing.id}`);
  const a = await priceDraft(page);
  let captured!: () => void, release!: () => void, finished!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (captured = r)),
    done = new Promise<void>((r) => (finished = r));
  await page.route("**/api/v1/admin/material-prices", async (route) => {
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response }).catch(() => {});
    finished();
  });
  const key = (await a.getByText(/Price command reference:/).textContent())!;
  await a
    .getByRole("button", { name: "Create manual Price", exact: true })
    .click();
  await ready;
  await page.getByLabel("Local development identity").fill(commercialRevocable);
  await page
    .getByRole("button", { name: "Switch local identity", exact: true })
    .click();
  await expect(a.getByLabel("Price amount", { exact: true })).toHaveValue("");
  await expect(a.getByText(/Price command reference:/)).not.toHaveText(key);
  release();
  await done;
  await expect(a.getByText(/Price fact confirmed/)).toHaveCount(0);
  await page.unroute("**/api/v1/admin/material-prices");
  await priceDraft(page);
  await inventoryDraft(page);
  revokeCommercialAdmin();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Manual Price creation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Curation", exact: true }),
  ).toHaveCount(0);
});
