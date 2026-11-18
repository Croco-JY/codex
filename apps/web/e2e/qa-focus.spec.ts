import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { provisionWorkspace } from "./workspace-fixture";

const api = "http://127.0.0.1:8080";
const notes = "Distinctive unsaved QA focus draft — no manufacturing approval";
async function setup(request: APIRequestContext) {
  const f = await provisionWorkspace(request);
  const root = `/api/v1/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}/patterns`;
  const created = await request.post(api + root, { headers: f.headers, data: { name: "Focus QA Pattern" } });
  expect(created.status()).toBe(201);
  const pattern = await created.json(), endpoint = root + "/" + pattern.id;
  const uploaded = await request.post(api + endpoint + "/artifact-revisions", { headers: f.headers, multipart: {
    metadata: { name: "metadata", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      expectedLatestRevisionNumber: 1, name: "Exact focus QA artifact", declaredFormat: "PDF", displayName: "focus.pdf",
    })) },
    file: { name: "focus.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nsynthetic focus QA\n%%EOF\n") },
  } });
  expect(uploaded.status()).toBe(201);
  const ready = await uploaded.json(), qa = endpoint + "/revisions/" + ready.revision.id + "/qa";
  const first = await request.post(api + qa + "/assessments", { headers: f.headers, data: {
    expectedLatestAssessmentNumber: 0, outcome: "OBSERVED", evidenceBasis: "METADATA_ONLY", artifactId: null,
    notes: "Initial exact-revision observation",
  } });
  expect(first.status()).toBe(201);
  return { ...f, pattern, ready, qa, route: qa.replace("/api/v1", "") };
}
async function draft(page: Page, f: Awaited<ReturnType<typeof setup>>) {
  await page.goto(f.route);
  await page.getByLabel("Local development identity").fill(f.writer);
  await page.getByRole("button", { name: "Use local identity", exact: true }).click();
  await page.getByRole("button", { name: "Record QA assessment", exact: true }).click();
  await page.getByLabel("QA outcome", { exact: true }).selectOption("HUMAN_REVIEWED");
  await page.getByLabel("Review basis", { exact: true }).selectOption("READY_ARTIFACT");
  await page.getByLabel("Human review notes", { exact: true }).fill(notes);
  await expect(page.getByText("Exact READY artifact: " + f.ready.artifact.id)).toBeVisible();
}
const submit = (page: Page) => page.getByRole("button", { name: "Submit QA assessment", exact: true });
const dialog = (page: Page) => page.getByRole("alertdialog", { name: "Confirm human review attestation", exact: true });
const confirm = (page: Page) => dialog(page).getByRole("button", { name: "Confirm human review attestation", exact: true });
const cancel = (page: Page) => dialog(page).getByRole("button", { name: "Cancel attestation", exact: true });
async function open(page: Page) {
  await submit(page).focus(); await page.keyboard.press("Enter");
  await expect(confirm(page)).toBeFocused();
}
const snapshot = (page: Page) => page.getByRole("form", { name: "QA assessment draft" })
  .locator("input,select,textarea").evaluateAll(elements => elements.map(e => ({ id: e.id, value: (e as HTMLInputElement).value })));

for (const width of [390, 1440]) for (const mode of ["escape", "mouse", "enter", "space"] as const) {
  test(`QA dismissal restores keyboard continuation, width=${width}, mode=${mode}`, async ({ page, request }, info) => {
    const f = await setup(request), mutations: string[] = [];
    page.on("request", r => { if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method() + " " + new URL(r.url()).pathname); });
    await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
    const before = await snapshot(page), originalUrl = page.url();
    for (let cycle = 0; cycle < 3; cycle++) {
      await open(page); await expect(dialog(page)).toContainText(f.ready.artifact.id);
      if (mode === "escape") {
        await page.keyboard.press("Tab"); await expect(cancel(page)).toBeFocused();
        await page.keyboard.press("Escape");
      } else if (mode === "mouse") await cancel(page).click();
      else {
        await page.keyboard.press("Tab"); await expect(cancel(page)).toBeFocused();
        await page.keyboard.press(mode === "enter" ? "Enter" : "Space");
      }
      await expect(dialog(page)).toHaveCount(0); await expect(submit(page)).toBeFocused();
      expect(await submit(page).evaluate(e => e instanceof HTMLButtonElement && e === document.activeElement && e.isConnected && !e.disabled && e.getClientRects().length > 0)).toBe(true);
      if (mode !== "mouse") expect(await submit(page).evaluate(e => {
        const style = getComputedStyle(e);
        return e.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      })).toBe(true);
      expect(await snapshot(page)).toEqual(before);
      await expect(page.getByRole("form", { name: "QA assessment draft" })).toContainText("Draft baseline assessment 1; current latest 1");
      expect(page.url()).toBe(originalUrl); expect(mutations).toEqual([]);
    }
    await open(page); await expect(confirm(page)).toBeFocused(); expect(mutations).toEqual([]);
    await info.attach("focus-and-draft", { body: JSON.stringify({ width, mode, before, mutations, revision: f.ready.revision.id, artifact: f.ready.artifact.id }), contentType: "application/json" });
  });
}

test("QA confirmation keeps Tab and Shift+Tab within its two action controls", async ({ page, request }) => {
  const f = await setup(request); await draft(page, f); await open(page);
  await page.keyboard.press("Tab"); await expect(cancel(page)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(confirm(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(cancel(page)).toBeFocused();
  await page.keyboard.press("Escape"); await expect(submit(page)).toBeFocused();
});

test("QA repeated cancellation does not alter the one explicit affirmative request", async ({ page, request }) => {
  const f = await setup(request), posts: Record<string, unknown>[] = [];
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === f.qa + "/assessments") posts.push(r.postDataJSON()); });
  await draft(page, f); await open(page); await page.keyboard.press("Escape");
  await expect(submit(page)).toBeFocused(); await page.keyboard.press("Enter");
  await expect(confirm(page)).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.getByText("QA assessment recorded.", { exact: true })).toBeVisible();
  expect(posts).toEqual([{ expectedLatestAssessmentNumber: 1, outcome: "HUMAN_REVIEWED", evidenceBasis: "READY_ARTIFACT", artifactId: f.ready.artifact.id, notes }]);
  const current = await request.get(api + f.qa, { headers: f.headers }); expect(current.status()).toBe(200);
  expect((await current.json()).latestAssessment.assessmentNumber).toBe(2);
});

test("QA Actor replacement during dismissal cannot focus the retired editor or submit", async ({ page, request }) => {
  const f = await setup(request), mutations: string[] = [];
  page.on("request", r => { if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method()); });
  await draft(page, f); await open(page);
  await page.getByLabel("Local development identity").fill(f.viewer);
  // The real session control retires the Actor before the React Escape handler.
  // Observe native focus calls on the original node without changing the guard.
  await page.evaluate(() => {
    const original = document.querySelector<HTMLButtonElement>('form[aria-label="QA assessment draft"] button[type="submit"]')!;
    const focus = original.focus.bind(original), calls: { connected: boolean }[] = [];
    Object.defineProperty(window, "qaRetiredFocus", { value: { original, calls } });
    original.focus = () => { calls.push({ connected: original.isConnected }); focus(); };
    const change = [...document.querySelectorAll<HTMLButtonElement>("button")].find(e => e.textContent?.trim() === "Switch local identity")!;
    document.querySelector('[role="alertdialog"]')!.addEventListener("keydown", () => change.click(), { capture: true, once: true });
  });
  await confirm(page).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Your VIEWER membership provides read-only QA access.", { exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "QA assessment draft" })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const value = (window as unknown as { qaRetiredFocus: { original: HTMLElement; calls: unknown[] } }).qaRetiredFocus;
    return { connected: value.original.isConnected, calls: value.calls };
  })).toEqual({ connected: false, calls: [] });
  expect(mutations).toEqual([]);
});

for (const width of [390, 1440]) for (const parent of ["Project", "Style", "Pattern"] as const) {
  test(`QA ${parent} archive transfers open confirmation focus safely, width=${width}`, async ({ page, request }, info) => {
    test.setTimeout(95000); // Two genuine 31-second stale windows in the reactivation case.
    const f = await setup(request), mutations: string[] = [], posts: unknown[] = [];
    page.on("request", r => {
      if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method() + " " + new URL(r.url()).pathname);
      if (r.method() === "POST" && new URL(r.url()).pathname === f.qa + "/assessments") posts.push(r.postDataJSON());
    });
    await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
    const before = await snapshot(page), originalUrl = page.url(); await open(page);
    const alreadyOnCancel = parent === "Pattern" && width === 1440;
    if (alreadyOnCancel) { await page.keyboard.press("Tab"); await expect(cancel(page)).toBeFocused(); }
    await cancel(page).evaluate(e => {
      const original = e.focus.bind(e), calls: { connected: boolean }[] = [];
      Object.defineProperty(window, "qaEligibilityFocus", { value: calls });
      e.focus = (...args) => { calls.push({ connected: e.isConnected }); original(...args); };
    });
    const project = `/api/v1/organizations/${f.a.id}/projects/${f.project.id}`;
    const endpoint = parent === "Project" ? project : parent === "Style" ? project + `/styles/${f.style.id}`
      : project + `/styles/${f.style.id}/patterns/${f.pattern.id}`;
    const archiveBody = parent === "Project" ? { name: f.project.name, description: f.project.description, status: "ARCHIVED", version: 0 }
      : parent === "Style" ? { name: f.style.name, styleCode: f.style.styleCode, description: f.style.description, status: "ARCHIVED", version: 0 }
      : { status: "ARCHIVED", version: 0 };
    const archived = await request.put(api + endpoint, { headers: f.headers, data: archiveBody });
    expect(archived.status()).toBe(200); const archivedValue = await archived.json();
    // Exercise real parent Query refetch after its unchanged production stale interval.
    await page.waitForTimeout(31000); await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("QA is read-only while the Project, Style or Pattern is archived.", { exact: true })).toBeVisible();
    await expect(confirm(page)).toBeDisabled(); await expect(cancel(page)).toBeEnabled();
    await expect(cancel(page)).toBeFocused(); // No manual focus or keypress repairs the transition.
    expect(await cancel(page).evaluate(e => e === document.activeElement && e.isConnected && e.getClientRects().length > 0)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { qaEligibilityFocus: { connected: boolean }[] }).qaEligibilityFocus))
      .toEqual(alreadyOnCancel ? [] : [{ connected: true }]);
    await info.attach("eligibility-focus", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    for (const key of ["Tab", "Shift+Tab", "Tab"]) { await page.keyboard.press(key); await expect(cancel(page)).toBeFocused(); }
    await confirm(page).evaluate((e: HTMLButtonElement) => e.click()); // Native disabled activation cannot submit.
    expect(mutations).toEqual([]); expect(posts).toEqual([]); expect(await snapshot(page)).toEqual(before);
    await expect(dialog(page)).toContainText(f.ready.artifact.id);
    await expect(page.getByRole("form", { name: "QA assessment draft" })).toContainText("Draft baseline assessment 1; current latest 1");
    await page.keyboard.press(parent === "Project" ? "Escape" : parent === "Style" ? "Enter" : "Space");
    await expect(dialog(page)).toHaveCount(0); await expect(submit(page)).toBeDisabled();
    const fallback = page.getByRole("heading", { name: "Record a human assessment", exact: true });
    await expect(fallback).toBeFocused();
    expect(await fallback.evaluate(e => e.isConnected && e.getClientRects().length > 0 && !!e.closest('form[aria-label="QA assessment draft"]'))).toBe(true);
    expect(await snapshot(page)).toEqual(before); expect(page.url()).toBe(originalUrl); expect(mutations).toEqual([]);
    const current = await request.get(api + f.qa, { headers: f.headers }); expect(current.status()).toBe(200);
    expect((await current.json()).latestAssessment.assessmentNumber).toBe(1);
    if (alreadyOnCancel) {
      const reactivated = await request.put(api + endpoint, { headers: f.headers, data: { status: "ACTIVE", version: archivedValue.version } });
      expect(reactivated.status()).toBe(200);
      await page.waitForTimeout(31000); await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await expect(submit(page)).toBeEnabled(); expect(await snapshot(page)).toEqual(before); expect(mutations).toEqual([]);
      await open(page); await page.keyboard.press("Enter"); await expect(page.getByText("QA assessment recorded.", { exact: true })).toBeVisible();
      expect(posts).toEqual([{ expectedLatestAssessmentNumber: 1, outcome: "HUMAN_REVIEWED", evidenceBasis: "READY_ARTIFACT", artifactId: f.ready.artifact.id, notes }]);
      expect(mutations).toEqual(["POST " + f.qa + "/assessments"]);
    }
    await info.attach("eligibility-draft-and-network", { body: JSON.stringify({ width, parent, alreadyOnCancel, before, mutations, posts, revision: f.ready.revision.id, artifact: f.ready.artifact.id }), contentType: "application/json" });
  });
}

for (const width of [390, 1440]) {
  for (const mode of ["hidden", "disabled", "inert", "aria-hidden", "opacity", "class", "ancestor", "disconnected", "replaced"] as const) {
    test(`QA external eligibility repair preserves native keyboard continuation, width=${width}, mode=${mode}`, async ({ page, request }, info) => {
      const f = await setup(request), mutations: string[] = [];
      await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
      page.on("request", r => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method()); });
      const before = await snapshot(page); await open(page);
      await confirm(page).evaluate((button: HTMLButtonElement, mode) => {
        if (mode === "hidden") button.hidden = true;
        else if (mode === "disabled") button.disabled = true;
        else if (mode === "opacity") button.style.opacity = "0";
        else if (mode === "class") {
          const style = document.createElement("style"); style.textContent = ".qa-external-hidden { display:none; }";
          document.head.append(style); button.classList.add("qa-external-hidden");
        } else if (mode === "ancestor") {
          const wrapper = document.createElement("span"); button.before(wrapper); wrapper.append(button); wrapper.style.visibility = "hidden";
        } else if (mode === "disconnected") button.remove();
        else if (mode === "replaced") { const replacement = button.cloneNode(true) as HTMLButtonElement; replacement.hidden = true; button.replaceWith(replacement); }
        else button.setAttribute(mode, mode === "aria-hidden" ? "true" : "");
      }, mode);
      // Automatic repair must precede any repair key or manual focus operation.
      await expect(cancel(page)).toBeFocused();
      expect(await cancel(page).evaluate((e: HTMLButtonElement) => e.isConnected && !e.disabled && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))).toBe(true);
      for (const key of ["Shift+Tab", "Tab", "Tab", "Shift+Tab"]) { await page.keyboard.press(key); await expect(cancel(page)).toBeFocused(); }
      await page.keyboard.press("Escape"); await expect(submit(page)).toBeFocused();
      expect(await snapshot(page)).toEqual(before); expect(mutations).toEqual([]);
      await expect(page.getByRole("form", { name: "QA assessment draft" })).toContainText("Draft baseline assessment 1; current latest 1");
      const current = await request.get(api + f.qa, { headers: f.headers }); expect(current.status()).toBe(200);
      expect((await current.json()).latestAssessment.assessmentNumber).toBe(1);
      await info.attach("residual-invariants", { body: JSON.stringify({ width, mode, before, after: await snapshot(page), artifact: f.ready.artifact.id, revision: f.ready.revision.id, mutations }), contentType: "application/json" });
    });
  }
  test(`QA BODY keyboard boundary, container fallback and restored actions, width=${width}`, async ({ page, request }) => {
    const f = await setup(request), mutations: string[] = [];
    await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
    page.on("request", r => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method()); });
    const before = await snapshot(page); await open(page);
    for (const key of ["Tab", "Shift+Tab"]) {
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
      await page.keyboard.press(key);
      expect(await dialog(page).evaluate(e => e.contains(document.activeElement))).toBe(true);
    }
    await dialog(page).evaluate(e => e.querySelectorAll("button").forEach(b => b.disabled = true));
    await expect(dialog(page)).toBeFocused();
    await page.keyboard.press("Tab"); await expect(dialog(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(dialog(page)).toBeFocused();
    await cancel(page).evaluate((e: HTMLButtonElement) => e.disabled = false); await expect(cancel(page)).toBeFocused();
    await confirm(page).evaluate((e: HTMLButtonElement) => e.disabled = false); await expect(cancel(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(confirm(page)).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press("Escape"); await expect(submit(page)).toBeFocused();
    expect(await snapshot(page)).toEqual(before); expect(mutations).toEqual([]);
    // Closing must remove the BODY-origin keyboard boundary.
    await submit(page).blur(); const event = await page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      document.body.dispatchEvent(e); return e.defaultPrevented;
    }); expect(event).toBe(false);
  });
}

for (const width of [390, 1440]) test(`QA CSSOM-only visibility changes are contained at the keyboard boundary, width=${width}`, async ({ page, request }) => {
  const f = await setup(request), mutations: string[] = [];
  await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
  page.on("request", r => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method()); });
  const before = await snapshot(page); await open(page);
  await confirm(page).evaluate(e => {
    e.id = "qa-cssom-action";
    const style = document.createElement("style"); style.id = "qa-cssom-style"; document.head.append(style);
  });
  // CSSOM rule insertion has no subtree/attribute MutationObserver signal.
  await page.evaluate(() => (document.getElementById("qa-cssom-style") as HTMLStyleElement).sheet!.insertRule("#qa-cssom-action { visibility: hidden; }"));
  await page.keyboard.press("Shift+Tab"); await expect(cancel(page)).toBeFocused();
  await page.keyboard.press("Tab"); await expect(cancel(page)).toBeFocused();
  await page.evaluate(() => (document.getElementById("qa-cssom-style") as HTMLStyleElement).sheet!.deleteRule(0));
  await page.keyboard.press("Shift+Tab"); await expect(confirm(page)).toBeFocused();
  await page.keyboard.press("Escape"); await expect(submit(page)).toBeFocused();
  expect(await snapshot(page)).toEqual(before); expect(mutations).toEqual([]);
});


for (const width of [390, 1440]) for (const key of ["Enter", "Space", "Space release"] as const) {
  test(`QA CSSOM-only opacity loss cannot activate an invisible action, width=${width}, key=${key}`, async ({ page, request }) => {
    const f = await setup(request), mutations: string[] = [];
    await page.setViewportSize({ width, height: 1000 }); await draft(page, f);
    page.on("request", r => { if (!["GET", "HEAD", "OPTIONS"].includes(r.method()) && new URL(r.url()).pathname.startsWith("/api/")) mutations.push(r.method()); });
    const before = await snapshot(page); await open(page);
    await confirm(page).evaluate(e => {
      e.id = "qa-opacity-action"; const style = document.createElement("style"); style.id = "qa-opacity-style"; document.head.append(style);
    });
    if (key === "Space release") await page.keyboard.down("Space");
    await page.evaluate(() => (document.getElementById("qa-opacity-style") as HTMLStyleElement).sheet!.insertRule("#qa-opacity-action { opacity:0; }"));
    if (key === "Space release") await page.keyboard.up("Space"); else await page.keyboard.press(key);
    await expect(cancel(page)).toBeFocused(); expect(await snapshot(page)).toEqual(before); expect(mutations).toEqual([]);
    await page.keyboard.press("Escape"); await expect(submit(page)).toBeFocused(); expect(mutations).toEqual([]);
    const current = await request.get(api + f.qa, { headers: f.headers }); expect(current.status()).toBe(200);
    expect((await current.json()).latestAssessment.assessmentNumber).toBe(1);
  });
}
