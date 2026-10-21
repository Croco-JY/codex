import {
  infiniteQueryOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { getSession } from "../../api/session";
import { detailOptions } from "../materials/materialQueries";
import { materialBaseline } from "./model";
export const listingOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: queryKeys.listing(scope, id),
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/material-listings/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const variantDetailOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: ["supply", scope, "variant", id],
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/material-variants/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const specOptions = (
  scope: string,
  id: string,
  type: "FABRIC" | "LEATHER",
) =>
  queryOptions({
    queryKey: ["supply", scope, "material", id, "admin-spec-read", type],
    retry: false,
    queryFn: async ({ signal }) => {
      const r =
        type === "FABRIC"
          ? await api.GET("/api/v1/materials/{id}/fabric-spec", {
              signal,
              params: { path: { id } },
            })
          : await api.GET("/api/v1/materials/{id}/leather-spec", {
              signal,
              params: { path: { id } },
            });
      return requireData(r.data, r.response);
    },
  });
export const listingsOptions = (
  scope: string,
  id: string,
  mode: "material" | "seller",
) =>
  infiniteQueryOptions({
    queryKey:
      mode === "material"
        ? queryKeys.materialChild(scope, id, "listings", 25)
        : ["supply", scope, "supplier", id, "material-listings", 25],
    initialPageParam: 0,
    enabled: !!id,
    queryFn: async ({ signal, pageParam }) => {
      const params = { path: { id }, query: { limit: 25, offset: pageParam } };
      const r =
        mode === "material"
          ? await api.GET("/api/v1/materials/{id}/listings", { signal, params })
          : await api.GET("/api/v1/suppliers/{id}/material-listings", {
              signal,
              params,
            });
      return requireData(r.data, r.response);
    },
    getNextPageParam: (p, _pages, offset) =>
      p.length === 25 && offset < 100000 ? offset + 25 : undefined,
  });
export async function refreshMaterial(
  cache: QueryClient,
  scope: string,
  id: string,
) {
  if (scope !== getSession().key) return undefined;
  const opts = detailOptions(scope, id);
  await cache.cancelQueries({ queryKey: opts.queryKey, exact: true });
  if (scope !== getSession().key) return undefined;
  try {
    const v = await cache.fetchQuery({ ...opts, staleTime: 0 });
    if (scope !== getSession().key) return undefined;
    const safe = materialBaseline(v);
    return safe?.id === id ? safe : undefined;
  } catch {
    return undefined;
  }
}
export async function invalidateCatalog(
  cache: QueryClient,
  scope: string,
  material?: string,
  seller?: string,
) {
  if (scope !== getSession().key) return;
  await Promise.all([
    ...(material
      ? [
          cache.invalidateQueries({
            queryKey: [
              "admin",
              scope,
              "catalog-citations",
              "materials",
              material,
            ],
          }),
        ]
      : []),
    cache.invalidateQueries({ queryKey: ["supply", scope, "materials"] }),
    cache.invalidateQueries({ queryKey: ["admin", scope, "material-search"] }),
    cache.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "supply" &&
        q.queryKey[1] === scope &&
        q.queryKey[2] === "supplier" &&
        (q.queryKey.includes("catalog-materials") ||
          q.queryKey.includes("material-listings")),
    }),
    ...(material
      ? [
          cache.invalidateQueries({
            queryKey: queryKeys.material(scope, material),
            exact: true,
          }),
        ]
      : []),
    ...(seller
      ? [
          cache.invalidateQueries({
            queryKey: [
              "supply",
              scope,
              "supplier",
              seller,
              "material-listings",
            ],
          }),
        ]
      : []),
  ]);
}
