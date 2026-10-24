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
  checkedRequirement,
  requirementSchema,
  requirementBody,
  requirementDraft,
  type Requirement,
} from "./requirementModel";
const stamp = "2026-10-23T00:00:00Z";
const initial = (): Requirement => ({
  styleId: "S",
  productType: "Recorded coat",
  targetQuantity: "0",
  quantityUnit: "PCS",
  targetCost: "0.0001",
  currency: "USD",
  targetDeliveryDate: "2000-02-29",
  notes: "Private planning notes",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "requirement-reference",
    },
  });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let cache: QueryClient,
  calls: Request[],
  value: Requirement | null,
  readStatus: number,
  writeStatus: number,
  role: string,
  parentArchived: boolean,
  styleArchived: boolean,
  styleStatus: number,
  readDelay: Promise<Response> | undefined,
  writeDelay: Promise<Response> | undefined;
beforeEach(() => {
  setAccessToken();
  calls = [];
  value = null;
  readStatus = writeStatus = styleStatus = 200;
  role = "ORG_OWNER";
  parentArchived = styleArchived = false;
  readDelay = writeDelay = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r);
      const p = new URL(r.url).pathname;
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
      if (p.endsWith("/development-references"))
        return reply({ items: [], limit: 25, offset: 0, hasMore: false });
      if (p.endsWith("/facility-candidates"))
        return reply({ items: [], limit: 25, offset: 0, hasMore: false });
      if (p.endsWith("/material-selections"))
        return reply({ items: [], limit: 25, offset: 0, hasMore: false });
      if (p.endsWith("/requirement")) {
        if (r.method === "PUT") {
          if (writeDelay) return writeDelay;
          if (writeStatus === 0) throw new TypeError("offline");
          if (writeStatus !== 200)
            return reply({ detail: "private unsafe body" }, writeStatus);
          const body = await r.clone().json();
          value = {
            ...initial(),
            ...body,
            version: r.headers.has("If-None-Match") ? 0 : body.version + 1,
          };
          return reply(value, r.headers.has("If-None-Match") ? 201 : 200);
        }
        if (p.includes("/A/") && readDelay) return readDelay;
        return readStatus !== 200
          ? reply({}, readStatus)
          : value
            ? reply(value)
            : reply({}, 404);
      }
      const org = p.includes("/B/") ? "B" : "A";
      if (p.endsWith("/styles/S"))
        return reply(
          {
            id: "S",
            projectId: "P",
            name: `Style ${org}`,
            styleCode: null,
            description: null,
            status: styleArchived ? "ARCHIVED" : "ACTIVE",
            version: 8,
            createdAt: stamp,
            updatedAt: stamp,
          },
          styleStatus,
        );
      if (p.endsWith("/projects/P"))
        return reply({
          id: "P",
          organizationId: org,
          name: `Project ${org}`,
          description: null,
          status: parentArchived ? "ARCHIVED" : "ACTIVE",
          version: 12,
          createdAt: stamp,
          updatedAt: stamp,
        });
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
function Navigation() {
  const n = useNavigate();
  return (
    <>
      <button onClick={() => n("/organizations/B/projects/P/styles/S")}>
        Go B
      </button>
      <button onClick={() => n("/organizations/A/projects/P/styles/S")}>
        Go A
      </button>
    </>
  );
}
function mount() {
  cache = createQueryClient();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/organizations/A/projects/P/styles/S"]}>
        <App />
        <Navigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const region = () =>
  within(screen.getByRole("region", { name: "Style Requirement" }));
const writes = () =>
  calls.filter((r) => r.method === "PUT" && r.url.endsWith("/requirement"));
const reads = () =>
  calls.filter((r) => r.method === "GET" && r.url.endsWith("/requirement"));
async function ready() {
  await screen.findByRole("heading", { name: "Style A" });
  await waitFor(() => expect(reads().length).toBeGreaterThan(0));
}
async function submit(label = "Create Requirement") {
  await userEvent.click(region().getByRole("button", { name: label }));
}

test("validated Style 404 is a normal absent sheet, no retry or page error", async () => {
  mount();
  await ready();
  await region().findByText(
    "No Requirement sheet has been created for this Style.",
  );
  expect(
    screen.queryByRole("heading", { name: "Not found" }),
  ).not.toBeInTheDocument();
  expect(reads()).toHaveLength(1);
  expect(
    region().getByRole("button", { name: "Create Requirement" }),
  ).toBeEnabled();
});
test.each([403, 500])(
  "Requirement %s remains an error, not absence",
  async (status) => {
    readStatus = status;
    mount();
    await ready();
    await screen.findByRole("heading", {
      name: status === 403 ? "Access denied" : "Service unavailable",
    });
    expect(
      screen.queryByText(
        "No Requirement sheet has been created for this Style.",
      ),
    ).not.toBeInTheDocument();
    expect(reads()).toHaveLength(1);
  },
);
test("Style hierarchy 404 prevents Requirement lookup", async () => {
  styleStatus = 404;
  mount();
  await screen.findByRole("heading", { name: "Not found" });
  expect(reads()).toHaveLength(0);
});
test.each(["0", "0.0001", "999999999999999.9999"])(
  "create transports exact strings %s, then update omits the header and uses own version",
  async (exact) => {
    mount();
    await ready();
    await region().findByLabelText("Target quantity");
    await userEvent.type(region().getByLabelText("Target quantity"), exact);
    await userEvent.type(region().getByLabelText("Target unit cost"), exact);
    await userEvent.type(region().getByLabelText("Currency"), "USD");
    await userEvent.selectOptions(
      region().getByLabelText("Quantity unit"),
      "SET",
    );
    await submit();
    await region().findByText("Requirement saved.");
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers.get("If-None-Match")).toBe("*");
    expect(await writes()[0].clone().json()).toMatchObject({
      targetQuantity: exact,
      targetCost: exact,
      version: 0,
      quantityUnit: "SET",
      currency: "USD",
      targetDeliveryDate: null,
    });
    await submit("Save Requirement");
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].headers.has("If-None-Match")).toBe(false);
    expect(await writes()[1].clone().json()).toMatchObject({
      version: 0,
      targetQuantity: exact,
    });
    await waitFor(() => expect(value?.version).toBe(1));
  },
);
test("existing empty sheet is not absence and replacement explicitly clears facts", async () => {
  value = initial();
  mount();
  await ready();
  await region().findByLabelText("Product type");
  for (const label of [
    "Product type",
    "Target quantity",
    "Target unit cost",
    "Currency",
    "Target delivery date",
    "Requirement notes",
  ])
    await userEvent.clear(region().getByLabelText(label));
  await userEvent.selectOptions(region().getByLabelText("Quantity unit"), "");
  await submit("Save Requirement");
  await region().findByText("Requirement saved.");
  expect(await writes()[0].clone().json()).toEqual({
    version: 0,
    productType: null,
    targetQuantity: null,
    targetCost: null,
    currency: null,
    quantityUnit: null,
    targetDeliveryDate: null,
    notes: null,
  });
  expect(
    region().queryByText(
      "No Requirement sheet has been created for this Style.",
    ),
  ).not.toBeInTheDocument();
});
test.each(["1e3", "-1", "1.00001"])(
  "invalid decimal %s cannot mutate",
  async (text) => {
    mount();
    await ready();
    await region().findByLabelText("Target quantity");
    await userEvent.type(region().getByLabelText("Target quantity"), text);
    await submit();
    expect(writes()).toHaveLength(0);
    expect(region().getAllByRole("alert").length).toBeGreaterThan(0);
  },
);
test("create 412 retains draft and reference, compares server and reconciles only explicitly", async () => {
  mount();
  await ready();
  await region().findByLabelText("Product type");
  await userEvent.type(region().getByLabelText("Product type"), "My coat");
  value = { ...initial(), productType: "Other writer", version: 4 };
  writeStatus = 412;
  await submit();
  await region().findByRole("heading", {
    name: "A Requirement already exists.",
  });
  await within(
    await region().findByRole("region", { name: "Current server Requirement" }),
  ).findByText("Other writer");
  expect(region().getByLabelText("Product type")).toHaveValue("My coat");
  expect(region().getByText("requirement-reference")).toBeVisible();
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    region().getByRole("button", { name: "Reconcile draft with existing" }),
  );
  expect(writes()).toHaveLength(1);
  writeStatus = 200;
  await submit("Save Requirement");
  await region().findByText("Requirement saved.");
  expect((await writes()[1].clone().json()).version).toBe(4);
  expect(writes()[1].headers.has("If-None-Match")).toBe(false);
});
test("409 preserves update draft and requires explicit reconciliation with latest Requirement version", async () => {
  value = initial();
  mount();
  await ready();
  await region().findByLabelText("Product type");
  await userEvent.clear(region().getByLabelText("Product type"));
  await userEvent.type(region().getByLabelText("Product type"), "My revision");
  value = { ...initial(), productType: "Server revision", version: 9 };
  writeStatus = 409;
  await submit("Save Requirement");
  await region().findByRole("region", { name: "Current server Requirement" });
  expect(region().getByLabelText("Product type")).toHaveValue("My revision");
  expect(writes()).toHaveLength(1);
  expect(
    calls.filter((r) => r.url.endsWith("/projects/P")).length,
  ).toBeGreaterThan(1);
  await userEvent.click(
    region().getByRole("button", { name: "Reconcile draft with existing" }),
  );
  writeStatus = 200;
  await submit("Save Requirement");
  await region().findByText("Requirement saved.");
  expect((await writes()[1].clone().json()).version).toBe(9);
});
test.each(["project", "style"])(
  "409 refreshes archived %s and makes retained draft read-only",
  async (parent) => {
    value = initial();
    mount();
    await ready();
    await region().findByLabelText("Product type");
    await userEvent.type(region().getByLabelText("Product type"), " draft");
    parentArchived = parent === "project";
    styleArchived = parent === "style";
    writeStatus = 409;
    await submit("Save Requirement");
    await region().findByText(/Requirement is read-only/);
    expect(region().getByLabelText("Product type")).toHaveAttribute("readonly");
    expect(
      region().queryByRole("button", { name: "Save Requirement" }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  },
);
test("update 404 never implicitly creates; explicit mode change still does not submit", async () => {
  value = initial();
  mount();
  await ready();
  await region().findByLabelText("Product type");
  value = null;
  writeStatus = 404;
  await submit("Save Requirement");
  await region().findByRole("button", { name: "Create from this draft" });
  expect(writes()).toHaveLength(1);
  await userEvent.click(
    region().getByRole("button", { name: "Create from this draft" }),
  );
  expect(writes()).toHaveLength(1);
  writeStatus = 200;
  await submit();
  await region().findByText("Requirement saved.");
  expect(writes()[1].headers.get("If-None-Match")).toBe("*");
  expect((await writes()[1].clone().json()).version).toBe(0);
});
test("network ambiguity preserves draft and refreshes without a second PUT", async () => {
  mount();
  await ready();
  await region().findByLabelText("Product type");
  await userEvent.type(
    region().getByLabelText("Product type"),
    "Uncertain draft",
  );
  writeStatus = 0;
  await submit();
  await region().findByText(/Save outcome unknown/);
  expect(region().getByLabelText("Product type")).toHaveValue(
    "Uncertain draft",
  );
  expect(writes()).toHaveLength(1);
  expect(reads().length).toBeGreaterThan(1);
});
test.each([false, true])(
  "VIEWER existing=%s reads without functional mutation or reconciliation controls",
  async (exists) => {
    role = "VIEWER";
    value = exists ? initial() : null;
    styleArchived = exists;
    mount();
    await ready();
    await region().findByText(
      "Requirement access is read-only for your VIEWER membership.",
    );
    expect(region().queryByRole("textbox")).not.toBeInTheDocument();
    expect(region().queryByRole("button")).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  },
);
test("PLATFORM_ADMIN without membership cannot query Requirement", async () => {
  role = "NONE";
  mount();
  await screen.findByRole("heading", { name: "Access denied" });
  expect(reads()).toHaveLength(0);
});
test.each(["read", "412", "mutation"])(
  "old Organization %s completion cannot cross A→B→A generation; global Supply cache survives",
  async (kind) => {
    const pending = deferred<Response>();
    if (kind === "read") readDelay = pending.promise;
    mount();
    await ready();
    const scope = getSession().key,
      supply = queryKeys.material(scope, "global-material");
    cache.setQueryData(supply, { label: "Shared catalog" });
    if (kind !== "read") {
      await region().findByLabelText("Product type");
      await userEvent.type(
        region().getByLabelText("Product type"),
        "Old A draft",
      );
      writeDelay = pending.promise;
      await submit();
      await waitFor(() => expect(writes()).toHaveLength(1));
    }
    readDelay = undefined;
    await userEvent.click(screen.getByRole("button", { name: "Go B" }));
    await screen.findByRole("heading", { name: "Style B" });
    await userEvent.click(screen.getByRole("button", { name: "Go A" }));
    await screen.findByRole("heading", { name: "Style A" });
    await region().findByLabelText("Product type");
    await act(async () =>
      pending.resolve(reply(initial(), kind === "412" ? 412 : 200)),
    );
    expect(region().getByLabelText("Product type")).toHaveValue("");
    expect(
      region().queryByRole("region", { name: "Requirement conflict" }),
    ).not.toBeInTheDocument();
    expect(cache.getQueryData(supply)).toEqual({ label: "Shared catalog" });
  },
);
test("Actor change aborts and discards Requirement draft and late completion", async () => {
  mount();
  await ready();
  await region().findByLabelText("Product type");
  await userEvent.type(
    region().getByLabelText("Product type"),
    "Actor A draft",
  );
  const pending = deferred<Response>();
  writeDelay = pending.promise;
  await submit();
  const request = writes()[0];
  await act(async () => {
    setLocalSubject("actor-b");
  });
  await waitFor(() => expect(request.signal.aborted).toBe(true));
  await act(async () => pending.resolve(reply(initial(), 201)));
  await screen.findByRole("heading", { name: "Style A" });
  await region().findByLabelText("Product type");
  expect(region().getByLabelText("Product type")).toHaveValue("");
  expect(screen.queryByText(/Save outcome unknown/)).not.toBeInTheDocument();
});
test.each([
  { version: undefined },
  { version: -1 },
  { version: Number.MAX_SAFE_INTEGER + 1 },
  { styleId: "foreign" },
  { targetQuantity: 1 },
  { quantityUnit: "KG" },
  { currency: "usd" },
  { targetCost: null, currency: "USD" },
  { createdAt: null },
  { targetDeliveryDate: "2026-02-30" },
  { notes: undefined },
])("malformed response blocks mutation %#", async (patch) => {
  value = { ...initial(), ...patch } as Requirement;
  mount();
  await ready();
  await region().findByRole("heading", { name: "Service unavailable" });
  expect(
    region().queryByRole("button", {
      name: /Create Requirement|Save Requirement/,
    }),
  ).not.toBeInTheDocument();
});
test.each(["PCS", "SET"])(
  "unit %s may exist alone and optional blank facts serialize null",
  (unit) => {
    const d = {
      ...requirementDraft(null),
      quantityUnit: unit as "PCS" | "SET",
    };
    expect(requirementSchema.safeParse(d).success).toBe(true);
    expect(requirementBody(d, 0)).toMatchObject({
      quantityUnit: unit,
      targetQuantity: null,
      targetCost: null,
    });
  },
);
test.each([
  { targetQuantity: "1" },
  { targetCost: "1", currency: "USD" },
  { currency: "USD" },
  { targetCost: "1", quantityUnit: "PCS" },
  { currency: "XXX", targetCost: "1", quantityUnit: "PCS" },
  { targetDeliveryDate: "2026-02-30" },
  { notes: "x".repeat(4001) },
  { productType: "x".repeat(161) },
])("invalid form relationships rejected %#", (patch) => {
  expect(
    requirementSchema.safeParse({ ...requirementDraft(null), ...patch })
      .success,
  ).toBe(false);
});
test("past date, empty response, safe version and exact zero remain coherent", () => {
  expect(checkedRequirement(initial(), "S")).toEqual(initial());
  expect(
    requirementSchema.safeParse({
      ...requirementDraft(null),
      targetDeliveryDate: "2000-02-29",
    }).success,
  ).toBe(true);
  expect(() =>
    checkedRequirement(undefined as unknown as Requirement, "S"),
  ).toThrow();
});

test("412 comparison refetch completing after ABA cannot restore the discarded create draft", async () => {
  mount();
  await ready();
  await region().findByLabelText("Product type");
  await userEvent.type(
    region().getByLabelText("Product type"),
    "Discarded A conflict draft",
  );
  value = initial();
  writeStatus = 412;
  const pending = deferred<Response>();
  readDelay = pending.promise;
  await submit();
  await region().findByRole("heading", {
    name: "A Requirement already exists.",
  });
  await waitFor(() => expect(reads()).toHaveLength(2));
  const oldRefetch = reads()[1];
  readDelay = undefined;
  await userEvent.click(screen.getByRole("button", { name: "Go B" }));
  await screen.findByRole("heading", { name: "Style B" });
  await userEvent.click(screen.getByRole("button", { name: "Go A" }));
  await screen.findByRole("heading", { name: "Style A" });
  await region().findByLabelText("Product type");
  await act(async () =>
    pending.resolve(reply({ ...initial(), productType: "Late comparison" })),
  );
  expect(oldRefetch.signal.aborted).toBe(true);
  expect(region().getByLabelText("Product type")).toHaveValue("Recorded coat");
  expect(region().queryByText("Late comparison")).not.toBeInTheDocument();
  expect(
    region().queryByRole("region", { name: "Requirement conflict" }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});
test("Requirement mutations explicitly disable retries and success refreshes only its exact key", async () => {
  mount();
  await ready();
  await region().findByLabelText("Product type");
  const scope = getSession().key;
  const other = queryKeys.requirement(scope, "B", "P", "S");
  const supply = queryKeys.material(scope, "global");
  cache.setQueryData(other, "Other tenant sentinel");
  cache.setQueryData(supply, "Catalog sentinel");
  const pReads = calls.filter((r) => r.url.endsWith("/projects/P")).length;
  const sReads = calls.filter((r) => r.url.endsWith("/styles/S")).length;
  await submit();
  await region().findByText("Requirement saved.");
  expect(
    cache
      .getMutationCache()
      .getAll()
      .filter((m) => m.options.mutationKey?.includes("requirement"))
      .every((m) => m.options.retry === false),
  ).toBe(true);
  expect(cache.getQueryData(other)).toBe("Other tenant sentinel");
  expect(cache.getQueryData(supply)).toBe("Catalog sentinel");
  expect(calls.filter((r) => r.url.endsWith("/projects/P"))).toHaveLength(
    pReads,
  );
  expect(calls.filter((r) => r.url.endsWith("/styles/S"))).toHaveLength(sReads);
  expect(reads()).toHaveLength(2);
});
