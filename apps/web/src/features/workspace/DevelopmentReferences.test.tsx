import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  checkedReference,
  referenceFormData,
  safeDisplayName,
  type Reference,
  type ReferenceState,
} from "./developmentReferenceModel";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const S = id(1),
  stamp = "2026-10-23T00:00:00Z";
const row = (n = 10, state: ReferenceState = "READY"): Reference => ({
  id: id(n),
  styleId: S,
  storageObjectId: id(n + 1000),
  displayName: `Synthetic reference ${n}`,
  mediaType: "application/octet-stream",
  sizeBytes: 3,
  state,
  version: state === "PENDING" ? 0 : 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "reference-test",
    },
  });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let cache: QueryClient,
  calls: Request[],
  rows: Reference[],
  role: string,
  archived: boolean,
  listStatus: number,
  writeStatus: number,
  detachStatus: number,
  contentStatus: number;
let pDelay: Promise<Response> | undefined,
  sDelay: Promise<Response> | undefined,
  listDelay: Promise<Response> | undefined,
  writeDelay: Promise<Response> | undefined,
  downloadDelay: Promise<Response> | undefined,
  reqDelay: Promise<Response> | undefined;
let append: MockInstance<FormData["append"]>;
let createUrl = vi.fn<(obj: Blob | MediaSource) => string>(),
  revokeUrl = vi.fn<(url: string) => void>(),
  click: MockInstance<() => void>;
const project = (org = "A") => ({
  id: "P",
  organizationId: org,
  name: `Project ${org}`,
  description: null,
  status: archived ? "ARCHIVED" : "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
});
const style = (org = "A") => ({
  id: S,
  projectId: "P",
  name: `Style ${org}`,
  styleCode: null,
  description: null,
  status: "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
});
beforeEach(() => {
  setAccessToken();
  calls = [];
  rows = [];
  role = "ORG_OWNER";
  archived = false;
  listStatus = writeStatus = detachStatus = contentStatus = 200;
  pDelay =
    sDelay =
    listDelay =
    writeDelay =
    downloadDelay =
    reqDelay =
      undefined;
  append = vi.spyOn(FormData.prototype, "append");
  createUrl = vi.fn<(obj: Blob | MediaSource) => string>(
    () => "blob:synthetic",
  );
  revokeUrl = vi.fn<(url: string) => void>();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = revokeUrl;
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r);
      const u = new URL(r.url),
        p = u.pathname,
        org = p.includes("/B/") ? "B" : "A";
      if (p === "/api/identity")
        return reply({
          issuer: "local",
          subject: r.headers.get("X-Dev-Subject") ?? "actor-a",
        });
      if (p === "/api/identity/capabilities")
        return reply({ platformAdmin: true });
      if (p === "/api/organizations")
        return reply(
          role === "NONE"
            ? []
            : ["A", "B"].map((id) => ({
                id,
                name: `Organization ${id}`,
                role,
                status: "ACTIVE",
                version: 0,
              })),
        );
      if (p.endsWith("/projects/P"))
        return org === "A" && pDelay ? pDelay : reply(project(org));
      if (p.endsWith(`/styles/${S}`))
        return org === "A" && sDelay ? sDelay : reply(style(org));
      if (p.endsWith("/requirement")) return reqDelay ?? reply({}, 404);
      if (
        p.endsWith("/material-selections") ||
        p.endsWith("/facility-candidates")
      )
        return reply({ items: [], limit: 25, offset: 0, hasMore: false });
      if (p.includes("/development-references")) {
        if (p.endsWith("/content"))
          return (
            downloadDelay ??
            (contentStatus === 200
              ? new Response(new Uint8Array([1, 2, 3]), {
                  headers: { "Content-Type": "application/octet-stream" },
                })
              : reply({}, contentStatus))
          );
        if (r.method === "POST" && p.endsWith("/detach")) {
          if (writeDelay) return writeDelay;
          if (detachStatus === 0) throw new TypeError("offline");
          if (detachStatus !== 200) return reply({}, detachStatus);
          const key = p.split("/").at(-2);
          rows = rows.map((v) =>
            v.id === key
              ? { ...v, state: "DETACHED", version: v.version + 1 }
              : v,
          );
          return reply(rows.find((v) => v.id === key));
        }
        if (r.method === "POST") {
          if (writeDelay) return writeDelay;
          if (writeStatus === 0) throw new TypeError("offline");
          if (writeStatus !== 200) return reply({}, writeStatus);
          rows = [row(100), ...rows];
          return reply(rows[0], 201);
        }
        if (!p.endsWith("/development-references"))
          return reply(
            rows.find((v) => p.endsWith(v.id)) ?? {},
            rows.some((v) => p.endsWith(v.id)) ? 200 : 404,
          );
        if (org === "A" && listDelay) return listDelay;
        if (listStatus !== 200) return reply({}, listStatus);
        const offset = Number(u.searchParams.get("offset")),
          filter = u.searchParams.get("state"),
          selected = rows.filter((v) => !filter || v.state === filter);
        return reply({
          items: selected.slice(offset, offset + 25),
          limit: 25,
          offset,
          hasMore: selected.length > offset + 25,
        });
      }
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  cache?.clear();
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Nav() {
  const n = useNavigate();
  return (
    <>
      <button onClick={() => n(`/organizations/B/projects/P/styles/${S}`)}>
        Go B
      </button>
      <button onClick={() => n(`/organizations/A/projects/P/styles/${S}`)}>
        Go A
      </button>
    </>
  );
}
function mount() {
  cache = createQueryClient();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[`/organizations/A/projects/P/styles/${S}`]}
      >
        <App />
        <Nav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const region = () =>
  within(screen.getByRole("region", { name: "Development References" }));
const refs = () =>
  calls.filter((r) => r.url.includes("/development-references"));
const writes = () => refs().filter((r) => r.method === "POST");
async function ready() {
  await screen.findByRole("region", {
    name: "Development References",
  });
  await waitFor(() =>
    expect(
      region().queryByRole("status", {
        name: "Loading Development References",
      }),
    ).not.toBeInTheDocument(),
  );
}
async function draft() {
  await userEvent.upload(
    region().getByLabelText("Reference file"),
    new File([new Uint8Array([1, 2, 3])], "synthetic.bin", {
      type: "text/html",
    }),
  );
  await userEvent.clear(region().getByLabelText("Display name"));
  await userEvent.type(region().getByLabelText("Display name"), "샘플 자료 01");
}
async function upload() {
  await userEvent.click(
    region().getByRole("button", { name: "Upload reference" }),
  );
}
async function detach() {
  await userEvent.click(
    region().getByRole("button", { name: "Detach reference" }),
  );
  await userEvent.click(
    region().getByRole("button", { name: "Confirm detach" }),
  );
}

test("empty collection uses full private key and no detail/content fanout", async () => {
  mount();
  await ready();
  expect(refs()).toHaveLength(1);
  expect(
    cache.getQueryData(
      queryKeys.references(getSession().key, "A", "P", S, undefined, 25, 0),
    ),
  ).toMatchObject({ items: [] });
});
test.each([404, 403, 500])(
  "list %s remains error, never empty",
  async (status) => {
    listStatus = status;
    mount();
    await screen.findByRole("heading", {
      name:
        status === 404
          ? "Not found"
          : status === 403
            ? "Access denied"
            : "Service unavailable",
    });
    expect(
      screen.queryByText("No Development References in this view."),
    ).not.toBeInTheDocument();
    expect(refs()).toHaveLength(1);
  },
);
test("writer serializes exactly two multipart parts with browser boundary and success clears draft", async () => {
  mount();
  await ready();
  await draft();
  await upload();
  await region().findByText("Reference uploaded · READY.");
  expect(writes()).toHaveLength(1);
  const r = writes()[0];
  expect(r.headers.get("Content-Type")).toMatch(
    /^multipart\/form-data; boundary=/,
  );
  expect(r.headers.get("Authorization")).toBeNull();
  expect(r.headers.get("X-Request-ID")).toBeTruthy();
  expect(append.mock.calls.map((c) => c[0])).toEqual(["displayName", "file"]);
  expect(append.mock.calls[0][1]).toBe("샘플 자료 01");
  expect(append.mock.calls[1][1]).toBeInstanceOf(File);
  expect(region().getByLabelText("Display name")).toHaveValue("");
  expect(
    (region().getByLabelText("Reference file") as HTMLInputElement).files,
  ).toHaveLength(0);
});
test("FormData adapter appends actual File once, no authority or MIME fields", () => {
  const file = new File(["synthetic"], "untrusted.pdf");
  const form = referenceFormData({ displayName: "Explicit name", file });
  expect([...form.keys()]).toEqual(["displayName", "file"]);
  expect(form.getAll("file")).toHaveLength(1);
  expect(form.get("file")).toBe(file);
  expect(form.getAll("displayName")).toEqual(["Explicit name"]);
});
test.each(["VIEWER", "archived"])(
  "%s permits READY download and blocks upload/detach",
  async (kind) => {
    rows = [row()];
    if (kind === "VIEWER") role = "VIEWER";
    else archived = true;
    mount();
    await ready();
    expect(
      region().getByRole("button", { name: "Download reference" }),
    ).toBeEnabled();
    expect(
      region().queryByRole("button", { name: "Detach reference" }),
    ).not.toBeInTheDocument();
    if (kind === "VIEWER")
      expect(
        region().queryByLabelText("Reference file"),
      ).not.toBeInTheDocument();
    else expect(region().getByLabelText("Reference file")).toBeDisabled();
    expect(writes()).toEqual([]);
  },
);
test("platform admin without membership never reads References", async () => {
  role = "NONE";
  mount();
  await screen.findByRole("heading", { name: "Access denied" });
  expect(refs()).toEqual([]);
});
test.each(["PENDING", "FAILED", "DETACHED"] as const)(
  "%s metadata retained with no binary/detail fanout",
  async (state) => {
    rows = [row(10, state)];
    mount();
    await ready();
    expect(region().getByText(new RegExp(`${state} ·`))).toBeVisible();
    expect(
      region().queryByRole("button", { name: "Download reference" }),
    ).not.toBeInTheDocument();
    expect(refs()).toHaveLength(1);
    if (state !== "DETACHED") await detach();
  },
);
test("READY download uses ephemeral Blob, metadata filename and revokes URL", async () => {
  rows = [row()];
  mount();
  await ready();
  await userEvent.click(
    region().getByRole("button", { name: "Download reference" }),
  );
  await waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
  expect(click.mock.instances[0]).toHaveAttribute(
    "download",
    row().displayName,
  );
  expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic");
  expect(refs().filter((r) => r.url.endsWith("/content"))).toHaveLength(1);
});
test.each([400, 413])(
  "known upload %s retains guidance without retry",
  async (status) => {
    mount();
    await ready();
    await draft();
    writeStatus = status;
    await upload();
    await region().findByRole("heading", {
      name: status === 413 ? "File too large" : "Check your input",
    });
    if (status === 413)
      expect(
        region().getByText(
          "The selected file is too large. Maximum file size is 10 MiB.",
        ),
      ).toBeVisible();
    expect(writes()).toHaveLength(1);
    expect(region().getByLabelText("Display name")).toHaveValue("샘플 자료 01");
  },
);
test.each([0, 500])(
  "ambiguous upload %s preserves file/name, resets All/first page and requires explicit new action",
  async (status) => {
    mount();
    await ready();
    await draft();
    await userEvent.selectOptions(
      region().getByLabelText("Reference state"),
      "FAILED",
    );
    await region().findByText("No Development References in this view.");
    writeStatus = status;
    await upload();
    await region().findByText(/Upload outcome is uncertain/);
    await waitFor(() =>
      expect(region().getByLabelText("Reference state")).toHaveValue(""),
    );
    expect(writes()).toHaveLength(1);
    expect(region().getByLabelText("Display name")).toHaveValue("샘플 자료 01");
    expect(
      (region().getByLabelText("Reference file") as HTMLInputElement).files,
    ).toHaveLength(1);
    expect(
      region().getByRole("button", { name: "Upload reference" }),
    ).toBeDisabled();
    await userEvent.click(
      region().getByRole("button", { name: "Start a new upload after review" }),
    );
    expect(writes()).toHaveLength(1);
  },
);
test("detach requires confirmation with exact version", async () => {
  rows = [row()];
  mount();
  await ready();
  await userEvent.click(
    region().getByRole("button", { name: "Detach reference" }),
  );
  expect(writes()).toEqual([]);
  await userEvent.click(
    region().getByRole("button", { name: "Cancel detach" }),
  );
  await detach();
  await region().findByText("DETACHED · Detached");
  expect(await writes()[0].clone().json()).toEqual({ version: 1 });
});
test.each([409, 404, 0, 500])(
  "detach %s performs bounded authoritative recovery without retry",
  async (status) => {
    rows = [row()];
    mount();
    await ready();
    detachStatus = status;
    await detach();
    await region().findByText(/Detach outcome requires review/);
    await waitFor(() =>
      expect(
        refs().filter((r) => r.method === "GET" && !r.url.includes("/content"))
          .length,
      ).toBe(3),
    );
    expect(writes()).toHaveLength(1);
    if (status === 409)
      expect(calls.filter((r) => r.url.endsWith("/projects/P"))).toHaveLength(
        2,
      );
    expect(
      region().queryByRole("button", { name: "Confirm detach" }),
    ).not.toBeInTheDocument();
  },
);
test("parent upload 409 refreshes hierarchy and disables writes", async () => {
  mount();
  await ready();
  await draft();
  archived = true;
  writeStatus = 409;
  await upload();
  await region().findByText(/Project or Style is archived/);
  expect(region().getByLabelText("Reference file")).toBeDisabled();
  expect(writes()).toHaveLength(1);
});
test("state filter and bounded offset do not prefetch content", async () => {
  rows = Array.from({ length: 26 }, (_, i) => row(100 + i));
  mount();
  await ready();
  expect(refs()).toHaveLength(1);
  await userEvent.click(
    region().getByRole("button", { name: "Next references" }),
  );
  await region().findByText("Synthetic reference 125");
  await userEvent.selectOptions(
    region().getByLabelText("Reference state"),
    "FAILED",
  );
  await region().findByText("No Development References in this view.");
  const u = new URL(refs().at(-1)!.url);
  expect(u.searchParams.get("offset")).toBe("0");
  expect(u.searchParams.get("state")).toBe("FAILED");
  expect(
    refs().every((r) =>
      new URL(r.url).pathname.endsWith("/development-references"),
    ),
  ).toBe(true);
});
test.each([0, 10485761])(
  "file byte prevalidation %s prevents mutation",
  async (size) => {
    mount();
    await ready();
    await userEvent.upload(
      region().getByLabelText("Reference file"),
      new File([new Uint8Array(size)], "synthetic.bin"),
    );
    await upload();
    await region().findByText("Choose a file of 1 byte through 10 MiB.");
    expect(writes()).toEqual([]);
  },
);
test.each([".", "..", "../x", "C:\\x", "line\nbreak", "x".repeat(256)])(
  "safe name rejects %s",
  (name) => expect(safeDisplayName(name)).toBe(false),
);
test.each([
  { id: "" },
  { styleId: id(999) },
  { storageObjectId: "bad" },
  { sizeBytes: 0 },
  { sizeBytes: 10485761 },
  { sizeBytes: 1.5 },
  { version: -1 },
  { version: Number.MAX_SAFE_INTEGER + 1 },
  { mediaType: "text/html" },
  { state: "APPROVED" },
  { createdAt: "bad" },
  { updatedAt: "bad" },
  { displayName: "../x" },
])("malformed Reference fails closed %#", (patch) =>
  expect(() =>
    checkedReference({ ...row(), ...patch } as Reference, S),
  ).toThrow(),
);
test("malformed page has no download/detach controls", async () => {
  rows = [{ ...row(), storageObjectId: "bad" }];
  mount();
  await screen.findByRole("region", {
    name: "Development References",
  });
  await region().findByRole("heading", { name: "Service unavailable" });
  expect(
    region().queryByRole("button", { name: "Download reference" }),
  ).not.toBeInTheDocument();
  expect(
    region().queryByRole("button", { name: "Detach reference" }),
  ).not.toBeInTheDocument();
});
for (const kind of ["read", "upload", "download", "detach"] as const)
  test(`old ${kind} completion is isolated across A→B→A and preserves Supply cache`, async () => {
    const d = deferred<Response>();
    if (kind === "read") listDelay = d.promise;
    else if (kind === "download" || kind === "detach") rows = [row()];
    mount();
    if (kind === "read")
      await screen.findByRole("heading", { name: "Style A", level: 1 });
    else {
      await ready();
      if (kind === "upload") {
        await draft();
        writeDelay = d.promise;
        await upload();
      }
      if (kind === "download") {
        downloadDelay = d.promise;
        await userEvent.click(
          region().getByRole("button", { name: "Download reference" }),
        );
      }
      if (kind === "detach") {
        writeDelay = d.promise;
        await detach();
      }
    }
    await waitFor(() => expect(refs().length).toBeGreaterThan(0));
    const old = refs().at(-1)!;
    const supply = queryKeys.facility(getSession().key, id(500));
    cache.setQueryData(supply, { name: "Global sentinel" });
    listDelay = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Go B" }));
    await screen.findByRole("heading", { name: "Style B", level: 1 });
    expect(old.signal.aborted).toBe(true);
    expect(region().queryByText(/Reference uploaded/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go A" }));
    await ready();
    const count = refs().length;
    await act(async () =>
      d.resolve(
        kind === "read"
          ? reply({ items: [row(900)], limit: 25, offset: 0, hasMore: false })
          : kind === "download"
            ? new Response(new Uint8Array([1, 2, 3]))
            : reply(row(901), kind === "upload" ? 201 : 200),
      ),
    );
    expect(refs()).toHaveLength(count);
    expect(createUrl).not.toHaveBeenCalled();
    expect(region().queryByText(/Reference uploaded/)).not.toBeInTheDocument();
    expect(cache.getQueryData(supply)).toMatchObject({
      name: "Global sentinel",
    });
    if (kind === "upload")
      expect(region().getByLabelText("Display name")).toHaveValue("");
  });
test("Actor switch aborts upload and discards private file draft", async () => {
  mount();
  await ready();
  await draft();
  const d = deferred<Response>();
  writeDelay = d.promise;
  await upload();
  const old = writes()[0];
  await act(async () => setLocalSubject("actor-b"));
  await waitFor(() => expect(old.signal.aborted).toBe(true));
  await act(async () => d.resolve(reply(row(100), 201)));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(region().getByLabelText("Display name")).toHaveValue("");
});
test.each(["project", "style"])(
  "%s pending/denied gates all four children",
  async (parent) => {
    const d = deferred<Response>();
    if (parent === "project") pDelay = d.promise;
    else sDelay = d.promise;
    mount();
    await waitFor(() =>
      expect(
        calls.some((r) =>
          r.url.endsWith(parent === "project" ? "/projects/P" : `/styles/${S}`),
        ),
      ).toBe(true),
    );
    expect(
      calls.some((r) =>
        /requirement|material-selections|facility-candidates|development-references/.test(
          r.url,
        ),
      ),
    ).toBe(false);
    await act(async () => d.resolve(reply({}, 404)));
    await screen.findByRole("heading", { name: "Not found" });
    expect(refs()).toEqual([]);
  },
);
test("held Requirement does not gate References; four exact siblings start after Style", async () => {
  reqDelay = deferred<Response>().promise;
  mount();
  await ready();
  const privateReads = calls
    .filter((r) => r.url.includes("/api/v1/organizations/"))
    .map((r) => new URL(r.url).pathname);
  expect(privateReads.slice(0, 2)).toEqual([
    "/api/v1/organizations/A/projects/P",
    `/api/v1/organizations/A/projects/P/styles/${S}`,
  ]);
  expect(privateReads.slice(2).sort()).toEqual(
    [
      "requirement",
      "material-selections",
      "facility-candidates",
      "development-references",
    ]
      .map((s) => `/api/v1/organizations/A/projects/P/styles/${S}/${s}`)
      .sort(),
  );
});
test("stale detach refreshes exact version and requires new explicit confirmation", async () => {
  rows = [row()];
  mount();
  await ready();
  rows = [{ ...row(), version: 2 }];
  detachStatus = 409;
  await detach();
  await region().findByText(/Authoritative state: READY · version 2/);
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    region().getByRole("button", { name: "Review latest detach" }),
  );
  expect(writes()).toHaveLength(1);
  detachStatus = 200;
  await userEvent.click(
    region().getByRole("button", { name: "Confirm detach" }),
  );
  await region().findByText("DETACHED · Detached");
  expect(await writes()[1].clone().json()).toEqual({ version: 2 });
});
test("already DETACHED recovery shows authoritative completion without restoring controls", async () => {
  rows = [row()];
  mount();
  await ready();
  rows = [{ ...row(), state: "DETACHED", version: 2 }];
  detachStatus = 409;
  await detach();
  await region().findByText(/Detachment is confirmed/);
  expect(writes()).toHaveLength(1);
  expect(
    region().queryByRole("button", { name: "Review latest detach" }),
  ).not.toBeInTheDocument();
});
test.each([404, 409, 500])(
  "download %s shows safe error without retry or object URL",
  async (status) => {
    rows = [row()];
    contentStatus = status;
    mount();
    await ready();
    await userEvent.click(
      region().getByRole("button", { name: "Download reference" }),
    );
    await region().findByRole("heading", {
      name:
        status === 404
          ? "Not found"
          : status === 409
            ? "Reload required"
            : "Service unavailable",
    });
    expect(refs().filter((r) => r.url.endsWith("/content"))).toHaveLength(1);
    expect(createUrl).not.toHaveBeenCalled();
  },
);
test("failed sibling cannot suppress successful References", async () => {
  reqDelay = Promise.resolve(reply({}, 500));
  mount();
  await ready();
  expect(region().getByLabelText("Reference file")).toBeEnabled();
});
