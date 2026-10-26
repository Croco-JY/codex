/** Test-only grading transport, layered on the accepted workspace fixture. */
import { render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import App from "../App";
import {
  fixture as workspaceFixture,
  A,
  B,
  P,
  Q,
  S,
  T,
  id,
  time,
  root,
  response,
} from "./measurementFixture";
import type { Grading, Revision, Summary } from "../features/grading/model";
export { A, B, P, Q, S, T, id, time, root, response };
export const GID = id(30);
export const route = (org = A, detail = false) =>
  root(org).replace("/api/v1", "") + "/grading" + (detail ? "/" + GID : "");
export function revision(n = 1, org = A, sizes = 3, rules = 2): Revision {
  const range = Array.from({ length: sizes }, (_, i) => ({
    position: i,
    code: "S" + i,
    label: "Size " + i,
  }));
  return {
    id: id(300 + n + (org === B ? 1000 : 0)),
    gradeRuleSetId: GID,
    styleId: org === A ? S : T,
    revisionNumber: n,
    name: `Grading revision ${n}`,
    notes: null,
    unitSystem: "CM",
    baseSizeCode: "S1",
    createdAt: time,
    sizes: range,
    rules: Array.from({ length: rules }, (_, i) => ({
      position: i,
      code: "R" + i,
      label: "Rule " + i,
      notes: null,
      values: range.map((s, j) => ({
        sizeCode: s.code,
        delta: j === 1 ? "0.0000" : "-2.5000",
      })),
    })),
  };
}
export const summary = (r: Revision): Summary => ({
  id: r.id,
  gradeRuleSetId: r.gradeRuleSetId,
  styleId: r.styleId,
  revisionNumber: r.revisionNumber,
  name: r.name,
  baseSizeCode: r.baseSizeCode,
  unitSystem: r.unitSystem,
  sizeCount: r.sizes.length,
  ruleCount: r.rules.length,
  createdAt: r.createdAt,
});
export const grading = (n = 1, org = A): Grading => ({
  id: GID,
  styleId: org === A ? S : T,
  status: "ACTIVE",
  version: 0,
  createdAt: time,
  updatedAt: time,
  latestRevision: revision(n, org),
});
const item = (g: Grading) => ({
  ...g,
  latestRevision: summary(g.latestRevision),
});
export function fixture() {
  const h = workspaceFixture(),
    original = globalThis.fetch;
  const gradings = new Map<string, Grading[]>([
      [A, []],
      [B, []],
    ]),
    history = new Map<string, Revision>();
  let serial = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      const u = new URL(r.url),
        p = u.pathname;
      if (!p.includes("/grade-rule-sets")) return original(r);
      h.calls.push(r);
      const override = h.overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      const org = p.includes(B) ? B : A,
        base = root(org) + "/grade-rule-sets",
        rows = gradings.get(org)!;
      if (p === base && r.method === "GET") {
        const status = u.searchParams.get("status") ?? "ACTIVE";
        return response({
          items: rows
            .filter((g) => status === "ALL" || g.status === status)
            .map(item),
          limit: 25,
          nextCursor: null,
        });
      }
      function snapshot(
        b: ReturnType<typeof JSON.parse>,
        n: number,
        parent: string,
      ): Revision {
        return {
          ...revision(n, org),
          id: id(10000 + ++serial),
          gradeRuleSetId: parent,
          name: b.name,
          notes: b.notes,
          baseSizeCode: b.baseSizeCode,
          unitSystem: b.unitSystem,
          sizes: b.sizes.map(
            (s: { code: string; label: string }, i: number) => ({
              ...s,
              position: i,
            }),
          ),
          rules: b.rules.map(
            (
              g: {
                code: string;
                label: string;
                notes: string | null;
                values: { sizeCode: string; delta: string }[];
              },
              i: number,
            ) => ({ ...g, position: i }),
          ),
        };
      }
      if (p === base && r.method === "POST") {
        const b = await r.clone().json(),
          parent = id(20000 + ++serial),
          v = {
            ...grading(1, org),
            id: parent,
            latestRevision: snapshot(b, 1, parent),
          };
        gradings.set(org, [v, ...rows]);
        history.set(v.latestRevision.id, v.latestRevision);
        return response(v, 201);
      }
      const parts = p.slice(base.length + 1).split("/"),
        g = rows.find((g) => g.id === parts[0]);
      if (!g) return response({}, 404);
      if (parts.length === 1) {
        if (r.method === "GET") return response(g);
        const b = await r.clone().json();
        if (g.version !== b.version) return response({}, 409);
        if (g.status !== b.status) {
          g.status = b.status;
          g.version++;
          g.updatedAt = "2026-10-26T06:00:00Z";
        }
        return response(item(g));
      }
      if (parts.length === 2 && r.method === "POST") {
        const b = await r.clone().json();
        if (
          g.status !== "ACTIVE" ||
          b.expectedLatestRevisionNumber !== g.latestRevision.revisionNumber
        )
          return response({}, 409);
        const saved = snapshot(b, b.expectedLatestRevisionNumber + 1, g.id);
        history.set(g.latestRevision.id, g.latestRevision);
        history.set(saved.id, saved);
        g.latestRevision = saved;
        return response(saved, 201);
      }
      if (parts.length === 2) {
        const max = Number(u.searchParams.get("maxRevisionNumber"));
        const all = [
          ...new Map(
            [...history.values(), g.latestRevision]
              .filter(
                (r) =>
                  r.gradeRuleSetId === g.id &&
                  r.styleId === g.styleId &&
                  r.revisionNumber <= max,
              )
              .map((r) => [r.id, r]),
          ).values(),
        ].sort((a, b) => b.revisionNumber - a.revisionNumber);
        return response({
          items: all.slice(0, 25).map(summary),
          limit: 25,
          nextMaxRevisionNumber: all[25]?.revisionNumber ?? null,
        });
      }
      return response(
        history.get(parts[2]) ?? {},
        history.has(parts[2]) ? 200 : 404,
      );
    }),
  );
  function Nav() {
    const n = useNavigate();
    return (
      <>
        <button onClick={() => n(route(A))}>Grading A</button>
        <button onClick={() => n(route(B))}>Grading B</button>
        <button onClick={() => n(route(A, true))}>Grading detail A</button>
      </>
    );
  }
  return Object.assign(h, {
    gradings,
    history,
    mount: (url = route()) =>
      render(
        <QueryClientProvider client={h.cache}>
          <MemoryRouter initialEntries={[url]}>
            <App />
            <Nav />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  });
}
