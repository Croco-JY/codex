import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { vi, test, expect, beforeEach, afterEach } from "vitest";
import App from "../App";
import { createQueryClient } from "../app/queryClient";
import { queryKeys } from "../api/queryKeys";
import {
  endSession,
  getSession,
  setAccessToken,
  setLocalSubject,
} from "../api/session";
import { ErrorBoundary } from "../app/ErrorBoundary";

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "test-reference",
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const organization = (
  name = "Private Alpha organization",
  id = "org-a",
  role = "ORG_OWNER",
  version = 0,
) => ({ name, id, role, version, status: "ACTIVE" });
let admin = false;
let identityStatus = 200;
let capabilityStatus = 200;
let serverActor = "actor-a";
let identityWait: Promise<Response> | undefined;
let capabilityWait: Promise<Response> | undefined;
let writeWait: Promise<Response> | undefined;
let renameConflict = false;
let renamed = false;
let requests: Request[];
let clients: QueryClient[];
beforeEach(() => {
  setAccessToken();
  admin = false;
  identityStatus = 200;
  capabilityStatus = 200;
  serverActor = "actor-a";
  identityWait = undefined;
  capabilityWait = undefined;
  writeWait = undefined;
  renameConflict = false;
  renamed = false;
  requests = [];
  clients = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      const subject = request.headers.get("X-Dev-Subject") ?? serverActor;
      if (path === "/api/health")
        return reply({ status: "UP", application: "SOURCE OS" });
      if (path === "/api/identity")
        return (
          identityWait ?? reply({ issuer: "local", subject }, identityStatus)
        );
      if (path === "/api/identity/capabilities")
        return (
          capabilityWait ??
          reply(
            { platformAdmin: admin && subject === "actor-a" },
            capabilityStatus,
          )
        );
      if (path === "/api/organizations" && request.method === "GET")
        return reply(
          subject === "actor-a"
            ? [organization(undefined, undefined, undefined, renamed ? 1 : 0)]
            : [],
        );
      if (request.method === "PATCH") {
        if (renameConflict)
          return reply({ detail: "unsafe internal constraint" }, 409);
        return reply(organization("Updated Alpha", "org-a", "ORG_OWNER", 2));
      }
      if (request.method === "POST")
        return writeWait ?? reply(organization("Created organization"));
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(path = "/") {
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

test("preserves overview, authenticated identity, compact working navigation and accessible landmarks", async () => {
  mount();
  expect(await screen.findByText("API UP")).toBeVisible();
  expect(await screen.findByText("Session active")).toBeVisible();
  expect(
    screen.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
    "href",
    "#main",
  );
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const name of ["Materials", "Suppliers", "Facilities", "Curation"])
    expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
  expect(screen.queryByText("PHASE 0")).not.toBeInTheDocument();
});

test("unauthenticated identity is distinct and never retries or fetches capabilities/organization data", async () => {
  identityStatus = 401;
  mount("/organization");
  expect(
    await screen.findByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  expect(
    requests.filter((r) => new URL(r.url).pathname === "/api/identity"),
  ).toHaveLength(1);
  expect(
    requests.every((r) => new URL(r.url).pathname === "/api/identity"),
  ).toBe(true);
  expect(screen.queryByLabelText("Organization name")).not.toBeInTheDocument();
});

test("pending identity never starts capability or organization requests", async () => {
  const wait = deferred<Response>();
  identityWait = wait.promise;
  mount("/organization");
  expect(
    screen.getByRole("status", { name: "Checking your session" }),
  ).toBeVisible();
  expect(
    requests.every((r) => new URL(r.url).pathname === "/api/identity"),
  ).toBe(true);
  await act(async () =>
    wait.resolve(reply({ issuer: "local", subject: "actor-a" })),
  );
  expect(
    await screen.findByRole("heading", { name: "Your working context." }),
  ).toBeVisible();
});

test("transient identity failure is unavailable rather than signed out and supports explicit recovery", async () => {
  identityStatus = 500;
  mount("/organization");
  expect(
    await screen.findByRole("heading", { name: "Service unavailable" }),
  ).toBeVisible();
  expect(screen.getByText("Session unavailable")).toBeVisible();
  expect(screen.queryByText("Authentication required")).not.toBeInTheDocument();
  identityStatus = 200;
  await userEvent.click(screen.getByRole("button", { name: "Retry session" }));
  expect(
    await screen.findByRole("heading", { name: "Your working context." }),
  ).toBeVisible();
});

test("direct admin URL denies non-admin including an organization owner without speculative admin requests", async () => {
  mount("/admin");
  expect(
    await screen.findByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    requests.every((r) => !new URL(r.url).pathname.startsWith("/api/v1/admin")),
  ).toBe(true);
});

test("pending capability hides controls and direct admin landing", async () => {
  const wait = deferred<Response>();
  capabilityWait = wait.promise;
  mount("/admin");
  expect(
    await screen.findByRole("status", { name: "Checking curation access" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Access denied" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Curation workspace" }),
  ).not.toBeInTheDocument();
  await act(async () => wait.resolve(reply({ platformAdmin: false })));
  expect(
    await screen.findByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
});

test("capability error stays unknown with retry rather than becoming a denial or grant", async () => {
  capabilityStatus = 503;
  mount("/admin");
  expect(
    await screen.findByRole("heading", { name: "Curation access unavailable" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Access denied" }),
  ).not.toBeInTheDocument();
  capabilityStatus = 200;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(
    requests.every((r) => !new URL(r.url).pathname.startsWith("/api/v1/admin")),
  ).toBe(true);
});

test("an invalid capability payload is an error instead of a silently inferred non-admin", async () => {
  capabilityWait = Promise.resolve(reply({}));
  mount("/admin");
  expect(
    await screen.findByRole("heading", { name: "Curation access unavailable" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Access denied" }),
  ).not.toBeInTheDocument();
});

test("admin has curation navigation and landing, then revocation removes both on refetch", async () => {
  admin = true;
  const client = mount("/admin");
  expect(
    await screen.findByRole("heading", { name: "Curation workspace" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Curation" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  admin = false;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  expect(
    await screen.findByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Curation workspace" }),
  ).not.toBeInTheDocument();
});

test("DEV actor switch cancels reads, clears private caches/selection and never reuses stale admin state", async () => {
  setLocalSubject("actor-a");
  admin = true;
  const client = mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  expect(await screen.findByRole("link", { name: "Curation" })).toBeVisible();
  const oldScope = getSession().key;
  client.setQueryData(queryKeys.supply(oldScope, "evidence"), {
    private: "previous actor evidence",
  });
  const late = deferred<string>();
  let signal: AbortSignal | undefined;
  void client
    .fetchQuery({
      queryKey: queryKeys.supply(oldScope, "pending"),
      queryFn: (context) => {
        signal = context.signal;
        return late.promise;
      },
    })
    .catch(() => {});
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Local development identity"),
    "actor-b",
  );
  await user.click(
    screen.getByRole("button", { name: "Switch local identity" }),
  );
  expect(await screen.findByText("No organizations yet")).toBeVisible();
  expect(getSession().key).not.toBe(oldScope);
  expect(signal?.aborted).toBe(true);
  expect(
    screen.queryByText("Private Alpha organization"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => !query.queryKey.includes(oldScope)),
  ).toBe(true);
  await act(async () => late.resolve("late private data"));
  expect(
    client.getQueryData(queryKeys.supply(oldScope, "pending")),
  ).toBeUndefined();
});

test("ending a local session clears cache, organization selection and capability without retrying identity", async () => {
  setLocalSubject("actor-a");
  admin = true;
  const client = mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  const oldScope = getSession().key;
  const count = requests.filter(
    (r) => new URL(r.url).pathname === "/api/identity",
  ).length;
  await userEvent.click(
    screen.getByRole("button", { name: "End local session" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  expect(
    screen.queryByText("Private Alpha organization"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => !query.queryKey.includes(oldScope)),
  ).toBe(true);
  expect(
    requests.filter((r) => new URL(r.url).pathname === "/api/identity"),
  ).toHaveLength(count);
});

test("an identity changed by the server rotates the scope and clears selection too", async () => {
  const client = mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  const oldScope = getSession().key;
  serverActor = "actor-b";
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.identity(oldScope) });
  });
  expect(await screen.findByText("No organizations yet")).toBeVisible();
  expect(getSession().key).not.toBe(oldScope);
  expect(
    screen.queryByText("Private Alpha organization"),
  ).not.toBeInTheDocument();
});

test("late mutation completion cannot select an organization for the next actor", async () => {
  const late = deferred<Response>();
  writeWait = late.promise;
  mount("/organization");
  await screen.findByRole("heading", { name: "Your working context." });
  await userEvent.type(
    screen.getByLabelText("Organization name", { exact: true }),
    "Draft",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create organization" }),
  );
  await act(async () => setLocalSubject("actor-b"));
  expect(await screen.findByText("No organizations yet")).toBeVisible();
  await act(async () =>
    late.resolve(reply(organization("Late private organization"))),
  );
  expect(
    screen.queryByText("Late private organization"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Select an organization")).toBeVisible();
});

test("401 on a protected read ends an established session and removes old private state", async () => {
  const client = mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  capabilityStatus = 401;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  expect(
    await screen.findByRole("heading", { name: "Authentication required" }),
  ).toBeVisible();
  expect(
    screen.queryByText("Private Alpha organization"),
  ).not.toBeInTheDocument();
  expect(screen.getByText("test-reference")).toBeVisible();
});

test("keyboard navigation, aria-current and route focus remain usable", async () => {
  mount();
  await screen.findByText("API UP");
  const user = userEvent.setup();
  // Route navigation targets a focusable content region; Tab reaches shell controls.
  screen.getByRole("link", { name: "Skip to content" }).focus();
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  screen.getByRole("link", { name: "Organization" }).focus();
  await user.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", { name: "Your working context." }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Organization" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.activeElement).toHaveClass("route-content");
});

test("409 preserves the rename draft and reloads the current version without retrying the write", async () => {
  mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  const field = screen.getByLabelText("New organization name");
  await userEvent.clear(field);
  await userEvent.type(field, "My preserved draft");
  renameConflict = true;
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(
    await screen.findByRole("heading", { name: "Reload required" }),
  ).toBeVisible();
  expect(field).toHaveValue("My preserved draft");
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  renamed = true;
  renameConflict = false;
  await userEvent.click(screen.getByRole("button", { name: "Reload" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Reload required" }),
    ).not.toBeInTheDocument(),
  );
  expect(field).toHaveValue("My preserved draft");
  expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(
    await screen.findByRole("heading", { name: "Updated Alpha" }),
  ).toBeVisible();
  const writes = requests.filter((r) => r.method === "PATCH");
  expect(JSON.parse(await writes[1]!.clone().text()).version).toBe(1);
});

test("unknown routes have a product not-found state", async () => {
  mount("/unavailable");
  expect(
    await screen.findByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Return to overview" }),
  ).toHaveAttribute("href", "/");
});

test("render boundary offers recovery without exposing exception content", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never {
    throw new Error("private render credential");
  }
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(
    screen.getByRole("button", { name: "Reload application" }),
  ).toBeVisible();
  expect(document.body.textContent).not.toContain("private render credential");
  log.mockRestore();
});

test("a late 401 from the previous actor cannot end the next actor's session", async () => {
  setLocalSubject("actor-a");
  const client = mount("/organization");
  await screen.findByRole("button", { name: "Private Alpha organization" });
  const late = deferred<Response>();
  capabilityWait = late.promise;
  const oldScope = getSession().key;
  const calls = requests.length;
  const pending = client.invalidateQueries({
    queryKey: queryKeys.capabilities(oldScope),
  });
  await waitFor(() => expect(requests.length).toBeGreaterThan(calls));
  capabilityWait = undefined;
  await act(async () => setLocalSubject("actor-b"));
  expect(await screen.findByText("No organizations yet")).toBeVisible();
  const newScope = getSession().key;
  await act(async () => {
    late.resolve(reply({}, 401));
    await pending;
  });
  expect(getSession().key).toBe(newScope);
  expect(screen.getByText("Session active")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Authentication required" }),
  ).not.toBeInTheDocument();
});

test("selecting an organization as ORG_OWNER does not grant curation access", async () => {
  mount("/organization");
  await userEvent.click(
    await screen.findByRole("button", { name: "Private Alpha organization" }),
  );
  expect(
    screen.getByRole("heading", { name: "Private Alpha organization" }),
  ).toBeVisible();
  expect(screen.getAllByText("ORG_OWNER").length).toBeGreaterThan(0);
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
});

test("known ADMIN remains visible during a background refresh, then revocation applies after response", async () => {
  admin = true;
  const client = mount("/admin");
  await screen.findByRole("heading", { name: "Curation workspace" });
  const wait = deferred<Response>();
  capabilityWait = wait.promise;
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = client.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  expect(
    client.isFetching({ queryKey: queryKeys.capabilities(getSession().key) }),
  ).toBe(1);
  expect(
    screen.getByRole("heading", { name: "Curation workspace" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Curation" })).toBeVisible();
  expect(
    screen.queryByRole("status", { name: "Checking curation access" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    wait.resolve(reply({ platformAdmin: false }));
    await refresh;
  });
  expect(
    await screen.findByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
});

test("known NON_ADMIN keeps denied UX during refresh, then a successful grant enables curation", async () => {
  const client = mount("/admin");
  await screen.findByRole("heading", { name: "Access denied" });
  const wait = deferred<Response>();
  capabilityWait = wait.promise;
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = client.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  expect(
    client.isFetching({ queryKey: queryKeys.capabilities(getSession().key) }),
  ).toBe(1);
  expect(screen.getByRole("heading", { name: "Access denied" })).toBeVisible();
  expect(
    screen.queryByRole("status", { name: "Checking curation access" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    wait.resolve(reply({ platformAdmin: true }));
    await refresh;
  });
  expect(
    await screen.findByRole("heading", { name: "Curation workspace" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Curation" })).toBeVisible();
});

test.each([true, false])(
  "failed background refresh closes stale ADMIN access and explicit retry restores %s",
  async (restored) => {
    admin = true;
    const client = mount("/admin");
    await screen.findByRole("heading", { name: "Curation workspace" });
    capabilityStatus = 503;
    await act(async () => {
      await client.invalidateQueries({
        queryKey: queryKeys.capabilities(getSession().key),
      });
    });
    expect(
      await screen.findByRole("heading", {
        name: "Curation access unavailable",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Curation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Curation workspace" }),
    ).not.toBeInTheDocument();
    expect(
      requests.every(
        (r) => !new URL(r.url).pathname.startsWith("/api/v1/admin"),
      ),
    ).toBe(true);
    const wait = deferred<Response>();
    capabilityWait = wait.promise;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      screen.getByRole("heading", { name: "Curation access unavailable" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Curation" }),
    ).not.toBeInTheDocument();
    await act(async () => wait.resolve(reply({ platformAdmin: restored })));
    expect(
      await screen.findByRole("heading", {
        name: restored ? "Curation workspace" : "Access denied",
      }),
    ).toBeVisible();
  },
);
