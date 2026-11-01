import { test, expect, vi, afterEach } from "vitest";
import {
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import {
  fixture,
  inboxRoute,
  sourceRoute,
  consentRoute,
  A,
  B,
  id,
  grant,
  consent,
  response,
} from "../../test/patternReleaseFixture";
import { deferred } from "../../test/measurementFixture";
import { setLocalSubject } from "../../api/session";
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const path = (value: string) => "/api/v1" + value;
const releaseCalls = (h: ReturnType<typeof fixture>) =>
  h.calls.filter((r) =>
    /\/(?:releases|received-pattern-releases|release-consents)(?:\/|$)/.test(
      new URL(r.url).pathname,
    ),
  );
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
  originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalCreate)
    Object.defineProperty(URL, "createObjectURL", originalCreate);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevoke)
    Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});
function binarySpies() {
  const create = vi.fn(() => "blob:release-test"),
    revoke = vi.fn(),
    clicked: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revoke,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.download);
  });
  return { create, revoke, clicked };
}
async function openSource(h: ReturnType<typeof fixture>) {
  h.mount(sourceRoute());
  await screen.findByRole("heading", {
    name: "Release receipts for this revision",
  });
  await screen.findByRole("button", { name: new RegExp(id(600)) });
}
async function prepare(h: ReturnType<typeof fixture>) {
  await openSource(h);
  click("Prepare exact release");
  await screen.findByText(/Private B exact.pdf · PDF · 3 bytes · READY/);
  fireEvent.change(screen.getByLabelText("Recipient-issued consent ID"), {
    target: { value: id(602) },
  });
  fireEvent.change(screen.getByLabelText("Purpose shared with recipient"), {
    target: { value: "Explicit outbound review" },
  });
  fireEvent.click(screen.getByLabelText(/I verified this consent/));
}
test("inbox entry reads one scoped projection and never source hierarchy, consent or binary", async () => {
  const h = fixture();
  h.mount();
  await screen.findByText(/Private B exact.pdf · ACTIVE/);
  expect(releaseCalls(h)).toHaveLength(1);
  expect(releaseCalls(h)[0].url).toContain(path(inboxRoute()));
  expect(
    h.calls.some(
      (r) => r.url.includes("/projects/") || r.url.endsWith("/content"),
    ),
  ).toBe(false);
});
test.each(["ORG_OWNER", "ORG_ADMIN", "VIEWER"])(
  "recipient %s downloads only after explicit action and revokes Blob URL",
  async (role) => {
    const h = fixture(),
      binary = binarySpies();
    h.role = role;
    h.mount(inboxRoute() + "/" + id(600));
    await screen.findByRole("button", { name: "Download exact artifact" });
    expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(0);
    click("Download exact artifact");
    await waitFor(() => expect(binary.create).toHaveBeenCalledTimes(1));
    expect(binary.revoke).toHaveBeenCalledWith("blob:release-test");
    expect(binary.clicked).toEqual([grant().displayName]);
    expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(1);
    expect(h.calls.some((r) => r.url.includes("/projects/"))).toBe(false);
  },
);
test("VIEWER cannot open consent administration and makes zero consent calls", async () => {
  const h = fixture();
  h.role = "VIEWER";
  h.mount(consentRoute());
  await screen.findByText(
    "Only Organization Owners and Admins may administer consents.",
  );
  expect(releaseCalls(h)).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Issue consent" })).toBeNull();
});
test("recipient issues source-bound consent, receives exact durable identity and withdraws", async () => {
  const h = fixture();
  h.mount(consentRoute());
  await screen.findByRole("heading", { name: "Issue a single-use consent" });
  fireEvent.change(screen.getByLabelText("Intended source Organization UUID"), {
    target: { value: A },
  });
  click("Issue consent");
  await screen.findByRole("heading", { name: "Exact consent" });
  const writes = releaseCalls(h).filter((r) => r.method === "POST");
  expect(writes).toHaveLength(1);
  expect(await writes[0].clone().json()).toEqual({ sourceOrganizationId: A });
  fireEvent.click(
    await screen.findByLabelText(/I understand withdrawal is permanent/),
  );
  click("Withdraw consent permanently");
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Exact consent" }),
    ).toHaveTextContent("WITHDRAWN"),
  );
  expect(releaseCalls(h).filter((r) => r.method === "POST")).toHaveLength(2);
});
test("no membership prevents protected release queries", async () => {
  const h = fixture();
  h.member = false;
  h.mount();
  await screen.findByRole("heading", { name: "Access denied" });
  expect(releaseCalls(h)).toHaveLength(0);
});
test("source entry keeps lazy artifact, history and content request budget", async () => {
  const h = fixture();
  await openSource(h);
  expect(releaseCalls(h)).toHaveLength(1);
  expect(
    h.calls.some(
      (r) =>
        r.url.endsWith("/artifact") ||
        r.url.endsWith("/content") ||
        r.url.includes("/events") ||
        r.url.includes("/qa"),
    ),
  ).toBe(false);
});
test.each(["VIEWER", "ARCHIVED"])(
  "source %s cannot prepare a release",
  async (boundary) => {
    const h = fixture();
    if (boundary === "VIEWER") h.role = "VIEWER";
    else h.projectStatus = "ARCHIVED";
    await openSource(h);
    expect(
      screen.queryByRole("button", { name: "Prepare exact release" }),
    ).toBeNull();
    expect(h.calls.some((r) => r.url.endsWith("/artifact"))).toBe(false);
  },
);
test("source explicitly creates one exact READY release with server-owned recipient and integrity", async () => {
  const h = fixture();
  await prepare(h);
  click("Create release");
  await screen.findByRole("heading", { name: "Exact release receipt" });
  const writes = releaseCalls(h).filter((r) => r.method === "POST");
  expect(writes).toHaveLength(1);
  expect(await writes[0].clone().json()).toEqual({
    consentId: id(602),
    expectedLatestConsentEventNumber: 1,
    purpose: "Explicit outbound review",
    accessDurationSeconds: 86400,
  });
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Source release detail" }),
    ).toHaveTextContent("Explicit outbound review"),
  );
});
test("ambiguous creation retains draft, never retries and requires explicit reconciliation", async () => {
  const h = fixture();
  h.overrides.set("POST " + path(sourceRoute()), () => {
    throw new TypeError("synthetic transport loss");
  });
  await prepare(h);
  click("Create release");
  await screen.findByRole("region", { name: "Reconcile uncertain outcome" });
  expect(screen.getByLabelText("Purpose shared with recipient")).toHaveValue(
    "Explicit outbound review",
  );
  expect(screen.getByLabelText("Recipient-issued consent ID")).toHaveValue(
    id(602),
  );
  expect(screen.getByRole("button", { name: "Create release" })).toBeDisabled();
  await act(async () => {
    await h.cache.refetchQueries();
  });
  expect(releaseCalls(h).filter((r) => r.method === "POST")).toHaveLength(1);
  click("Refresh authoritative state");
  await screen.findByRole("button", {
    name: "I reviewed the records; allow a new submission",
  });
  click("I reviewed the records; allow a new submission");
  expect(screen.getByRole("button", { name: "Create release" })).toBeEnabled();
  expect(releaseCalls(h).filter((r) => r.method === "POST")).toHaveLength(1);
});
test("current source refresh preserves open event head until deliberate close and reopen", async () => {
  const h = fixture();
  await openSource(h);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(id(600)) }));
  await screen.findByRole("heading", { name: "Exact release receipt" });
  fireEvent.click(
    await screen.findByRole("button", { name: "Open release events" }),
  );
  await screen.findByRole("heading", { name: "Release events through 1" });
  await waitFor(() =>
    expect(h.calls.filter((r) => r.url.includes("/events"))).toHaveLength(1),
  );
  const v = h.sources.get(id(600))!;
  v.latestEventNumber = 2;
  v.lifecycle = "REVOKED";
  v.effectiveState = "REVOKED";
  await act(async () => {
    await h.cache.refetchQueries({
      predicate: (q) =>
        q.queryKey.includes("release") &&
        q.queryKey.includes(id(600)) &&
        !q.queryKey.includes("events"),
    });
  });
  expect(
    screen.getByRole("heading", { name: "Release events through 1" }),
  ).toBeVisible();
  expect(
    h.calls
      .filter((r) => r.url.includes("/events"))
      .map((r) => new URL(r.url).searchParams.get("maxEventNumber")),
  ).toEqual(["1"]);
  click("Close release events");
  click("Open release events");
  await screen.findByRole("heading", { name: "Release events through 2" });
  await waitFor(() =>
    expect(
      h.calls
        .filter((r) => r.url.includes("/events"))
        .map((r) => new URL(r.url).searchParams.get("maxEventNumber")),
    ).toEqual(["1", "2"]),
  );
});
test.each([200, 403])(
  "old-generation late %s cannot populate or deny a new recipient workspace",
  async (status) => {
    const h = fixture(),
      late = deferred<Response>();
    h.overrides.set("GET " + path(inboxRoute(A)), () => late.promise);
    h.mount(inboxRoute(A));
    await waitFor(() => expect(releaseCalls(h)).toHaveLength(1));
    click("Inbox B");
    await screen.findByText(/Private B exact.pdf · ACTIVE/);
    await act(async () =>
      late.resolve(
        response(
          status === 200
            ? { items: [grant(A)], limit: 25, nextCursor: null }
            : {},
          status,
        ),
      ),
    );
    expect(screen.queryByText(/Private A exact.pdf/)).toBeNull();
    expect(screen.getByText(/Private B exact.pdf · ACTIVE/)).toBeVisible();
  },
);
test("ABA uses fresh generation rather than accepting first A response", async () => {
  const h = fixture(),
    late = deferred<Response>();
  let first = true;
  h.overrides.set("GET " + path(inboxRoute(A)), () => {
    if (first) {
      first = false;
      return late.promise;
    }
    return response({
      items: [{ ...grant(A), displayName: "Fresh A exact.pdf" }],
      limit: 25,
      nextCursor: null,
    });
  });
  h.mount(inboxRoute(A));
  await waitFor(() => expect(releaseCalls(h)).toHaveLength(1));
  click("Inbox B");
  await screen.findByText(/Private B exact.pdf/);
  click("Inbox A");
  await screen.findByText(/Fresh A exact.pdf/);
  await act(async () =>
    late.resolve(response({ items: [grant(A)], limit: 25, nextCursor: null })),
  );
  expect(screen.queryByText(/Private A exact.pdf/)).toBeNull();
  expect(screen.getByText(/Fresh A exact.pdf/)).toBeVisible();
});
test("current-generation 403 removes private receipt and enforces workspace denial", async () => {
  const h = fixture();
  h.mount(inboxRoute() + "/" + id(600));
  await screen.findByRole("button", { name: "Download exact artifact" });
  h.overrides.set("GET " + path(inboxRoute()) + "/" + id(600), () =>
    response({}, 403),
  );
  await act(async () => {
    await h.cache.refetchQueries({
      predicate: (q) => q.queryKey.includes("received"),
    });
  });
  await screen.findByRole("heading", { name: "Access denied" });
  expect(screen.queryByText(grant().purpose)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Download exact artifact" }),
  ).toBeNull();
});
test.each(["organization", "actor", "cancel"])(
  "late binary after %s invalidation creates no Blob or click",
  async (change) => {
    const h = fixture(),
      late = deferred<Response>(),
      binary = binarySpies();
    h.overrides.set(
      "GET " + path(inboxRoute()) + "/" + id(600) + "/content",
      () => late.promise,
    );
    h.mount(inboxRoute() + "/" + id(600));
    await screen.findByRole("button", { name: "Download exact artifact" });
    click("Download exact artifact");
    await screen.findByRole("button", { name: "Cancel download" });
    if (change === "organization") {
      click("Inbox A");
      await screen.findByText(/Private A exact.pdf/);
    } else if (change === "actor") {
      await act(async () => setLocalSubject("new-actor"));
      await waitFor(() =>
        expect(
          h.calls.filter((r) => new URL(r.url).pathname === "/api/identity"),
        ).toHaveLength(2),
      );
    } else click("Cancel download");
    await act(async () =>
      late.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "application/octet-stream" },
        }),
      ),
    );
    expect(binary.create).not.toHaveBeenCalled();
    expect(binary.clicked).toEqual([]);
  },
);
test.each(["size", "type", "status"])(
  "malformed successful binary %s is denied without a Blob",
  async (kind) => {
    const h = fixture(),
      binary = binarySpies();
    h.overrides.set(
      "GET " + path(inboxRoute()) + "/" + id(600) + "/content",
      () =>
        new Response(new Uint8Array(kind === "size" ? [1] : [1, 2, 3]), {
          status: kind === "status" ? 206 : 200,
          headers: {
            "Content-Type":
              kind === "type" ? "text/html" : "application/octet-stream",
          },
        }),
    );
    h.mount(inboxRoute() + "/" + id(600));
    await screen.findByRole("button", { name: "Download exact artifact" });
    click("Download exact artifact");
    await screen.findByRole("alert");
    expect(binary.create).not.toHaveBeenCalled();
  },
);
test("cached exact detail remains bound to first trusted immutable receipt", async () => {
  const h = fixture();
  h.mount(inboxRoute() + "/" + id(600));
  await screen.findByRole("button", { name: "Download exact artifact" });
  const key = h.cache
    .getQueryCache()
    .findAll()
    .find(
      (q) => q.queryKey.includes("received") && q.queryKey.includes(id(600)),
    )!.queryKey;
  act(() =>
    h.cache.setQueryData(key, {
      ...grant(),
      purpose: "Contradictory cached purpose",
    }),
  );
  await screen.findByRole("alert");
  expect(screen.queryByText("Contradictory cached purpose")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Download exact artifact" }),
  ).not.toBeEnabled();
});

test.each([
  "foreign release",
  "above pinned head",
  "invalid timestamp",
  "duplicate event",
])(
  "cached release events reject %s without replacing pinned history",
  async (fault) => {
    const h = fixture();
    await openSource(h);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(id(600)) }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open release events" }),
    );
    await screen.findByRole("heading", { name: "Release events through 1" });
    await waitFor(() =>
      expect(
        h.cache
          .getQueryCache()
          .findAll()
          .filter((q) => q.queryKey.includes("events") && q.state.data),
      ).toHaveLength(1),
    );
    const query = h.cache
      .getQueryCache()
      .findAll()
      .find((q) => q.queryKey.includes("events"))!;
    const good = query.state.data as {
      items: {
        id: string;
        releaseId: string;
        eventNumber: number;
        kind: string;
        occurredAt: string;
      }[];
      limit: number;
      nextMaxEventNumber: number | null;
    };
    const event = { ...good.items[0] };
    if (fault === "foreign release") event.releaseId = id(998);
    if (fault === "above pinned head") {
      event.eventNumber = 2;
      event.kind = "REVOKED";
    }
    if (fault === "invalid timestamp")
      event.occurredAt = "FOREIGN-CACHED-INVALID-TIMESTAMP";
    const bad = {
      ...good,
      items: fault === "duplicate event" ? [event, event] : [event],
    };
    await act(async () => {
      h.cache.setQueryData(query.queryKey, bad);
    });
    await screen.findByRole("alert");
    expect(
      screen.getByRole("heading", { name: "Release events through 1" }),
    ).toBeVisible();
    expect(screen.queryByText(/FOREIGN-CACHED-INVALID-TIMESTAMP/)).toBeNull();
    expect(screen.queryByText(/2 · REVOKED/)).toBeNull();
    expect(releaseCalls(h).filter((r) => r.method === "POST")).toHaveLength(0);
  },
);

test.each(["inbox", "consents", "source"])(
  "cached %s collection rejects a foreign Organization before rendering",
  async (kind) => {
    const h = fixture();
    if (kind === "source") await openSource(h);
    else {
      h.mount(kind === "inbox" ? inboxRoute() : consentRoute());
      if (kind === "inbox")
        await screen.findByText(/Private B exact.pdf · ACTIVE/);
      else await screen.findByRole("button", { name: new RegExp(id(602)) });
    }
    const query = h.cache
      .getQueryCache()
      .findAll()
      .find((q) =>
        kind === "source"
          ? q.queryKey.includes("source") &&
            !q.queryKey.includes("release") &&
            q.state.data
          : q.queryKey.includes(kind) && q.state.data,
      )!;
    const good = query.state.data as {
      items: Record<string, unknown>[];
      limit: number;
      nextCursor: string | null;
    };
    const foreign = { ...good.items[0] };
    if (kind === "source") foreign.sourceOrganizationId = B;
    else foreign.recipientOrganizationId = A;
    if (kind !== "consents") foreign.displayName = "FOREIGN-CACHED-COLLECTION";
    await act(async () => {
      h.cache.setQueryData(query.queryKey, { ...good, items: [foreign] });
    });
    await screen.findByRole("alert");
    expect(screen.queryByText(/FOREIGN-CACHED-COLLECTION/)).toBeNull();
  },
);

test("cached exact artifact cannot substitute a foreign revision or authorize submission", async () => {
  const h = fixture();
  await prepare(h);
  const query = h.cache
    .getQueryCache()
    .findAll()
    .find((q) => q.queryKey.includes("artifact") && q.state.data)!;
  await act(async () => {
    h.cache.setQueryData(query.queryKey, {
      ...(query.state.data as Record<string, unknown>),
      patternRevisionId: id(998),
      displayName: "FOREIGN-CACHED-ARTIFACT.pdf",
    });
  });
  await screen.findByRole("alert");
  expect(screen.queryByText(/FOREIGN-CACHED-ARTIFACT/)).toBeNull();
  expect(screen.getByRole("button", { name: "Create release" })).toBeDisabled();
});
