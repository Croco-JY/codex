/** Measurement tests only. No production import or runtime bypass. */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import App from "../App";
import { createQueryClient } from "../app/queryClient";
import { getSession, setAccessToken } from "../api/session";
import type { Spec, Revision, Summary } from "../features/measurement/model";
export const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const A = id(1),
  B = id(2),
  P = id(3),
  S = id(4),
  Q = id(5),
  T = id(6),
  MS = id(7);
export const time = "2026-10-24T00:00:00Z";
export const root = (org = A) =>
  `/api/v1/organizations/${org}/projects/${org === A ? P : Q}/styles/${org === A ? S : T}`;
export const route = (org = A) =>
  root(org).replace("/api/v1", "") + "/measurements";
export const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "measurement-reference",
    },
  });
export function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
export const rev = (n = 1, org = A): Revision => ({
  id: id(100 + n + (org === B ? 1000 : 0)),
  measurementSpecId: org === A ? MS : id(8),
  styleId: org === A ? S : T,
  revisionNumber: n,
  baseSize: "M",
  unitSystem: "CM",
  createdAt: time,
  points: [
    {
      position: 0,
      code: "CHEST",
      label: "Chest",
      value: "50.0000",
      tolerancePlus: "1.0000",
      toleranceMinus: null,
      notes: "Synthetic persisted POM",
    },
  ],
});
export const spec = (n = 1, org = A): Spec => ({
  id: org === A ? MS : id(8),
  styleId: org === A ? S : T,
  createdAt: time,
  latestRevision: rev(n, org),
});
export const summary = (r: Revision): Summary => {
  const { points, ...v } = r;
  return { ...v, pointCount: points.length };
};
export function fixture() {
  setAccessToken();
  const cache = createQueryClient(),
    scope = getSession().key,
    calls: Request[] = [],
    overrides = new Map<string, (r: Request) => Response | Promise<Response>>();
  const h = {
    cache,
    scope,
    calls,
    overrides,
    role: "ORG_OWNER",
    projectStatus: "ACTIVE",
    styleStatus: "ACTIVE",
    specs: new Map<string, Spec | null>([
      [A, null],
      [B, null],
    ]),
    revisions: new Map<string, Revision>(),
    member: true,
    writes: () => calls.filter((r) => r.method !== "GET"),
    measurementReads: () =>
      calls.filter(
        (r) => r.method === "GET" && r.url.includes("/measurement-spec"),
      ),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r);
      const url = new URL(r.url),
        p = url.pathname,
        override = overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      if (p === "/api/identity")
        return response({
          issuer: "local",
          subject: r.headers.get("X-Dev-Subject") ?? "measurement-writer",
        });
      if (p === "/api/identity/capabilities")
        return response({ platformAdmin: true });
      if (p === "/api/organizations")
        return response(
          h.member
            ? [A, B].map((id) => ({
                id,
                name: `Org ${id}`,
                role: h.role,
                status: "ACTIVE",
                version: 0,
              }))
            : [],
        );
      const org = p.includes(B) ? B : A,
        project = org === A ? P : Q,
        style = org === A ? S : T;
      if (p === `/api/v1/organizations/${org}/projects/${project}`)
        return response({
          id: project,
          organizationId: org,
          name: "Measurement Project",
          description: null,
          status: h.projectStatus,
          version: 0,
          createdAt: time,
          updatedAt: time,
        });
      if (p === root(org))
        return response({
          id: style,
          projectId: project,
          name: "Measurement Style",
          styleCode: null,
          description: null,
          status: h.styleStatus,
          version: 0,
          createdAt: time,
          updatedAt: time,
        });
      const base = root(org) + "/measurement-spec",
        current = h.specs.get(org) ?? null;
      if (p === base && r.method === "GET")
        return response(current ?? {}, current ? 200 : 404);
      if (p === base && r.method === "PUT") {
        if (current) return response({}, 412);
        const b = await r.clone().json(),
          created = spec(1, org);
        created.latestRevision = {
          ...created.latestRevision,
          baseSize: b.baseSize,
          unitSystem: b.unitSystem,
          points: b.points.map(
            (p: Record<string, unknown>, position: number) => ({
              ...p,
              position,
            }),
          ),
        };
        h.specs.set(org, created);
        h.revisions.set(created.latestRevision.id, created.latestRevision);
        return response(created, 201);
      }
      if (p === base + "/revisions" && r.method === "POST") {
        const b = await r.clone().json();
        if (!current) return response({}, 404);
        if (
          b.expectedLatestRevisionNumber !==
          current.latestRevision.revisionNumber
        )
          return response({}, 409);
        const saved = {
          ...rev(current.latestRevision.revisionNumber + 1, org),
          baseSize: b.baseSize,
          unitSystem: b.unitSystem,
          points: b.points.map(
            (p: Record<string, unknown>, position: number) => ({
              ...p,
              position,
            }),
          ),
        };
        h.revisions.set(saved.id, saved);
        h.specs.set(org, { ...current, latestRevision: saved });
        return response(saved, 201);
      }
      if (p === base + "/revisions") {
        if (!current) return response({}, 404);
        const max = Number(url.searchParams.get("maxRevisionNumber")),
          limit = Number(url.searchParams.get("limit"));
        const records = [
          ...h.revisions.values(),
          current.latestRevision,
        ].filter((r) => r.styleId === style && r.revisionNumber <= max);
        const unique = [
          ...new Map(records.map((r) => [r.id, r])).values(),
        ].sort((a, b) => b.revisionNumber - a.revisionNumber);
        return response({
          items: unique.slice(0, limit).map(summary),
          limit,
          nextMaxRevisionNumber: unique[limit]?.revisionNumber ?? null,
        });
      }
      if (p.startsWith(base + "/revisions/")) {
        const found =
          h.revisions.get(p.split("/").at(-1)!) ??
          (current && current.latestRevision.id === p.split("/").at(-1)
            ? current.latestRevision
            : null);
        return response(found ?? {}, found ? 200 : 404);
      }
      if (p.endsWith("/requirement")) return response({}, 404);
      if (
        [
          "material-selections",
          "facility-candidates",
          "development-references",
        ].some((c) => p.endsWith("/" + c))
      )
        return response({ items: [], limit: 25, offset: 0, hasMore: false });
      return response({}, 404);
    }),
  );
  function Nav() {
    const n = useNavigate();
    return (
      <>
        <button onClick={() => n(route(A))}>Enter A</button>
        <button onClick={() => n(route(B))}>Enter B</button>
      </>
    );
  }
  return Object.assign(h, {
    mount: (url = route()) =>
      render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[url]}>
            <App />
            <Nav />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  });
}
export async function ready() {
  await screen.findByRole("heading", { name: "Measurements", level: 1 });
  await screen.findByRole("heading", { name: "Measurement Spec", level: 2 });
}
