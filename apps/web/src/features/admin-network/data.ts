import {
  queryOptions,
  infiniteQueryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { getSession } from "../../api/session";
import { supplierOptions } from "../materials/materialQueries";
import { supplierBaseline, facilityBaseline } from "./model";

export const supplierChildKey = (scope: string, id: string, kind: string) =>
  ["supply", scope, "supplier", id, kind, 25] as const;
export const aliasOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: supplierChildKey(scope, id, "aliases"),
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/suppliers/{id}/aliases", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const verificationOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: supplierChildKey(scope, id, "verification-events"),
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/suppliers/{id}/verification-events", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const facilityOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: queryKeys.facility(scope, id),
    enabled: !!id,
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/facilities/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const summaryOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: [...queryKeys.facility(scope, id), "capabilities"],
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/facilities/{id}/capabilities", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
export const citationOptions = (
  scope: string,
  kind: "suppliers" | "facilities",
  id: string,
) =>
  queryOptions({
    queryKey: queryKeys.adminCitations(scope, kind, id),
    queryFn: async ({ signal }) => {
      const r =
        kind === "suppliers"
          ? await api.GET("/api/v1/admin/suppliers/{id}/sources", {
              signal,
              params: { path: { id } },
            })
          : await api.GET("/api/v1/admin/facilities/{id}/sources", {
              signal,
              params: { path: { id } },
            });
      return requireData(r.data, r.response);
    },
  });
export const assignmentOptions = (
  scope: string,
  id: string,
  capability: string,
) =>
  queryOptions({
    queryKey: queryKeys.adminAssignment(scope, id, capability),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const r = await api.GET(
        "/api/v1/admin/facilities/{id}/capabilities/{capability}",
        { signal, params: { path: { id, capability } } },
      );
      return requireData(r.data, r.response);
    },
  });
export const geographyOptions = (
  scope: string,
  kind: "regions" | "industrial-clusters",
  country: string,
) =>
  infiniteQueryOptions({
    queryKey: ["supply", scope, "network-reference", kind, { country }],
    enabled: !!country,
    staleTime: 300_000,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const query = { country, limit: 100, offset: pageParam };
      const r =
        kind === "regions"
          ? await api.GET("/api/v1/regions", { signal, params: { query } })
          : await api.GET("/api/v1/industrial-clusters", {
              signal,
              params: { query },
            });
      return requireData(r.data, r.response);
    },
    getNextPageParam: (p, _pages, offset) =>
      p.length === 100 && offset + 100 <= 100000 ? offset + 100 : undefined,
  });
export async function refreshSupplier(
  cache: QueryClient,
  scope: string,
  id: string,
) {
  if (scope !== getSession().key) return undefined;
  const options = supplierOptions(scope, id);
  await cache.cancelQueries({ queryKey: options.queryKey, exact: true });
  if (scope !== getSession().key) return undefined;
  try {
    const current = await cache.fetchQuery({ ...options, staleTime: 0 });
    const safe = supplierBaseline(current);
    return safe?.id === id ? safe : undefined;
  } catch {
    return undefined;
  }
}
export async function refreshFacility(
  cache: QueryClient,
  scope: string,
  id: string,
) {
  if (scope !== getSession().key) return undefined;
  const options = facilityOptions(scope, id);
  await cache.cancelQueries({ queryKey: options.queryKey, exact: true });
  if (scope !== getSession().key) return undefined;
  try {
    const current = await cache.fetchQuery({ ...options, staleTime: 0 });
    const safe = facilityBaseline(current);
    return safe?.id === id ? safe : undefined;
  } catch {
    return undefined;
  }
}
export async function invalidateSupplier(
  cache: QueryClient,
  scope: string,
  id?: string,
) {
  await Promise.all([
    cache.invalidateQueries({
      queryKey: ["supply", scope, "supplier-directory"],
    }),
    cache.invalidateQueries({ queryKey: ["supply", scope, "supplier-search"] }),
    cache.invalidateQueries({
      queryKey: ["supply", scope, "facility-directory"],
    }),
    ...(id
      ? [cache.invalidateQueries({ queryKey: queryKeys.supplier(scope, id) })]
      : []),
  ]);
}
export async function invalidateFacility(
  cache: QueryClient,
  scope: string,
  parent: string,
  id?: string,
) {
  await Promise.all([
    cache.invalidateQueries({
      queryKey: ["supply", scope, "facility-directory"],
    }),
    cache.invalidateQueries({
      queryKey: ["supply", scope, "supplier-directory"],
    }),
    cache.invalidateQueries({
      queryKey: supplierChildKey(scope, parent, "facilities"),
    }),
    ...(id
      ? [cache.invalidateQueries({ queryKey: queryKeys.facility(scope, id) })]
      : []),
  ]);
}
