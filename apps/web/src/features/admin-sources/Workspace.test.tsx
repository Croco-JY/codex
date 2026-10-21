import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../App";
import { createQueryClient } from "../../app/queryClient";
import { endSession, getSession, setLocalSubject } from "../../api/session";
import { queryKeys } from "../../api/queryKeys";
import { MutationFeedback } from "./FormUI";
import type { Observation, Review, Source } from "./model";
const sid = "50000000-0000-4000-8000-000000000001",
  inactiveId = "50000000-0000-4000-8000-000000000002",
  rid = "50000000-0000-4000-8000-000000000003",
  oid = "50000000-0000-4000-8000-000000000004",
  createdId = "50000000-0000-4000-8000-000000000005";
const source = (
  id = sid,
  name = "Protected Source A",
  sourceCode = "A.Mixed_Source",
) => ({
  id,
  name,
  sourceCode,
  sourceType: "MANUAL_ENTRY" as const,
  accessMethod: "MANUAL" as const,
  normalizationPolicy: "PRESERVE" as const,
  active: true,
  version: 0,
});
const observed = (): Observation => ({
  id: oid,
  sourceRecordId: rid,
  observationKey: "Existing-key",
  observedAt: "2026-10-21T12:00:00Z",
  recordedAt: "2026-10-21T12:00:01Z",
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "admin-reference",
    },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Call = {
  request: Request;
  path: string;
  method: string;
  body?: Record<string, unknown>;
  url: URL;
};
let clients: QueryClient[],
  calls: Call[],
  sources: Source[],
  observations: Observation[],
  reviews: Review[];
let admin: boolean,
  capabilityStatus: number,
  capabilityWait: Promise<Response> | undefined;
let overrides: Record<string, (call: Call) => Response | Promise<Response>>;
beforeEach(() => {
  setLocalSubject("admin-a");
  admin = true;
  capabilityStatus = 200;
  capabilityWait = undefined;
  clients = [];
  calls = [];
  overrides = {};
  sources = [
    source(),
    { ...source(inactiveId, "Inactive Source B", "B.Inactive"), active: false },
  ];
  observations = [];
  reviews = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url),
        path = url.pathname;
      const call: Call = {
        request,
        url,
        path,
        method: request.method,
        ...(request.method !== "GET"
          ? { body: await request.clone().json() }
          : {}),
      };
      calls.push(call);
      if (overrides[`${call.method} ${path}`])
        return overrides[`${call.method} ${path}`]!(call);
      if (path === "/api/identity")
        return reply({
          issuer: "local",
          subject: request.headers.get("X-Dev-Subject"),
        });
      if (path === "/api/identity/capabilities")
        return (
          capabilityWait ?? reply({ platformAdmin: admin }, capabilityStatus)
        );
      if (path === "/api/health") return reply({ status: "UP" });
      if (path === "/api/v1/admin/sources" && call.method === "GET") {
        const offset = Number(url.searchParams.get("offset"));
        return reply(sources.slice(offset, offset + 25));
      }
      if (path === "/api/v1/admin/sources" && call.method === "POST") {
        sources = [
          { ...call.body, id: createdId, version: 0 } as Source,
          ...sources,
        ];
        return reply(createdId);
      }
      if (path.startsWith("/api/v1/admin/sources/") && call.method === "PUT") {
        const index = sources.findIndex((s) => s.id === path.split("/").at(-1));
        const before = sources[index]!;
        sources[index] = {
          ...call.body,
          id: before.id,
          version: (before.version ?? 0) + 1,
        } as Source;
        return reply(before.id);
      }
      if (path === "/api/v1/admin/source-records")
        return reply({
          ...call.body,
          id: rid,
          normalizedExternalRecordKey: call.body!.externalRecordKey,
        });
      if (path === "/api/v1/admin/source-observations") {
        const found = observations.find(
          (o) => o.observationKey === call.body?.observationKey,
        );
        if (found) return reply(found);
        const row = {
          ...call.body,
          id: oid,
          recordedAt: "2026-10-21T12:00:01Z",
        };
        observations.unshift(row);
        return reply(row);
      }
      if (path.endsWith("/observations")) {
        const offset = Number(url.searchParams.get("offset"));
        return reply(observations.slice(offset, offset + 25));
      }
      if (path.endsWith("/reviews") && call.method === "POST") {
        const id = `50000000-0000-4000-8000-${String(100 + reviews.length).padStart(12, "0")}`;
        reviews.unshift({
          ...call.body,
          id,
          observationId: oid,
          reviewedAt: "2026-10-21T12:00:00Z",
        });
        return reply(id);
      }
      if (path.endsWith("/reviews")) {
        const offset = Number(url.searchParams.get("offset"));
        return reply(reviews.slice(offset, offset + 25));
      }
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  clients.forEach((c) => c.clear());
  endSession();
  vi.unstubAllGlobals();
});
function mount(path = "/admin/sources") {
  const cache = createQueryClient();
  clients.push(cache);
  cache.setDefaultOptions({
    ...cache.getDefaultOptions(),
    queries: { ...cache.getDefaultOptions().queries, retryDelay: 0 },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
const gets = (path = "/api/v1/admin/sources") =>
  calls.filter((c) => c.method === "GET" && c.path === path);
const writes = (path: string) =>
  calls.filter((c) => c.method !== "GET" && c.path === path);
async function ready() {
  await screen.findByRole("heading", { name: "Sources & Evidence", level: 1 });
  await screen.findByRole("button", {
    name: "Select Source Protected Source A · A.Mixed_Source",
  });
}
async function createDraft() {
  await userEvent.click(screen.getByRole("button", { name: "New Source" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Source code")).toHaveFocus(),
  );
  await userEvent.type(screen.getByLabelText("Source code"), "JaPan.Mixed-1");
  await userEvent.type(screen.getByLabelText("Source name"), "My new Source");
}
async function openKnown(withObservation = false) {
  if (withObservation) observations = [observed()];
  await userEvent.type(screen.getByLabelText("Known SourceRecord UUID"), rid);
  await userEvent.click(
    screen.getByRole("button", { name: "Open Record history" }),
  );
  await screen.findByRole("heading", { name: "Immutable Observations" });
}
async function register() {
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Protected Source A · A.Mixed_Source",
    }),
  );
  await userEvent.type(
    screen.getByLabelText("External record key"),
    "  MiXeD-会社-e\u0301  ",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Register / reuse record" }),
  );
  await screen.findByRole("heading", { name: "Immutable Observations" });
}
async function fillObservation() {
  await userEvent.type(screen.getByLabelText("Observation key"), "Draft-Key");
  fireEvent.change(screen.getByLabelText("Observed at (UTC)"), {
    target: { value: "2026-10-21T12:34:56.123" },
  });
}
async function openReviews() {
  await openKnown(true);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Open Reviews for Existing-key",
    }),
  );
  await screen.findByRole("heading", { name: "Observation Reviews" });
}

test.each([false, "error", "pending"] as const)(
  "nested admin route fails closed for capability %s without admin requests",
  async (state) => {
    if (state === false) admin = false;
    if (state === "error") capabilityStatus = 503;
    const pending = deferred<Response>();
    if (state === "pending") capabilityWait = pending.promise;
    mount();
    if (state === "pending")
      await screen.findByRole("status", { name: "Checking curation access" });
    else
      await screen.findByRole("heading", {
        name: state === false ? "Access denied" : "Curation access unavailable",
      });
    expect(
      calls.filter((c) => c.path.startsWith("/api/v1/admin")),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("link", { name: "Curation" }),
    ).not.toBeInTheDocument();
    if (state === "pending")
      await act(async () => pending.resolve(reply({ platformAdmin: false })));
  },
);
test("Sources landing tool remains actionable and nested entry refreshes capability", async () => {
  mount("/admin");
  await screen.findByRole("heading", { name: "Curation workspace" });
  const before = gets("/api/identity/capabilities").length;
  await userEvent.click(
    screen.getByRole("link", { name: "Open Sources & Evidence" }),
  );
  await ready();
  expect(gets("/api/identity/capabilities").length).toBeGreaterThan(before);
  expect(
    screen.queryByRole("link", {
      name: /Price curation|Inventory curation|Identity Binding/,
    }),
  ).not.toBeInTheDocument();
});
test("Source pagination uses bounded offset pages, no total and no per-row history fanout", async () => {
  sources = Array.from({ length: 26 }, (_, n) =>
    source(
      `50000000-0000-4000-8000-${String(n + 20).padStart(12, "0")}`,
      `Source ${n}`,
      `Code-${n}`,
    ),
  );
  mount();
  await screen.findByText("25 sources loaded");
  expect(gets()[0]!.url.searchParams.toString()).toBe("limit=25&offset=0");
  await userEvent.click(
    screen.getByRole("button", { name: "Load more sources" }),
  );
  await screen.findByText("26 sources loaded");
  expect(gets()[1]!.url.searchParams.get("offset")).toBe("25");
  expect(
    screen.queryByRole("button", { name: "Load more sources" }),
  ).not.toBeInTheDocument();
  expect(
    calls.filter(
      (c) =>
        c.path.startsWith("/api/v1/admin/") &&
        c.path !== "/api/v1/admin/sources",
    ),
  ).toHaveLength(0);
  expect(screen.queryByText(/total sources/i)).not.toBeInTheDocument();
});
test("an exact 25-row page permits a final empty page without inventing totals", async () => {
  sources = Array.from({ length: 25 }, (_, n) =>
    source(
      `50000000-0000-4000-8000-${String(n + 20).padStart(12, "0")}`,
      `Source ${n}`,
      `Code-${n}`,
    ),
  );
  mount();
  await screen.findByText("25 sources loaded");
  await userEvent.click(
    screen.getByRole("button", { name: "Load more sources" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Load more sources" }),
    ).not.toBeInTheDocument(),
  );
  expect(gets()).toHaveLength(2);
});
test("Source create preserves input, sends deliberate active/version0 and resets the pagination sequence", async () => {
  sources.push(
    ...Array.from({ length: 25 }, (_, n) =>
      source(
        `50000000-0000-4000-8000-${String(n + 20).padStart(12, "0")}`,
        `Source ${n}`,
        `Code-${n}`,
      ),
    ),
  );
  const cache = mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Load more sources" }),
  );
  await screen.findByText("27 sources loaded");
  await createDraft();
  await userEvent.type(
    screen.getByLabelText("Base URL (optional)"),
    "https://Example.com:443/Path?q=AbC%2FZ",
  );
  await userEvent.click(screen.getByLabelText("Active Source"));
  await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
  await screen.findByText(/Source created\. Reference:/);
  expect(writes("/api/v1/admin/sources")[0]!.body).toEqual({
    sourceCode: "JaPan.Mixed-1",
    name: "My new Source",
    sourceType: "MANUAL_ENTRY",
    accessMethod: "MANUAL",
    normalizationPolicy: "PRESERVE",
    active: false,
    version: 0,
    baseUrl: "https://Example.com:443/Path?q=AbC%2FZ",
  });
  await screen.findByText("25 sources loaded");
  expect(gets().at(-1)!.url.searchParams.get("offset")).toBe("0");
  expect(
    cache
      .getMutationCache()
      .getAll()
      .every((m) => m.options.retry === false),
  ).toBe(true);
  expect(screen.getByLabelText("Source name")).toHaveValue("");
});
test("incomplete SourceView may display but cannot enable edit with fabricated defaults", async () => {
  sources = [{ id: sid, name: "Incomplete Source", sourceCode: "Incomplete" }];
  mount();
  await screen.findByText(
    "Incomplete or unsafe current state: this Source cannot be edited.",
  );
  expect(
    screen.getByRole("button", {
      name: "Edit Source Incomplete Source · Incomplete",
    }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Incomplete Source · Incomplete",
    }),
  );
  expect(
    screen.getByRole("button", { name: "Register / reuse record" }),
  ).toBeDisabled();
});
test("Source edit preserves read-only identity and exact version; 409 retains draft and requires explicit retry", async () => {
  let conflict = true;
  overrides[`PUT /api/v1/admin/sources/${sid}`] = (call) => {
    if (conflict) {
      sources[0] = { ...sources[0], name: "Server changed name", version: 3 };
      return reply({ detail: "unsafe database constraint" }, 409);
    }
    sources[0] = { ...call.body, id: sid, version: 4 } as Source;
    return reply(sid);
  };
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Edit Source Protected Source A · A.Mixed_Source",
    }),
  );
  expect(screen.getByLabelText("Source code")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("Normalization policy")).toHaveAttribute(
    "readonly",
  );
  await userEvent.clear(screen.getByLabelText("Source name"));
  await userEvent.type(
    screen.getByLabelText("Source name"),
    "Preserved draft name",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save Source" }));
  await screen.findByRole("heading", {
    name: "The Source changed or conflicts with the current server state.",
  });
  await screen.findByText("Server changed name", { selector: "dd" });
  expect(screen.getByLabelText("Source name")).toHaveValue(
    "Preserved draft name",
  );
  expect(writes(`/api/v1/admin/sources/${sid}`)).toHaveLength(1);
  expect(screen.getByText("admin-reference")).toBeVisible();
  expect(document.body.textContent).not.toContain("unsafe database");
  conflict = false;
  await userEvent.click(
    screen.getByRole("button", { name: "Use refreshed version, keep draft" }),
  );
  expect(writes(`/api/v1/admin/sources/${sid}`)).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Save Source" }));
  await screen.findByText(
    "Source updated. The current loaded pages and server version have been refreshed.",
  );
  expect(writes(`/api/v1/admin/sources/${sid}`)[1]!.body).toMatchObject({
    version: 3,
    sourceCode: "A.Mixed_Source",
    normalizationPolicy: "PRESERVE",
    name: "Preserved draft name",
  });
});
test("network-ambiguous Source create retains draft and only offers explicit read refresh", async () => {
  overrides["POST /api/v1/admin/sources"] = () => {
    throw new TypeError("private transport error");
  };
  mount();
  await ready();
  await createDraft();
  await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
  await screen.findByRole("heading", {
    name: "Source creation outcome unknown",
  });
  expect(screen.getByLabelText("Source name")).toHaveValue("My new Source");
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh for comparison" }),
  );
  expect(writes("/api/v1/admin/sources")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("private transport");
});
test.each([400, 403, 404, 409, 500])(
  "explicit Source HTTP %i is not transport ambiguity",
  async (status) => {
    overrides["POST /api/v1/admin/sources"] = () =>
      reply({ detail: "unsafe payload" }, status);
    mount();
    await ready();
    await createDraft();
    await userEvent.click(
      screen.getByRole("button", { name: "Create Source" }),
    );
    await screen.findByText("admin-reference");
    expect(screen.queryByText(/outcome unknown/)).not.toBeInTheDocument();
    expect(writes("/api/v1/admin/sources")).toHaveLength(1);
  },
);
test("Record register/reuse preserves raw key and establishes only returned transient context", async () => {
  const cache = mount();
  await ready();
  await register();
  expect(writes("/api/v1/admin/source-records")[0]!.body).toEqual({
    dataSourceId: sid,
    recordKind: "SUPPLIER",
    externalRecordKey: "  MiXeD-会社-e\u0301  ",
  });
  expect(
    await screen.findByText("No observations recorded for this SourceRecord."),
  ).toBeVisible();
  expect(
    screen.queryByText(/does not prove whether this SourceRecord exists/),
  ).not.toBeInTheDocument();
  expect(
    cache
      .getMutationCache()
      .getAll()
      .every((m) => m.options.retry === false),
  ).toBe(true);
  expect(
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  ).not.toContain("MiXeD");
});
test("inactive Source cannot normally register/reuse and is never reactivated automatically", async () => {
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Inactive Source B · B.Inactive",
    }),
  );
  expect(
    screen.getByText(
      "New/reused SourceRecord registration requires an active Source.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Register / reuse record" }),
  ).toBeDisabled();
  expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
});
test("malformed Record response cannot enter Observation workflow", async () => {
  overrides["POST /api/v1/admin/source-records"] = () =>
    reply({ recordKind: "SUPPLIER" });
  mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Protected Source A · A.Mixed_Source",
    }),
  );
  await userEvent.type(screen.getByLabelText("External record key"), "raw");
  await userEvent.click(
    screen.getByRole("button", { name: "Register / reuse record" }),
  );
  await screen.findByRole("heading", { name: "Service unavailable" });
  expect(screen.queryByLabelText("Observation key")).not.toBeInTheDocument();
});
test("UUID-only context keeps uncertainty visible and does not invent metadata", async () => {
  mount();
  await ready();
  await openKnown();
  await screen.findByText(
    "No observations returned. This read does not confirm whether the SourceRecord exists.",
  );
  expect(
    screen.getByText(
      "An empty observation result does not prove whether this SourceRecord exists.",
    ),
  ).toBeVisible();
  expect(
    gets(
      `/api/v1/admin/source-records/${rid}/observations`,
    )[0]!.url.searchParams.toString(),
  ).toBe("limit=25&offset=0");
  expect(
    screen.queryByRole("button", { name: /Search record/ }),
  ).not.toBeInTheDocument();
});
test("Observation create sends UTC timestamps, exact hash pair and explicit optional supersession", async () => {
  mount();
  await ready();
  await register();
  await fillObservation();
  fireEvent.change(screen.getByLabelText("Retrieved at (UTC, optional)"), {
    target: { value: "2026-10-21T13:00" },
  });
  await userEvent.type(
    screen.getByLabelText("Content hash (optional)"),
    "a".repeat(64),
  );
  await userEvent.type(
    screen.getByLabelText("Supersedes Observation UUID (optional)"),
    oid,
  );
  expect(screen.getByLabelText("Hash algorithm")).toHaveValue("SHA-256");
  expect(screen.getByLabelText("Hash algorithm")).toHaveAttribute("readonly");
  await userEvent.click(
    screen.getByRole("button", { name: "Register Observation" }),
  );
  await screen.findByText(/Observation registration confirmed/);
  expect(writes("/api/v1/admin/source-observations")[0]!.body).toEqual({
    sourceRecordId: rid,
    observationKey: "Draft-Key",
    observedAt: "2026-10-21T12:34:56.123Z",
    retrievedAt: "2026-10-21T13:00:00Z",
    contentHash: "a".repeat(64),
    hashAlgorithm: "SHA-256",
    supersedesObservationId: oid,
  });
  expect(
    gets(`/api/v1/admin/source-records/${rid}/observations`).length,
  ).toBeGreaterThan(1);
});
test("optional Observation fields stay absent and exact explicit retry may reuse a fact", async () => {
  mount();
  await ready();
  await register();
  await fillObservation();
  await userEvent.click(
    screen.getByRole("button", { name: "Register Observation" }),
  );
  await screen.findByText(/Observation registration confirmed/);
  expect(writes("/api/v1/admin/source-observations")[0]!.body).toEqual({
    sourceRecordId: rid,
    observationKey: "Draft-Key",
    observedAt: "2026-10-21T12:34:56.123Z",
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Register Observation" }),
  );
  await waitFor(() =>
    expect(writes("/api/v1/admin/source-observations")).toHaveLength(2),
  );
  expect(observations).toHaveLength(1);
});
test("Observation conflict has exact bounded copy, preserves draft and does not auto-retry", async () => {
  overrides["POST /api/v1/admin/source-observations"] = () => reply({}, 409);
  mount();
  await ready();
  await register();
  await fillObservation();
  await userEvent.click(
    screen.getByRole("button", { name: "Register Observation" }),
  );
  await screen.findByRole("heading", {
    name: "An Observation with this identity conflicts with the submitted facts.",
  });
  expect(
    screen.getByText(
      "An Observation with this identity exists but does not match the submitted facts, or another integrity conflict occurred.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("Observation key")).toHaveValue("Draft-Key");
  expect(writes("/api/v1/admin/source-observations")).toHaveLength(1);
});
test("ambiguous Observation read refresh highlights a visible identity match without claiming bounded absence proves failure", async () => {
  overrides["POST /api/v1/admin/source-observations"] = (call) => {
    observations = [
      { ...observed(), observationKey: String(call.body!.observationKey) },
    ];
    throw new TypeError("lost confirmation");
  };
  mount();
  await ready();
  await register();
  await fillObservation();
  await userEvent.click(
    screen.getByRole("button", { name: "Register Observation" }),
  );
  await screen.findByRole("heading", {
    name: "Observation registration outcome unknown",
  });
  await screen.findByText(
    "Visible identity match — compare the facts before any retry.",
  );
  expect(screen.getByLabelText("Observation key")).toHaveValue("Draft-Key");
  expect(writes("/api/v1/admin/source-observations")).toHaveLength(1);
  expect(
    screen.getByText(/Absence from this bounded history is not proof/),
  ).toBeVisible();
});
test.each(["ACCEPTED", "REJECTED", "NEEDS_REVIEW"])(
  "Review append %s omits optional fields and has no editable reviewer/idempotency",
  async (status) => {
    const cache = mount();
    await ready();
    await openReviews();
    await userEvent.selectOptions(
      screen.getByLabelText("Review status"),
      status,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Append review" }),
    );
    await screen.findByText(/Review appended\. Reference:/);
    const written = writes(
      `/api/v1/admin/source-observations/${oid}/reviews`,
    )[0]!;
    expect(written.body).toEqual({ reviewStatus: status });
    expect(written.request.headers.has("Idempotency-Key")).toBe(false);
    expect(
      cache
        .getMutationCache()
        .getAll()
        .every((m) => m.options.retry === false),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: /Edit Review|Delete Review/ }),
    ).not.toBeInTheDocument();
  },
);
test("explicit Review permission/notes are preserved and repeated submissions append twice", async () => {
  mount();
  await ready();
  await openReviews();
  await userEvent.selectOptions(
    screen.getByLabelText("License status (optional)"),
    "UNKNOWN",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Terms status (optional)"),
    "PERMITTED",
  );
  await userEvent.type(
    screen.getByLabelText("Review notes (optional)"),
    "Operator assessment",
  );
  await userEvent.click(screen.getByRole("button", { name: "Append review" }));
  await screen.findByText(/Review appended\. Reference:/);
  await userEvent.click(screen.getByRole("button", { name: "Append review" }));
  await waitFor(() => expect(reviews).toHaveLength(2));
  expect(
    writes(`/api/v1/admin/source-observations/${oid}/reviews`)[0]!.body,
  ).toEqual({
    reviewStatus: "NEEDS_REVIEW",
    licenseStatus: "UNKNOWN",
    termsStatus: "PERMITTED",
    notes: "Operator assessment",
  });
});
test("Review network ambiguity preserves draft, refetches history and never appends automatically", async () => {
  overrides[`POST /api/v1/admin/source-observations/${oid}/reviews`] = () => {
    reviews = [
      { id: oid, reviewStatus: "NEEDS_REVIEW", notes: "Preserved review" },
    ];
    throw new TypeError("lost confirmation");
  };
  mount();
  await ready();
  await openReviews();
  await userEvent.type(
    screen.getByLabelText("Review notes (optional)"),
    "Preserved review",
  );
  await userEvent.click(screen.getByRole("button", { name: "Append review" }));
  await screen.findByRole("heading", { name: "Review append outcome unknown" });
  expect(screen.getByLabelText("Review notes (optional)")).toHaveValue(
    "Preserved review",
  );
  expect(
    gets(`/api/v1/admin/source-observations/${oid}/reviews`).length,
  ).toBeGreaterThan(1);
  expect(
    writes(`/api/v1/admin/source-observations/${oid}/reviews`),
  ).toHaveLength(1);
});
test("AbortError is not displayed as an outcome-unknown warning", () => {
  render(
    <MutationFeedback
      error={new DOMException("cancelled", "AbortError")}
      noun="Source creation"
    />,
  );
  expect(screen.queryByText(/outcome unknown/)).not.toBeInTheDocument();
});
test("revocation removes protected data/cache/drafts, and regrant mounts an empty workflow", async () => {
  observations = [observed()];
  const cache = mount();
  await ready();
  await register();
  await userEvent.type(
    screen.getByLabelText("Observation key"),
    "Sensitive draft",
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Open Reviews for Existing-key",
    }),
  );
  await userEvent.type(
    screen.getByLabelText("Review notes (optional)"),
    "Sensitive review draft",
  );
  admin = false;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(
    screen.queryByRole("link", { name: "Curation" }),
  ).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("Protected Source A");
  expect(screen.queryByLabelText("Observation key")).not.toBeInTheDocument();
  expect(
    cache
      .getQueryCache()
      .findAll({ queryKey: queryKeys.admin(getSession().key) }),
  ).toHaveLength(0);
  expect(
    cache
      .getMutationCache()
      .findAll({ mutationKey: queryKeys.admin(getSession().key) }),
  ).toHaveLength(0);
  admin = true;
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: queryKeys.capabilities(getSession().key),
    });
  });
  await ready();
  expect(
    screen.queryByRole("heading", { name: "Current Record context" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("External record key")).toHaveValue("");
  expect(screen.queryByLabelText("Observation key")).not.toBeInTheDocument();
});
test("Actor switch aborts old reads and late results cannot repopulate the next admin's cache/context", async () => {
  const late = deferred<Response>();
  overrides[`GET /api/v1/admin/source-records/${rid}/observations`] = () =>
    late.promise;
  const cache = mount();
  await ready();
  await register();
  await userEvent.type(
    screen.getByLabelText("Observation key"),
    "Old Actor draft",
  );
  const oldScope = getSession().key,
    oldRead = gets(`/api/v1/admin/source-records/${rid}/observations`)[0]!
      .request;
  delete overrides[`GET /api/v1/admin/source-records/${rid}/observations`];
  await act(async () => setLocalSubject("admin-b"));
  await ready();
  expect(oldRead.signal.aborted).toBe(true);
  expect(screen.queryByLabelText("Observation key")).not.toBeInTheDocument();
  expect(screen.getByLabelText("External record key")).toHaveValue("");
  await act(async () =>
    late.resolve(
      reply([{ ...observed(), observationKey: "Late private Actor A fact" }]),
    ),
  );
  expect(document.body.textContent).not.toContain("Late private Actor A fact");
  expect(
    cache
      .getQueryCache()
      .findAll()
      .some((q) => q.queryKey.includes(oldScope)),
  ).toBe(false);
});

test("ordinary Source update refetches loaded offset pages without resetting their scope", async () => {
  sources.push(
    ...Array.from({ length: 25 }, (_, n) =>
      source(
        `50000000-0000-4000-8000-${String(n + 20).padStart(12, "0")}`,
        `Source ${n}`,
        `Code-${n}`,
      ),
    ),
  );
  const cache = mount();
  await ready();
  await userEvent.click(
    screen.getByRole("button", { name: "Load more sources" }),
  );
  await screen.findByText("27 sources loaded");
  await userEvent.click(
    screen.getByRole("button", {
      name: "Edit Source Protected Source A · A.Mixed_Source",
    }),
  );
  await userEvent.clear(screen.getByLabelText("Source name"));
  await userEvent.type(
    screen.getByLabelText("Source name"),
    "Updated loaded Source",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save Source" }));
  await screen.findByText(
    "Source updated. The current loaded pages and server version have been refreshed.",
  );
  expect(
    (
      cache.getQueryData(queryKeys.adminSources(getSession().key)) as {
        pageParams: number[];
      }
    ).pageParams,
  ).toEqual([0, 25]);
  expect(
    gets()
      .slice(-2)
      .map((c) => c.url.searchParams.get("offset")),
  ).toEqual(["0", "25"]);
  expect(screen.getByLabelText("Source name")).toHaveValue(
    "Updated loaded Source",
  );
});
test("invalid Source input blocks the command and connects feedback to its control", async () => {
  mount();
  await ready();
  await createDraft();
  await userEvent.clear(screen.getByLabelText("Base URL (optional)"));
  await userEvent.type(
    screen.getByLabelText("Base URL (optional)"),
    "https://@example.com/#",
  );
  await userEvent.click(screen.getByRole("button", { name: "Create Source" }));
  expect(
    await screen.findByText(
      "Enter an HTTP(S) URL without credentials or a fragment.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("Base URL (optional)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Base URL (optional)")).toHaveAttribute(
    "aria-describedby",
  );
  expect(writes("/api/v1/admin/sources")).toHaveLength(0);
});
test("Review notes beyond1000 are rejected before any append", async () => {
  mount();
  await ready();
  await openReviews();
  fireEvent.change(screen.getByLabelText("Review notes (optional)"), {
    target: { value: "n".repeat(1001) },
  });
  await userEvent.click(screen.getByRole("button", { name: "Append review" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Review notes (optional)")).toHaveAttribute(
      "aria-invalid",
      "true",
    ),
  );
  expect(
    writes(`/api/v1/admin/source-observations/${oid}/reviews`),
  ).toHaveLength(0);
});
test("selecting a Source cannot silently discard a UUID-only Record draft or relabel it", async () => {
  mount();
  await ready();
  await openKnown();
  await userEvent.type(
    screen.getByLabelText("Observation key"),
    "Unknown Record draft",
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Protected Source A · A.Mixed_Source",
    }),
  );
  expect(screen.getByLabelText("Observation key")).toHaveValue(
    "Unknown Record draft",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Keep current Source" }),
  );
  expect(screen.getByLabelText("Observation key")).toHaveValue(
    "Unknown Record draft",
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Select Source Protected Source A · A.Mixed_Source",
    }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change Source and clear context" }),
  );
  expect(screen.queryByLabelText("Observation key")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Known SourceRecord UUID")).toHaveValue("");
});
test.each(["actor switch", "revocation"])(
  "late command after %s cannot repopulate state or show outcome-unknown to the next workspace",
  async (transition) => {
    const late = deferred<Response>();
    overrides["POST /api/v1/admin/sources"] = () => late.promise;
    const cache = mount();
    await ready();
    await createDraft();
    await userEvent.click(
      screen.getByRole("button", { name: "Create Source" }),
    );
    await waitFor(() =>
      expect(writes("/api/v1/admin/sources")).toHaveLength(1),
    );
    const pendingRequest = writes("/api/v1/admin/sources")[0]!.request;
    if (transition === "actor switch")
      await act(async () => setLocalSubject("admin-b"));
    else {
      admin = false;
      await act(async () => {
        await cache.invalidateQueries({
          queryKey: queryKeys.capabilities(getSession().key),
        });
      });
      await screen.findByRole("heading", { name: "Access denied" });
      admin = true;
      await act(async () => {
        await cache.invalidateQueries({
          queryKey: queryKeys.capabilities(getSession().key),
        });
      });
    }
    await ready();
    expect(pendingRequest.signal.aborted).toBe(true);
    await act(async () => late.resolve(reply(createdId)));
    expect(screen.queryByLabelText("Source name")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Source created\.|outcome unknown/),
    ).not.toBeInTheDocument();
    expect(
      cache
        .getMutationCache()
        .findAll({ mutationKey: queryKeys.admin(getSession().key) }),
    ).toHaveLength(0);
  },
);
