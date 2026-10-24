/** Phase 2G test-only harness. No production entrypoint imports this module. */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import App from "../App";
import { createQueryClient } from "../app/queryClient";
import { getSession, setAccessToken } from "../api/session";
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const A = uuid(1),
  B = uuid(2),
  P = uuid(3),
  S = uuid(4),
  M = uuid(5),
  V = uuid(6),
  L = uuid(7),
  F = uuid(8),
  U = uuid(9),
  R = uuid(10);
export const children = [
  "requirement",
  "material-selections",
  "facility-candidates",
  "development-references",
] as const;
export type Child = (typeof children)[number];
export const regions = [
  "Style Requirement",
  "Material Selections",
  "Facility Candidates",
  "Development References",
] as const;
const stamp = "2026-10-24T00:00:00Z";
export const base = (org = A) =>
  `/api/v1/organizations/${org}/projects/${P}/styles/${S}`;
export const route = (org = A) =>
  `/organizations/${org}/projects/${P}/styles/${S}`;
export const response = (v: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(v), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": "cumulative-reference",
    },
  });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
export function fixture() {
  setAccessToken();
  const cache = createQueryClient(),
    scope = getSession().key,
    calls: Request[] = [];
  const overrides = new Map<
    string,
    (request: Request) => Response | Promise<Response>
  >();
  const h = {
    cache,
    scope,
    calls,
    overrides,
    role: "ORG_OWNER",
    member: true,
    archived: false,
    project: (org = A) => ({
      id: P,
      organizationId: org,
      name: `Project ${org}`,
      description: null,
      status: h.archived ? "ARCHIVED" : "ACTIVE",
      version: 0,
      createdAt: stamp,
      updatedAt: stamp,
    }),
    style: () => ({
      id: S,
      projectId: P,
      name: "Cumulative Style",
      styleCode: null,
      description: null,
      status: "ACTIVE",
      version: 0,
      createdAt: stamp,
      updatedAt: stamp,
    }),
    requirement: () => ({
      styleId: S,
      productType: "Synthetic authoritative requirement",
      targetQuantity: "0",
      quantityUnit: "PCS",
      targetCost: null,
      currency: null,
      targetDeliveryDate: null,
      notes: null,
      version: 0,
      createdAt: stamp,
      updatedAt: stamp,
    }),
    reference: () => ({
      id: R,
      styleId: S,
      storageObjectId: uuid(11),
      displayName: "Synthetic retained reference",
      mediaType: "application/octet-stream",
      sizeBytes: 3,
      state: "READY",
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
    }),
    privateReads: () =>
      calls.filter(
        (r) =>
          new URL(r.url).pathname.startsWith("/api/v1/organizations/") &&
          r.method === "GET",
      ),
    writes: () =>
      calls.filter(
        (r) =>
          new URL(r.url).pathname.startsWith("/api/v1/organizations/") &&
          r.method !== "GET",
      ),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      calls.push(r);
      const p = new URL(r.url).pathname,
        override = overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      if (p === "/api/identity")
        return response({
          issuer: "local",
          subject: r.headers.get("X-Dev-Subject") ?? "cumulative-actor",
        });
      if (p === "/api/identity/capabilities")
        return response({ platformAdmin: true });
      if (p === "/api/organizations")
        return response(
          h.member
            ? [A, B].map((id) => ({
                id,
                name: `Organization ${id}`,
                role: h.role,
                status: "ACTIVE",
                version: 0,
              }))
            : [],
        );
      const org = p.includes(B) ? B : A;
      if (p === `/api/v1/organizations/${org}/projects/${P}`)
        return response(h.project(org));
      if (p === base(org)) return response(h.style());
      if (p === base(org) + "/requirement") return response(h.requirement());
      if (p === base(org) + "/material-selections")
        return response({
          items: [
            {
              id: uuid(20),
              styleId: S,
              materialId: M,
              variantId: V,
              listingId: L,
              createdAt: stamp,
            },
          ],
          limit: 25,
          offset: 0,
          hasMore: false,
        });
      if (p === base(org) + "/facility-candidates")
        return response({
          items: [
            { id: uuid(21), styleId: S, facilityId: F, createdAt: stamp },
          ],
          limit: 25,
          offset: 0,
          hasMore: false,
        });
      if (p === base(org) + "/development-references")
        return response({
          items: [h.reference()],
          limit: 25,
          offset: 0,
          hasMore: false,
        });
      if (p === `/api/v1/materials/${M}`)
        return response({
          id: M,
          displayName: "Synthetic global Material",
          status: "ACTIVE",
          materialType: "FABRIC",
          catalogSupplierId: U,
        });
      if (p === `/api/v1/material-variants/${V}`)
        return response({
          id: V,
          materialId: M,
          variantName: "Synthetic global Variant",
          status: "ACTIVE",
        });
      if (p === `/api/v1/material-listings/${L}`)
        return response({
          id: L,
          materialId: M,
          sellerArticleNumber: "Synthetic global Listing",
          status: "ACTIVE",
          sellerSupplierId: U,
        });
      if (p === `/api/v1/facilities/${F}`)
        return response({
          id: F,
          supplierId: U,
          name: "Synthetic global Facility",
          facilityType: "FACTORY",
          status: "ACTIVE",
        });
      if (p === `/api/v1/suppliers/${U}`)
        return response({
          id: U,
          displayName: "Synthetic global Supplier",
          status: "ACTIVE",
          verificationStatus: "DISCOVERED",
        });
      if (p === base(org) + `/development-references/${R}/content`)
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "application/octet-stream" },
        });
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
    mount: () =>
      render(
        <QueryClientProvider client={cache}>
          <MemoryRouter initialEntries={[route()]}>
            <App />
            <Nav />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  });
}
export async function ready() {
  for (const name of regions) await screen.findByRole("region", { name });
  await waitFor(() => {
    if (screen.queryByText("Loading Development References…"))
      throw Error("References pending");
  });
}
