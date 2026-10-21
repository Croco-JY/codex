import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SessionProvider, useSession } from "../../app/session";
import { endSession, setLocalSubject } from "../../api/session";
import { useAdminMutation } from "../admin-sources/data";
import { supplierDefaults, facilityDefaults } from "../admin-network/model";
import {
  PermanentBinding,
  ResolutionControls,
  ResolutionOutcome,
  useIdentityResolution,
} from "./Workspace";
import {
  identityKinds,
  resolvedState,
  type IdentityType,
  type CreateBodies,
} from "./model";
const id = (n: number) =>
  `1c5e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const types = Object.keys(identityKinds) as IdentityType[];
const paths = {
  supplier: "suppliers",
  facility: "facilities",
  material: "materials",
  variant: "material-variants",
  listing: "material-listings",
};
const inputs: CreateBodies = {
  supplier: {
    countryId: id(3),
    displayName: "Draft Supplier",
    roles: [],
    status: "ACTIVE",
    observationId: id(4),
    version: 0,
  },
  facility: {
    supplierId: id(5),
    countryId: id(3),
    name: "Draft Facility",
    facilityType: "MILL",
    status: "ACTIVE",
    observationId: id(4),
    version: 0,
  },
  material: {
    catalogSupplierId: id(5),
    displayName: "Draft Material",
    materialType: "FABRIC",
    composition: [],
    compositionCompleteness: "UNKNOWN",
    status: "ACTIVE",
    observationId: id(4),
    version: 0,
  },
  variant: {
    materialId: id(5),
    variantName: "Draft Variant",
    status: "ACTIVE",
    observationId: id(4),
    version: 0,
    attributes: { lengthMm: "999999999999999.9999" },
  },
  listing: {
    materialId: id(5),
    sellerSupplierId: id(6),
    minimumOrderQuantity: "0",
    status: "ACTIVE",
    observationId: id(4),
    version: 0,
  },
};
function view(type: IdentityType) {
  const b = inputs[type];
  const common = { ...b, id: id(1), version: 9 };
  if (type === "supplier")
    return {
      ...supplierDefaults,
      ...common,
      displayName: "Actual Supplier",
      verificationStatus: "AUDITED",
    };
  if (type === "facility")
    return {
      ...facilityDefaults,
      ...common,
      supplierId: id(50),
      name: "Actual Facility",
    };
  if (type === "material")
    return {
      ...common,
      catalogSupplierId: id(50),
      catalogArticleNumber: null,
      description: null,
      originCountryId: null,
      displayName: "Actual Material",
    };
  if (type === "variant")
    return {
      ...common,
      materialId: id(50),
      catalogVariantSku: null,
      colorName: null,
      colorCode: null,
      batchNumber: null,
    };
  return {
    ...common,
    materialId: id(50),
    sellerSupplierId: id(60),
    sellerArticleNumber: null,
    minimumColorQuantity: null,
    quantityUnit: "METER",
    standardLeadTimeDays: null,
    reproductionLeadTimeDays: null,
  };
}
let cache: QueryClient,
  calls: Request[],
  admin: boolean,
  status: number,
  handler: (r: Request) => Promise<Response>;
const reply = (v: unknown = {}, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "identity-reference",
    },
  });
beforeEach(() => {
  setLocalSubject("identity-admin");
  admin = true;
  status = 200;
  calls = [];
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  handler = async () => new Response(null, { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r.clone());
      const p = new URL(r.url).pathname;
      if (p === "/api/identity")
        return reply({
          issuer: "local",
          subject: r.headers.get("X-Dev-Subject"),
        });
      if (p === "/api/identity/capabilities")
        return reply({ platformAdmin: admin }, status);
      return handler(r);
    }),
  );
});
afterEach(() => {
  cache.clear();
  endSession();
  vi.unstubAllGlobals();
});
function Gate({ children }: { children: React.ReactNode }) {
  const s = useSession();
  return (
    <>
      <button onClick={s.retryCapability}>Recheck authority</button>
      {s.capability === "ADMIN" ? children : <p>{s.capability}</p>}
    </>
  );
}
function mount(node: React.ReactNode) {
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={["/admin/materials"]}>
        <SessionProvider>
          <Gate>{node}</Gate>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const post = () => calls.filter((r) => r.method === "POST");
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function ResolveHarness({ type }: { type: IdentityType }) {
  const r = useIdentityResolution(type);
  const m = useAdminMutation(
    "test-resolve",
    (_v: void, signal) => r.send(inputs[type], signal),
    () => r.complete(),
  );
  return (
    <>
      <ResolutionControls resolution={r} pending={m.isPending} />
      <fieldset disabled={r.locked}>
        <input aria-label="Domain draft" defaultValue="retained" />
        <button disabled={!r.canSubmit} onClick={() => m.mutate()}>
          Resolve external identity
        </button>
      </fieldset>
      <ResolutionOutcome
        resolution={r}
        error={m.error}
        pending={m.isPending}
        retry={() => m.mutate()}
        reset={() => m.reset()}
      />
    </>
  );
}
async function resolveMode() {
  await screen.findByLabelText("Creation mode");
  fill("Creation mode", "resolve");
  fill("Resolve SourceRecord UUID", id(2));
  fireEvent.click(screen.getByLabelText(/I acknowledge permanent/));
}
test.each(types)(
  "%s binding requires confirmation, uses typed POST only and body without Observation/version",
  async (type) => {
    mount(<PermanentBinding type={type} id={id(1)} label="Canonical target" />);
    await screen.findByText(/Canonical target:/);
    expect(post()).toHaveLength(0);
    fill("SourceRecord UUID", id(2));
    expect(
      screen.getByRole("button", {
        name: "Permanently bind external identity",
      }),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I confirm this permanent/));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Permanently bind external identity",
      }),
    );
    await screen.findByText(/No complete binding-list read exists/);
    expect(new URL(post()[0]!.url).pathname).toBe(
      `/api/v1/admin/${paths[type]}/${id(1)}/external-records`,
    );
    expect(await post()[0]!.json()).toEqual({ sourceRecordId: id(2) });
    expect(post()).toHaveLength(1);
    expect(
      calls.filter(
        (r) => r.method === "GET" && r.url.includes("external-record"),
      ),
    ).toHaveLength(0);
  },
);
test.each([400, 404, 409, 500])(
  "binding HTTP %i preserves request reference without auto retry",
  async (code) => {
    handler = async () => reply({}, code);
    mount(<PermanentBinding type="supplier" id={id(1)} label="Target" />);
    await screen.findByLabelText("SourceRecord UUID");
    fill("SourceRecord UUID", id(2));
    fireEvent.click(screen.getByLabelText(/I confirm this permanent/));
    fireEvent.click(screen.getByText("Permanently bind external identity"));
    await screen.findByText(/identity-reference/);
    expect(post()).toHaveLength(1);
    expect(screen.queryByText("Retry exact same permanent binding")).toBeNull();
    expect(screen.getByLabelText("SourceRecord UUID")).toHaveValue(id(2));
  },
);
test("binding transport ambiguity freezes exact target/record; explicit replay is the sole retry", async () => {
  let first = true;
  handler = async () => {
    if (first) {
      first = false;
      throw new TypeError("network");
    }
    return new Response(null, { status: 200 });
  };
  mount(<PermanentBinding type="facility" id={id(1)} label="Target" />);
  await screen.findByLabelText("SourceRecord UUID");
  fill("SourceRecord UUID", id(2));
  fireEvent.click(screen.getByLabelText(/I confirm this permanent/));
  fireEvent.click(screen.getByText("Permanently bind external identity"));
  await screen.findByText(/outcome is unknown because/);
  expect(post()).toHaveLength(1);
  expect(screen.getByLabelText("SourceRecord UUID")).toBeDisabled();
  fireEvent.click(screen.getByText("Retry exact same permanent binding"));
  await screen.findByText(/No complete binding-list read exists/);
  expect(await post()[0]!.json()).toEqual(await post()[1]!.json());
  expect(post()[0]!.url).toBe(post()[1]!.url);
});
test.each(types)(
  "%s Resolve uses exact generated nested body and authoritative returned parent without false created claim",
  async (type) => {
    handler = async () => reply(view(type));
    mount(<ResolveHarness type={type} />);
    await resolveMode();
    fireEvent.click(screen.getByText("Resolve external identity"));
    await screen.findByRole("heading", {
      name: `Identity resolved to canonical ${identityKinds[type].label}`,
    });
    const p = post()[0]!;
    expect(new URL(p.url).pathname).toBe(
      `/api/v1/admin/${type === "variant" ? "material-variant" : type === "listing" ? "material-listing" : type}-identities`,
    );
    expect(await p.json()).toEqual({
      sourceRecordId: id(2),
      [type]: inputs[type],
    });
    expect(
      screen.getByText(/Existing canonical data was returned/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: `Open resolved canonical ${identityKinds[type].label}`,
      }),
    ).toHaveAttribute("href", resolvedState(type, view(type))!.href);
    expect(screen.queryByText(/New .* created/)).toBeNull();
    expect(post()).toHaveLength(1);
  },
);
test.each(types)(
  "%s status0 Resolve retries identical frozen request, no plain create or bind fallback",
  async (type) => {
    let first = true;
    handler = async () => {
      if (first) {
        first = false;
        throw Error("lost response");
      }
      return reply(view(type));
    };
    mount(<ResolveHarness type={type} />);
    await resolveMode();
    fireEvent.click(screen.getByText("Resolve external identity"));
    await screen.findByText(/identity-resolution outcome is unknown/);
    expect(screen.getByLabelText("Domain draft")).toBeDisabled();
    expect(screen.getByLabelText("Creation mode")).toBeDisabled();
    expect(post()).toHaveLength(1);
    fireEvent.click(screen.getByText("Retry exact same identity resolution"));
    await screen.findByText(/Resolution does not indicate/);
    expect(await post()[0]!.json()).toEqual(await post()[1]!.json());
    expect(post()).toHaveLength(2);
  },
);
test.each(types)(
  "%s malformed Resolve response blocks navigation and retains command",
  async (type) => {
    handler = async () => reply({ id: id(1) });
    mount(<ResolveHarness type={type} />);
    await resolveMode();
    fireEvent.click(screen.getByText("Resolve external identity"));
    await screen.findByText(
      "Abandon identity resolution intention and unlock draft",
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /Open resolved canonical/ }),
      ).toBeNull(),
    );
    expect(screen.getByLabelText("Resolve SourceRecord UUID")).toHaveValue(
      id(2),
    );
  },
);
test.each([false, true])(
  "revocation/Actor switch discards unresolved identity state (switch=%s)",
  async (switchActor) => {
    handler = async () => {
      throw Error("network");
    };
    mount(<ResolveHarness type="material" />);
    await resolveMode();
    fireEvent.click(screen.getByText("Resolve external identity"));
    await screen.findByText(/identity-resolution outcome is unknown/);
    if (switchActor) await act(async () => setLocalSubject("identity-actor-b"));
    else {
      admin = false;
      fireEvent.click(screen.getByText("Recheck authority"));
    }
    await waitFor(() =>
      expect(
        screen.queryByText(/identity-resolution outcome is unknown/),
      ).toBeNull(),
    );
    if (switchActor)
      await waitFor(() =>
        expect(screen.getByLabelText("Creation mode")).toHaveValue("normal"),
      );
    else await screen.findByText("NON_ADMIN");
  },
);
test.each(["PENDING", "ERROR", "NON_ADMIN"])(
  "%s gate issues no identity commands",
  async (state) => {
    admin = false;
    status = state === "ERROR" ? 500 : 200;
    if (state === "PENDING")
      vi.stubGlobal("fetch", () => new Promise(() => {}));
    mount(<PermanentBinding type="supplier" id={id(1)} label="Target" />);
    await screen.findByText(state);
    expect(post()).toHaveLength(0);
    expect(screen.queryByLabelText("SourceRecord UUID")).toBeNull();
  },
);
