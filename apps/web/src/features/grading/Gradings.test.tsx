import { test, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  fixture,
  grading,
  revision,
  summary,
  route,
  A,
  B,
  S,
  GID,
  root,
  response,
  id,
} from "../../test/gradingFixture";
import { deferred } from "../../test/measurementFixture";
import { setAccessToken } from "../../api/session";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test.each(["detail", "history", "exact"])(
  "late %s 403 cannot deny B or repopulate A private cache",
  async (kind) => {
    const h = fixture(),
      d = deferred<Response>();
    h.gradings.set(A, [grading(2)]);
    h.history.set(revision(1).id, revision(1));
    const endpoint =
      kind === "detail"
        ? detail
        : kind === "history"
          ? detail + "/revisions"
          : detail + "/revisions/" + revision(1).id;
    h.overrides.set("GET " + endpoint, () => d.promise);
    h.mount(route(A, true));
    if (kind === "exact") {
      await ready(2);
      await screen.findByRole("button", { name: "Open grading revision 1" });
      click("Open grading revision 1");
    }
    await waitFor(() =>
      expect(h.calls.some((r) => new URL(r.url).pathname === endpoint)).toBe(
        true,
      ),
    );
    click("Grading B");
    await load();
    d.resolve(response({}, 403));
    await screen.findByText("No grade rule sets in this page.");
    expect(screen.queryByText(/Access denied/i)).toBeNull();
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === "workspace" && q.queryKey[2] === A),
    ).toHaveLength(0);
  },
);
const base = root() + "/grade-rule-sets",
  detail = base + "/" + GID;
const load = () => screen.findByRole("heading", { name: "Grade rule sets" });
const ready = (n = 1) =>
  screen.findByRole("heading", { name: `Latest grading revision ${n}` });
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const writes = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) => r.method !== "GET");
function form(name = "Private grading draft") {
  fireEvent.change(screen.getByLabelText("Grading name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Grading unit"), {
    target: { value: "CM" },
  });
  fireEvent.change(screen.getByLabelText("Base size"), {
    target: { value: "M" },
  });
  fireEvent.change(screen.getByLabelText("Rule 1 code"), {
    target: { value: "CHEST" },
  });
  fireEvent.change(screen.getByLabelText("Rule 1 label"), {
    target: { value: "Chest" },
  });
  fireEvent.change(screen.getByLabelText("Delta rule 1 size 1"), {
    target: { value: "-2.5000" },
  });
  fireEvent.change(screen.getByLabelText("Delta rule 1 size 2"), {
    target: { value: "-0.0000" },
  });
}
test("StyleDetail retains its four children and zero grading/pattern/measurement/artifact traffic", async () => {
  const h = fixture();
  h.mount(root().replace("/api/v1", ""));
  await screen.findByRole("link", { name: "Grading" });
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
    h.calls.filter((r) =>
      /grade-rule-sets|measurement-spec|\/patterns/.test(r.url),
    ),
  ).toHaveLength(0);
});
test("one compact list request; filter does not hydrate details or history", async () => {
  const h = fixture();
  h.gradings.set(A, [
    grading(),
    {
      ...grading(),
      id: id(31),
      status: "ARCHIVED",
      latestRevision: { ...revision(), gradeRuleSetId: id(31) },
    },
  ]);
  h.mount();
  await load();
  await screen.findByRole("link", { name: "Grading revision 1" });
  expect(
    h.calls.filter((r) => r.url.includes("/grade-rule-sets")),
  ).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Grading status"), {
    target: { value: "ALL" },
  });
  await waitFor(() =>
    expect(
      screen.getAllByRole("link", { name: "Grading revision 1" }),
    ).toHaveLength(2),
  );
  expect(
    h.calls.filter((r) => /measurement-spec|\/patterns/.test(r.url)),
  ).toHaveLength(0);
});
test.each(["ORG_OWNER", "ORG_ADMIN"])(
  "%s creates exact revision 1 with decimal strings",
  async (role) => {
    const h = fixture();
    h.role = role;
    h.mount();
    await load();
    click("Create grade rule set");
    form();
    click("Save new grade rule set");
    await screen.findByText("Grade rule set and revision 1 created.");
    expect(writes(h)).toHaveLength(1);
    expect(await writes(h)[0].clone().json()).toMatchObject({
      name: "Private grading draft",
      unitSystem: "CM",
      baseSizeCode: "M",
      notes: null,
      rules: [
        {
          code: "CHEST",
          label: "Chest",
          notes: null,
          values: [
            { sizeCode: "S", delta: "-2.5000" },
            { sizeCode: "M", delta: "-0.0000" },
          ],
        },
      ],
    });
  },
);
test.each(["viewer", "project", "style", "aggregate"])(
  "%s remains readable without revision mutations",
  async (kind) => {
    const h = fixture(),
      g = grading();
    if (kind === "viewer") h.role = "VIEWER";
    else if (kind === "project") h.projectStatus = "ARCHIVED";
    else if (kind === "style") h.styleStatus = "ARCHIVED";
    else g.status = "ARCHIVED";
    h.gradings.set(A, [g]);
    h.mount(route(A, true));
    await ready();
    expect(
      screen.queryByRole("button", { name: "Create new grading revision" }),
    ).toBeNull();
    if (kind !== "aggregate")
      expect(
        screen.queryByRole("button", { name: "Archive grade rule set" }),
      ).toBeNull();
    expect(writes(h)).toHaveLength(0);
  },
);
test("detail embeds matrix, anchors one history, opens exact historical snapshot only explicitly", async () => {
  const h = fixture();
  h.gradings.set(A, [grading(2)]);
  h.history.set(revision(1).id, revision(1));
  h.mount(route(A, true));
  await ready(2);
  await screen.findByRole("button", { name: "Open grading revision 1" });
  const requests = h.calls.filter((r) => r.url.includes("/grade-rule-sets"));
  expect(requests).toHaveLength(2);
  expect(new URL(requests[1].url).searchParams.get("maxRevisionNumber")).toBe(
    "2",
  );
  click("Open grading revision 1");
  await screen.findByRole("heading", { name: "Historical grading revision 1" });
  expect(
    h.calls.filter((r) => r.url.includes("/grade-rule-sets")),
  ).toHaveLength(3);
});
test("409 retains whole matrix and old baseline; explicit reconciliation changes only baseline", async () => {
  const h = fixture();
  h.gradings.set(A, [grading()]);
  h.mount(route(A, true));
  await ready();
  click("Create new grading revision");
  fireEvent.change(screen.getByLabelText("Grading name"), {
    target: { value: "Keep my snapshot" },
  });
  fireEvent.change(screen.getByLabelText("Delta rule 1 size 1"), {
    target: { value: "-7.2500" },
  });
  h.gradings.set(A, [grading(2)]);
  click("Save grading revision");
  await screen.findByText(
    "Draft baseline revision 1; current latest revision 2.",
  );
  expect(screen.getByLabelText("Grading name")).toHaveValue("Keep my snapshot");
  expect(screen.getByLabelText("Delta rule 1 size 1")).toHaveValue("-7.2500");
  expect(writes(h)).toHaveLength(1);
  click("Reconcile baseline without changing draft");
  expect(writes(h)).toHaveLength(1);
  expect(
    screen.getByText("Draft baseline revision 2; current latest revision 2."),
  ).toBeVisible();
  expect(screen.getByLabelText("Delta rule 1 size 1")).toHaveValue("-7.2500");
  click("Save grading revision");
  await screen.findByText("Grading revision created.");
  expect(writes(h)).toHaveLength(2);
});
test.each([0, 500, 502])(
  "ambiguous create %s retains draft with zero automatic resends",
  async (status) => {
    const h = fixture();
    h.overrides.set("POST " + base, () =>
      status === 0
        ? Promise.reject(new TypeError("network loss"))
        : response({}, status === 502 ? 201 : status),
    );
    h.mount();
    await load();
    click("Create grade rule set");
    form();
    click("Save new grade rule set");
    await screen.findByRole("button", {
      name: "Review current state before another create attempt",
    });
    expect(screen.getByLabelText("Grading name")).toHaveValue(
      "Private grading draft",
    );
    expect(screen.getByLabelText("Delta rule 1 size 1")).toHaveValue("-2.5000");
    expect(writes(h)).toHaveLength(1);
    click("Review current state before another create attempt");
    expect(writes(h)).toHaveLength(1);
  },
);
test.each([0, 500, 502])(
  "ambiguous revision %s retains captured baseline and all deltas",
  async (status) => {
    const h = fixture();
    h.gradings.set(A, [grading()]);
    h.overrides.set("POST " + detail + "/revisions", () =>
      status === 0
        ? Promise.reject(new TypeError("network loss"))
        : response({}, status === 502 ? 201 : status),
    );
    h.mount(route(A, true));
    await ready();
    click("Create new grading revision");
    click("Save grading revision");
    await screen.findByRole("button", {
      name: "Reconcile baseline without changing draft",
    });
    expect(
      screen.getByText("Draft baseline revision 1; current latest revision 1."),
    ).toBeVisible();
    expect(screen.getByLabelText("Delta rule 1 size 1")).toHaveValue("-2.5000");
    expect(writes(h)).toHaveLength(1);
  },
);
test("archive requires explicit confirmation and compact response; reactivation restores editing", async () => {
  const h = fixture();
  h.gradings.set(A, [grading()]);
  h.mount(route(A, true));
  await ready();
  click("Archive grade rule set");
  expect(writes(h)).toHaveLength(0);
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "expected lifecycle version 0",
  );
  click("Confirm archive");
  await screen.findByRole("button", { name: "Reactivate grade rule set" });
  expect(writes(h)).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Create new grading revision" }),
  ).toBeNull();
  click("Reactivate grade rule set");
  click("Confirm reactivation");
  await screen.findByRole("button", { name: "Create new grading revision" });
  expect(writes(h)).toHaveLength(2);
});
test.each(["project", "style"])(
  "pending/invalid %s prevents grading requests",
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
    expect(
      h.calls.filter((r) => r.url.includes("/grade-rule-sets")),
    ).toHaveLength(0);
    d.resolve(response({}, 404));
    await screen.findByText(/Not found/i);
    expect(
      h.calls.filter((r) => r.url.includes("/grade-rule-sets")),
    ).toHaveLength(0);
  },
);
test.each(["list", "detail", "history"])(
  "current %s 403 denies the entire Organization workspace",
  async (kind) => {
    const h = fixture();
    h.gradings.set(A, [grading()]);
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
test.each([false, true])(
  "A→B/ABA discards old list results, ABA=%s",
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
    click("Grading B");
    await load();
    if (aba) {
      click("Grading A");
      await load();
    }
    d.resolve(
      response({
        items: [{ ...grading(), latestRevision: summary(revision()) }],
        limit: 25,
        nextCursor: null,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Grading revision 1" }),
      ).toBeNull(),
    );
  },
);
test.each([true, false])(
  "late mutation success/error cannot change B draft; success=%s",
  async (success) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set("POST " + base, () => d.promise);
    h.mount();
    await load();
    click("Create grade rule set");
    form("A private draft");
    click("Save new grade rule set");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    click("Grading B");
    await load();
    click("Create grade rule set");
    form("B retained draft");
    d.resolve(response(success ? grading() : {}, success ? 201 : 403));
    await waitFor(() =>
      expect(screen.getByLabelText("Grading name")).toHaveValue(
        "B retained draft",
      ),
    );
    expect(screen.queryByText(/Access denied/i)).toBeNull();
    expect(writes(h)).toHaveLength(1);
  },
);
test("Actor switch discards draft and late mutation callbacks", async () => {
  const h = fixture(),
    d = deferred<Response>();
  h.overrides.set("POST " + base, () => d.promise);
  h.mount();
  await load();
  click("Create grade rule set");
  form("Actor private draft");
  click("Save new grade rule set");
  await waitFor(() => expect(writes(h)).toHaveLength(1));
  setAccessToken("replacement-grading-actor");
  d.resolve(response(grading(), 201));
  await waitFor(() =>
    expect(screen.queryByDisplayValue("Actor private draft")).toBeNull(),
  );
  expect(h.cache.getMutationCache().getAll()).toHaveLength(0);
});
test("matrix operations retain string deltas, preserve explicit order and leave new cells blank", async () => {
  const h = fixture();
  h.mount();
  await load();
  click("Create grade rule set");
  form();
  click("Add size");
  expect(screen.getByLabelText("Delta rule 1 size 3")).toHaveValue("");
  click("Move size 3 up");
  expect(screen.getByLabelText("Delta rule 1 size 3")).toHaveValue("-0.0000");
  fireEvent.change(screen.getByLabelText("Size 2 code"), {
    target: { value: "L" },
  });
  click("Add rule");
  expect(screen.getByLabelText("Delta rule 2 size 1")).toHaveValue("");
  click("Move rule 2 up");
  expect(screen.getByLabelText("Rule 1 code")).toHaveValue("");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(location.hash).toBe("");
});
test("maximum matrix renders 3000 editable string cells and clears on Organization switch", async () => {
  const h = fixture(),
    g = grading();
  g.latestRevision = revision(1, A, 30, 100);
  h.gradings.set(A, [g]);
  h.mount(route(A, true));
  await ready();
  const switchOrganization = screen.getByRole("button", { name: "Grading B" });
  click("Create new grading revision");
  const editor = document.querySelector(
    'form[aria-label="Grading snapshot editor"]',
  )!;
  expect(editor.querySelectorAll('input[id*="Delta rule "]')).toHaveLength(
    3000,
  );
  const last = editor.querySelector<HTMLInputElement>(
    'input[id$="Delta rule 100 size 30"]',
  )!;
  const label = editor.querySelector<HTMLLabelElement>(
    'label[for$="Delta rule 100 size 30"]',
  )!;
  expect(label.htmlFor).toBe(last.id);
  expect(label).toHaveTextContent("Delta rule 100 size 30");
  fireEvent.change(last, { target: { value: "-99.1234" } });
  expect(last).toHaveValue("-99.1234");
  fireEvent.click(switchOrganization);
  await load();
  expect(screen.queryByDisplayValue("-99.1234")).toBeNull();
});
