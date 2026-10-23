import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import type { FacilityFilters } from "./filters";

export const facilityDirectoryKey = (scope: string, filters: FacilityFilters) =>
  ["supply", scope, "facility-directory", filters, 25] as const;

export const facilityDirectoryOptions = (
  scope: string,
  filters: FacilityFilters,
) =>
  infiniteQueryOptions({
    queryKey: facilityDirectoryKey(scope, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET("/api/v1/facilities", {
        signal,
        params: { query: { ...filters, limit: 25, cursor: pageParam } },
      });
      const page = requireData(data, response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });

export const facilityOptions = (scope: string, id: string) =>
  queryOptions({
    queryKey: queryKeys.facility(scope, id),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const r = await api.GET("/api/v1/facilities/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(r.data, r.response);
    },
  });
