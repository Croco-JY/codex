import { test, expect, vi, afterEach } from "vitest";
import {
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import {
  fixture,
  route,
  qaRoot,
  qa,
  assessment,
  summary,
  revision,
  pattern,
  A,
  B,
  P,
  S,
  PID,
  id,
  time,
  root,
  response,
} from "../../test/patternQaFixture";
import { deferred } from "../../test/measurementFixture";
import { setAccessToken } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const loaded = () =>
  screen.findByText("This exact revision has no assessments.");
const writes = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) => r.method !== "GET");
const reads = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) => r.url.includes("/qa"));
async function edit(notes = "Private human QA notes") {
  click("Record QA assessment");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Submit QA assessment" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText("Human review notes"), {
    target: { value: notes },
  });
}
const artifact = (state: "READY" | "PENDING" | "FAILED" = "READY") => ({
  id: id(900),
  patternRevisionId: revision().id,
  patternId: PID,
  styleId: S,
  declaredFormat: "PDF",
  displayName: "review.pdf",
  sizeBytes: 10,
  state,
  failureCode: state === "FAILED" ? "STORAGE_WRITE_FAILED" : null,
  createdAt: time,
  updatedAt: time,
});
test("QA parent gating, UNREVIEWED and explicit history/exact request budgets", async () => {
  const h = fixture();
  h.mount(route());
  await loaded();
  expect(reads(h)).toHaveLength(1);
  expect(
    h.calls.filter((r) =>
      /\/revisions\/[0-9a-f-]+$/.test(new URL(r.url).pathname),
    ),
  ).toHaveLength(1);
  expect(
    h.calls.filter((r) =>
      /\/artifact|measurement-spec|grade-rule-sets|release/.test(r.url),
    ),
  ).toHaveLength(0);
  click("Expand QA history");
  await screen.findByText("No assessments in this history snapshot.");
  expect(reads(h)).toHaveLength(2);
  expect(new URL(reads(h)[1].url).searchParams.get("maxAssessmentNumber")).toBe(
    "0",
  );
  expect(writes(h)).toHaveLength(0);
});
test("StyleDetail and Pattern detail QA navigation never prefetches QA", async () => {
  const h = fixture();
  h.mount(root().replace("/api/v1", ""));
  await screen.findByRole("link", { name: "Patterns" });
  expect(reads(h)).toHaveLength(0);
  click("Pattern detail A");
  await screen.findByRole("link", { name: "Human QA for revision 1" });
  expect(reads(h)).toHaveLength(0);
});
test("PLATFORM_ADMIN capability without requested Organization membership has no QA bypass", async () => {
  const h = fixture();
  h.member = false;
  h.mount(route());
  await screen.findByText("Access denied");
  expect(reads(h)).toHaveLength(0);
  expect(h.calls.filter((r) => r.url.includes("/projects/"))).toHaveLength(0);
});
test.each(["wrong-revision", "date-only"])(
  "malformed QA success %s fails closed before submission controls",
  async (kind) => {
    const h = fixture(),
      value = qa(1);
    if (kind === "wrong-revision") value.patternRevisionId = id(99);
    else value.latestAssessment!.reviewedAt = "2026-10-27";
    h.overrides.set("GET " + qaRoot(), () => response(value));
    h.mount(route());
    await screen.findByRole("heading", { name: "Service unavailable" });
    expect(
      screen.queryByRole("button", { name: "Record QA assessment" }),
    ).toBeNull();
    expect(writes(h)).toHaveLength(0);
  },
);
test.each(["project", "style", "pattern", "revision"])(
  "pending or invalid %s suppresses downstream QA",
  async (kind) => {
    const h = fixture(),
      d = deferred<Response>();
    const path =
      kind === "project"
        ? root().split("/styles")[0]
        : kind === "style"
          ? root()
          : kind === "pattern"
            ? root() + "/patterns/" + PID
            : root() + "/patterns/" + PID + "/revisions/" + revision().id;
    h.overrides.set("GET " + path, () => d.promise);
    h.mount(route());
    await screen.findByRole("status", {
      name:
        kind === "project"
          ? "Loading parent Project"
          : kind === "style"
            ? "Loading Style"
            : kind === "pattern"
              ? "Loading parent Pattern"
              : "Loading exact Pattern revision",
    });
    expect(reads(h)).toHaveLength(0);
    d.resolve(response({}, 404));
    await screen.findByText("Not found");
    expect(reads(h)).toHaveLength(0);
  },
);
test.each(["ORG_OWNER", "ORG_ADMIN"])(
  "%s explicitly records an observation with server-owned identity/time",
  async (role) => {
    const h = fixture();
    h.role = role;
    h.mount(route());
    await loaded();
    await edit(" \u0085Human note 🧵\ufeff ");
    click("Submit QA assessment");
    await screen.findByText("QA assessment recorded.");
    expect(writes(h)).toHaveLength(1);
    expect(await writes(h)[0].clone().json()).toEqual({
      expectedLatestAssessmentNumber: 0,
      outcome: "OBSERVED",
      evidenceBasis: "METADATA_ONLY",
      artifactId: null,
      notes: "Human note 🧵",
    });
    expect(
      screen.getByRole("heading", { name: "Latest QA assessment 1" }),
    ).toBeVisible();
  },
);
test.each(["VIEWER", "project", "style", "pattern"])(
  "%s reads history without write controls",
  async (kind) => {
    const h = fixture();
    h.current.set(A, qa(1));
    if (kind === "VIEWER") h.role = "VIEWER";
    else if (kind === "project") h.projectStatus = "ARCHIVED";
    else if (kind === "style") h.styleStatus = "ARCHIVED";
    else h.patterns.set(A, [{ ...pattern(), status: "ARCHIVED" }]);
    h.mount(route());
    await screen.findByRole("heading", { name: "Latest QA assessment 1" });
    expect(
      screen.queryByRole("button", { name: "Record QA assessment" }),
    ).toBeNull();
    click("Expand QA history");
    await screen.findByRole("button", { name: "Open QA assessment 1" });
    expect(writes(h)).toHaveLength(0);
  },
);
test("HUMAN_REVIEWED requires READY basis and explicit keyboard-accessible confirmation", async () => {
  const h = fixture();
  h.overrides.set(
    "GET " +
      root() +
      "/patterns/" +
      PID +
      "/revisions/" +
      revision().id +
      "/artifact",
    () => response(artifact()),
  );
  h.mount(route());
  await loaded();
  await edit();
  fireEvent.change(screen.getByLabelText("QA outcome"), {
    target: { value: "HUMAN_REVIEWED" },
  });
  click("Submit QA assessment");
  await screen.findByText(/Check the outcome, review basis/);
  expect(writes(h)).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Review basis"), {
    target: { value: "READY_ARTIFACT" },
  });
  click("Submit QA assessment");
  expect(await screen.findByRole("alertdialog")).toHaveTextContent(
    "not automated validation",
  );
  expect(writes(h)).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "Confirm human review attestation" }),
  ).toHaveFocus();
  click("Confirm human review attestation");
  await screen.findByText("QA assessment recorded.");
  expect(await writes(h)[0].clone().json()).toMatchObject({
    outcome: "HUMAN_REVIEWED",
    evidenceBasis: "READY_ARTIFACT",
    artifactId: id(900),
  });
  expect(screen.getByText(/^Human review recorded\./)).toBeVisible();
});
test.each(["PENDING", "FAILED", "absent"])(
  "%s evidence is unavailable, without content fetch",
  async (state) => {
    const h = fixture();
    if (state !== "absent")
      h.overrides.set(
        "GET " +
          root() +
          "/patterns/" +
          PID +
          "/revisions/" +
          revision().id +
          "/artifact",
        () => response(artifact(state as "PENDING" | "FAILED")),
      );
    h.mount(route());
    await loaded();
    await edit();
    expect(
      screen.getByRole("option", { name: "READY_ARTIFACT" }),
    ).toBeDisabled();
    expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(0);
  },
);
test("stale409 keeps draft and captured head until explicit non-submitting reconciliation", async () => {
  const h = fixture();
  h.mount(route());
  await loaded();
  await edit("Keep all of my notes");
  h.current.set(A, qa(1));
  click("Submit QA assessment");
  await screen.findByText("Draft baseline assessment 0; current latest 1.");
  expect(screen.getByLabelText("Human review notes")).toHaveValue(
    "Keep all of my notes",
  );
  expect(writes(h)).toHaveLength(1);
  click("Reconcile QA baseline without changing draft");
  expect(writes(h)).toHaveLength(1);
  click("Submit QA assessment");
  await screen.findByText("QA assessment recorded.");
  expect(await writes(h)[1].clone().json()).toMatchObject({
    expectedLatestAssessmentNumber: 1,
    notes: "Keep all of my notes",
  });
});
test.each(["archived", "unavailable"])(
  "409 refreshes parent context while retaining draft: %s",
  async (kind) => {
    const h = fixture();
    h.mount(route());
    await loaded();
    await edit("Retain notes across parent reconciliation");
    h.overrides.set("POST " + qaRoot() + "/assessments", () =>
      response({}, 409),
    );
    if (kind === "archived")
      h.patterns.set(A, [{ ...pattern(), status: "ARCHIVED" }]);
    else
      h.overrides.set("GET " + root() + "/patterns/" + PID, () =>
        response({}, 500),
      );
    click("Submit QA assessment");
    if (kind === "archived")
      await screen.findByText(
        "QA is read-only while the Project, Style or Pattern is archived.",
      );
    else await screen.findByRole("heading", { name: "Service unavailable" });
    expect(screen.getByLabelText("Human review notes")).toHaveValue(
      "Retain notes across parent reconciliation",
    );
    expect(
      screen.getByRole("button", { name: "Submit QA assessment" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Reconcile QA baseline without changing draft",
      }),
    ).toBeDisabled();
    expect(writes(h)).toHaveLength(1);
  },
);
test.each([0, 500, 502])(
  "ambiguous outcome %s retains draft and never attributes or automatically resends",
  async (status) => {
    const h = fixture();
    h.mount(route());
    await loaded();
    await edit("Keep ambiguous human notes");
    h.current.set(A, qa(1));
    h.overrides.set("POST " + qaRoot() + "/assessments", () =>
      status === 0
        ? Promise.reject(new TypeError("network loss"))
        : response({}, status === 502 ? 201 : status),
    );
    click("Submit QA assessment");
    await screen.findByText("Draft baseline assessment 0; current latest 1.");
    expect(screen.getByLabelText("Human review notes")).toHaveValue(
      "Keep ambiguous human notes",
    );
    expect(writes(h)).toHaveLength(1);
    expect(screen.queryByText("QA assessment recorded.")).toBeNull();
  },
);
test.each(["number", "outcome", "notes", "valid"])(
  "historical selected-summary/detail %s uses exact eight-field correspondence",
  async (kind) => {
    const h = fixture(),
      a = assessment(1);
    h.current.set(A, qa(2));
    h.rows.set(a.id, a);
    const forged = { ...a };
    if (kind === "number") forged.assessmentNumber = 999;
    if (kind === "outcome") forged.outcome = "CHANGES_REQUESTED";
    if (kind === "notes") forged.notes = " bad stored notes";
    h.overrides.set("GET " + qaRoot() + "/assessments/" + a.id, () =>
      response(forged),
    );
    h.mount(route());
    await screen.findByRole("heading", { name: "Latest QA assessment 2" });
    click("Expand QA history");
    await screen.findByRole("button", { name: "Open QA assessment 1" });
    click("Open QA assessment 1");
    if (kind === "valid")
      await screen.findByRole("heading", {
        name: "Historical QA assessment 1",
      });
    else {
      await screen.findByRole("heading", { name: "Service unavailable" });
      expect(
        screen.queryByRole("region", { name: /Historical QA assessment/ }),
      ).toBeNull();
    }
    expect(reads(h)).toHaveLength(3);
    expect(writes(h)).toHaveLength(0);
  },
);
test("cached same UUID cannot bypass the newly selected summary even without an exact refetch", async () => {
  const h = fixture(),
    a = assessment();
  h.current.set(A, qa(2));
  h.rows.set(a.id, a);
  h.mount(route());
  await screen.findByRole("heading", { name: "Latest QA assessment 2" });
  click("Expand QA history");
  await screen.findByRole("button", { name: "Open QA assessment 1" });
  click("Open QA assessment 1");
  await screen.findByRole("heading", { name: "Historical QA assessment 1" });
  await act(async () => {
    h.cache.setQueryData(
      [
        ...queryKeys.patternQa(h.scope, A, P, S, PID, revision().id),
        "assessments",
        25,
        2,
      ],
      {
        items: [{ ...summary(a), outcome: "CHANGES_REQUESTED" }],
        limit: 25,
        nextMaxAssessmentNumber: null,
      },
    );
  });
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "QA assessment history" }),
    ).toHaveTextContent("CHANGES_REQUESTED"),
  );
  click("Open QA assessment 1");
  await screen.findByRole("heading", { name: "Service unavailable" });
  expect(
    screen.queryByRole("region", { name: /Historical QA assessment/ }),
  ).toBeNull();
  expect(
    h.calls.filter((r) =>
      new URL(r.url).pathname.endsWith("/assessments/" + a.id),
    ),
  ).toHaveLength(1);
});
test.each(["A→B", "ABA", "Actor"])(
  "late QA response cannot cross %s",
  async (mode) => {
    const h = fixture(),
      d = deferred<Response>();
    let first = true;
    h.overrides.set("GET " + qaRoot(), () => {
      if (first) {
        first = false;
        return d.promise;
      }
      return response(qa());
    });
    h.mount(route());
    await screen.findByRole("status", { name: "Loading Pattern QA" });
    if (mode === "Actor") {
      await act(async () => {
        setAccessToken("replacement-qa-actor");
      });
      await loaded();
    } else {
      click("Patterns B");
      await screen.findByRole("link", { name: "Pattern revision 1" });
      if (mode === "ABA") {
        click("Pattern detail A");
        await screen.findByRole("link", { name: "Human QA for revision 1" });
        fireEvent.click(
          screen.getByRole("link", { name: "Human QA for revision 1" }),
        );
        await loaded();
      }
    }
    await act(async () => {
      d.resolve(response(qa(9)));
    });
    expect(
      screen.queryByRole("heading", { name: "Latest QA assessment 9" }),
    ).toBeNull();
    expect(writes(h)).toHaveLength(0);
  },
);
test.each(["current", "history", "exact"])(
  "current-generation %s403 denies workspace",
  async (kind) => {
    const h = fixture();
    h.current.set(A, qa(2));
    h.rows.set(assessment().id, assessment());
    const path =
      qaRoot() +
      (kind === "current"
        ? ""
        : kind === "history"
          ? "/assessments"
          : "/assessments/" + assessment().id);
    h.overrides.set("GET " + path, () => response({}, 403));
    h.mount(route());
    if (kind !== "current") {
      await screen.findByRole("heading", { name: "Latest QA assessment 2" });
      click("Expand QA history");
      if (kind === "exact") {
        await screen.findByRole("button", { name: "Open QA assessment 1" });
        click("Open QA assessment 1");
      }
    }
    await screen.findByText("Access denied");
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === "workspace"),
    ).toHaveLength(0);
  },
);
test.each([true, false])(
  "old403 and old success cannot replace B QA draft, success=%s",
  async (success) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set("POST " + qaRoot() + "/assessments", () => d.promise);
    h.mount(route());
    await loaded();
    await edit("A private draft");
    click("Submit QA assessment");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    click("Patterns B");
    await screen.findByRole("link", { name: "Pattern revision 1" });
    fireEvent.click(screen.getByRole("link", { name: "Pattern revision 1" }));
    await screen.findByRole("link", { name: "Human QA for revision 1" });
    fireEvent.click(
      screen.getByRole("link", { name: "Human QA for revision 1" }),
    );
    await loaded();
    await edit("B private draft");
    await act(async () => {
      d.resolve(
        response(
          success ? { ...assessment(), notes: "A private draft" } : {},
          success ? 201 : 403,
        ),
      );
    });
    expect(screen.getByLabelText("Human review notes")).toHaveValue(
      "B private draft",
    );
    expect(screen.queryByText("Access denied")).toBeNull();
    expect(writes(h)).toHaveLength(1);
  },
);
test("private QA draft has no durable browser storage or URL payload", async () => {
  const h = fixture();
  h.mount(route());
  await loaded();
  await edit("Private QA IP marker");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(location.search).toBe("");
  expect(location.hash).toBe("");
});
test("old-generation QA403 cannot deny the replacement workspace", async () => {
  const h = fixture(),
    d = deferred<Response>();
  h.overrides.set("GET " + qaRoot(), () => d.promise);
  h.mount(route());
  await screen.findByRole("status", { name: "Loading Pattern QA" });
  click("Patterns B");
  await screen.findByRole("link", { name: "Pattern revision 1" });
  await act(async () => {
    d.resolve(response({}, 403));
  });
  expect(screen.queryByText("Access denied")).toBeNull();
  expect(reads(h)).toHaveLength(1);
});
test.each([true, false])(
  "Actor-switch drops late QA mutation success/error and draft, success=%s",
  async (success) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set("POST " + qaRoot() + "/assessments", () => d.promise);
    h.mount(route());
    await loaded();
    await edit("Old Actor private assessment");
    click("Submit QA assessment");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    await act(async () => {
      setAccessToken("replacement-assessment-actor");
    });
    await loaded();
    await act(async () => {
      d.resolve(
        response(
          success
            ? { ...assessment(), notes: "Old Actor private assessment" }
            : {},
          success ? 201 : 403,
        ),
      );
    });
    expect(
      screen.queryByDisplayValue("Old Actor private assessment"),
    ).toBeNull();
    expect(screen.queryByText("QA assessment recorded.")).toBeNull();
    expect(screen.queryByText("Access denied")).toBeNull();
    expect(h.cache.getMutationCache().getAll()).toHaveLength(0);
  },
);
test.each([true, false])(
  "ABA preserves replacement A draft against old mutation, success=%s",
  async (success) => {
    const h = fixture(),
      d = deferred<Response>();
    h.overrides.set("POST " + qaRoot() + "/assessments", () => d.promise);
    h.mount(route());
    await loaded();
    await edit("Old A QA draft");
    click("Submit QA assessment");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    click("Patterns B");
    await screen.findByRole("link", { name: "Pattern revision 1" });
    click("Pattern detail A");
    await screen.findByRole("link", { name: "Human QA for revision 1" });
    fireEvent.click(
      screen.getByRole("link", { name: "Human QA for revision 1" }),
    );
    await loaded();
    await edit("Replacement A QA draft");
    await act(async () => {
      d.resolve(
        response(
          success ? { ...assessment(), notes: "Old A QA draft" } : {},
          success ? 201 : 403,
        ),
      );
    });
    expect(screen.getByLabelText("Human review notes")).toHaveValue(
      "Replacement A QA draft",
    );
    expect(screen.queryByText("Access denied")).toBeNull();
    expect(screen.queryByText("QA assessment recorded.")).toBeNull();
  },
);
