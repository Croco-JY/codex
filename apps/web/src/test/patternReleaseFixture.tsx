/** In-memory test transport only. Real HTTP/PostgreSQL acceptance uses Playwright separately. */
import { render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import App from "../App";
import {
  fixture as patternFixture,
  A,
  B,
  P,
  S,
  PID,
  id,
  time,
  root,
  response,
  pattern,
  revision,
} from "./patternFixture";
export { A, B, P, S, PID, id, time, response, revision };
export const inboxRoute = (org = B) =>
  `/organizations/${org}/received-pattern-releases`;
export const consentRoute = (org = B) =>
  `/organizations/${org}/release-consents`;
export const sourceRoute = (org = A) =>
  root(org).replace("/api/v1", "") +
  `/patterns/${PID}/revisions/${revision(1, org).id}/releases`;
export const grant = (org = B) => ({
  releaseId: id(org === B ? 600 : 610),
  sourceOrganizationId: org === B ? A : B,
  recipientOrganizationId: org,
  patternRevisionId: revision(1, org === B ? A : B).id,
  patternRevisionNumber: 1,
  artifactId: id(650),
  declaredFormat: "PDF" as const,
  displayName: `Private ${org === B ? "B" : "A"} exact.pdf`,
  sizeBytes: 3,
  purpose: `Private ${org === B ? "B" : "A"} outbound purpose`,
  releasedAt: time,
  expiresAt: "2026-10-24T01:00:00Z",
  effectiveState: "ACTIVE" as const,
});
export const consent = (consumed = false) => ({
  id: id(consumed ? 601 : 602),
  recipientOrganizationId: B,
  sourceOrganizationId: A,
  issuedAt: time,
  expiresAt: "2026-10-24T00:15:00Z",
  state: consumed ? "CONSUMED" : "ISSUED",
  latestEventNumber: consumed ? 2 : 1,
  consumedReleaseId: consumed ? id(600) : null,
});
export function fixture() {
  const h = patternFixture(),
    original = globalThis.fetch;
  h.patterns.set(A, [pattern()]);
  h.patterns.set(B, [pattern(1, B)]);
  h.history.set(revision().id, revision());
  h.history.set(revision(1, B).id, revision(1, B));
  const source = {
    id: id(600),
    consentId: id(601),
    sourceOrganizationId: A,
    recipientOrganizationId: B,
    projectId: P,
    styleId: S,
    patternId: PID,
    patternRevisionId: revision().id,
    patternRevisionNumber: 1,
    artifactId: id(650),
    declaredFormat: "PDF",
    displayName: grant().displayName,
    sizeBytes: 3,
    purpose: grant().purpose,
    releasedAt: time,
    expiresAt: "2026-10-24T01:00:00Z",
  };
  const sources = new Map([
      [
        source.id,
        {
          release: source,
          latestEventNumber: 1,
          lifecycle: "ACTIVATED",
          effectiveState: "ACTIVE",
        },
      ],
    ]),
    consents = new Map([
      [id(601), consent(true)],
      [id(602), consent()],
    ]);
  let serial = 700;
  const received = new Map([
    [A, [grant(A)]],
    [B, [grant(B)]],
  ]);
  const projection = (r: ReturnType<typeof grant>) => {
    const s = sources.get(r.releaseId);
    if (!s || s.effectiveState === "ACTIVE") return r;
    return {
      releaseId: r.releaseId,
      sourceOrganizationId: r.sourceOrganizationId,
      recipientOrganizationId: r.recipientOrganizationId,
      releasedAt: r.releasedAt,
      expiresAt: r.expiresAt,
      effectiveState: s.effectiveState,
    };
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      const u = new URL(r.url),
        p = u.pathname;
      if (
        !p.includes("/release-consents") &&
        !p.includes("/received-pattern-releases") &&
        !p.includes("/releases") &&
        !p.endsWith("/artifact")
      )
        return original(r);
      h.calls.push(r);
      const override = h.overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      if (p.endsWith("/artifact"))
        return response({
          id: id(650),
          patternRevisionId: revision().id,
          patternId: PID,
          styleId: S,
          declaredFormat: "PDF",
          displayName: source.displayName,
          sizeBytes: 3,
          state: "READY",
          failureCode: null,
          createdAt: time,
          updatedAt: time,
        });
      const org = p.includes(`/organizations/${B}/`) ? B : A;
      if (p.includes("/release-consents")) {
        const base = `/api/v1/organizations/${org}/release-consents`,
          parts = p.slice(base.length).split("/").filter(Boolean);
        if (parts.length === 0 && r.method === "POST") {
          const body = await r.clone().json();
          const c = {
            ...consent(),
            id: id(++serial),
            sourceOrganizationId: body.sourceOrganizationId,
          };
          consents.set(c.id, c);
          return response(c, 201);
        }
        if (parts.length === 0)
          return response({
            items: [...consents.values()]
              .filter((c) => c.recipientOrganizationId === org)
              .sort((a, b) => b.id.localeCompare(a.id)),
            limit: 25,
            nextCursor: null,
          });
        const c = consents.get(parts[0]);
        if (!c || c.recipientOrganizationId !== org) return response({}, 404);
        if (parts[1] === "withdrawals") {
          const body = await r.clone().json();
          if (body.expectedLatestEventNumber !== c.latestEventNumber)
            return response({}, 409);
          if (c.state !== "WITHDRAWN") {
            c.state = "WITHDRAWN";
            c.latestEventNumber++;
            if (c.consumedReleaseId)
              sources.get(c.consumedReleaseId)!.effectiveState = "WITHDRAWN";
          }
          return response(c);
        }
        return response(c);
      }
      if (p.includes("/received-pattern-releases")) {
        const base = `/api/v1/organizations/${org}/received-pattern-releases`,
          parts = p.slice(base.length).split("/").filter(Boolean),
          rows = received.get(org)!;
        if (parts.length === 0)
          return response({
            items: rows.map(projection),
            limit: 25,
            nextCursor: null,
          });
        const item = rows.find((v) => v.releaseId === parts[0]);
        if (!item) return response({}, 404);
        if (parts[1] === "content")
          return projection(item).effectiveState !== "ACTIVE"
            ? response({}, 404)
            : new Response(new Uint8Array([1, 2, 3]), {
                headers: { "Content-Type": "application/octet-stream" },
              });
        return response(projection(item));
      }
      const base = "/api/v1" + sourceRoute(org),
        parts = p.slice(base.length).split("/").filter(Boolean);
      if (parts.length === 0 && r.method === "GET")
        return response({
          items: [...sources.values()]
            .map((v) => v.release)
            .sort((a, b) => b.id.localeCompare(a.id)),
          limit: 25,
          nextCursor: null,
        });
      if (parts.length === 0) {
        const body = await r.clone().json(),
          c = consents.get(body.consentId);
        if (
          !c ||
          c.state !== "ISSUED" ||
          body.expectedLatestConsentEventNumber !== 1
        )
          return response({}, 409);
        const s = {
          ...source,
          id: id(++serial),
          consentId: c.id,
          purpose: body.purpose,
          expiresAt: new Date(
            Date.parse(time) + body.accessDurationSeconds * 1000,
          ).toISOString(),
        };
        const value = {
          release: s,
          latestEventNumber: 1,
          lifecycle: "ACTIVATED",
          effectiveState: "ACTIVE",
        };
        sources.set(s.id, value);
        c.state = "CONSUMED";
        c.latestEventNumber = 2;
        c.consumedReleaseId = s.id;
        received.get(B)!.unshift({
          ...grant(),
          releaseId: s.id,
          purpose: s.purpose,
          expiresAt: s.expiresAt,
        });
        return response(value, 201);
      }
      const value = sources.get(parts[0]);
      if (!value) return response({}, 404);
      if (parts[1] === "revocations") {
        const body = await r.clone().json();
        if (body.expectedLatestEventNumber !== value.latestEventNumber)
          return response({}, 409);
        value.latestEventNumber = 2;
        value.lifecycle = "REVOKED";
        value.effectiveState = "REVOKED";
        return response(value);
      }
      if (parts[1] === "events") {
        const max = Number(u.searchParams.get("maxEventNumber")),
          events = [
            {
              id: id(680),
              releaseId: value.release.id,
              eventNumber: 1,
              kind: "ACTIVATED",
              occurredAt: time,
            },
            ...(value.latestEventNumber === 2
              ? [
                  {
                    id: id(681),
                    releaseId: value.release.id,
                    eventNumber: 2,
                    kind: "REVOKED",
                    occurredAt: "2026-10-24T00:00:01Z",
                  },
                ]
              : []),
          ];
        return response({
          items: events.filter((e) => e.eventNumber <= max).reverse(),
          limit: 25,
          nextMaxEventNumber: null,
        });
      }
      return response(value);
    }),
  );
  function Nav() {
    const n = useNavigate();
    return (
      <>
        {[A, B].map((org) => (
          <button key={org} onClick={() => n(inboxRoute(org))}>
            Inbox {org === A ? "A" : "B"}
          </button>
        ))}
        <button onClick={() => n(sourceRoute())}>Source A</button>
        <button onClick={() => n(inboxRoute() + "/" + id(600))}>Exact B</button>
        <button onClick={() => n("/organization")}>Leave releases</button>
      </>
    );
  }
  return Object.assign(h, {
    sources,
    consents,
    received,
    mount: (url = inboxRoute()) =>
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
