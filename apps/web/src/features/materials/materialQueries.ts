import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { searchParams, type Filters } from "./filters";
export const materialOptions = (scope: string, filters: Filters, limit = 25) =>
  infiniteQueryOptions({
    queryKey: queryKeys.materials(scope, filters, limit),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET("/api/v1/materials", {
        signal,
        params: { query: searchParams(filters, limit, pageParam) },
      });
      return requireData(data, response);
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
export const supplierOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: queryKeys.supplier(scope, id),
    enabled: !!id,
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/suppliers/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(data, response);
    },
  });
export function useReferences() {
  const { scope } = useSession();
  const countries = useQuery({
    queryKey: queryKeys.countries(scope),
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/countries", { signal });
      return requireData(data, response);
    },
  });
  const fibers = useInfiniteQuery({
    queryKey: queryKeys.fibers(scope),
    staleTime: 300_000,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET("/api/v1/fiber-types", {
        signal,
        params: { query: { limit: 100, offset: pageParam } },
      });
      return requireData(data, response);
    },
    getNextPageParam: (page, _pages, offset) =>
      page.length === 100 ? offset + 100 : undefined,
  });
  return { countries, fibers, fiberList: fibers.data?.pages.flat() ?? [] };
}
export type References = ReturnType<typeof useReferences>;

export const detailOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: queryKeys.material(scope, id),
    enabled: !!id,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/materials/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(data, response);
    },
  });
export const variantOptions = (scope: string, id: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.materialChild(scope, id, "variants", 25),
    enabled: !!id,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/materials/{id}/variants",
        {
          signal,
          params: { path: { id }, query: { limit: 25, offset: pageParam } },
        },
      );
      return requireData(data, response);
    },
    getNextPageParam: (page, _pages, offset) =>
      page.length === 25 ? offset + 25 : undefined,
  });
