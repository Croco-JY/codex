import {
  infiniteQueryOptions,
  type QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { components } from "../../api/schema";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { getSession } from "../../api/session";
import { nextOffset } from "../admin-sources/data";
export const evidenceOptions = (scope: string, id: string) =>
  infiniteQueryOptions({
    queryKey: [...queryKeys.admin(scope), "price", id, "evidence", 25],
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET("/api/v1/admin/material-prices/{id}/sources", {
        signal,
        params: { path: { id }, query: { limit: 25, offset: pageParam } },
      });
      const rows = requireData(r.data, r.response);
      if (!Array.isArray(rows))
        throw new ApiError(
          502,
          r.response.headers.get("X-Request-ID") ?? undefined,
        );
      return rows;
    },
    getNextPageParam: nextOffset,
  });
export const priceHistoryOptions = (scope: string, id: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.commercial(scope, id, "price-history", {}),
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET("/api/v1/material-listings/{id}/prices", {
        signal,
        params: {
          path: { id },
          query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      });
      const page = requireData(r.data, r.response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
export const inventoryHistoryOptions = (scope: string, id: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.commercial(scope, id, "inventory-history", {}),
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET(
        "/api/v1/material-listings/{id}/inventory-snapshots",
        {
          signal,
          params: {
            path: { id },
            query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        },
      );
      const page = requireData(r.data, r.response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
const prefix = (scope: string, id: string, kind: string) => [
  "supply",
  scope,
  "listing",
  id,
  kind,
];
export async function refreshPrices(
  cache: QueryClient,
  scope: string,
  id: string,
  restart = false,
) {
  if (getSession().key !== scope) return;
  const history = prefix(scope, id, "price-history");
  if (restart) await cache.resetQueries({ queryKey: history });
  else await cache.invalidateQueries({ queryKey: history });
  if (getSession().key !== scope) return;
  await cache.invalidateQueries({
    queryKey: prefix(scope, id, "effective-prices"),
  });
  if (getSession().key !== scope) return;
  // A selected older Price can be visible in a filtered/loaded cursor scope
  // while absent from the unfiltered first page. Use only freshly refetched
  // active pages, never stale inactive cache, alongside the bounded fallback.
  const visible = cache
    .getQueriesData<InfiniteData<components["schemas"]["PagePriceView"]>>({
      queryKey: history,
      type: "active",
      predicate: (q) => !q.state.isInvalidated && q.state.status === "success",
    })
    .flatMap(([, data]) => data?.pages.flatMap((p) => p.items ?? []) ?? []);
  try {
    const p = await cache.fetchInfiniteQuery(priceHistoryOptions(scope, id));
    return getSession().key === scope
      ? [...p.pages.flatMap((p) => p.items ?? []), ...visible]
      : undefined;
  } catch {
    return getSession().key === scope ? visible : undefined;
  }
}
export async function refreshInventory(
  cache: QueryClient,
  scope: string,
  id: string,
) {
  if (getSession().key !== scope) return;
  await Promise.all([
    cache.resetQueries({ queryKey: prefix(scope, id, "inventory-current") }),
    cache.resetQueries({ queryKey: prefix(scope, id, "inventory-history") }),
  ]);
  if (getSession().key !== scope) return;
  try {
    const p = await cache.fetchInfiniteQuery(
      inventoryHistoryOptions(scope, id),
    );
    return getSession().key === scope
      ? p.pages.flatMap((p) => p.items ?? [])
      : undefined;
  } catch {
    return undefined;
  }
}
