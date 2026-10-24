import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../App";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { endSession, getSession, setAccessToken } from "../api/session";
import { createQueryClient } from "../app/queryClient";
import {
  checked,
  entityValid,
  type Entity,
  type Project,
  type Style,
} from "../features/workspace/model";

// This narrow regression is independent of the uncommitted cumulative hardening harness.
const A = "00000000-0000-4000-8000-000000000001";
const P = "00000000-0000-4000-8000-000000000002";
const S = "00000000-0000-4000-8000-000000000003";
const stamp = "2026-10-24T00:00:00Z";
const project: Project = {
  id: P,
  organizationId: A,
  name: "Timestamp Project",
  description: null,
  status: "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
};
const style: Style = {
  id: S,
  projectId: P,
  name: "Timestamp Style",
  styleCode: null,
  description: null,
  status: "ACTIVE",
  version: 0,
  createdAt: stamp,
  updatedAt: stamp,
};
const projectPath = `/api/v1/organizations/${A}/projects/${P}`;
const stylePath = `${projectPath}/styles/${S}`;
const childNames = [
  "requirement",
  "material-selections",
  "facility-candidates",
  "development-references",
] as const;
const fields = ["createdAt", "updatedAt"] as const;
const valid = [
  "2026-10-24T00:00:00Z",
  "2026-10-24T12:34:56.123Z",
  "2026-10-24T09:00:00+09:00",
];
const invalid: unknown[] = [
  "2026-10-24",
  "2026-10-24T12:34:56",
  "not-a-date",
  "",
  null,
  undefined,
  1792800000000,
];

for (const kind of ["Project", "Style"] as const) {
  const original = kind === "Project" ? project : style;
  const parent = kind === "Project" ? A : P;
  for (const field of fields) {
    test.each(invalid)(
      `${kind}.${field} rejects malformed timestamp %j with ApiError 502`,
      (value) => {
        // Simulate untrusted transport data despite the generated string property type.
        const malformed = { ...original, [field]: value } as Entity;
        expect(entityValid(malformed, parent, original.id)).toBe(false);
        expect(() => checked(malformed, parent, original.id)).toThrowError(
          ApiError,
        );
        try {
          checked(malformed, parent, original.id);
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).status).toBe(502);
        }
      },
    );
    test.each(valid)(
      `${kind}.${field} accepts explicit-zone timestamp %s unchanged`,
      (value) => {
        const supported = { ...original, [field]: value };
        expect(entityValid(supported, parent, original.id)).toBe(true);
        expect(checked(supported, parent, original.id)).toBe(supported);
      },
    );
  }
}

let cache: QueryClient | undefined;
let calls: Request[];
let scope: string;
let projectResponse: Project;
let styleResponse: Style;
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "timestamp-regression",
    },
  });
beforeEach(() => {
  setAccessToken();
  scope = getSession().key;
  calls = [];
  projectResponse = { ...project };
  styleResponse = { ...style };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      calls.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/api/identity")
        return reply({ issuer: "local", subject: "timestamp-writer" });
      if (path === "/api/identity/capabilities")
        return reply({ platformAdmin: false });
      if (path === "/api/organizations")
        return reply([
          {
            id: A,
            name: "Timestamp Organization",
            role: "ORG_OWNER",
            status: "ACTIVE",
            version: 0,
          },
        ]);
      if (path === projectPath) return reply(projectResponse);
      if (path === stylePath) return reply(styleResponse);
      if (path === `${stylePath}/requirement`) return reply({}, 404);
      if (childNames.slice(1).some((child) => path === `${stylePath}/${child}`))
        return reply({ items: [], limit: 25, offset: 0, hasMore: false });
      return reply({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  cache?.clear();
  cache = undefined;
  endSession();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(nestedStyle: boolean) {
  cache = createQueryClient();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter
        initialEntries={[
          nestedStyle
            ? `/organizations/${A}/projects/${P}/styles/${S}`
            : `/organizations/${A}/projects/${P}`,
        ]}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function privateReads() {
  return calls.filter(
    (r) =>
      r.method === "GET" &&
      new URL(r.url).pathname.startsWith("/api/v1/organizations/"),
  );
}
function expectNoWriterControls() {
  for (const name of [
    "Save Project",
    "Archive Project",
    "Save Style",
    "Archive Style",
    "Create Requirement",
    "Save Requirement",
    "Choose catalog Material",
    "Choose Facility",
    "Upload reference",
    "Detach reference",
  ])
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  expect(calls.filter((r) => r.method !== "GET")).toHaveLength(0);
}
function expectNoChildren() {
  for (const child of childNames)
    expect(
      calls.filter((r) => new URL(r.url).pathname === `${stylePath}/${child}`),
    ).toHaveLength(0);
}

test.each(fields)(
  "malformed Project %s on Project detail never enables Save/Archive",
  async (field) => {
    projectResponse = { ...project, [field]: "2026-10-24" };
    mount(false);
    await screen.findByRole("heading", {
      name: "Service unavailable",
      level: 1,
    });
    await waitFor(() =>
      expect(cache?.getQueryState(queryKeys.project(scope, A, P))?.status).toBe(
        "error",
      ),
    );
    expect(
      cache?.getQueryState(queryKeys.project(scope, A, P))?.error,
    ).toBeInstanceOf(ApiError);
    expect(privateReads().map((r) => new URL(r.url).pathname)).toEqual([
      projectPath,
    ]);
    expectNoWriterControls();
  },
);

test.each(fields)(
  "malformed Project %s on direct Style entry blocks Style and all four children",
  async (field) => {
    projectResponse = { ...project, [field]: "2026-10-24" };
    mount(true);
    await screen.findByRole("heading", {
      name: "Service unavailable",
      level: 1,
    });
    expect(cache?.getQueryState(queryKeys.project(scope, A, P))?.status).toBe(
      "error",
    );
    expect(
      calls.filter((r) => new URL(r.url).pathname === stylePath),
    ).toHaveLength(0);
    expectNoChildren();
    expectNoWriterControls();
    expect(privateReads().map((r) => new URL(r.url).pathname)).toEqual([
      projectPath,
    ]);
  },
);

test.each(fields)(
  "valid Project then malformed Style %s blocks all four child workspaces",
  async (field) => {
    styleResponse = { ...style, [field]: "2026-10-24" };
    mount(true);
    await screen.findByRole("heading", {
      name: "Service unavailable",
      level: 1,
    });
    expect(cache?.getQueryState(queryKeys.project(scope, A, P))?.status).toBe(
      "success",
    );
    expect(cache?.getQueryState(queryKeys.style(scope, A, P, S))?.status).toBe(
      "error",
    );
    expect(privateReads().map((r) => new URL(r.url).pathname)).toEqual([
      projectPath,
      stylePath,
    ]);
    expectNoChildren();
    expectNoWriterControls();
  },
);
