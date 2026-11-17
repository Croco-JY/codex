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
