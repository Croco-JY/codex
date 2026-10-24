import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { endSession, setLocalSubject, getSession } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  A,
  B,
  P,
  S,
  MS,
  id,
  root,
  route,
  rev,
  spec,
  summary,
  response,
  deferred,
  fixture,
} from "../../test/measurementFixture";
afterEach(() => {
  cleanup();
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const base = root() + "/measurement-spec";
async function absent() {
  await screen.findByText(
    "No Measurement Spec has been created for this Style.",
  );
}
async function existing(n = 1) {
  await screen.findByRole("heading", { name: `Latest revision ${n}` });
  await screen.findByRole("button", { name: `Open revision ${n}` });
}
async function fill() {
  await userEvent.type(screen.getByLabelText("Base size"), " M ");
  await userEvent.selectOptions(screen.getByLabelText("Unit system"), "CM");
  await userEvent.type(screen.getByLabelText("Code · POM 1"), "CHEST");
  await userEvent.type(screen.getByLabelText("Label · POM 1"), " Chest ");
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "00012.5");
}
const button = (name: string) => screen.getByRole("button", { name });
const writes = (h: ReturnType<typeof fixture>) =>
  h.writes().filter((r) => r.url.includes("measurement-spec"));

test("ordinary StyleDetail preserves four initial children and navigation causes zero Measurement reads", async () => {
  const h = fixture();
  h.mount(route().replace("/measurements", ""));
  await screen.findByRole("heading", { name: "Measurement Style", level: 1 });
  for (const name of [
    "Style Requirement",
    "Material Selections",
    "Facility Candidates",
    "Development References",
  ])
    await screen.findByRole("region", { name });
  expect(h.measurementReads()).toHaveLength(0);
  expect(screen.getByRole("link", { name: "Measurements" })).toHaveAttribute(
    "href",
    route(),
  );
  const child = h.calls.filter((r) =>
    [
      "requirement",
      "material-selections",
      "facility-candidates",
      "development-references",
    ].some((c) => new URL(r.url).pathname === root() + "/" + c),
  );
  expect(child).toHaveLength(4);
});
test("absent singleton GET is normal only after exact Project→Style and no history/detail/domain fanout", async () => {
  const h = fixture();
  h.mount();
  await absent();
  expect(h.measurementReads()).toHaveLength(1);
  expect(
    h.calls
      .filter((r) => r.url.includes("/api/v1/organizations/"))
      .map((r) => new URL(r.url).pathname),
  ).toEqual([`/api/v1/organizations/${A}/projects/${P}`, root(), base]);
  expect(h.calls.some((r) => /patterns|grading|release/.test(r.url))).toBe(
    false,
  );
});
test.each(["ORG_OWNER", "ORG_ADMIN"])(
  "%s creates exact initial body without authority fields",
  async (role) => {
    const h = fixture();
    h.role = role;
    h.mount();
    await absent();
    await fill();
    await userEvent.click(button("Create Measurement Spec"));
    await screen.findByText("Measurement revision created.");
    await existing();
    expect(writes(h)).toHaveLength(1);
    const request = writes(h)[0];
    expect(request.method).toBe("PUT");
    expect(request.headers.get("If-None-Match")).toBe("*");
    expect(await request.clone().json()).toEqual({
      baseSize: "M",
      unitSystem: "CM",
      points: [
        {
          code: "CHEST",
          label: "Chest",
          value: "00012.5",
          tolerancePlus: null,
          toleranceMinus: null,
          notes: null,
        },
      ],
    });
    expect(
      screen.queryByRole("form", { name: "Measurement draft" }),
    ).not.toBeInTheDocument();
  },
);
test.each(["VIEWER", "PROJECT_ARCHIVED", "STYLE_ARCHIVED"])(
  "%s has read-only absence and no mutation actions",
  async (mode) => {
    const h = fixture();
    if (mode === "VIEWER") h.role = mode;
    else if (mode === "PROJECT_ARCHIVED") h.projectStatus = "ARCHIVED";
    else h.styleStatus = "ARCHIVED";
    h.mount();
    await absent();
    expect(
      screen.queryByRole("button", { name: "Create Measurement Spec" }),
    ).not.toBeInTheDocument();
    expect(writes(h)).toHaveLength(0);
  },
);
test("existing latest and anchored summaries need no detail calls; explicit historical open fetches exactly one", async () => {
  const h = fixture();
  h.specs.set(A, spec(2));
  h.revisions.set(rev().id, rev());
  h.mount();
  await existing(2);
  expect(h.measurementReads()).toHaveLength(2);
  const history = h
    .measurementReads()
    .find((r) => new URL(r.url).pathname.endsWith("/revisions"))!;
  expect(new URL(history.url).searchParams.get("maxRevisionNumber")).toBe("2");
  expect(new URL(history.url).searchParams.get("limit")).toBe("25");
  await userEvent.click(button("Open revision 1"));
  await screen.findByRole("heading", { name: "Selected revision 1" });
  expect(h.measurementReads()).toHaveLength(3);
  expect(h.measurementReads()[2].url).toContain(rev().id);
});
test("history waits for spec even when a newer server head exists by the time history begins", async () => {
  const h = fixture(),
    held = deferred<Response>();
  h.overrides.set(`GET ${base}`, () => held.promise);
  h.specs.set(A, spec(3));
  h.revisions.set(rev(2).id, rev(2));
  h.mount();
  await waitFor(() => expect(h.measurementReads()).toHaveLength(1));
  expect(h.measurementReads().some((r) => r.url.includes("/revisions"))).toBe(
    false,
  );
  await act(async () => held.resolve(response(spec(2))));
  await existing(2);
  expect(
    new URL(h.measurementReads()[1].url).searchParams.get("maxRevisionNumber"),
  ).toBe("2");
  expect(
    screen.queryByRole("button", { name: "Open revision 3" }),
  ).not.toBeInTheDocument();
});
test("25-row anchored history loads older cursor only explicitly and never details", async () => {
  const h = fixture();
  h.specs.set(A, spec(30));
  for (let n = 1; n <= 30; n++) h.revisions.set(rev(n).id, rev(n));
  h.mount();
  await existing(30);
  expect(h.measurementReads()).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "Open revision 5" }),
  ).not.toBeInTheDocument();
  await userEvent.click(button("Older revisions"));
  await screen.findByRole("button", { name: "Open revision 5" });
  expect(h.measurementReads()).toHaveLength(3);
  expect(
    new URL(h.measurementReads()[2].url).searchParams.get("maxRevisionNumber"),
  ).toBe("5");
  await userEvent.click(button("Newer revisions"));
  await screen.findByRole("button", { name: "Open revision 30" });
  expect(
    h
      .measurementReads()
      .filter((r) => new URL(r.url).pathname.includes("/revisions/")),
  ).toHaveLength(0);
});
test("new revision copies a fresh draft, preserves immutable cache, sends captured head", async () => {
  const h = fixture();
  h.specs.set(A, spec());
  h.mount();
  await existing();
  await userEvent.click(button("Create new revision"));
  await userEvent.clear(screen.getByLabelText("Value · POM 1"));
  await userEvent.type(screen.getByLabelText("Value · POM 1"), "51.0000");
  expect(
    h.cache.getQueryData(queryKeys.measurementSpec(h.scope, A, P, S)),
  ).toEqual(spec());
  await userEvent.click(button("Create revision"));
  await existing(2);
  expect((await writes(h)[0].clone().json()).expectedLatestRevisionNumber).toBe(
    1,
  );
  expect((await writes(h)[0].clone().json()).points[0].value).toBe("51.0000");
  expect(writes(h)).toHaveLength(1);
});
test.each([409, 412])(
  "%s preserves draft and requires explicit reconciliation without automatic conversion",
  async (status) => {
    const h = fixture();
    if (status === 409) h.specs.set(A, spec());
    h.mount();
    if (status === 409) {
      await existing();
      await userEvent.click(button("Create new revision"));
      await userEvent.clear(screen.getByLabelText("Base size"));
      await userEvent.type(screen.getByLabelText("Base size"), "PRIVATE DRAFT");
    } else {
      await absent();
      await fill();
    }
    const method = status === 409 ? "POST" : "PUT",
      target = status === 409 ? base + "/revisions" : base;
    h.overrides.set(`${method} ${target}`, () => {
      h.specs.set(A, spec(status === 409 ? 2 : 1));
      return response({}, status);
    });
    await userEvent.click(
      button(status === 409 ? "Create revision" : "Create Measurement Spec"),
    );
    await screen.findByRole("heading", {
      name: "Review authoritative measurements before submitting again",
    });
    await existing(status === 409 ? 2 : 1);
    expect(writes(h)).toHaveLength(1);
    expect(screen.getByLabelText("Base size")).toHaveValue(
      status === 409 ? "PRIVATE DRAFT" : " M ",
    );
    expect(
      button(status === 409 ? "Create revision" : "Create Measurement Spec"),
    ).toBeDisabled();
    await userEvent.click(button("Reconcile draft with latest revision"));
    expect(writes(h)).toHaveLength(1);
    expect(button("Create revision")).toBeEnabled();
    expect(
      screen.getByText(`Draft baseline revision: ${status === 409 ? 2 : 1}`),
    ).toBeVisible();
  },
);
for (const mode of ["create", "revision"] as const)
  for (const status of [0, 500, 502])
    test(`${mode} ambiguous ${status} retains draft without success attribution/resend`, async () => {
      const h = fixture();
      if (mode === "revision") h.specs.set(A, spec());
      h.mount();
      if (mode === "revision") {
        await existing();
        await userEvent.click(button("Create new revision"));
      } else {
        await absent();
        await fill();
      }
      const method = mode === "create" ? "PUT" : "POST",
        target = base + (mode === "revision" ? "/revisions" : "");
      h.overrides.set(`${method} ${target}`, () => {
        h.specs.set(A, spec(mode === "revision" ? 2 : 1));
        if (status === 0) throw new TypeError("Synthetic lost response");
        return response({}, status === 502 ? 201 : status);
      });
      await userEvent.click(
        button(
          mode === "create" ? "Create Measurement Spec" : "Create revision",
        ),
      );
      await screen.findByText(/Outcome is uncertain/);
      await existing(mode === "revision" ? 2 : 1);
      expect(writes(h)).toHaveLength(1);
      expect(
        screen.queryByText("Measurement revision created."),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Code · POM 1")).toHaveValue("CHEST");
    });
test("POM draft add/remove/reorder and validation never mutate server cache or send partial writes", async () => {
  const h = fixture();
  h.mount();
  await absent();
  await userEvent.click(button("Create Measurement Spec"));
  expect(writes(h)).toHaveLength(0);
  await fill();
  await userEvent.click(button("Add POM"));
  await userEvent.type(screen.getByLabelText("Code · POM 2"), "CHEST");
  await userEvent.type(screen.getByLabelText("Label · POM 2"), "Second");
  await userEvent.type(screen.getByLabelText("Value · POM 2"), "-1");
  await userEvent.click(button("Create Measurement Spec"));
  await screen.findByText("POM codes must be unique in this revision.");
  expect(writes(h)).toHaveLength(0);
  await userEvent.click(button("Move POM 2 up"));
  expect(screen.getByLabelText("Label · POM 1")).toHaveValue("Second");
  await userEvent.click(button("Remove POM 1"));
  expect(screen.getByLabelText("Label · POM 1")).toHaveValue(" Chest ");
});
test.each([404, 500])(
  "history %s is error, not absent spec, and never enables detail mutations",
  async (status) => {
    const h = fixture();
    h.specs.set(A, spec());
    h.overrides.set(`GET ${base}/revisions`, () => response({}, status));
    h.mount();
    await screen.findByRole("heading", { name: "Latest revision 1" });
    await within(
      screen.getByRole("region", { name: "Measurement revision history" }),
    ).findByRole("heading", {
      name: status === 404 ? "Not found" : "Service unavailable",
    });
    expect(h.measurementReads()).toHaveLength(2);
  },
);
test.each(["project", "style"])(
  "%s pending gates every deeper Measurement request",
  async (parent) => {
    const h = fixture(),
      held = deferred<Response>(),
      url =
        parent === "project"
          ? `/api/v1/organizations/${A}/projects/${P}`
          : root();
    h.overrides.set(`GET ${url}`, () => held.promise);
    h.mount();
    await screen.findByRole("status", {
      name: parent === "project" ? "Loading parent Project" : "Loading Style",
    });
    expect(h.measurementReads()).toHaveLength(0);
    if (parent === "project")
      expect(h.calls.some((r) => new URL(r.url).pathname === root())).toBe(
        false,
      );
  },
);
test.each(["project", "style"])(
  "%s malformed timestamp suppresses Measurement and mutations",
  async (parent) => {
    const h = fixture(),
      url =
        parent === "project"
          ? `/api/v1/organizations/${A}/projects/${P}`
          : root();
    h.overrides.set(`GET ${url}`, () =>
      response(
        parent === "project"
          ? {
              id: P,
              organizationId: A,
              name: "Bad Project",
              description: null,
              status: "ACTIVE",
              version: 0,
              createdAt: "2026-10-24",
              updatedAt: "2026-10-24T00:00:00Z",
            }
          : {
              id: S,
              projectId: P,
              name: "Bad Style",
              styleCode: null,
              description: null,
              status: "ACTIVE",
              version: 0,
              createdAt: "2026-10-24",
              updatedAt: "2026-10-24T00:00:00Z",
            },
      ),
    );
    h.mount();
    await screen.findByRole("heading", {
      name: "Service unavailable",
      level: 1,
    });
    expect(h.measurementReads()).toHaveLength(0);
    expect(writes(h)).toHaveLength(0);
  },
);
test("current-generation Measurement 403 denies whole workspace and removes private cache", async () => {
  const h = fixture(),
    held = deferred<Response>();
  h.overrides.set(`GET ${base}`, () => held.promise);
  h.mount();
  await waitFor(() => expect(h.measurementReads()).toHaveLength(1));
  await act(async () => held.resolve(response({}, 403)));
  await screen.findByRole("heading", { name: "Access denied", level: 1 });
  expect(
    h.cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(h.scope, A) }),
  ).toHaveLength(0);
  expect(
    screen.queryByRole("form", { name: "Measurement draft" }),
  ).not.toBeInTheDocument();
});
test.each([false, true])("A→B stale read is isolated; ABA=%s", async (aba) => {
  const h = fixture(),
    held = deferred<Response>();
  h.overrides.set(`GET ${base}`, () => held.promise);
  h.mount();
  await waitFor(() => expect(h.measurementReads()).toHaveLength(1));
  const old = h.measurementReads()[0];
  await userEvent.click(button("Enter B"));
  await absent();
  h.overrides.delete(`GET ${base}`);
  if (aba) {
    await userEvent.click(button("Enter A"));
    await absent();
  }
  expect(old.signal.aborted).toBe(true);
  await act(async () => held.resolve(response(spec())));
  expect(
    screen.queryByRole("heading", { name: "Latest revision 1" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(MS)).not.toBeInTheDocument();
});
test.each(["success", "failure"])(
  "late %s mutation cannot change replacement workspace draft",
  async (outcome) => {
    const h = fixture(),
      held = deferred<Response>();
    h.overrides.set(`PUT ${base}`, () => held.promise);
    h.mount();
    await absent();
    await fill();
    await userEvent.click(button("Create Measurement Spec"));
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    await userEvent.click(button("Enter B"));
    await absent();
    await userEvent.type(screen.getByLabelText("Base size"), "B DRAFT");
    await act(async () =>
      held.resolve(
        response(
          outcome === "success" ? spec() : {},
          outcome === "success" ? 201 : 409,
        ),
      ),
    );
    expect(screen.getByLabelText("Base size")).toHaveValue("B DRAFT");
    expect(
      screen.queryByText("Measurement revision created."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Review authoritative measurements before submitting again",
      }),
    ).not.toBeInTheDocument();
    expect(writes(h)).toHaveLength(1);
  },
);
test("same-Actor Org switch clears private draft and retains Supply; Actor switch purges old scopes", async () => {
  const h = fixture(),
    key = queryKeys.material(h.scope, id(90));
  h.cache.setQueryData(key, { synthetic: true });
  h.mount();
  await absent();
  await fill();
  await userEvent.click(button("Enter B"));
  await absent();
  expect(screen.getByLabelText("Base size")).toHaveValue("");
  expect(h.cache.getQueryData(key)).toEqual({ synthetic: true });
  expect(
    h.cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(h.scope, A) }),
  ).toHaveLength(0);
  await act(async () => setLocalSubject("replacement-measurement-actor"));
  await absent();
  expect(getSession().key).not.toBe(h.scope);
  expect(
    h.cache
      .getQueryCache()
      .findAll()
      .filter((q) => q.queryKey[1] === h.scope),
  ).toHaveLength(0);
  expect(
    h.cache
      .getMutationCache()
      .getAll()
      .filter((m) => m.options.mutationKey?.[1] === h.scope),
  ).toHaveLength(0);
  expect(screen.getByLabelText("Code · POM 1")).toHaveValue("");
});
test.each(["project", "style"])(
  "%s 404 suppresses Measurement queries",
  async (parent) => {
    const h = fixture(),
      url =
        parent === "project"
          ? `/api/v1/organizations/${A}/projects/${P}`
          : root();
    h.overrides.set(`GET ${url}`, () => response({}, 404));
    h.mount();
    await screen.findByRole("heading", { name: "Not found", level: 1 });
    expect(h.measurementReads()).toHaveLength(0);
  },
);
test("ABA late successful mutation cannot clear a fresh A draft or repopulate old generation", async () => {
  const h = fixture(),
    held = deferred<Response>();
  h.overrides.set(`PUT ${base}`, () => held.promise);
  h.mount();
  await absent();
  await fill();
  await userEvent.click(button("Create Measurement Spec"));
  await waitFor(() => expect(writes(h)).toHaveLength(1));
  const old = writes(h)[0];
  await userEvent.click(button("Enter B"));
  await absent();
  await userEvent.click(button("Enter A"));
  await absent();
  await userEvent.type(screen.getByLabelText("Base size"), "NEW A DRAFT");
  await act(async () => held.resolve(response(spec(), 201)));
  expect(old.signal.aborted).toBe(true);
  expect(screen.getByLabelText("Base size")).toHaveValue("NEW A DRAFT");
  expect(
    screen.queryByText("Measurement revision created."),
  ).not.toBeInTheDocument();
  expect(writes(h)).toHaveLength(1);
});
test("Actor switch aborts pending create and ignores old success while clearing draft/mutations", async () => {
  const h = fixture(),
    held = deferred<Response>();
  h.overrides.set(`PUT ${base}`, () => held.promise);
  h.mount();
  await absent();
  await fill();
  await userEvent.click(button("Create Measurement Spec"));
  await waitFor(() => expect(writes(h)).toHaveLength(1));
  const old = writes(h)[0];
  await act(async () => setLocalSubject("measurement-new-actor"));
  await absent();
  await act(async () => held.resolve(response(spec(), 201)));
  expect(old.signal.aborted).toBe(true);
  expect(screen.getByLabelText("Base size")).toHaveValue("");
  expect(
    screen.queryByText("Measurement revision created."),
  ).not.toBeInTheDocument();
  expect(
    h.cache
      .getMutationCache()
      .getAll()
      .filter((m) => m.options.mutationKey?.[1] === h.scope),
  ).toHaveLength(0);
});
test("history 403 denies the workspace; malformed history cursor is a safe error without row actions", async () => {
  const h = fixture();
  h.specs.set(A, spec());
  h.overrides.set(`GET ${base}/revisions`, () => response({}, 403));
  h.mount();
  await screen.findByRole("heading", { name: "Access denied", level: 1 });
  expect(
    h.cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(h.scope, A) }),
  ).toHaveLength(0);
});
test("uncertain initial create with authoritative absence requires a deliberate new-create decision", async () => {
  const h = fixture();
  h.overrides.set(`PUT ${base}`, () => response({}, 500));
  h.mount();
  await absent();
  await fill();
  await userEvent.click(button("Create Measurement Spec"));
  await screen.findByText(/Outcome is uncertain/);
  expect(writes(h)).toHaveLength(1);
  await userEvent.click(button("Use draft for initial creation"));
  expect(writes(h)).toHaveLength(1);
  expect(button("Create Measurement Spec")).toBeEnabled();
});
test("malformed spec or full points fail closed, not an empty editable model", async () => {
  const h = fixture();
  h.specs.set(A, {
    ...spec(),
    latestRevision: { ...rev(), points: [{ ...rev().points[0], position: 1 }] },
  });
  h.mount();
  await screen.findByRole("heading", { name: "Service unavailable" });
  expect(
    screen.queryByRole("button", { name: "Create new revision" }),
  ).not.toBeInTheDocument();
  expect(h.measurementReads()).toHaveLength(1);
});
