import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  setup,
  issue,
  release,
  login,
  createForm,
  choose,
  api,
  pdf,
  type F,
} from "./pattern-release-fixture";
const mode = process.env.VITE_API_BASE_URL ? "separate-origin" : "same-origin",
  artifacts = fileURLToPath(
    new URL(`../../../.local/phase3f-review/${mode}/`, import.meta.url),
  );
function traffic(page: Page) {
  const calls: { method: string; url: string }[] = [];
  page.on("request", (r) => {
    if (
      /\/(?:releases|release-consents|received-pattern-releases)(?:\/|\?|$)/.test(
        r.url(),
      )
    )
      calls.push({ method: r.method(), url: r.url() });
  });
  return calls;
}
async function capture(page: Page, name: string) {
  mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 820, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.SOURCE_OS_VISUAL_REVIEW)
      await page.screenshot({
        path: artifacts + name + "-" + width + ".png",
        fullPage: true,
      });
  }
}
async function bytes(page: Page) {
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download exact artifact", exact: true })
    .click();
  const downloaded = await event;
  expect(downloaded.suggestedFilename()).toBe("검토용 exact.pdf");
  const path = await downloaded.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!)).toEqual(pdf);
}
async function exact(page: Page, f: F, id: string, subject = f.recipient) {
  await login(page, f, f.inboxRoute + "/" + id, subject);
  await expect(
    page.getByRole("button", { name: "Download exact artifact", exact: true }),
  ).toBeVisible();
}

test("real recipient consent → exact source release → recipient inbox and exact private bytes", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    calls = traffic(page);
  await login(page, f, f.consentRoute);
  await page
    .getByLabel("Intended source Organization UUID", { exact: true })
    .fill(f.a.id);
  await page
    .getByRole("button", { name: "Issue consent", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Exact consent" }),
  ).toContainText("ISSUED");
  const consents = await request.get(api + f.consentApi, {
    headers: f.recipientHeaders,
  });
  const c = (await consents.json()).items[0];
  expect(c.sourceOrganizationId).toBe(f.a.id);
  await login(page, f, f.sourceRoute, f.owner);
  await createForm(page, c.id);
  await capture(page, "source-ready-form");
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Source release detail" }),
  ).toContainText("ACTIVE");
  const source = await request.get(api + f.sourceApi, { headers: f.headers }),
    r = (await source.json()).items[0];
  expect(r.patternRevisionId).toBe(f.ready.revision.id);
  expect(r.artifactId).toBe(f.ready.artifact.id);
  await login(page, f);
  await page.getByRole("link", { name: /검토용 exact.pdf · ACTIVE/ }).click();
  await expect(
    page.getByText("Explicit outbound exact artifact", { exact: true }),
  ).toBeVisible();
  expect(calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(0);
  await capture(page, "recipient-active");
  await bytes(page);
  const content = calls.filter((r) => r.url.endsWith("/content"));
  expect(content).toHaveLength(1);
  expect(new URL(content[0].url).origin).toBe(
    process.env.VITE_API_BASE_URL || "http://127.0.0.1:5173",
  );
  const storage = await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    databases:
      typeof indexedDB.databases === "function"
        ? await indexedDB.databases()
        : [],
    serviceWorkers:
      "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).length
        : 0,
  }));
  expect(storage).toEqual({
    local: [],
    session: [],
    databases: [],
    serviceWorkers: 0,
  });
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    artifacts + "happy-flow.json",
    JSON.stringify(
      {
        calls,
        revision: r.patternRevisionId,
        artifact: r.artifactId,
        binaryBytes: pdf.length,
        storage,
      },
      null,
      2,
    ),
  );
});
test("recipient VIEWER downloads without source membership or consent administration", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f);
  await exact(page, f, r.release.id, f.viewer);
  await bytes(page);
  await login(page, f, f.consentRoute, f.viewer);
  await expect(
    page.getByText(
      "Only Organization Owners and Admins may administer consents.",
      { exact: true },
    ),
  ).toBeVisible();
  const denied = await request.post(
    api + f.consentApi + "/" + r.consent.id + "/withdrawals",
    {
      headers: { "X-Dev-Subject": f.viewer },
      data: { expectedLatestEventNumber: 2 },
    },
  );
  expect(denied.status()).toBe(403);
});
test("source VIEWER reads receipts but cannot create or revoke", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f),
    c = await issue(request, f);
  await login(page, f, f.sourceRoute, f.sourceViewer);
  await expect(
    page.getByRole("heading", { name: "Release receipts for this revision" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prepare exact release", exact: true }),
  ).toHaveCount(0);
  const denied = await request.post(api + f.sourceApi, {
    headers: { "X-Dev-Subject": f.sourceViewer },
    data: {
      consentId: c.id,
      expectedLatestConsentEventNumber: 1,
      purpose: "Denied source viewer",
    },
  });
  expect(denied.status()).toBe(403);
  expect(
    (
      await request.post(
        api + f.sourceApi + "/" + r.release.id + "/revocations",
        {
          headers: { "X-Dev-Subject": f.sourceViewer },
          data: { expectedLatestEventNumber: 1 },
        },
      )
    ).status(),
  ).toBe(403);
});
test("source ADMIN explicitly creates a release against the same fixed policy", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    c = await issue(request, f);
  await login(page, f, f.sourceRoute, f.sourceAdmin);
  await createForm(page, c.id);
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Source release detail" }),
  ).toContainText("ACTIVE");
});
for (const terminal of ["revoke", "withdraw"] as const)
  test(`permanent ${terminal} removes recipient content and private projection`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      r = await release(request, f);
    if (terminal === "revoke") {
      await login(page, f, f.sourceRoute, f.owner);
      await page
        .getByRole("button", { name: new RegExp(r.release.id) })
        .click();
      await page.getByLabel(/I understand revocation is permanent/).check();
      await page
        .getByRole("button", {
          name: "Revoke release permanently",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("region", { name: "Source release detail" }),
      ).toContainText("REVOKED");
    } else {
      await login(page, f, f.consentRoute);
      await page
        .getByRole("button", { name: new RegExp(r.consent.id) })
        .click();
      await page.getByLabel(/I understand withdrawal is permanent/).check();
      await page
        .getByRole("button", {
          name: "Withdraw consent permanently",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("region", { name: "Exact consent" }),
      ).toContainText("WITHDRAWN");
    }
    await login(page, f, f.inboxRoute + "/" + r.release.id);
    await expect(
      page.getByText(terminal === "revoke" ? "REVOKED" : "WITHDRAWN", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Download exact artifact",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Explicit outbound exact artifact", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(api + f.inboxApi + "/" + r.release.id + "/content", {
          headers: f.recipientHeaders,
        })
      ).status(),
    ).toBe(404);
    await capture(page, "recipient-" + terminal);
  });
test("new revision never replaces an existing release", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f);
  const next = await request.post(api + f.endpoint + "/revisions", {
    headers: f.headers,
    data: {
      expectedLatestRevisionNumber: 2,
      name: "Unreleased metadata revision",
    },
  });
  expect(next.status()).toBe(201);
  await exact(page, f, r.release.id);
  await expect(page.getByText(new RegExp(f.ready.revision.id))).toBeVisible();
  await bytes(page);
});
test("metadata invalidation and archive/reactivation cannot resurrect the old release", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f);
  for (const [status, version] of [
    ["ARCHIVED", 0],
    ["ACTIVE", 1],
  ] as const) {
    const response = await request.put(api + f.endpoint, {
      headers: f.headers,
      data: { status, version },
    });
    expect(response.status()).toBe(200);
  }
  await login(page, f, f.inboxRoute + "/" + r.release.id);
  await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download exact artifact", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.get(api + f.inboxApi + "/" + r.release.id + "/content", {
        headers: f.recipientHeaders,
      })
    ).status(),
  ).toBe(404);
});
test("ambiguous committed creation preserves draft, reconciles without transparent resend", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    c = await issue(request, f),
    calls = traffic(page);
  await page.route("**" + f.sourceApi, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(201);
    await route.abort("failed");
  });
  await login(page, f, f.sourceRoute, f.owner);
  await createForm(page, c.id);
  await page
    .getByRole("button", { name: "Create release", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Reconcile uncertain outcome" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Purpose shared with recipient", { exact: true }),
  ).toHaveValue("Explicit outbound exact artifact");
  await expect(
    page.getByLabel("Recipient-issued consent ID", { exact: true }),
  ).toHaveValue(c.id);
  expect(calls.filter((r) => r.method === "POST")).toHaveLength(1);
  await page
    .getByRole("button", { name: "Refresh authoritative state", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "I reviewed the records; allow a new submission",
      exact: true,
    })
    .click();
  expect(calls.filter((r) => r.method === "POST")).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Create release", exact: true }),
  ).toBeEnabled();
});
test("real current-state background refresh keeps open release events pinned", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f),
    calls = traffic(page);
  await login(page, f, f.sourceRoute, f.owner);
  await page.getByRole("button", { name: new RegExp(r.release.id) }).click();
  await page
    .getByRole("button", { name: "Open release events", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Release events through 1",
      exact: true,
    }),
  ).toBeVisible();
  await page.clock.install();
  expect(
    (
      await request.post(
        api + f.sourceApi + "/" + r.release.id + "/revocations",
        { headers: f.headers, data: { expectedLatestEventNumber: 1 } },
      )
    ).status(),
  ).toBe(200);
  await page.clock.fastForward(31_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("region", { name: "Source release detail" }),
  ).toContainText("REVOKED");
  await expect(
    page.getByRole("heading", {
      name: "Release events through 1",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    calls
      .filter((r) => r.url.includes("/events"))
      .map((r) => new URL(r.url).searchParams.get("maxEventNumber")),
  ).toEqual(["1"]);
  await page
    .getByRole("button", { name: "Close release events", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open release events", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Release events through 2",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      calls
        .filter((r) => r.url.includes("/events"))
        .map((r) => new URL(r.url).searchParams.get("maxEventNumber")),
    )
    .toEqual(["1", "2"]);
});
for (const change of ["organization", "actor", "aba", "cancel"] as const)
  test(`held real binary after ${change} transition is discarded before Blob creation`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      r = await release(request, f);
    await page.addInitScript(() => {
      const original = URL.createObjectURL;
      Object.assign(window, { releaseBlobCount: 0 });
      URL.createObjectURL = function (blob) {
        Object.assign(window, {
          releaseBlobCount: Number(Reflect.get(window, "releaseBlobCount")) + 1,
        });
        return original.call(URL, blob);
      };
    });
    let resume!: () => void, started!: () => void, finished!: () => void;
    const held = new Promise<void>((resolve) => {
        resume = resolve;
      }),
      reading = new Promise<void>((resolve) => {
        started = resolve;
      }),
      delivered = new Promise<void>((resolve) => {
        finished = resolve;
      });
    const cancelled = page.waitForEvent("requestfailed", (request) =>
      request.url().endsWith("/content"),
    );
    await page.route(
      "**" + f.inboxApi + "/" + r.release.id + "/content",
      async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        started();
        await held;
        try {
          await route.fulfill({ response });
        } catch (error) {
          if (!route.request().failure()) throw error;
        } finally {
          finished();
        }
      },
    );
    await exact(page, f, r.release.id, f.both);
    await page
      .getByRole("button", { name: "Download exact artifact", exact: true })
      .click();
    await reading;
    if (change === "organization" || change === "aba") {
      await choose(page, f.a.name);
      if (change === "aba") await choose(page, f.b.name);
    } else if (change === "actor") {
      await page.getByLabel("Local development identity").fill(f.viewer);
      await page
        .getByRole("button", { name: "Switch local identity", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Download exact artifact",
          exact: true,
        }),
      ).toBeVisible();
    } else
      await page
        .getByRole("button", { name: "Cancel download", exact: true })
        .click();
    resume();
    await Promise.all([cancelled, delivered]);
    expect(
      await page.evaluate(() => Reflect.get(window, "releaseBlobCount")),
    ).toBe(0);
  });
test("current membership denial clears private detail and prevents future downloads", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f);
  await exact(page, f, r.release.id, f.viewer);
  const { sql } = await import("./pattern-release-fixture");
  sql(
    `UPDATE membership SET status='REVOKED' WHERE organization_id='${f.b.id}' AND subject='${f.viewer}';`,
  );
  await page.clock.install();
  await page.clock.fastForward(31_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByRole("heading", { name: "Access denied", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Explicit outbound exact artifact", { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await request.get(api + f.inboxApi + "/" + r.release.id + "/content", {
        headers: { "X-Dev-Subject": f.viewer },
      })
    ).status(),
  ).toBe(403);
});

for (const parent of ["source", "recipient", "project", "style"] as const)
  test(`actual ${parent} metadata update invalidates access without a revoke event`, async ({
    page,
    request,
  }) => {
    const f = await setup(request),
      r = await release(request, f);
    const organization = parent === "source" || parent === "recipient";
    const path = organization
      ? `/api/organizations/${parent === "source" ? f.a.id : f.b.id}`
      : parent === "project"
        ? `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`
        : `/api/v1/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
    const data = organization
      ? { name: "Renamed release context", version: 0 }
      : parent === "project"
        ? {
            name: "Renamed source Project",
            description: null,
            status: "ACTIVE",
            version: 0,
          }
        : {
            name: "Renamed source Style",
            description: null,
            styleCode: null,
            status: "ACTIVE",
            version: 0,
          };
    const headers = parent === "recipient" ? f.recipientHeaders : f.headers;
    const changed = organization
      ? await request.patch(api + path, { headers, data })
      : await request.put(api + path, { headers, data });
    expect(changed.status()).toBe(200);
    await login(page, f, f.inboxRoute + "/" + r.release.id);
    await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Explicit outbound exact artifact", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Download exact artifact",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(api + f.inboxApi + "/" + r.release.id + "/content", {
          headers: f.recipientHeaders,
        })
      ).status(),
    ).toBe(404);
    const events = await request.get(
      api + f.sourceApi + "/" + r.release.id + "/events",
      { headers: f.headers },
    );
    expect(events.status()).toBe(200);
    expect(
      (await events.json()).items.map((event: { kind: string }) => event.kind),
    ).toEqual(["ACTIVATED"]);
  });

test("real older release page and selected receipt survive a newer committed release", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const f = await setup(request),
    rows = [];
  for (let i = 0; i < 27; i++) rows.push(await release(request, f));
  const calls = traffic(page);
  await login(page, f, f.sourceRoute, f.owner);
  await page
    .getByRole("button", { name: "Older records", exact: true })
    .click();
  const selected = rows[0].release;
  await page.getByRole("button", { name: new RegExp(selected.id) }).click();
  await expect(
    page.getByRole("region", { name: "Source release detail" }),
  ).toContainText(selected.id);
  const older = calls
    .filter(
      (r) => r.method === "GET" && new URL(r.url).pathname === f.sourceApi,
    )
    .map((r) => new URL(r.url).searchParams.get("cursor"));
  expect(older).toHaveLength(2);
  expect(older[0]).toBeNull();
  expect(older[1]).toBeTruthy();
  await page.clock.install();
  const newest = await release(request, f);
  const refreshed = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      new URL(r.url()).pathname === f.sourceApi,
  );
  await page.clock.fastForward(31_000);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  expect((await refreshed).status()).toBe(200);
  await expect(
    page.getByRole("region", { name: "Source release detail" }),
  ).toContainText(selected.id);
  await expect(
    page.getByRole("button", { name: new RegExp(newest.release.id) }),
  ).toHaveCount(0);
  expect(
    calls
      .filter(
        (r) => r.method === "GET" && new URL(r.url).pathname === f.sourceApi,
      )
      .map((r) => new URL(r.url).searchParams.get("cursor")),
  ).toEqual([null, older[1], older[1]]);
  await page
    .getByRole("button", { name: "Return to newest records", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: new RegExp(newest.release.id) }),
  ).toBeVisible();
});

test("IA-01 trusted event window rejects a valid contradictory network timestamp on remount", async ({
  page,
  request,
}) => {
  const f = await setup(request),
    r = await release(request, f),
    calls = traffic(page);
  await login(page, f, f.sourceRoute, f.owner);
  await page.getByRole("button", { name: new RegExp(r.release.id) }).click();
  const path = f.sourceApi + "/" + r.release.id + "/events";
  const first = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === path && res.request().method() === "GET",
  );
  await page
    .getByRole("button", { name: "Open release events", exact: true })
    .click();
  const trusted = await (await first).json();
  const original = trusted.items[0].occurredAt as string;
  const changed = new Date(Date.parse(original) + 1000).toISOString();
  expect(changed).not.toBe(original);
  const history = page.getByRole("region", { name: "Pinned release events" });
  await expect(history).toContainText(original);
  const pattern = (url: URL) => url.pathname === path;
  await page.route(pattern, async (route) => {
    const real = await route.fetch();
    expect(real.status()).toBe(200);
    const candidate = await real.json();
    candidate.items[0].occurredAt = changed;
    await route.fulfill({ response: real, json: candidate });
  });
  await page
    .getByRole("button", { name: "Close release events", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open release events", exact: true })
    .click();
  await expect(history.getByRole("alert")).toBeVisible();
  await expect(history).not.toContainText(changed);
  await expect(
    history.getByRole("heading", {
      name: "Release events through 1",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    calls.filter((c) => c.method !== "GET" || c.url.endsWith("/content")),
  ).toEqual([]);
  await page.unroute(pattern);
  await history.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(history.getByRole("alert")).toHaveCount(0);
  await expect(history).toContainText(original);
  expect(calls.filter((c) => c.url.includes("/events"))).toHaveLength(3);
  expect(
    calls.filter((c) => c.method !== "GET" || c.url.endsWith("/content")),
  ).toEqual([]);
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    artifacts + "ia01-immutable-window.json",
    JSON.stringify(
      {
        original,
        rejected: changed,
        pinnedHead: 1,
        requests: calls,
        mutations: 0,
        binaryRequests: 0,
        recovered: true,
      },
      null,
      2,
    ),
  );
});
