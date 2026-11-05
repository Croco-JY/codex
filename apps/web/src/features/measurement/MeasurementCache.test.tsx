import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { endSession, setLocalSubject } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import { fixture, A, B, P, S, T, MS, id, route, rev, spec, response } from "../../test/measurementFixture";
import type { Spec, Revision, Page } from "./model";

const clients = new Set<ReturnType<typeof fixture>["cache"]>();
afterEach(() => {
  cleanup(); endSession(); clients.forEach(c => c.clear()); clients.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function prepared(n = 3) {
  const h = fixture(); clients.add(h.cache);
  h.specs.set(A, spec(n)); h.specs.set(B, spec(1, B));
  for (let i = 1; i <= n; i++) h.revisions.set(rev(i).id, rev(i));
  return h;
}
async function ready(n = 3) {
  await screen.findByRole("heading", { name: `Latest revision ${n}` });
  await screen.findByRole("button", { name: "Open revision 1" });
}
function noEffects(h: ReturnType<typeof fixture>) {
  expect(h.writes()).toHaveLength(0);
  expect(h.calls.filter(r => r.url.endsWith("/content"))).toHaveLength(0);
}

const specAttacks: [string, (v: Spec) => void][] = [
  ["foreign Style", v => { v.styleId = T; v.latestRevision.styleId = T; }],
  ["nested foreign Style", v => { v.latestRevision.styleId = T; }],
  ["nested foreign Spec", v => { v.latestRevision.measurementSpecId = id(8); }],
  ["POM position", v => { v.latestRevision.points[0].position = 1; }],
  ["duplicate POM code", v => { v.latestRevision.points.push({ ...v.latestRevision.points[0], position: 1 }); }],
  ["decimal token", v => { v.latestRevision.points[0].value = "1e2"; }],
  ["timestamp", v => { v.latestRevision.createdAt = "2026-10-24"; }],
];
test.each(specAttacks)("DF-01 Spec cache rejects %s before rendering/editing, then recovers", async (_, attack) => {
  const h = prepared(); h.mount(); await ready();
  await userEvent.click(screen.getByRole("button", { name: "Create new revision" }));
  expect(screen.getByRole("form", { name: "Measurement draft" })).toBeVisible();
  const original = spec(3), bad = structuredClone(original);
  bad.latestRevision.points[0].notes = "REJECTED CACHED PRIVATE POM";
  bad.latestRevision.points[0].label = "FOREIGN-POM-LABEL";
  bad.latestRevision.points[0].value = "321.1234";
  attack(bad);
  const key = queryKeys.measurementSpec(h.scope, A, P, S);
  await act(async () => { h.cache.setQueryData(key, bad); });
  await within(screen.getByRole("region", { name: "Measurement workspace" })).findByRole("heading", { name: "Service unavailable" });
  expect(screen.queryByText("REJECTED CACHED PRIVATE POM")).not.toBeInTheDocument();
  expect(screen.queryByText(/FOREIGN-POM-LABEL|321\.1234/)).not.toBeInTheDocument();
  const retainedDraft = screen.queryByRole("form", { name: "Measurement draft" });
  if (retainedDraft) {
    expect(within(retainedDraft).getByLabelText("Notes · POM 1")).toHaveValue("Synthetic persisted POM");
    expect(within(retainedDraft).getByLabelText("Value · POM 1")).toHaveValue("50.0000");
    expect(within(retainedDraft).queryByRole("button", { name: "Create revision" })).not.toBeInTheDocument();
    expect(within(retainedDraft).getByRole("group", { name: "Revision snapshot" })).toBeDisabled();
  }
  expect(screen.queryByRole("button", { name: "Create new revision" })).not.toBeInTheDocument();
  noEffects(h);
  await act(async () => { h.cache.setQueryData(key, structuredClone(original)); });
  await ready();
  expect(screen.getByRole("button", { name: retainedDraft ? "Create revision" : "Create new revision" })).toBeEnabled();
  expect(screen.queryByText("REJECTED CACHED PRIVATE POM")).not.toBeInTheDocument();
  noEffects(h);
});

const pageAttacks: [string, (v: Page) => void][] = [
  ["foreign Style", v => { v.items[0].styleId = T; }],
  ["foreign Spec", v => { v.items[0].measurementSpecId = id(8); }],
  ["duplicate revision ID", v => { v.items[1].id = v.items[0].id; }],
  ["ordering", v => { v.items.reverse(); }],
  ["above pinned head", v => { v.items[0].revisionNumber = 4; }],
  ["continuation", v => { v.nextMaxRevisionNumber = 1; }],
  ["limit", v => { v.limit = 26; }],
];
test.each(pageAttacks)("DF-01 history cache rejects %s without row actions and recovers", async (_, attack) => {
  const h = prepared(); h.mount(); await ready();
  const key = queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3);
  const original = h.cache.getQueryData<Page>(key);
  expect(original).toBeDefined();
  const bad = structuredClone(original!); bad.items[0].baseSize = "REJECTED SUMMARY"; attack(bad);
  await act(async () => { h.cache.setQueryData(key, bad); });
  const history = within(screen.getByRole("region", { name: "Measurement revision history" }));
  await history.findByRole("alert");
  expect(history.queryByText(/REJECTED SUMMARY/)).not.toBeInTheDocument();
  expect(history.queryByRole("button", { name: /Open revision/ })).not.toBeInTheDocument();
  noEffects(h);
  await act(async () => { h.cache.setQueryData(key, structuredClone(original)); });
  await history.findByRole("button", { name: "Open revision 1" });
  noEffects(h);
});

const revisionAttacks: [string, (v: Revision) => void][] = [
  ["foreign Style", v => { v.styleId = T; }],
  ["foreign Spec", v => { v.measurementSpecId = id(8); }],
  ["wrong exact revision", v => { v.id = id(999); }],
  ["POM position", v => { v.points[0].position = 1; }],
  ["duplicate POM", v => { v.points.push({ ...v.points[0], position: 1 }); }],
  ["decimal", v => { v.points[0].value = "NaN"; }],
  ["timestamp", v => { v.createdAt = "2026-10-24"; }],
];
test.each(revisionAttacks)("DF-01 exact revision cache rejects %s and preserves explicit recovery", async (_, attack) => {
  const h = prepared(); h.mount(); await ready();
  await userEvent.click(screen.getByRole("button", { name: "Open revision 1" }));
  await screen.findByRole("region", { name: "Selected revision 1" });
  const bad = rev(); bad.points[0].notes = "REJECTED EXACT PRIVATE POM"; attack(bad);
  const key = queryKeys.measurementRevision(h.scope, A, P, S, rev().id);
  await act(async () => { h.cache.setQueryData(key, bad); });
  await within(screen.getByRole("region", { name: "Measurement workspace" })).findByRole("alert");
  expect(screen.queryByRole("region", { name: "Selected revision 1" })).not.toBeInTheDocument();
  expect(screen.queryByText("REJECTED EXACT PRIVATE POM")).not.toBeInTheDocument();
  noEffects(h);
  await act(async () => { h.cache.setQueryData(key, rev()); });
  await screen.findByRole("region", { name: "Selected revision 1" }); noEffects(h);
});

test.each([1, 3])("DF-01 cached summary cannot relabel embedded/historical revision %i", async n => {
  const h = prepared(); h.mount(); await ready();
  const key = queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3);
  const original = h.cache.getQueryData<Page>(key)!;
  const bad = structuredClone(original); bad.items.find(r => r.revisionNumber === n)!.baseSize = "CONTRADICTORY SUMMARY";
  await act(async () => { h.cache.setQueryData(key, bad); });
  await screen.findByText(/CONTRADICTORY SUMMARY/);
  await userEvent.click(screen.getByRole("button", { name: `Open revision ${n}` }));
  await within(screen.getByRole("region", { name: "Measurement workspace" })).findByRole("alert");
  expect(screen.queryByRole("region", { name: `Selected revision ${n}` })).not.toBeInTheDocument();
  noEffects(h);
});

test("DF-01 identical Spec/history/exact caches and valid revision creation remain usable", async () => {
  const h = prepared(); h.mount(); await ready();
  await userEvent.click(screen.getByRole("button", { name: "Open revision 1" }));
  await screen.findByRole("region", { name: "Selected revision 1" });
  await act(async () => {
    for (const q of h.cache.getQueryCache().getAll()) {
      if (q.queryKey.includes("measurement-spec") || q.queryKey.includes("measurement-revisions") || q.queryKey.includes("measurement-revision"))
        h.cache.setQueryData(q.queryKey, structuredClone(q.state.data));
    }
  });
  expect(screen.getByRole("region", { name: "Selected revision 1" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Create new revision" }));
  await userEvent.click(screen.getByRole("button", { name: "Create revision" }));
  await screen.findByRole("heading", { name: "Latest revision 4" });
  expect(h.writes()).toHaveLength(1);
});

test("DF-01 rejected cache on observer remount is never an editable absent Spec", async () => {
  const h = prepared(); const first = h.mount(); await ready();
  const bad = spec(1, B), key = queryKeys.measurementSpec(h.scope, A, P, S);
  const oldQuery = h.cache.getQueryCache().find({ queryKey: key, exact: true });
  await act(async () => { h.cache.setQueryData(key, bad); });
  await screen.findByRole("alert"); first.unmount();
  // Workspace teardown intentionally purges its private queries. Recreate a
  // contaminated entry before the new observer, rather than expecting cleanup
  // itself to retain invalid data or prevent legitimate network recovery.
  h.cache.setQueryData(key, bad);
  expect(h.cache.getQueryCache().find({ queryKey: key, exact: true })).not.toBe(oldQuery);
  h.mount(); await screen.findByRole("alert");
  expect(screen.queryByRole("form", { name: "Measurement draft" })).not.toBeInTheDocument();
  expect(screen.queryByText("No Measurement Spec has been created for this Style.")).not.toBeInTheDocument();
  await act(async () => { h.cache.setQueryData(key, spec(3)); });
  await ready(); noEffects(h);
});

test.each(["organization", "ABA", "actor"])("DF-01 old cache injection cannot cross %s boundary", async boundary => {
  const h = prepared(); h.mount(); await ready();
  const oldKey = queryKeys.measurementSpec(h.scope, A, P, S);
  if (boundary === "actor") await act(async () => setLocalSubject("df01-new-actor"));
  else await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
  await screen.findByRole("heading", { name: boundary === "actor" ? "Latest revision 3" : "Latest revision 1" });
  const bad = spec(1, B); bad.latestRevision.points[0].notes = "LATE FOREIGN CACHE";
  await act(async () => { h.cache.setQueryData(oldKey, bad); });
  if (boundary === "ABA") {
    await userEvent.click(screen.getByRole("button", { name: "Enter A" }));
    await screen.findByRole("alert");
  }
  expect(screen.queryByText("LATE FOREIGN CACHE")).not.toBeInTheDocument();
  noEffects(h);
});

test("DF-01 normal comparison outage retains the legitimate draft without rebasing or resubmission", async () => {
  const h = prepared(); h.mount(); await ready();
  await userEvent.click(screen.getByRole("button", { name: "Create new revision" }));
  const input = screen.getByLabelText("Notes · POM 1");
  await userEvent.clear(input); await userEvent.type(input, "Legitimate retained local draft");
  h.overrides.set(`POST ${route().replace("/measurements", "").replace(/^/, "/api/v1")}/measurement-spec/revisions`, () => response({}, 500));
  h.overrides.set(`GET ${route().replace("/measurements", "").replace(/^/, "/api/v1")}/measurement-spec`,
    () => new Response("{}", { status: 503, headers: { "Content-Type": "application/json", "X-Request-ID": "df01-comparison-outage" } }));
  await userEvent.click(screen.getByRole("button", { name: "Create revision" }));
  await waitFor(() => expect(h.calls.some(r => r.method === "POST")).toBe(true));
  await screen.findByText("df01-comparison-outage");
  expect(screen.getByLabelText("Notes · POM 1")).toHaveValue("Legitimate retained local draft");
  expect(h.writes()).toHaveLength(1);
});

test("DF-01 mutable raw-cache aliases cannot become rendered facts or a new draft", async () => {
  const h = prepared(); h.mount(); await ready();
  const key = queryKeys.measurementSpec(h.scope, A, P, S);
  await act(async () => {
    h.cache.setQueryData<Spec>(key, current => {
      if (!current) throw new Error("Expected legitimate established cache");
      current.styleId = T; current.latestRevision.styleId = T;
      current.latestRevision.points[0].notes = "ALIASED FOREIGN POM";
      return current;
    });
  });
  const create = screen.queryByRole("button", { name: "Create new revision" });
  if (create) await userEvent.click(create);
  expect(screen.queryByText("ALIASED FOREIGN POM")).not.toBeInTheDocument();
  const draft = screen.queryByRole("form", { name: "Measurement draft" });
  if (draft) expect(within(draft).getByLabelText("Notes · POM 1")).toHaveValue("Synthetic persisted POM");
  noEffects(h);
});

test.each(["history", "revision"] as const)("DF-01 %s selected facts do not alias mutable raw cache objects", async kind => {
  const h = prepared(); h.mount(); await ready();
  await userEvent.click(screen.getByRole("button", { name: "Open revision 1" }));
  await screen.findByRole("region", { name: "Selected revision 1" });
  await act(async () => {
    if (kind === "history") {
      h.cache.setQueryData<Page>(queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3), current => {
        if (!current) throw new Error("Expected established history");
        current.items[0].styleId = T; current.items[0].baseSize = "ALIASED FOREIGN SUMMARY";
        return current;
      });
    } else {
      h.cache.setQueryData<Revision>(queryKeys.measurementRevision(h.scope, A, P, S, rev().id), current => {
        if (!current) throw new Error("Expected established exact revision");
        current.styleId = T; current.points[0].notes = "ALIASED FOREIGN EXACT POM";
        return current;
      });
    }
  });
  const open = screen.queryByRole("button", { name: "Open revision 1" });
  if (open) await userEvent.click(open);
  expect(screen.queryByText(/ALIASED FOREIGN/)).not.toBeInTheDocument();
  noEffects(h);
});
