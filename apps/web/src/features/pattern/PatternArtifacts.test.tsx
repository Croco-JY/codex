import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  fixture,
  pattern,
  revision,
  route,
  root,
  A,
  B,
  S,
  PID,
  id,
  time,
  response,
} from "../../test/patternFixture";
import { deferred } from "../../test/measurementFixture";
import { setAccessToken } from "../../api/session";
import {
  artifactBody,
  artifactFormData,
  checkedArtifact,
  checkedArtifactResult,
  MAX_ARTIFACT_BYTES,
  type Artifact,
} from "./artifactModel";

const detail = root() + "/patterns/" + PID;
const upload = detail + "/artifact-revisions";
const meta = (n = 1) => detail + "/revisions/" + revision(n).id + "/artifact";
const bytes = "%PDF-1.4\nsynthetic\n%%EOF\n";
const file = () => new File([bytes], "untrusted.html", { type: "text/html" });
const artifact = (n = 1): Artifact => ({
  id: id(400 + n),
  patternRevisionId: revision(n).id,
  patternId: PID,
  styleId: S,
  declaredFormat: "PDF",
  displayName: "패턴 자료.pdf",
  sizeBytes: bytes.length,
  state: "READY",
  failureCode: null,
  createdAt: time,
  updatedAt: time,
});
const draft = {
  name: "New artifact",
  purpose: "Synthetic",
  measurementRevisionId: "",
  declaredFormat: "PDF" as const,
  displayName: "패턴 자료.pdf",
};
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const reads = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) =>
    /\/artifact(?:\/content)?$/.test(new URL(r.url).pathname),
  );
const writes = (h: ReturnType<typeof fixture>) =>
  h.calls.filter(
    (r) => r.method === "POST" && r.url.endsWith("/artifact-revisions"),
  );
function setup() {
  const h = fixture();
  h.patterns.set(A, [pattern()]);
  h.patterns.set(B, [pattern(1, B)]);
  h.history.set(revision().id, revision());
  h.overrides.set("GET " + meta(), () => response(artifact()));
  h.overrides.set(
    "GET " + meta() + "/content",
    () =>
      new Response(bytes, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
  );
  return h;
}
async function open(h: ReturnType<typeof fixture>) {
  h.mount(route(A, true));
  await screen.findByRole("heading", { name: "Latest Pattern revision 1" });
}
function edit(f = file()) {
  click("Import artifact as new revision");
  fireEvent.change(screen.getByLabelText("Artifact revision name"), {
    target: { value: "New artifact" },
  });
  fireEvent.change(screen.getByLabelText("Declared artifact format"), {
    target: { value: "PDF" },
  });
  fireEvent.change(
    screen.getByLabelText("Artifact file (1 byte through 10 MiB)"),
    { target: { files: [f] } },
  );
  fireEvent.change(screen.getByLabelText("Artifact display name"), {
    target: { value: "패턴 자료.pdf" },
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each(["A→B", "ABA", "Actor"])(
  "late artifact metadata %s is discarded",
  async (kind) => {
    const h = setup(),
      d = deferred<Response>();
    h.overrides.set("GET " + meta(), () => d.promise);
    await open(h);
    click("Inspect artifact");
    await waitFor(() => expect(reads(h)).toHaveLength(1));
    if (kind === "Actor") setAccessToken("replacement");
    else {
      click("Patterns B");
      await screen.findByRole("heading", { name: "Pattern families" });
      if (kind === "ABA") {
        click("Pattern detail A");
        await screen.findByRole("heading", {
          name: "Latest Pattern revision 1",
        });
      }
    }
    await act(async () => {
      d.resolve(response(artifact()));
      await d.promise;
    });
    expect(screen.queryByText("Artifact state: READY")).not.toBeInTheDocument();
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey.includes("artifact") && q.state.data),
    ).toHaveLength(0);
  },
);
test("25 history rows cause zero artifact/content detail fanout", async () => {
  const h = setup();
  h.patterns.set(A, [pattern(25)]);
  for (let n = 1; n <= 25; n++) h.history.set(revision(n).id, revision(n));
  h.mount(route(A, true));
  await screen.findByRole("button", { name: "Open Pattern revision 1" });
  expect(
    screen.getAllByRole("button", { name: /^Open Pattern revision / }),
  ).toHaveLength(25);
  expect(reads(h)).toHaveLength(0);
});
test.each(["Organization", "Actor"])(
  "artifact boundary keeps Supply only within same Actor: %s",
  async (kind) => {
    const h = setup(),
      key = ["supply", h.scope, "material", id(88)];
    h.cache.setQueryData(key, { id: id(88), name: "Canonical" });
    await open(h);
    click("Inspect artifact");
    await screen.findByText("Artifact state: READY");
    if (kind === "Actor") {
      setAccessToken("replacement");
      await waitFor(() => expect(h.cache.getQueryData(key)).toBeUndefined());
    } else {
      click("Patterns B");
      await screen.findByRole("heading", { name: "Pattern families" });
      expect(h.cache.getQueryData(key)).toEqual({
        id: id(88),
        name: "Canonical",
      });
    }
    expect(
      h.cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey.includes("artifact")),
    ).toHaveLength(0);
  },
);

test.each([
  ["createdAt", "2026-10-24"],
  ["updatedAt", "2026-10-24T12:00:00"],
  ["id", "bad"],
  ["styleId", id(9)],
  ["patternId", id(9)],
  ["patternRevisionId", id(9)],
  ["declaredFormat", "DXF"],
  ["displayName", "../x"],
  ["displayName", " x"],
  ["displayName", "x\n"],
  ["displayName", "."],
  ["displayName", ""],
  ["sizeBytes", 0],
  ["sizeBytes", MAX_ARTIFACT_BYTES + 1],
  ["sizeBytes", 1.2],
  ["sizeBytes", "23"],
  ["state", "DETACHED"],
  ["failureCode", "STORAGE_WRITE_FAILED"],
  ["createdAt", null],
  ["updatedAt", "bad"],
  ["failureCode", undefined],
])("malformed artifact %s=%s fails closed", (k, v) => {
  expect(() =>
    checkedArtifact({ ...artifact(), [k]: v }, S, PID, revision().id),
  ).toThrow();
});
test.each(["PENDING", "READY", "FAILED"] as const)(
  "valid %s state has precise failure-code semantics",
  (state) => {
    const a = {
      ...artifact(),
      state,
      failureCode: state === "FAILED" ? "STORAGE_WRITE_FAILED" : null,
    };
    expect(checkedArtifact(a, S, PID, revision().id).state).toBe(state);
    expect(() =>
      checkedArtifact(
        {
          ...a,
          failureCode: state === "FAILED" ? null : "STORAGE_WRITE_FAILED",
        },
        S,
        PID,
        revision().id,
      ),
    ).toThrow();
  },
);
test.each([
  "STORAGE_WRITE_FAILED",
  "STORAGE_READBACK_FAILED",
  "STORAGE_INTEGRITY_MISMATCH",
])("allowlisted failure %s", (failureCode) => {
  expect(
    checkedArtifact(
      { ...artifact(), state: "FAILED", failureCode },
      S,
      PID,
      revision().id,
    ).failureCode,
  ).toBe(failureCode);
});
test.each(["2026-10-24T00:00:00Z", "2026-10-24T09:00:00+09:00"])(
  "strict timestamp accepts %s",
  (createdAt) => {
    expect(
      checkedArtifact({ ...artifact(), createdAt }, S, PID, revision().id)
        .createdAt,
    ).toBe(createdAt);
  },
);
test.each([
  "PENDING",
  "FAILED",
  "wrong-size",
  "wrong-number",
  "wrong-relation",
])("upload success rejects %s ambiguity", (kind) => {
  const a = artifact(2),
    r = revision(2);
  if (kind === "PENDING" || kind === "FAILED") {
    a.state = kind;
    a.failureCode = kind === "FAILED" ? "STORAGE_WRITE_FAILED" : null;
  }
  if (kind === "wrong-size") a.sizeBytes++;
  if (kind === "wrong-number") r.revisionNumber = 3;
  if (kind === "wrong-relation") a.patternRevisionId = id(999);
  expect(() =>
    checkedArtifactResult(
      { artifact: a, revision: r },
      S,
      PID,
      1,
      bytes.length,
    ),
  ).toThrow();
});
test("multipart has exactly one JSON metadata blob and actual File; no caller authority", async () => {
  const f = file(),
    form = artifactFormData(draft, 1, f);
  expect([...form.keys()]).toEqual(["metadata", "file"]);
  expect(form.getAll("file")).toEqual([f]);
  const blob = form.get("metadata") as Blob;
  expect(blob.type).toBe("application/json");
  const json = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.readAsText(blob);
  });
  expect(JSON.parse(json)).toEqual(artifactBody(draft, 1));
  expect(Object.keys(JSON.parse(json)).sort()).toEqual([
    "declaredFormat",
    "displayName",
    "expectedLatestRevisionNumber",
    "measurementRevisionId",
    "name",
    "purpose",
  ]);
});
test.each([0, MAX_ARTIFACT_BYTES + 1])(
  "file %i rejected before transport",
  (size) => {
    expect(() =>
      artifactFormData(draft, 1, new File([new Uint8Array(size)], "x")),
    ).toThrow();
  },
);
test("exact 10 MiB passes client byte bound", () => {
  expect(
    artifactFormData(
      draft,
      1,
      new File([new Uint8Array(MAX_ARTIFACT_BYTES)], "x"),
    ).getAll("file"),
  ).toHaveLength(1);
});
test.each(["../x", "..", "x\\y", "x\r\ny", ""])(
  "unsafe display %s rejected",
  (displayName) => {
    expect(() => artifactBody({ ...draft, displayName }, 1)).toThrow();
  },
);

test("detail/history and opening import perform no artifact or Measurement fanout", async () => {
  const h = setup();
  await open(h);
  await waitFor(() =>
    expect(h.calls.some((r) => r.url.includes("maxRevisionNumber=1"))).toBe(
      true,
    ),
  );
  expect(reads(h)).toHaveLength(0);
  edit();
  expect(reads(h)).toHaveLength(0);
  expect(h.measurementReads()).toHaveLength(0);
});
test("explicit inspection has one metadata read, no content preload", async () => {
  const h = setup();
  await open(h);
  click("Inspect artifact");
  await screen.findByText("Artifact state: READY");
  expect(reads(h)).toHaveLength(1);
});
test.each(["PENDING", "FAILED"] as const)(
  "%s is retained with no download or in-place retry",
  async (state) => {
    const h = setup();
    h.overrides.set("GET " + meta(), () =>
      response({
        ...artifact(),
        state,
        failureCode: state === "FAILED" ? "STORAGE_WRITE_FAILED" : null,
      }),
    );
    await open(h);
    click("Inspect artifact");
    await screen.findByText("Artifact state: " + state);
    expect(
      screen.queryByRole("button", { name: "Download Pattern artifact" }),
    ).not.toBeInTheDocument();
    expect(reads(h)).toHaveLength(1);
  },
);
test("artifactless result requires successful exact revision verification", async () => {
  const h = setup();
  h.overrides.set("GET " + meta(), () => response({}, 404));
  await open(h);
  click("Inspect artifact");
  await screen.findByText("This revision has no artifact.");
  expect(
    h.calls.filter(
      (r) => new URL(r.url).pathname === detail + "/revisions/" + revision().id,
    ),
  ).toHaveLength(1);
});
test("404 hierarchy failure cannot claim artifactless", async () => {
  const h = setup();
  h.overrides.set("GET " + meta(), () => response({}, 404));
  h.overrides.set("GET " + detail + "/revisions/" + revision().id, () =>
    response({}, 404),
  );
  await open(h);
  click("Inspect artifact");
  await waitFor(() => expect(reads(h)).toHaveLength(1));
  await screen.findByText("Not found");
  expect(
    screen.queryByText("This revision has no artifact."),
  ).not.toBeInTheDocument();
});
test.each(["VIEWER", "project", "style", "pattern"])(
  "%s read-only still permits READY inspection",
  async (kind) => {
    const h = setup();
    if (kind === "VIEWER") h.role = "VIEWER";
    if (kind === "project") h.projectStatus = "ARCHIVED";
    if (kind === "style") h.styleStatus = "ARCHIVED";
    if (kind === "pattern") h.patterns.get(A)![0].status = "ARCHIVED";
    await open(h);
    expect(
      screen.queryByRole("button", { name: "Import artifact as new revision" }),
    ).not.toBeInTheDocument();
    click("Inspect artifact");
    await screen.findByRole("button", { name: "Download Pattern artifact" });
    expect(writes(h)).toHaveLength(0);
  },
);
test.each(["ORG_OWNER", "ORG_ADMIN"])(
  "%s upload appends exact parts, uses browser boundary, clears successful draft",
  async (role) => {
    const h = setup();
    h.role = role;
    const append = vi.spyOn(FormData.prototype, "append");
    h.overrides.set("POST " + upload, () => {
      h.history.set(revision(2).id, revision(2));
      h.patterns.set(A, [pattern(2)]);
      return response({ revision: revision(2), artifact: artifact(2) }, 201);
    });
    await open(h);
    edit();
    click("Upload new artifact revision");
    await screen.findByText("Artifact revision created · READY.");
    expect(writes(h)).toHaveLength(1);
    expect(writes(h)[0].headers.get("Content-Type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(append.mock.calls.map((c) => c[0])).toEqual(["metadata", "file"]);
    expect(
      screen.queryByLabelText("Artifact display name"),
    ).not.toBeInTheDocument();
  },
);
test.each([409, 500, 502, 0, "malformed"])(
  "%s ambiguous/conflicting upload retains file/draft and never resends",
  async (status) => {
    const h = setup();
    h.overrides.set("POST " + upload, () => {
      if (status === 0) throw new TypeError("network");
      h.patterns.set(A, [pattern(2)]);
      return typeof status === "number"
        ? response({}, status)
        : response({}, 201);
    });
    await open(h);
    edit();
    click("Upload new artifact revision");
    await screen.findByRole("button", { name: "Reconcile artifact draft" });
    expect(screen.getByLabelText("Artifact revision name")).toHaveValue(
      "New artifact",
    );
    expect(
      (
        screen.getByLabelText(
          "Artifact file (1 byte through 10 MiB)",
        ) as HTMLInputElement
      ).files?.[0].name,
    ).toBe("untrusted.html");
    expect(writes(h)).toHaveLength(1);
    expect(
      h.calls.filter(
        (r) => new URL(r.url).pathname === detail && r.method === "GET",
      ).length,
    ).toBe(2);
    click("Reconcile artifact draft");
    expect(writes(h)).toHaveLength(1);
    expect(screen.getByText(/Baseline reconciled/)).toBeInTheDocument();
  },
);
test("READY download validates bytes and revokes temporary object URL", async () => {
  const h = setup(),
    create = vi.fn(() => "blob:artifact"),
    revoke = vi.fn();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  const anchor = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await open(h);
  click("Inspect artifact");
  await screen.findByRole("button", { name: "Download Pattern artifact" });
  click("Download Pattern artifact");
  await waitFor(() => expect(anchor).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith("blob:artifact");
  expect((anchor.mock.instances[0] as HTMLAnchorElement).download).toBe(
    "패턴 자료.pdf",
  );
});
test("size mismatch download creates no object URL", async () => {
  const h = setup(),
    create = vi.fn();
  URL.createObjectURL = create;
  h.overrides.set("GET " + meta() + "/content", () => new Response("x"));
  await open(h);
  click("Inspect artifact");
  await screen.findByRole("button", { name: "Download Pattern artifact" });
  click("Download Pattern artifact");
  await screen.findByText("Service unavailable");
  expect(create).not.toHaveBeenCalled();
});
test.each(["A→B", "ABA", "Actor"])(
  "late binary %s cannot create URL/click",
  async (kind) => {
    const h = setup(),
      d = deferred<Response>(),
      create = vi.fn(),
      anchor = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
    URL.createObjectURL = create;
    h.overrides.set("GET " + meta() + "/content", () => d.promise);
    await open(h);
    click("Inspect artifact");
    await screen.findByRole("button", { name: "Download Pattern artifact" });
    click("Download Pattern artifact");
    await waitFor(() => expect(reads(h)).toHaveLength(2));
    if (kind === "Actor") {
      setAccessToken("replacement");
    } else {
      click("Patterns B");
      await screen.findByRole("heading", { name: "Pattern families" });
      if (kind === "ABA") {
        click("Pattern detail A");
        await screen.findByRole("heading", {
          name: "Latest Pattern revision 1",
        });
      }
    }
    await act(async () => {
      d.resolve(new Response(bytes));
      await d.promise;
    });
    await waitFor(() => expect(reads(h)).toHaveLength(2));
    expect(create).not.toHaveBeenCalled();
    expect(anchor).not.toHaveBeenCalled();
  },
);
test.each(["A→B", "ABA", "Actor"])(
  "late upload %s cannot affect replacement draft or state",
  async (kind) => {
    const h = setup(),
      d = deferred<Response>();
    h.overrides.set("POST " + upload, () => d.promise);
    await open(h);
    edit();
    click("Upload new artifact revision");
    await waitFor(() => expect(writes(h)).toHaveLength(1));
    if (kind === "Actor") setAccessToken("replacement");
    else {
      click("Patterns B");
      await screen.findByRole("heading", { name: "Pattern families" });
      if (kind === "ABA") {
        click("Pattern detail A");
        await screen.findByRole("heading", {
          name: "Latest Pattern revision 1",
        });
        edit();
      }
    }
    await act(async () => {
      d.resolve(
        response({ revision: revision(2), artifact: artifact(2) }, 201),
      );
      await d.promise;
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Artifact revision created · READY."),
      ).not.toBeInTheDocument(),
    );
    expect(writes(h)).toHaveLength(1);
  },
);
test.each(["metadata", "upload", "download"])(
  "current-generation %s 403 denies workspace",
  async (kind) => {
    const h = setup();
    await open(h);
    if (kind === "metadata") {
      h.overrides.set("GET " + meta(), () => response({}, 403));
      click("Inspect artifact");
    }
    if (kind === "upload") {
      h.overrides.set("POST " + upload, () => response({}, 403));
      edit();
      click("Upload new artifact revision");
    }
    if (kind === "download") {
      h.overrides.set("GET " + meta() + "/content", () => response({}, 403));
      click("Inspect artifact");
      await screen.findByRole("button", { name: "Download Pattern artifact" });
      click("Download Pattern artifact");
    }
    await screen.findByText("Access denied");
    expect(
      screen.queryByRole("button", { name: "Import artifact as new revision" }),
    ).not.toBeInTheDocument();
  },
);
