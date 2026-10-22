import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate, useLocation } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import App from "../../App";
import AppShell from "../../app/AppShell";
import { SessionProvider, useSession } from "../../app/session";
import { createQueryClient } from "../../app/queryClient";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import {
  metadataSchema,
  checked,
  safeVersion,
  type Project,
  type Style,
} from "./model";
const org = (id: string, role = "ORG_OWNER") => ({
  id,
  name: `Organization ${id}`,
  role,
  status: "ACTIVE",
  version: 0,
});
const project = (
  organizationId = "A",
  id = "P",
  version = 0,
  status: Project["status"] = "ACTIVE",
): Project => ({
  id,
  organizationId,
  name: `Project ${organizationId}`,
  description: "Recorded project",
  status,
  version,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
});
const style = (version = 0, status: Style["status"] = "ACTIVE"): Style => ({
  id: "S",
  projectId: "P",
  name: "Style A",
  styleCode: "Case-A",
  description: "Recorded style",
  status,
  version,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "workspace-reference",
    },
  });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let role: string,
  memberStatus: number,
  members: ReturnType<typeof org>[],
  calls: Request[],
  cache: QueryClient;
let morePages: boolean;
let detailWait: Promise<Response> | undefined;
let membershipWait: Promise<Response> | undefined,
  readWait: Promise<Response> | undefined,
  writeWait: Promise<Response> | undefined;
let p: Project, s: Style, conflict: boolean, privateStatus: number;
beforeEach(() => {
  setAccessToken();
  role = "ORG_OWNER";
  memberStatus = 200;
  members = [org("A"), org("B")];
  calls = [];
  membershipWait = readWait = writeWait = undefined;
  morePages = false;
  detailWait = undefined;
  p = project();
  s = style();
  conflict = false;
  privateStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      calls.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject") ?? "actor-a",
        });
      if (path === "/api/identity/capabilities")
        return reply({ platformAdmin: true });
      if (path === "/api/organizations")
        return (
          membershipWait ??
          reply(
            members.map((o) => ({ ...o, role })),
            memberStatus,
          )
        );
      const m = /\/organizations\/([^/]+)\/projects(.*)/.exec(path);
      if (m) {
        if (privateStatus !== 200) return reply({}, privateStatus);
        const owner = m[1],
          suffix = m[2];
        if (request.method === "POST")
          return writeWait ?? reply(suffix.includes("styles") ? s : p, 201);
        if (request.method === "PUT") {
          if (writeWait) return writeWait;
          if (conflict) {
            p = { ...p, name: "Server Project", version: 4 };
            s = { ...s, name: "Server Style", version: 7 };
            return reply({ detail: "unsafe sql private body" }, 409);
          }
          const body = await request.clone().json();
          if (suffix.includes("styles")) {
            s = { ...s, ...body, version: body.version + 1 };
            return reply(s);
          }
          p = { ...p, ...body, version: body.version + 1 };
          return reply(p);
        }
        if (suffix === "") {
          if (owner === "A" && readWait) return readWait;
          return reply({
            items: morePages
              ? Array.from({ length: 25 }, (_, i) =>
                  project(owner, `page-${i}`),
                )
              : [project(owner)],
            limit: 25,
            offset: Number(
              new URL(request.url).searchParams.get("offset") ?? 0,
            ),
            hasMore:
              morePages &&
              new URL(request.url).searchParams.get("offset") === "0",
          });
        }
        if (suffix === "/P" && owner === "A" && detailWait) return detailWait;
        if (suffix === "/P") return reply(owner === "A" ? p : project(owner));
        if (suffix === "/P/styles")
          return reply({ items: [s], limit: 25, offset: 0, hasMore: false });
        if (suffix === "/P/styles/S") return reply(s);
        return reply({}, 404);
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
function mount(path = "/organizations/A/projects", advisory = false) {
  cache = createQueryClient();
  cache.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        {advisory ? (
          <SessionProvider>
            <AppShell />
            <AdvisoryProbe />
          </SessionProvider>
        ) : (
          <App />
        )}
        <TestNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
function AdvisoryProbe() {
  const session = useSession();
  return (
    <button
      onClick={() =>
        session.select({
          ...org("A", "ORG_OWNER"),
          name: "Advisory owner display",
        })
      }
    >
      Change advisory display only
    </button>
  );
}
function TestNavigation() {
  const navigate = useNavigate(),
    location = useLocation();
  return (
    <div>
      <button onClick={() => navigate("/organizations/B/projects/P/styles/S")}>
        Deep B Style
      </button>
      <button onClick={() => navigate("/organizations/Z/projects/P/styles/S")}>
        Deep unavailable Organization
      </button>
      <output aria-label="Test route">{location.pathname}</output>
    </div>
  );
}
const privateCalls = () =>
  calls.filter((r) =>
    new URL(r.url).pathname.startsWith("/api/v1/organizations/"),
  );
const writes = () => privateCalls().filter((r) => r.method !== "GET");
async function choose(id: string) {
  await userEvent.click(screen.getByRole("link", { name: "Organization" }));
  await userEvent.click(
    await screen.findByRole("button", { name: `Organization ${id}` }),
  );
  await screen.findByRole("heading", { name: "Projects", level: 1 });
}
const profile = () =>
  within(screen.getByRole("region", { name: /^(Project|Style) profile$/ }));

test("direct nested route validates membership then parent then Style; display and Projects link synchronize without replacing nested URL", async () => {
  mount("/organizations/B/projects/P/styles/S");
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "href",
    "/organizations/B/projects",
  );
  expect(document.querySelector(".topbar")).toHaveTextContent("Organization B");
  expect(privateCalls().map((r) => new URL(r.url).pathname)).toEqual([
    "/api/v1/organizations/B/projects/P",
    "/api/v1/organizations/B/projects/P/styles/S",
  ]);
});
test.each(["pending", "error", "missing"])(
  "membership %s fails closed, including PLATFORM_ADMIN without membership",
  async (state) => {
    if (state === "pending") membershipWait = deferred<Response>().promise;
    if (state === "error") memberStatus = 503;
    if (state === "missing") members = [];
    mount();
    if (state === "pending")
      await screen.findByRole("status", {
        name: "Resolving organization membership",
      });
    else
      await screen.findByRole("heading", {
        name: state === "error" ? "Service unavailable" : "Access denied",
      });
    expect(privateCalls()).toHaveLength(0);
    expect(document.querySelector(".topbar")).not.toHaveTextContent(
      "Organization A",
    );
  },
);
test("membership revocation removes current Organization context and private cache", async () => {
  mount();
  await screen.findByRole("heading", { name: "Projects", level: 1 });
  members = [org("A")];
  await choose("A");
  // Membership removal while A is open must unmount private content.
  members = [];
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.organizations(getSession().key),
    });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(screen.queryByText("Project A")).not.toBeInTheDocument();
  expect(
    cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(getSession().key, "A") }),
  ).toHaveLength(0);
});
test("A→B pending read aborts and removes private cache while preserving global supply cache", async () => {
  const late = deferred<Response>();
  readWait = late.promise;
  mount();
  await screen.findByRole("status", { name: "Loading projects" });
  const old = privateCalls()[0];
  const scope = getSession().key;
  cache.setQueryData(queryKeys.supply(scope, "catalog"), "global catalog");
  await choose("B");
  expect(old.signal.aborted).toBe(true);
  expect(
    cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(scope, "A") }),
  ).toHaveLength(0);
  await act(async () =>
    late.resolve(
      reply({
        items: [project("A", "late", 0)],
        limit: 25,
        offset: 0,
        hasMore: false,
      }),
    ),
  );
  expect(await screen.findByText("Project B")).toBeVisible();
  expect(screen.queryByText("Project A")).not.toBeInTheDocument();
  expect(cache.getQueryData(queryKeys.supply(scope, "catalog"))).toBe(
    "global catalog",
  );
});
test("A→B→A rejects old A generation even if the UUID context returns", async () => {
  const late = deferred<Response>();
  readWait = late.promise;
  mount();
  await screen.findByRole("status", { name: "Loading projects" });
  await choose("B");
  readWait = undefined;
  await choose("A");
  await screen.findByText("Project A");
  await act(async () =>
    late.resolve(
      reply({
        items: [{ ...project(), name: "STALE first A" }],
        limit: 25,
        offset: 0,
        hasMore: false,
      }),
    ),
  );
  expect(screen.queryByText("STALE first A")).not.toBeInTheDocument();
  expect(screen.getByText("Project A")).toBeVisible();
});
test.each([
  [false, 201],
  [false, 409],
  [true, 201],
  [true, 409],
] as const)(
  "late mutation cannot reset/navigate/invalidate new Organization; ABA=%s HTTP=%s",
  async (aba, outcome) => {
    const late = deferred<Response>();
    writeWait = late.promise;
    mount();
    await screen.findByRole("heading", { name: "Projects", level: 1 });
    await userEvent.type(screen.getByLabelText("Name"), "Original A draft");
    await userEvent.click(
      screen.getByRole("button", { name: "Create Project" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    const old = writes()[0];
    await choose("B");
    if (aba) await choose("A");
    await userEvent.type(screen.getByLabelText("Name"), "New generation draft");
    const count = privateCalls().length;
    await act(async () =>
      late.resolve(reply({ ...project(), name: "Late original A" }, outcome)),
    );
    expect(old.signal.aborted).toBe(true);
    expect(screen.getByLabelText("Name")).toHaveValue("New generation draft");
    expect(privateCalls()).toHaveLength(count);
    expect(screen.queryByText("Project created.")).not.toBeInTheDocument();
    expect(screen.queryByText("workspace-reference")).not.toBeInTheDocument();
  },
);
test("dirty drafts disappear on Organization switch and return", async () => {
  mount();
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("Name"), "Private draft");
  await choose("B");
  expect(screen.getByLabelText("Name")).toHaveValue("");
  await choose("A");
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
test.each(["VIEWER", "ORG_OWNER", "ORG_ADMIN"])(
  "role %s controls create/edit/lifecycle independently from platform capability",
  async (membership) => {
    role = membership;
    mount("/organizations/A/projects/P/styles/S");
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    expect(
      profile().queryByRole("button", { name: "Save Style metadata" }) !== null,
    ).toBe(membership !== "VIEWER");
    expect(
      profile().queryByRole("button", { name: "Archive Style" }) !== null,
    ).toBe(membership !== "VIEWER");
    expect(writes()).toHaveLength(0);
  },
);
test.each(["actor", "logout"])(
  "%s invalidates old private reads, context and drafts",
  async (change) => {
    mount("/organizations/A/projects/P/styles/S");
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    await userEvent.type(profile().getByLabelText("Name"), "private draft");
    const scope = getSession().key;
    await act(async () => {
      if (change === "actor") {
        members = [];
        setLocalSubject("actor-b");
      } else endSession();
    });
    await screen.findByRole("heading", {
      name: change === "actor" ? "Access denied" : "Authentication required",
    });
    expect(screen.queryByDisplayValue(/private draft/)).not.toBeInTheDocument();
    expect(
      cache
        .getQueryCache()
        .findAll({ queryKey: queryKeys.workspace(scope, "A") }),
    ).toHaveLength(0);
  },
);
test.each(["project", "style"])(
  "%s metadata 409 preserves draft, compares latest, and requires explicit reconcile then submit",
  async (kind) => {
    mount(`/organizations/A/projects/P${kind === "style" ? "/styles/S" : ""}`);
    await screen.findByRole("heading", {
      name: kind === "style" ? "Style A" : "Project A",
      level: 1,
    });
    const area = profile(),
      field = area.getByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.type(field, "My preserved draft");
    conflict = true;
    await userEvent.click(
      area.getByRole("button", { name: /Save .* metadata/ }),
    );
    await screen.findByRole("alert", { name: "Metadata conflict" });
    await within(
      screen.getByRole("alert", { name: "Metadata conflict" }),
    ).findByText(`Server ${kind === "style" ? "Style" : "Project"}`);
    expect(field).toHaveValue("My preserved draft");
    expect(writes()).toHaveLength(1);
    expect(document.body.textContent).not.toContain("unsafe sql");
    expect(screen.getByText("workspace-reference")).toBeVisible();
    conflict = false;
    await userEvent.click(
      screen.getByRole("button", { name: "Reconcile draft with latest" }),
    );
    expect(writes()).toHaveLength(1);
    await userEvent.click(
      area.getByRole("button", { name: /Save .* metadata/ }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((await writes()[1].clone().json()).version).toBe(
      kind === "style" ? 7 : 4,
    );
  },
);
test.each(["project", "style"])(
  "%s lifecycle 409 is command reconciliation without metadata comparison or auto replay",
  async (kind) => {
    mount(`/organizations/A/projects/P${kind === "style" ? "/styles/S" : ""}`);
    await screen.findByRole("heading", {
      name: kind === "style" ? "Style A" : "Project A",
      level: 1,
    });
    conflict = true;
    await userEvent.click(
      profile().getByRole("button", {
        name: kind === "style" ? "Archive Style" : "Archive Project",
      }),
    );
    await screen.findByText(/The lifecycle command conflicts/);
    expect(
      screen.queryByRole("alert", { name: "Metadata conflict" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    conflict = false;
    await userEvent.click(
      profile().getByRole("button", {
        name: kind === "style" ? "Archive Style" : "Archive Project",
      }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((await writes()[1].clone().json()).version).toBe(
      kind === "style" ? 7 : 4,
    );
  },
);
test.each([false, true])(
  "Style 409 refreshes parent and child and disables writes when parent archived; lifecycle=%s",
  async (lifecycle) => {
    mount("/organizations/A/projects/P/styles/S");
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    if (!lifecycle)
      await userEvent.type(profile().getByLabelText("Name"), " draft");
    p = { ...p, status: "ARCHIVED", version: 2 };
    conflict = true;
    await userEvent.click(
      profile().getByRole("button", {
        name: lifecycle ? "Archive Style" : "Save Style metadata",
      }),
    );
    await screen.findByText(/The parent Project is archived/);
    expect(
      profile().queryByRole("button", {
        name: /^(Save|Archive|Reactivate) Style/,
      }),
    ).not.toBeInTheDocument();
    expect(
      privateCalls().filter((r) => new URL(r.url).pathname.endsWith("/P")),
    ).toHaveLength(2);
    expect(
      privateCalls().filter(
        (r) => new URL(r.url).pathname.endsWith("/S") && r.method === "GET",
      ),
    ).toHaveLength(2);
  },
);
test.each([
  ["ARCHIVED", "ACTIVE"],
  ["ACTIVE", "ARCHIVED"],
  ["ARCHIVED", "ARCHIVED"],
] as const)(
  "archived parent=%s child=%s remains readable with exact lifecycle controls",
  async (parent, child) => {
    p = { ...p, status: parent };
    s = { ...s, status: child };
    mount("/organizations/A/projects/P/styles/S");
    await screen.findByRole("heading", { name: "Style A", level: 1 });
    expect(profile().getByLabelText("Name")).toHaveAttribute("readonly");
    expect(
      profile().queryByRole("button", { name: "Reactivate Style" }) !== null,
    ).toBe(parent === "ACTIVE");
  },
);
test.each([403, 404])(
  "private %s is safe and never exposes foreign data or retries",
  async (status) => {
    privateStatus = status;
    mount("/organizations/A/projects/P/styles/S");
    await screen.findByRole("heading", {
      name: status === 403 ? "Access denied" : "Not found",
    });
    expect(privateCalls()).toHaveLength(1);
    expect(screen.queryByText("Style A")).not.toBeInTheDocument();
    if (status === 403)
      expect(
        cache
          .getQueryCache()
          .findAll({ queryKey: queryKeys.workspace(getSession().key, "A") }),
      ).toHaveLength(0);
  },
);
test("filter serialization and pagination keys are tenant scoped without keyword or totals", async () => {
  mount();
  await screen.findByText("Project A");
  await userEvent.selectOptions(screen.getByLabelText("Project status"), "ALL");
  await waitFor(() =>
    expect(new URL(privateCalls().at(-1)!.url).searchParams.has("status")).toBe(
      false,
    ),
  );
  expect(new URL(privateCalls()[0].url).searchParams.get("limit")).toBe("25");
  expect(new URL(privateCalls()[0].url).searchParams.get("offset")).toBe("0");
  expect(queryKeys.projects("scope", "A", undefined, 25, 50)).toEqual([
    "workspace",
    "scope",
    "A",
    "projects",
    null,
    25,
    50,
  ]);
  expect(queryKeys.style("scope", "A", "P", "S")).toEqual([
    "workspace",
    "scope",
    "A",
    "project",
    "P",
    "style",
    "S",
  ]);
  expect(queryKeys.styles("scope", "A", "P", "ACTIVE", 25, 0)).toEqual([
    "workspace",
    "scope",
    "A",
    "project",
    "P",
    "styles",
    "ACTIVE",
    25,
    0,
  ]);
  expect(screen.queryByText(/total projects/i)).not.toBeInTheDocument();
});
test.each([undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0"])(
  "unsafe version %s never becomes editable",
  async (version) => {
    p = { ...p, version } as Project;
    mount("/organizations/A/projects/P");
    await screen.findByRole("heading", { name: "Service unavailable" });
    expect(
      screen.queryByRole("button", { name: "Save Project metadata" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  },
);
test("normalization preserves code case, optional clearing and independent version contract", () => {
  expect(
    metadataSchema.parse({
      name: " Name ",
      description: " ",
      styleCode: " Case-A ",
    }),
  ).toEqual({ name: "Name", description: "", styleCode: "Case-A" });
  expect(
    metadataSchema.safeParse({ name: " ", description: "", styleCode: "" })
      .success,
  ).toBe(false);
  expect(() => checked({ ...style(), projectId: "foreign" }, "P")).toThrow();
  expect(safeVersion(0)).toBe(true);
});

test("selected A → authorized B deep link adopts B, preserves nested URL and clears A draft", async () => {
  mount();
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("Name"), "Old A draft");
  await userEvent.click(screen.getByRole("button", { name: "Deep B Style" }));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(document.querySelector(".topbar")).toHaveTextContent("Organization B");
  expect(screen.getByLabelText("Test route")).toHaveTextContent(
    "/organizations/B/projects/P/styles/S",
  );
  expect(screen.queryByDisplayValue("Old A draft")).not.toBeInTheDocument();
});
test("unavailable B deep link never adopts selected A into its neutral shell", async () => {
  mount();
  await screen.findByLabelText("Name");
  await userEvent.click(
    screen.getByRole("button", { name: "Deep unavailable Organization" }),
  );
  await screen.findByRole("heading", { name: "Access denied" });
  expect(document.querySelector(".topbar")).not.toHaveTextContent(
    "Organization A",
  );
  expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
    "href",
    "/organization",
  );
  expect(privateCalls().every((r) => !r.url.includes("/Z/"))).toBe(true);
});
test("create sends only generated fields, omits blank optional text and never retries", async () => {
  mount();
  await screen.findByLabelText("Name");
  await userEvent.type(screen.getByLabelText("Name"), "  Created Project  ");
  await userEvent.type(screen.getByLabelText("Description (optional)"), "   ");
  await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
  await screen.findByRole("link", { name: "Open created Project" });
  expect(await writes()[0].clone().json()).toEqual({ name: "Created Project" });
  expect(cache.getMutationCache().findAll()[0].options.retry).toBe(false);
  expect(cache.getMutationCache().findAll()[0].options.mutationKey).toEqual([
    "workspace",
    getSession().key,
    "A",
    "projects",
    "create",
  ]);
});
test("full Style replacement preserves code case and deliberately clears optional strings", async () => {
  mount("/organizations/A/projects/P/styles/S");
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  await userEvent.clear(profile().getByLabelText("Style code (optional)"));
  await userEvent.clear(profile().getByLabelText("Description (optional)"));
  await userEvent.click(
    profile().getByRole("button", { name: "Save Style metadata" }),
  );
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(await writes()[0].clone().json()).toEqual({
    name: "Style A",
    description: null,
    styleCode: null,
    status: "ACTIVE",
    version: 0,
  });
});
test("refetch failure during metadata conflict retains draft and blocks reconciliation with stale data", async () => {
  mount("/organizations/A/projects/P");
  await screen.findByRole("heading", { name: "Project A", level: 1 });
  await userEvent.type(profile().getByLabelText("Name"), " draft");
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      if (r.method === "PUT") return reply({}, 409);
      if (r.url.includes("/projects/P")) return reply({}, 503);
      return original(r);
    }),
  );
  await userEvent.click(
    profile().getByRole("button", { name: "Save Project metadata" }),
  );
  await screen.findByText(/Current server context is unavailable/);
  expect(profile().getByLabelText("Name")).toHaveValue("Project A draft");
  expect(screen.getByRole("button", { name: "Use latest" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Reconcile draft with latest" }),
  ).not.toBeInTheDocument();
});

test("pending deep-link B membership leaves A unadopted until validation, then adopts B", async () => {
  mount();
  await screen.findByText("Project A");
  const late = deferred<Response>();
  membershipWait = late.promise;
  await userEvent.click(screen.getByRole("button", { name: "Deep B Style" }));
  await screen.findByRole("status", {
    name: "Resolving organization membership",
  });
  expect(document.querySelector(".topbar")).not.toHaveTextContent(
    "Organization A",
  );
  expect(privateCalls().some((r) => r.url.includes("/B/"))).toBe(false);
  expect(
    cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.workspace(getSession().key, "A") }).length,
  ).toBeGreaterThan(0);
  await act(async () => late.resolve(reply(members)));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(document.querySelector(".topbar")).toHaveTextContent("Organization B");
});
test.each([false, true])(
  "late metadata conflict refresh cannot restore the old conflict after switching; ABA=%s",
  async (aba) => {
    mount("/organizations/A/projects/P");
    await screen.findByRole("heading", { name: "Project A", level: 1 });
    const late = deferred<Response>();
    detailWait = late.promise;
    await userEvent.type(profile().getByLabelText("Name"), " old draft");
    conflict = true;
    await userEvent.click(
      profile().getByRole("button", { name: "Save Project metadata" }),
    );
    await screen.findByRole("alert", { name: "Metadata conflict" });
    await choose("B");
    if (aba) {
      detailWait = undefined;
      await choose("A");
    }
    await userEvent.type(screen.getByLabelText("Name"), "New context draft");
    await act(async () =>
      late.resolve(reply({ ...p, name: "Late conflict state" })),
    );
    expect(
      screen.queryByRole("alert", { name: "Metadata conflict" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Late conflict state")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("New context draft");
  },
);

test("VIEWER reads archived Project and archived Style without any mutation controls", async () => {
  role = "VIEWER";
  p = { ...p, status: "ARCHIVED" };
  s = { ...s, status: "ARCHIVED" };
  mount("/organizations/A/projects/P");
  await screen.findByRole("heading", { name: "Project A", level: 1 });
  expect(
    screen.queryByRole("button", { name: "Reactivate Project" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create Style" }),
  ).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("link", { name: "Style A" }));
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  expect(profile().queryAllByRole("button")).toHaveLength(0);
  expect(writes()).toHaveLength(0);
});
test("offset pages are explicit, no row fanout occurs, and confirmed create resets to page zero", async () => {
  morePages = true;
  mount();
  await waitFor(() =>
    expect(screen.getAllByRole("link", { name: "Project A" })).toHaveLength(25),
  );
  expect(privateCalls()).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Next projects" }));
  await waitFor(() =>
    expect(new URL(privateCalls().at(-1)!.url).searchParams.get("offset")).toBe(
      "25",
    ),
  );
  await userEvent.type(screen.getByLabelText("Name"), "Added Project");
  await userEvent.click(screen.getByRole("button", { name: "Create Project" }));
  await screen.findByRole("link", { name: "Open created Project" });
  await waitFor(() =>
    expect(
      cache.getQueryCache().findAll({
        queryKey: queryKeys.projects(getSession().key, "A", "ACTIVE", 25, 0),
        type: "active",
      }),
    ).toHaveLength(1),
  );
  expect(
    screen.getByRole("button", { name: "Previous projects" }),
  ).toBeDisabled();
  expect(
    privateCalls()
      .filter((r) => r.method === "GET")
      .every((r) => new URL(r.url).pathname.endsWith("/projects")),
  ).toBe(true);
});

test("advisory selected Organization role cannot grant workspace write controls", async () => {
  role = "VIEWER";
  mount("/organizations/A/projects/P/styles/S", true);
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  await userEvent.click(
    screen.getByRole("button", { name: "Change advisory display only" }),
  );
  expect(document.querySelector(".topbar")).toHaveTextContent(
    "Advisory owner display",
  );
  expect(profile().queryAllByRole("button")).toHaveLength(0);
  expect(writes()).toHaveLength(0);
});
test("fresh same-Organization membership downgrade removes writer controls without using display role", async () => {
  mount("/organizations/A/projects/P/styles/S");
  await screen.findByRole("heading", { name: "Style A", level: 1 });
  role = "VIEWER";
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.organizations(getSession().key),
    });
  });
  await screen.findByText(/Your VIEWER membership/);
  expect(profile().queryAllByRole("button")).toHaveLength(0);
  expect(writes()).toHaveLength(0);
});
