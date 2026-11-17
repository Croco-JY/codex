import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import App from "../../App";
import { endSession, setLocalSubject } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import { fixture, route, qaRoot, qa, assessment, revision, pattern, A, B, P, S, T, PID, id, time, root, response } from "../../test/patternQaFixture";

const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => { cleanup(); endSession(); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const notes = "Distinctive retained human QA focus draft";
const trigger = () => screen.getByRole("button", { name: "Submit QA assessment" });
const dialog = () => screen.getByRole("alertdialog", { name: "Confirm human review attestation" });
const cancel = () => within(dialog()).getByRole("button", { name: "Cancel attestation" });
const heading = () => screen.getByRole("heading", { name: "Record a human assessment" });
function Navigation() {
  const navigate = useNavigate(), location = useLocation();
  return <><output data-testid="focus-route">{location.pathname}</output><button onClick={() => navigate(route(A, 2))}>Other revision</button><button onClick={() => navigate(route(B))}>Other Organization</button></>;
}
async function setup(strict = false) {
  const h = fixture(); clients.push(h.cache);
  h.current.set(A, qa(1)); h.rows.set(assessment().id, assessment());
  h.history.set(revision(2).id, revision(2)); h.patterns.set(A, [pattern(2)]);
  h.overrides.set("GET " + qaRoot(A, 2), () => response({ ...qa(), patternRevisionId: revision(2).id, patternRevisionNumber: 2 }));
  h.overrides.set("GET " + root() + "/patterns/" + PID + "/revisions/" + revision().id + "/artifact", () => response({
    id: id(900), patternRevisionId: revision().id, patternId: PID, styleId: S,
    declaredFormat: "PDF", displayName: "focus.pdf", sizeBytes: 10, state: "READY", failureCode: null, createdAt: time, updatedAt: time,
  }));
  const mounted = render(<QueryClientProvider client={h.cache}><MemoryRouter initialEntries={[route()]}><App /><Navigation /></MemoryRouter></QueryClientProvider>, strict ? { wrapper: StrictMode } : undefined);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Record QA assessment" }));
  await user.selectOptions(screen.getByLabelText("QA outcome"), "HUMAN_REVIEWED");
  await user.selectOptions(screen.getByLabelText("Review basis"), "READY_ARTIFACT");
  await user.type(screen.getByLabelText("Human review notes"), notes);
  return Object.assign(h, { mounted, user });
}
async function open(h: Awaited<ReturnType<typeof setup>>) {
  trigger().focus(); await h.user.keyboard("{Enter}");
  expect(await screen.findByRole("button", { name: "Confirm human review attestation" })).toHaveFocus();
}
const snapshot = () => [...screen.getByRole("form", { name: "QA assessment draft" }).querySelectorAll("input,select,textarea")]
  .map(e => ({ id: e.id, value: (e as HTMLInputElement).value }));

test.each([false, true])("QA repeated keyboard dismissal preserves draft and head; StrictMode=%s", async strict => {
  const h = await setup(strict), before = snapshot();
  for (const key of ["{Escape}", "{Enter}", " ", "{Escape}{Escape}"]) {
    await open(h); await h.user.tab(); expect(cancel()).toHaveFocus(); await h.user.keyboard(key);
    expect(screen.queryByRole("alertdialog")).toBeNull(); expect(trigger()).toHaveFocus(); expect(snapshot()).toEqual(before);
    expect(screen.getByRole("form", { name: "QA assessment draft" })).toHaveTextContent("Draft baseline assessment 1; current latest 1");
    expect(h.writes()).toHaveLength(0);
  }
});

test("QA cancellation contains keyboard focus and does not reach a page-level Escape handler", async () => {
  const h = await setup(), escape = vi.fn();
  document.addEventListener("keydown", escape);
  try {
    await open(h); await h.user.tab(); expect(cancel()).toHaveFocus();
    await h.user.tab(); expect(screen.getByRole("button", { name: "Confirm human review attestation" })).toHaveFocus();
    await h.user.tab({ shift: true }); expect(cancel()).toHaveFocus(); escape.mockClear();
    await h.user.keyboard("{Escape}"); expect(trigger()).toHaveFocus(); expect(escape).not.toHaveBeenCalled();
  } finally { document.removeEventListener("keydown", escape); }
  expect(h.writes()).toHaveLength(0);
});

test.each(["unmount", "Actor", "Organization", "revision"])("QA dismissal never focuses a detached or replaced editor across %s", async mode => {
  const h = await setup(true); await open(h);
  const oldTrigger = trigger(), oldHeading = heading();
  const focus = oldTrigger.focus.bind(oldTrigger), headingFocus = vi.spyOn(oldHeading, "focus");
  const observations: { connected: boolean; path: string | null }[] = [];
  const triggerFocus = vi.spyOn(oldTrigger, "focus").mockImplementation(() => {
    observations.push({ connected: oldTrigger.isConnected, path: screen.queryByTestId("focus-route")?.textContent ?? null });
    focus();
  });
  dialog().addEventListener("keydown", () => {
    if (mode === "unmount") h.mounted.unmount();
    else if (mode === "Actor") setLocalSubject("focus-replacement-actor");
    else screen.getByRole("button", { name: mode === "Organization" ? "Other Organization" : "Other revision" }).click();
  }, { capture: true, once: true });
  await h.user.keyboard("{Escape}");
  await waitFor(() => expect(oldTrigger.isConnected).toBe(false));
  // Router transitions may commit after the dismissal commit. Focus while the
  // original editor is still current is valid; no call may target its replacement.
  expect(observations.every(o => o.connected && o.path === route())).toBe(true);
  if (mode === "unmount" || mode === "Actor") expect(triggerFocus).not.toHaveBeenCalled();
  expect(headingFocus).not.toHaveBeenCalled();
  const callsAfterRetirement = triggerFocus.mock.calls.length;
  await h.user.keyboard("{Escape}");
  expect(triggerFocus).toHaveBeenCalledTimes(callsAfterRetirement);
  expect(h.writes()).toHaveLength(0);
});

test("QA archived editor uses its current local heading instead of a disabled trigger", async () => {
  const h = await setup(); await open(h); const before = snapshot();
  h.projectStatus = "ARCHIVED";
  await act(async () => h.cache.refetchQueries({ queryKey: queryKeys.project(h.scope, A, P), exact: true }));
  expect(trigger()).toBeDisabled(); await h.user.click(cancel());
  expect(heading()).toHaveFocus(); expect(trigger()).not.toHaveFocus(); expect(snapshot()).toEqual(before);
  expect(h.writes()).toHaveLength(0);
});

test("QA hidden trigger uses a visible local fallback without changing values", async () => {
  const h = await setup(); await open(h); const before = snapshot(), button = trigger();
  button.hidden = true; await h.user.click(cancel());
  expect(heading()).toHaveFocus(); expect(button).not.toHaveFocus(); expect(snapshot()).toEqual(before);
  expect(h.writes()).toHaveLength(0);
});

test("QA read refresh and dismissal do not reconcile a stale draft baseline", async () => {
  const h = await setup(), before = snapshot(); await open(h);
  h.current.set(A, qa(2));
  await act(async () => h.cache.refetchQueries({ queryKey: queryKeys.patternQa(h.scope, A, P, S, PID, revision().id), exact: true }));
  await h.user.keyboard("{Escape}"); expect(trigger()).toHaveFocus(); expect(snapshot()).toEqual(before);
  expect(screen.getByRole("form", { name: "QA assessment draft" })).toHaveTextContent("Draft baseline assessment 1; current latest 2");
  expect(h.writes()).toHaveLength(0);
});

test("QA focus restoration never substitutes for an explicit affirmative assessment", async () => {
  const h = await setup(); await open(h); await h.user.keyboard("{Escape}");
  expect(h.writes()).toHaveLength(0); await open(h); await h.user.keyboard("{Enter}");
  await screen.findByText("QA assessment recorded."); expect(h.writes()).toHaveLength(1);
  expect(await h.writes()[0].clone().json()).toEqual({ expectedLatestAssessmentNumber: 1, outcome: "HUMAN_REVIEWED", evidenceBasis: "READY_ARTIFACT", artifactId: id(900), notes });
});
