import { test, expect, afterEach, vi } from "vitest";
import {
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import {
  fixture,
  pattern,
  revision,
  route,
  A,
  B,
  S,
  PID,
  root,
  response,
  id,
} from "../../test/patternFixture";
import { spec, rev, deferred } from "../../test/measurementFixture";
import { setAccessToken } from "../../api/session";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const base = root() + "/patterns",
  detail = base + "/" + PID;
const load = async () =>
  screen.findByRole("heading", { name: "Pattern families" });
const detailReady = async () =>
  screen.findByRole("heading", { name: "Latest Pattern revision 1" });
const click = (s: string) =>
  fireEvent.click(
    screen.getByRole("button", { name: s, exact: true } as never),
  );
function form(name = "Synthetic new draft") {
  fireEvent.change(screen.getByLabelText("Pattern name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Pattern purpose"), {
    target: { value: "Synthetic purpose" },
  });
}
const writes = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) => r.method !== "GET");
test("StyleDetail keeps four siblings with zero Measurement/Pattern prefetch", async () => {
  const h = fixture();
  h.mount(root().replace("/api/v1", ""));
  await screen.findByRole("link", { name: "Patterns", exact: true } as never);
  await waitFor(() =>
    expect(
      h.calls.filter((r) =>
        /requirement|material-selections|facility-candidates|development-references/.test(
          r.url,
        ),
      ),
    ).toHaveLength(4),
  );
  expect(
    h.calls.filter((r) => /measurement-spec|\/patterns/.test(r.url)),
  ).toHaveLength(0);
});
test("list initial budget and ACTIVE/ARCHIVED/ALL do not hydrate any row", async () => {
  const h = fixture();
  h.patterns.set(A, [
    pattern(),
    {
      ...pattern(),
      id: id(21),
      status: "ARCHIVED",
      latestRevision: { ...revision(), patternId: id(21) },
    },
  ]);
  h.mount();
  await load();
  await screen.findByRole("link", { name: "Pattern revision 1" });
  expect(h.calls.filter((r) => r.url.includes("/patterns"))).toHaveLength(1);
  expect(h.measurementReads()).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Pattern status"), {
    target: { value: "ARCHIVED" },
  });
  await waitFor(() =>
    expect(screen.getByText("ARCHIVED · Revision 1")).toBeVisible(),
  );
  fireEvent.change(screen.getByLabelText("Pattern status"), {
    target: { value: "ALL" },
  });
  await waitFor(() =>
    expect(
      screen.getAllByRole("link", { name: "Pattern revision 1" }),
    ).toHaveLength(2),
  );
});
test.each(["ORG_OWNER", "ORG_ADMIN"])(
  "%s creates atomic revision 1 without authority fields or Measurement fetch",
  async (role) => {
    const h = fixture();
    h.role = role;
    h.mount();
    await load();
    click("Create Pattern");
    form();
    click("Save new Pattern");
    await screen.findByRole("status");
    expect(writes(h)).toHaveLength(1);
    expect(await writes(h)[0].clone().json()).toEqual({
      name: "Synthetic new draft",
      purpose: "Synthetic purpose",
      measurementRevisionId: null,
    });
    expect(h.measurementReads()).toHaveLength(0);
  },
);
test.each(["viewer", "project", "style"])(
  "read-only %s has no mutation controls",
  async (kind) => {
    const h = fixture();
    if (kind === "viewer") h.role = "VIEWER";
    else if (kind === "project") h.projectStatus = "ARCHIVED";
    else h.styleStatus = "ARCHIVED";
    h.patterns.set(A, [pattern()]);
    h.mount(route(A, true));
    await detailReady();
    expect(
      screen.queryByRole("button", { name: "Create new Pattern revision" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Archive Pattern" }),
    ).toBeNull();
    expect(writes(h)).toHaveLength(0);
  },
);
test("detail embeds latest, anchors one history, requests exact old revision only explicitly", async () => {
  const h = fixture();
  h.patterns.set(A, [pattern(2)]);
  h.history.set(revision(1).id, revision(1));
  h.mount(route(A, true));
  await screen.findByRole("heading", { name: "Latest Pattern revision 2" });
  await screen.findByRole("button", { name: "Open Pattern revision 1" });
  const rs = h.calls.filter((r) => r.url.includes("/patterns"));
  expect(rs).toHaveLength(2);
  expect(new URL(rs[1].url).searchParams.get("maxRevisionNumber")).toBe("2");
  expect(h.measurementReads()).toHaveLength(0);
  click("Open Pattern revision 1");
  await screen.findByRole("heading", { name: "Selected Pattern revision 1" });
  expect(h.calls.filter((r) => r.url.includes("/patterns"))).toHaveLength(3);
});
test("explicit lazy Measurement picker supports latest/old without exact detail", async () => {
  const h = fixture();
  h.specs.set(A, spec(2));
  h.revisions.set(rev(1).id, rev(1));
  h.mount();
  await load();
  click("Create Pattern");
  expect(h.measurementReads()).toHaveLength(0);
  click("Pin measurement revision");
  await screen.findByRole("button", { name: "Use Measurement revision 1" });
  expect(h.measurementReads()).toHaveLength(2);
  click("Use Measurement revision 1");
  form();
  click("Save new Pattern");
  await screen.findByRole("status");
  expect((await writes(h)[0].clone().json()).measurementRevisionId).toBe(
    rev(1).id,
  );
  expect(h.measurementReads()).toHaveLength(2);
});
test("absent lazy Measurement has no history", async () => {
  const h = fixture();
  h.mount();
  await load();
  click("Create Pattern");
  click("Pin measurement revision");
  await screen.findByText("No Measurement Spec exists for this Style.");
  expect(h.measurementReads()).toHaveLength(1);
});
test("archive confirmation, archived read-only, reactivation exact versions", async () => {
  const h = fixture();
  h.patterns.set(A, [pattern()]);
  h.mount(route(A, true));
  await detailReady();
  click("Archive Pattern");
  expect(writes(h)).toHaveLength(0);
  expect(screen.getByRole("alertdialog")).toHaveTextContent(PID);
  click("Confirm archive");
  await screen.findByRole("button", { name: "Reactivate Pattern" });
  expect(
    screen.queryByRole("button", { name: "Create new Pattern revision" }),
  ).toBeNull();
  click("Reactivate Pattern");
  click("Confirm reactivation");
  await screen.findByRole("button", { name: "Archive Pattern" });
  expect(await writes(h)[0].clone().json()).toEqual({
    status: "ARCHIVED",
    version: 0,
  });
  expect(await writes(h)[1].clone().json()).toEqual({
    status: "ACTIVE",
    version: 1,
  });
});
test("stale revision retains draft and baseline until explicit reconciliation without submit", async () => {
  const h = fixture();
  h.patterns.set(A, [pattern()]);
  h.mount(route(A, true));
  await detailReady();
  click("Create new Pattern revision");
  form("Unsaved revised name");
  h.history.set(revision().id, revision());
  h.patterns.set(A, [pattern(2)]);
  click("Create Pattern revision");
  await screen.findByRole("alert", { name: "Pattern reconciliation" });
  expect(screen.getByLabelText("Pattern name")).toHaveValue(
    "Unsaved revised name",
  );
  expect(
    screen.getByText(/Draft baseline revision: 1. Current latest: 2./),
  ).toBeVisible();
  expect(writes(h)).toHaveLength(1);
  click("Reconcile Pattern draft");
  expect(writes(h)).toHaveLength(1);
  click("Create Pattern revision");
  await screen.findByText("Pattern revision created.");
  expect((await writes(h)[1].clone().json()).expectedLatestRevisionNumber).toBe(
    2,
  );
});
test.each([0, 500, 502])(
  "ambiguous create %s retains draft and does not resend",
  async (status) => {
    const h = fixture();
    h.overrides.set("POST " + base, () => {
      if (status === 0) throw new TypeError("network");
      return response(
        status === 502 ? {} : { status: 500 },
        status === 502 ? 201 : status,
      );
    });
    h.mount();
    await load();
    click("Create Pattern");
    form();
    click("Save new Pattern");
    await screen.findByText(/Outcome unknown/);
    expect(screen.getByLabelText("Pattern name")).toHaveValue(
      "Synthetic new draft",
    );
    expect(writes(h)).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Save new Pattern" }),
    ).toBeDisabled();
  },
);
test.each(["project", "style"])(
  "pending %s gates downstream Pattern requests",
  async (kind) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set(
      "GET " + (kind === "project" ? root().split("/styles")[0] : root()),
      () => d.promise,
    );
    h.mount();
    await screen.findByRole("status", {
      name: kind === "project" ? "Loading parent Project" : "Loading Style",
    });
    expect(h.calls.filter((r) => r.url.includes("/patterns"))).toHaveLength(0);
    d.resolve(response({}, 404));
    await screen.findByText(/Not found/i);
    expect(h.calls.filter((r) => r.url.includes("/patterns"))).toHaveLength(0);
  },
);
test("current Pattern 403 denies whole workspace", async () => {
  const h = fixture();
  h.overrides.set("GET " + base, () => response({}, 403));
  h.mount();
  await screen.findByText(/Access denied/i);
  expect(screen.queryByRole("button", { name: "Create Pattern" })).toBeNull();
  expect(
    h.cache
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[0] === "workspace"),
  ).toHaveLength(0);
});
test.each([false, true])(
  "A→B/ABA ignores held old-generation list, ABA=%s",
  async (aba) => {
    const h = fixture(),
      d = deferred<Response>();
    let first = true;
    h.overrides.set("GET " + base, () => {
      if (first) {
        first = false;
        return d.promise;
      }
      return response({ items: [], limit: 25, nextCursor: null });
    });
    h.mount();
    await load();
    click("Patterns B");
    await load();
    if (aba) {
      click("Patterns A");
      await load();
    }
    d.resolve(response({ items: [pattern()], limit: 25, nextCursor: null }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Pattern revision 1" }),
      ).toBeNull(),
    );
  },
);
test("Actor switch clears old drafts/cache and suppresses late mutation", async () => {
  const h = fixture(),
    d = deferred<Response>();
  h.overrides.set("POST " + base, () => d.promise);
  h.mount();
  await load();
  click("Create Pattern");
  form("Actor private draft");
  click("Save new Pattern");
  await waitFor(() => expect(writes(h)).toHaveLength(1));
  setAccessToken("replacement-pattern-actor");
  d.resolve(response(pattern(), 201));
  await waitFor(() =>
    expect(screen.queryByDisplayValue("Actor private draft")).toBeNull(),
  );
  expect(h.cache.getMutationCache().getAll()).toHaveLength(0);
});

test("stale lifecycle retains confirmation and explains authoritative version without retry", async () => {
  const h = fixture();
  h.patterns.set(A, [pattern()]);
  h.mount(route(A, true));
  await detailReady();
  click("Archive Pattern");
  h.patterns.set(A, [{ ...pattern(), version: 1, status: "ARCHIVED" }]);
  click("Confirm archive");
  await screen.findByRole("button", { name: "Review current lifecycle" });
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "expected lifecycle version 0",
  );
  expect(
    screen.getByText(/Review current status ARCHIVED, version 1/),
  ).toBeVisible();
  expect(writes(h)).toHaveLength(1);
  click("Review current lifecycle");
  expect(writes(h)).toHaveLength(1);
});
test.each([0, 500, 502])(
  "ambiguous revision %s retains captured head and no resend",
  async (status) => {
    const h = fixture();
    h.patterns.set(A, [pattern()]);
    h.overrides.set("POST " + detail + "/revisions", () => {
      if (status === 0) throw new TypeError("network");
      return response({}, status === 502 ? 201 : status);
    });
    h.mount(route(A, true));
    await detailReady();
    click("Create new Pattern revision");
    form("Uncertain revised draft");
    click("Create Pattern revision");
    await screen.findByText(/Outcome unknown/);
    expect(screen.getByLabelText("Pattern name")).toHaveValue(
      "Uncertain revised draft",
    );
    expect(
      screen.getByText(/Draft baseline revision: 1. Current latest: 1./),
    ).toBeVisible();
    expect(writes(h)).toHaveLength(1);
  },
);
test("new revision changes and removes Measurement pin without mutating history", async () => {
  const h = fixture();
  h.patterns.set(A, [
    {
      ...pattern(),
      latestRevision: { ...revision(), measurementRevisionId: rev(1).id },
    },
  ]);
  h.specs.set(A, spec(2));
  h.revisions.set(rev(1).id, rev(1));
  h.mount(route(A, true));
  await detailReady();
  click("Create new Pattern revision");
  click("Pin measurement revision");
  await screen.findByRole("button", { name: "Use Measurement revision 2" });
  click("Use Measurement revision 2");
  click("Create Pattern revision");
  await screen.findByText("Pattern revision created.");
  expect(h.history.get(revision().id)?.measurementRevisionId).toBe(rev(1).id);
  click("Create new Pattern revision");
  click("No Measurement pin");
  click("Create Pattern revision");
  await screen.findByRole("heading", { name: "Latest Pattern revision 3" });
  expect((await writes(h)[0].clone().json()).measurementRevisionId).toBe(
    rev(2).id,
  );
  expect((await writes(h)[1].clone().json()).measurementRevisionId).toBeNull();
});
test("collection cursor navigation is explicit and never loads row details", async () => {
  const h = fixture();
  const rows = Array.from({ length: 25 }, (_, i) => ({
    ...pattern(),
    id: id(600 + i),
    latestRevision: {
      ...revision(),
      patternId: id(600 + i),
      name: `Family ${i}`,
    },
  }));
  h.overrides.set("GET " + base, (r) =>
    response({
      items: new URL(r.url).searchParams.has("cursor") ? [] : rows,
      limit: 25,
      nextCursor: new URL(r.url).searchParams.has("cursor") ? null : "b2xk",
    }),
  );
  h.mount();
  await screen.findByRole("link", { name: "Family 24" });
  expect(h.calls.filter((r) => r.url.includes("/patterns"))).toHaveLength(1);
  click("Older Patterns");
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Family 24" })).toBeNull(),
  );
  expect(
    new URL(
      h.calls.filter((r) => r.url.includes("/patterns"))[1].url,
    ).searchParams.get("cursor"),
  ).toBe("b2xk");
  expect(h.measurementReads()).toHaveLength(0);
});
test.each(["list", "detail", "history"])(
  "%s 403 denies whole workspace",
  async (kind) => {
    const h = fixture();
    h.patterns.set(A, [pattern()]);
    h.overrides.set(
      "GET " +
        (kind === "list"
          ? base
          : kind === "detail"
            ? detail
            : detail + "/revisions"),
      () => response({}, 403),
    );
    h.mount(route(A, kind !== "list"));
    await screen.findByText(/Access denied/i);
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === "workspace"),
    ).toHaveLength(0);
  },
);
test.each(["detail", "history"])(
  "late %s from A cannot render in B or repopulate private cache",
  async (kind) => {
    const h = fixture(),
      d = deferred<Response>();
    h.patterns.set(A, [pattern()]);
    h.overrides.set(
      "GET " + (kind === "detail" ? detail : detail + "/revisions"),
      () => d.promise,
    );
    h.mount(route(A, true));
    await waitFor(() =>
      expect(
        h.calls.some((r) =>
          r.url.includes(kind === "detail" ? "/patterns/" + PID : "/revisions"),
        ),
      ).toBe(true),
    );
    click("Patterns B");
    await load();
    d.resolve(
      response(
        kind === "detail"
          ? pattern()
          : { items: [revision()], limit: 25, nextMaxRevisionNumber: null },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Latest Pattern revision 1" }),
      ).toBeNull(),
    );
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === "workspace" && q.queryKey[2] === A),
    ).toHaveLength(0);
  },
);
test.each([true, false])(
  "late mutation success/error cannot affect B draft, success=%s",
  async (success) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set("POST " + base, () => d.promise);
    h.mount();
    await load();
    click("Create Pattern");
    form("A unsaved draft");
    click("Save new Pattern");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    click("Patterns B");
    await load();
    click("Create Pattern");
    form("B retained draft");
    d.resolve(response(success ? pattern() : {}, success ? 201 : 500));
    await waitFor(() =>
      expect(screen.getByLabelText("Pattern name")).toHaveValue(
        "B retained draft",
      ),
    );
    expect(screen.queryByText(/Outcome unknown/)).toBeNull();
    expect(writes(h)).toHaveLength(1);
  },
);
test("same Actor Org switch preserves Supply and discards private draft", async () => {
  const h = fixture();
  const supply = ["supply", h.scope, "materials", id(90)];
  h.cache.setQueryData(supply, { name: "Canonical synthetic" });
  h.mount();
  await load();
  click("Create Pattern");
  form("private discarded draft");
  click("Patterns B");
  await load();
  expect(h.cache.getQueryData(supply)).toEqual({ name: "Canonical synthetic" });
  click("Patterns A");
  await load();
  click("Create Pattern");
  expect(screen.getByLabelText("Pattern name")).toHaveValue("");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test("Pattern archived during revision submission retains a read-only unsaved draft", async () => {
  const h = fixture();
  h.patterns.set(A, [pattern()]);
  h.mount(route(A, true));
  await detailReady();
  click("Create new Pattern revision");
  form("Preserved archived draft");
  h.patterns.set(A, [{ ...pattern(), status: "ARCHIVED", version: 1 }]);
  click("Create Pattern revision");
  await screen.findByText(
    "This Pattern is archived. History remains readable; reactivate before creating a revision.",
  );
  expect(screen.getByLabelText("Pattern name")).toHaveValue(
    "Preserved archived draft",
  );
  expect(screen.getByLabelText("Pattern name")).toBeDisabled();
  expect(
    screen.queryByRole("button", {
      name: "Create Pattern revision",
      exact: true,
    } as never),
  ).toBeNull();
  expect(writes(h)).toHaveLength(1);
});

test("warm Measurement cache still waits for fresh spec before the one anchored picker history", async () => {
  const h = fixture();
  h.specs.set(A, spec(2));
  const { queryKeys } = await import("../../api/queryKeys");
  const { P, S } = await import("../../test/measurementFixture");
  h.cache.setQueryData(queryKeys.measurementSpec(h.scope, A, P, S), spec(1));
  h.mount();
  await load();
  click("Create Pattern");
  expect(h.measurementReads()).toHaveLength(0);
  click("Pin measurement revision");
  await screen.findByRole("button", { name: "Use Measurement revision 2" });
  expect(h.measurementReads()).toHaveLength(2);
  expect(
    new URL(h.measurementReads()[1].url).searchParams.get("maxRevisionNumber"),
  ).toBe("2");
});
