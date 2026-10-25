/** Pattern tests only; layered on the accepted workspace fixture without production hooks. */
import { render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import App from "../App";
import {
  fixture as measurementFixture,
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
import type { Pattern, Revision } from "../features/pattern/model";
export { A, B, P, Q, S, T, id, time, root, response };
export const PID = id(20);
export const route = (org = A, detail = false) =>
  root(org).replace("/api/v1", "") + "/patterns" + (detail ? "/" + PID : "");
export const revision = (n = 1, org = A): Revision => ({
  id: id(200 + n + (org === B ? 1000 : 0)),
  patternId: PID,
  styleId: org === A ? S : T,
  revisionNumber: n,
  name: `Pattern revision ${n}`,
  purpose: "Synthetic purpose",
  measurementRevisionId: null,
  createdAt: time,
});
export const pattern = (n = 1, org = A): Pattern => ({
  id: PID,
  styleId: org === A ? S : T,
  status: "ACTIVE",
  version: 0,
  latestRevision: revision(n, org),
  createdAt: time,
  updatedAt: time,
});
export function fixture() {
  const h = measurementFixture(),
    original = globalThis.fetch;
  const patterns = new Map<string, Pattern[]>([
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
      if (!p.includes("/patterns")) return original(r);
      h.calls.push(r);
      const override = h.overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      const org = p.includes(B) ? B : A,
        base = root(org) + "/patterns",
        rows = patterns.get(org)!;
      if (p === base && r.method === "GET") {
        const status = u.searchParams.get("status") ?? "ACTIVE";
        return response({
          items: rows.filter((p) => status === "ALL" || p.status === status),
          limit: 25,
          nextCursor: null,
        });
      }
      if (p === base && r.method === "POST") {
        const b = await r.clone().json(),
          v = {
            ...pattern(1, org),
            id: id(500 + ++serial),
            latestRevision: {
              ...revision(1, org),
              ...b,
              patternId: id(500 + serial),
            },
          };
        patterns.set(org, [v, ...rows]);
        history.set(v.latestRevision.id, v.latestRevision);
        return response(v, 201);
      }
      const parts = p.slice(base.length + 1).split("/"),
        v = rows.find((v) => v.id === parts[0]);
      if (!v) return response({}, 404);
      if (parts.length === 1) {
        if (r.method === "GET") return response(v);
        const b = await r.clone().json();
        if (v.version !== b.version) return response({}, 409);
        if (v.status !== b.status) {
          v.version++;
          v.status = b.status;
          v.updatedAt = "2026-10-25T00:00:00Z";
        }
        return response(v);
      }
      if (parts.length === 2 && r.method === "POST") {
        const b = await r.clone().json();
        if (
          v.status !== "ACTIVE" ||
          b.expectedLatestRevisionNumber !== v.latestRevision.revisionNumber
        )
          return response({}, 409);
        const saved = {
          ...revision(b.expectedLatestRevisionNumber + 1, org),
          patternId: v.id,
          name: b.name,
          purpose: b.purpose,
          measurementRevisionId: b.measurementRevisionId,
        };
        history.set(v.latestRevision.id, v.latestRevision);
        history.set(saved.id, saved);
        v.latestRevision = saved;
        return response(saved, 201);
      }
      if (parts.length === 2) {
        const max = Number(u.searchParams.get("maxRevisionNumber"));
        const all = [
          ...new Map(
            [...history.values(), v.latestRevision]
              .filter(
                (r) =>
                  r.patternId === v.id &&
                  r.styleId === v.styleId &&
                  r.revisionNumber <= max,
              )
              .map((r) => [r.id, r]),
          ).values(),
        ].sort((a, b) => b.revisionNumber - a.revisionNumber);
        return response({
          items: all.slice(0, 25),
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
        <button onClick={() => n(route(A))}>Patterns A</button>
        <button onClick={() => n(route(B))}>Patterns B</button>
        <button onClick={() => n(route(A, true))}>Pattern detail A</button>
      </>
    );
  }
  return Object.assign(h, {
    patterns,
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
