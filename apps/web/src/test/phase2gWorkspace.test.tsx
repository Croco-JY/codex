import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test, expect, vi } from "vitest";
import { endSession, getSession, setLocalSubject } from "../api/session";
import { queryKeys } from "../api/queryKeys";
import {
  A,
  B,
  P,
  S,
  M,
  L,
  F,
  U,
  base,
  children,
  regions,
  fixture,
  ready,
  response,
  deferred,
  type Child,
} from "./phase2gWorkspace";
afterEach(() => {
  cleanup();
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const supplyKeys = (scope: string) => [
  queryKeys.material(scope, M),
  queryKeys.facility(scope, F),
  queryKeys.supplier(scope, U),
  queryKeys.listing(scope, L),
];
const privateKeys = (h: ReturnType<typeof fixture>, org = A) =>
  h.cache
    .getQueryCache()
    .findAll({ queryKey: queryKeys.workspace(h.scope, org) });
const suffix = (r: Request) => new URL(r.url).pathname;

test("strict real component hierarchy has one exact read per Style sibling, then bounded deduplicated canonical hydration", async () => {
  const h = fixture();
  h.mount();
  await ready();
  await screen.findByText(/Synthetic global Supplier · ACTIVE/);
  const reads = h.privateReads().map(suffix);
  expect(reads.slice(0, 2)).toEqual([
    `/api/v1/organizations/${A}/projects/${P}`,
    base(),
  ]);
  expect(reads.slice(2).sort()).toEqual(
    children.map((c) => base() + "/" + c).sort(),
  );
  for (const key of supplyKeys(h.scope))
    expect(h.cache.getQueryData(key)).toBeDefined();
  expect(
    h.calls.filter((r) => /\/facilities\/.+\/capabilities$/.test(suffix(r))),
  ).toHaveLength(0);
  expect(
    h.calls.filter((r) => /development-references\//.test(suffix(r))),
  ).toHaveLength(0);
});

for (const child of children)
  test(`current-generation ${child} 403 denies the entire workspace and removes all private queries/mutations`, async () => {
    const h = fixture(),
      hold = deferred<Response>();
    h.overrides.set(`GET ${base()}/${child}`, () => hold.promise);
    h.mount();
    await screen.findByRole("heading", { name: "Cumulative Style", level: 1 });
    for (let n = 0; n < children.length; n++)
      if (children[n] !== child)
        await screen.findByRole("region", { name: regions[n] });
    await waitFor(() =>
      expect(
        h.privateReads().filter((r) => suffix(r) === base() + "/" + child),
      ).toHaveLength(1),
    );
    // A representative conflicted private mutation must be purged with the denied generation.
    h.cache
      .getMutationCache()
      .build(h.cache, {
        mutationKey: [
          ...queryKeys.style(h.scope, A, P, S),
          "synthetic-test-command",
        ],
        retry: false,
      });
    await act(async () => hold.resolve(response({}, 403)));
    await screen.findByRole("heading", { name: "Access denied", level: 1 });
    for (const name of regions)
      expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
    expect(privateKeys(h)).toHaveLength(0);
    expect(
      h.cache
        .getMutationCache()
        .findAll({ mutationKey: queryKeys.workspace(h.scope, A) }),
    ).toHaveLength(0);
    expect(h.writes()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Save Requirement" }),
    ).not.toBeInTheDocument();
  });

for (const child of children)
  test(`single ${child} 500 remains section-local with three usable successful siblings`, async () => {
    const h = fixture();
    h.overrides.set(`GET ${base()}/${child}`, () => response({}, 500));
    h.mount();
    await ready();
    const index = children.indexOf(child);
    await within(
      screen.getByRole("region", { name: regions[index] }),
    ).findByRole("heading", { name: "Service unavailable" });
    for (let n = 0; n < children.length; n++)
      if (n !== index) {
        const s = within(screen.getByRole("region", { name: regions[n] }));
        expect(
          s.queryByRole("heading", { name: "Service unavailable" }),
        ).not.toBeInTheDocument();
      }
    expect(
      h.privateReads().filter((r) => suffix(r) === base() + "/" + child),
    ).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Cumulative Style", level: 1 }),
    ).toBeVisible();
  });

test("same-Actor Organization switch purges private state but reuses four warmed Supply records", async () => {
  const h = fixture();
  h.mount();
  await ready();
  await screen.findByText(/Synthetic global Supplier · ACTIVE/);
  const warm = supplyKeys(h.scope).map((key) => h.cache.getQueryData(key));
  expect(warm.every(Boolean)).toBe(true);
  const canonical = h.calls.filter((r) =>
    /^\/api\/v1\/(materials|material-variants|material-listings|facilities|suppliers)\//.test(
      suffix(r),
    ),
  ).length;
  h.cache
    .getMutationCache()
    .build(h.cache, {
      mutationKey: [...queryKeys.style(h.scope, A, P, S), "test-conflict"],
      retry: false,
    });
  await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
  await ready();
  expect(privateKeys(h, A)).toHaveLength(0);
  expect(privateKeys(h, B).length).toBeGreaterThan(0);
  expect(
    h.cache
      .getMutationCache()
      .findAll({ mutationKey: queryKeys.workspace(h.scope, A) }),
  ).toHaveLength(0);
  expect(supplyKeys(h.scope).map((key) => h.cache.getQueryData(key))).toEqual(
    warm,
  );
  expect(
    h.calls.filter((r) =>
      /^\/api\/v1\/(materials|material-variants|material-listings|facilities|suppliers)\//.test(
        suffix(r),
      ),
    ),
  ).toHaveLength(canonical);
});

test("Actor reset synchronously purges old Supply/workspace/mutation scopes before fresh reads", async () => {
  const h = fixture();
  h.mount();
  await ready();
  await screen.findByText(/Synthetic global Supplier · ACTIVE/);
  h.cache
    .getMutationCache()
    .build(h.cache, {
      mutationKey: [...queryKeys.style(h.scope, A, P, S), "test-conflict"],
      retry: false,
    });
  await act(async () => setLocalSubject("cumulative-actor-b"));
  await ready();
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
      .findAll()
      .filter((m) => m.options.mutationKey?.[1] === h.scope),
  ).toHaveLength(0);
});

for (const child of children)
  test(`late old-generation ${child} 403 cannot deny replacement B or fresh ABA generation`, async () => {
    const h = fixture(),
      hold = deferred<Response>();
    h.overrides.set(`GET ${base()}/${child}`, () => hold.promise);
    h.mount();
    await screen.findByRole("heading", { name: "Cumulative Style", level: 1 });
    await waitFor(() =>
      expect(
        h.privateReads().filter((r) => suffix(r) === base() + "/" + child),
      ).toHaveLength(1),
    );
    const old = h
      .privateReads()
      .find((r) => suffix(r) === base() + "/" + child)!;
    await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
    await ready();
    expect(old.signal.aborted).toBe(true);
    h.overrides.delete(`GET ${base()}/${child}`);
    await userEvent.click(screen.getByRole("button", { name: "Enter A" }));
    await ready();
    const count = h.calls.length;
    await act(async () => hold.resolve(response({}, 403)));
    expect(h.calls).toHaveLength(count);
    expect(
      screen.queryByRole("heading", { name: "Access denied", level: 1 }),
    ).not.toBeInTheDocument();
    for (const name of regions)
      expect(screen.getByRole("region", { name })).toBeVisible();
  });

test("authoritative membership loss clears all child sections, private queries and mutation state", async () => {
  const h = fixture();
  h.mount();
  await ready();
  h.member = false;
  await act(async () => {
    await h.cache.invalidateQueries({
      queryKey: queryKeys.organizations(h.scope),
    });
  });
  await screen.findByRole("heading", { name: "Access denied", level: 1 });
  expect(privateKeys(h)).toHaveLength(0);
  for (const name of regions)
    expect(screen.queryByRole("region", { name })).not.toBeInTheDocument();
  expect(h.writes()).toHaveLength(0);
});
test("VIEWER sees all four populated children and READY download but no functional mutation controls", async () => {
  const h = fixture();
  h.role = "VIEWER";
  h.mount();
  await ready();
  for (const name of [
    "Save Requirement",
    "Choose catalog Material",
    "Choose Facility",
    "Upload reference",
    "Detach reference",
    "Remove selection",
    "Remove candidate",
  ])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Download reference" }),
  ).toBeEnabled();
  expect(h.writes()).toHaveLength(0);
});
test.each(["Organization", "Actor"])(
  "late binary after %s boundary creates zero object URLs and anchor clicks",
  async (boundary) => {
    const h = fixture(),
      hold = deferred<Response>(),
      OriginalURL = URL,
      create = vi.fn(() => "blob:unexpected"),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends OriginalURL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    h.overrides.set(
      `GET ${base()}/development-references/${"00000000-0000-4000-8000-00000000000a"}/content`,
      () => hold.promise,
    );
    h.mount();
    await ready();
    await userEvent.click(
      screen.getByRole("button", { name: "Download reference" }),
    );
    await waitFor(() =>
      expect(h.calls.filter((r) => r.url.endsWith("/content"))).toHaveLength(1),
    );
    const old = h.calls.find((r) => r.url.endsWith("/content"))!;
    if (boundary === "Organization")
      await userEvent.click(screen.getByRole("button", { name: "Enter B" }));
    else await act(async () => setLocalSubject("binary-replacement-actor"));
    await ready();
    expect(old.signal.aborted).toBe(true);
    await act(async () =>
      hold.resolve(new Response(new Uint8Array([1, 2, 3]))),
    );
    expect(create).toHaveBeenCalledTimes(0);
    expect(click).toHaveBeenCalledTimes(0);
    expect(revoke).toHaveBeenCalledTimes(0);
  },
);
test.each([400, 404, 409, 412, 413])(
  "terminal Reference read %s is attempted once and does not deny healthy siblings",
  async (status) => {
    const h = fixture();
    h.overrides.set(`GET ${base()}/development-references`, () =>
      response({}, status),
    );
    h.mount();
    await ready();
    const view = within(
      screen.getByRole("region", { name: "Development References" }),
    );
    await view.findByRole("heading", {
      name:
        status === 400
          ? "Check your input"
          : status === 404
            ? "Not found"
            : status === 409
              ? "Reload required"
              : status === 412
                ? "Precondition no longer holds"
                : "File too large",
    });
    expect(
      h
        .privateReads()
        .filter((r) => suffix(r) === base() + "/development-references"),
    ).toHaveLength(1);
    for (const name of regions.slice(0, 3))
      expect(screen.getByRole("region", { name })).toBeVisible();
  },
);
