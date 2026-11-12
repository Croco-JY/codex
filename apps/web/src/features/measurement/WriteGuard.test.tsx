import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { fixture, A, P, S, rev, spec } from "../../test/measurementFixture";
import { queryKeys } from "../../api/queryKeys";
import { endSession } from "../../api/session";
import * as t from "./measurementTrust";
const clients: ReturnType<typeof fixture>["cache"][] = [];
afterEach(() => {
  cleanup();
  endSession();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function context(h: ReturnType<typeof fixture>) {
  return Array.from({ length: 100 }, (_, generation) => ({
    scope: h.scope,
    organizationId: A,
    projectId: P,
    styleId: S,
    generation,
    current: () => true,
  })).find((c) => t.measurementTrustVersion(h.cache, c) > 0)!;
}
async function setup() {
  const h = fixture();
  clients.push(h.cache);
  h.specs.set(A, spec(3));
  for (let n = 1; n <= 3; n++) h.revisions.set(rev(n).id, rev(n));
  h.mount();
  await screen.findByRole("button", { name: "Open revision 3" });
  await userEvent.click(
    screen.getByRole("button", { name: "Create new revision" }),
  );
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "88.1122");
  return h;
}
const attacks = [
  {
    name: "NaN",
    change: (k: unknown[]) => {
      k[9] = NaN;
    },
  },
  {
    name: "Infinity",
    change: (k: unknown[]) => {
      k[9] = Infinity;
    },
  },
  {
    name: "negative",
    change: (k: unknown[]) => {
      k[9] = -1;
    },
  },
  {
    name: "limit",
    change: (k: unknown[]) => {
      k[8] = 101;
    },
  },
  {
    name: "suffix",
    change: (k: unknown[]) => {
      k.push("unsupported");
    },
  },
  {
    name: "revision",
    change: (k: unknown[]) => {
      k.splice(7, 3, "measurement-revision", "invalid");
    },
  },
  {
    name: "namespace and hash",
    change: (k: unknown[]) => {
      k[7] = "unrelated";
      k[2] = "other";
    },
  },
];
test.each(attacks)(
  "actual synchronous form dispatch blocks $name active alias and preserves draft",
  async ({ name, change }) => {
    const h = await setup(),
      key = queryKeys.measurementRevisions(h.scope, A, P, S, 25, 3),
      q = h.cache.getQueryCache().find({ queryKey: key, exact: true })!;
    expect(q.getObserversCount()).toBeGreaterThan(0);
    const originalHash = q.queryHash;
    let allowed = false;
    await act(async () => {
      change(q.queryKey as unknown[]);
      if (name === "namespace and hash") q.queryHash = "unrelated";
      try {
        t.requireMeasurementWrite(h.cache, context(h), spec(3), "revision", 3);
        allowed = true;
      } catch {}
      screen
        .getByRole("form", { name: "Measurement draft" })
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await waitFor(() => expect(h.cache.isMutating()).toBe(0));
    expect(allowed).toBe(false);
    expect(h.writes()).toHaveLength(0);
    expect(screen.getByLabelText("Value · POM 1")).toHaveValue("88.1122");
    expect(screen.getByText("Draft baseline revision: 3")).toBeVisible();
    // Remove the unsafe observer by leaving its workspace, then recreate genuine
    // typed reads. This does not clear a network failure or reconcile a draft.
    cleanup();
    q.queryHash = originalHash;
    h.cache.removeQueries({ predicate: (x) => x === q });
    h.mount();
    await screen.findByRole("button", { name: "Open revision 3" });
    await userEvent.click(
      screen.getByRole("button", { name: "Create new revision" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create revision" }),
    );
    await screen.findByRole("heading", { name: "Latest revision 4" });
    expect(h.writes()).toHaveLength(1);
  },
);
test("authenticated absence PUT is blocked by active malformed family before actual HTTP", async () => {
  const h = fixture();
  clients.push(h.cache);
  h.mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Create Measurement Spec" }),
  );
  await userEvent.type(screen.getByLabelText("Base size"), "M");
  await userEvent.type(screen.getByLabelText("Code · POM 1"), "CHEST");
  await userEvent.type(screen.getByLabelText("Label · POM 1"), "Chest");
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "50.0000");
  const q = h.cache
    .getQueryCache()
    .find({
      queryKey: queryKeys.measurementSpec(h.scope, A, P, S),
      exact: true,
    })!;
  await act(async () => {
    (q.queryKey as unknown[]).push("unsupported");
    screen
      .getByRole("form", { name: "Measurement draft" })
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await waitFor(() => expect(h.cache.isMutating()).toBe(0));
  expect(h.writes()).toHaveLength(0);
});
