import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hashKey, QueryClientProvider, type Query, type QueryObserver } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import App from "../../App";
import { fixture, A, P, S, rev, spec, route } from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
import { endSession } from "../../api/session";
import * as trust from "./measurementTrust";

const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => {
  cleanup();
  endSession();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const draft = () => Array.from(
  screen.getByRole("form", { name: "Measurement draft" }).querySelectorAll("input,select,textarea"),
).map((element) => ({ name: (element as HTMLInputElement).name, value: (element as HTMLInputElement).value }));

test.each([false, true])("missing observer registration follows replacement, blocks forced submit and permits explicit recovery, StrictMode=%s", async (strict) => {
  const h = fixture();
  clients.push(h.cache);
  h.specs.set(A, spec(3));
  for (let n = 1; n <= 3; n++) h.revisions.set(rev(n).id, rev(n));
  if (strict) render(<StrictMode><QueryClientProvider client={h.cache}><MemoryRouter initialEntries={[route()]}><App /></MemoryRouter></QueryClientProvider></StrictMode>);
  else h.mount();
  await screen.findByRole("button", { name: "Open revision 3" });
  await userEvent.click(screen.getByRole("button", { name: "Create new revision" }));
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "83.4567");
  const before = draft();
  const context = Array.from({ length: 100 }, (_, generation) => ({
    scope: h.scope, organizationId: A, projectId: P, styleId: S, generation, current: () => true,
  })).find((c) => trust.measurementTrustVersion(h.cache, c) > 0)!;
  const expected = queryKeys.measurementRevision(h.scope, A, P, S, rev(3).id);
  const cache = h.cache.getQueryCache();
  const register = trust.retainMeasurementReader;
  let sawMissingObserver = false;
  // Observe registration without replacing the production resolver or guard.
  vi.spyOn(trust, "retainMeasurementReader").mockImplementation((...args) => {
    if (hashKey(args[3]) === hashKey(expected)) {
      const query = cache.get(hashKey(expected));
      sawMissingObserver ||= !query?.observers.some((o) => o.options.meta?.measurementReader === args[2]);
    }
    return register(...args);
  });
  let replacements = 0;
  let observer: QueryObserver | undefined;
  const off = cache.subscribe((event) => {
    if (event.type !== "observerAdded" || event.query.queryHash !== hashKey(expected) || replacements >= 2) return;
    replacements++;
    observer = event.query.observers[0];
    cache.remove(event.query);
    cache.build(h.cache, { queryKey: [...expected] });
  });
  await userEvent.click(screen.getByRole("button", { name: "Open revision 3" }));
  await screen.findByRole("heading", { name: "Selected revision 3" });
  off();
  expect(replacements).toBe(2);
  expect(sawMissingObserver).toBe(true);
  expect(observer).toBeDefined();
  await act(async () => {
    cache.remove(observer!.getCurrentQuery());
    const replacement = cache.build(h.cache, { queryKey: [...expected] });
    observer!.setOptions(observer!.options);
    expect(observer!.getCurrentQuery()).toBe(replacement);
    expect(replacement.getObserversCount()).toBeGreaterThan(0);
    cache.remove(replacement);
    replacement.queryKey = ["unrelated"];
    replacement.queryHash = hashKey(replacement.queryKey);
    expect(() => trust.requireMeasurementWrite(h.cache, context, spec(3), "revision", 3)).toThrow();
  });
  expect(h.writes()).toHaveLength(0); // Guard failure is distinct from HTTP submission.
  expect(draft()).toEqual(before);

  // Keep any subsequent native replacement unsafe through asynchronous form
  // validation, so zero requests cannot be explained by a vanished hazard.
  const aliases = new Map<Query, { key: readonly unknown[]; hash: string }>();
  const alias = (query: Query) => {
    if (!aliases.has(query)) aliases.set(query, { key: [...query.queryKey], hash: query.queryHash });
    query.queryKey = ["unrelated"];
    query.queryHash = hashKey(query.queryKey);
  };
  const stopAlias = cache.subscribe((event) => {
    if (event.type === "observerAdded" && event.query.queryHash === hashKey(expected)) alias(event.query);
  });
  await act(async () => {
    observer!.setOptions(observer!.options);
    alias(observer!.getCurrentQuery());
    screen.getByRole("form", { name: "Measurement draft" }).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await waitFor(() => expect(h.cache.isMutating()).toBe(0));
  stopAlias();
  expect(h.writes().filter((r) => r.method === "POST")).toHaveLength(0);
  expect(h.writes().filter((r) => r.method === "PUT")).toHaveLength(0);
  expect(draft()).toEqual(before);
  expect(screen.getByText("Draft baseline revision: 3")).toBeVisible();
  await act(async () => {
    for (const [query, original] of aliases) {
      query.queryKey = original.key;
      query.queryHash = original.hash;
    }
    observer!.setOptions(observer!.options);
    await h.cache.refetchQueries({ queryKey: queryKeys.measurementSpec(h.scope, A, P, S), exact: true });
    await h.cache.refetchQueries({ queryKey: queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3), exact: true });
  });
  expect(draft()).toEqual(before);
  await userEvent.click(screen.getByRole("button", { name: "Reconcile draft with latest revision" }));
  expect(draft()).toEqual(before);
  expect(h.writes()).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Create revision" }));
  await screen.findByRole("heading", { name: "Latest revision 4" });
  expect(h.writes()).toHaveLength(1);
  const body = await h.writes()[0].clone().json();
  expect(body.expectedLatestRevisionNumber).toBe(3);
  expect(body.points[0].value).toBe("83.4567");
});
