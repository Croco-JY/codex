import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
export const countryOptions = (scope: string) =>
  queryOptions({
    queryKey: queryKeys.countries(scope),
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/countries", { signal });
      return requireData(data, response);
    },
  });
export const referenceOptions = (
  scope: string,
  kind: "regions" | "industrial-clusters" | "capabilities",
) =>
  infiniteQueryOptions({
    queryKey: ["supply", scope, "network-reference", kind] as const,
    staleTime: 300_000,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const query = { limit: 100, offset: pageParam };
      const result =
        kind === "regions"
          ? await api.GET("/api/v1/regions", { signal, params: { query } })
          : kind === "industrial-clusters"
            ? await api.GET("/api/v1/industrial-clusters", {
                signal,
                params: { query },
              })
            : await api.GET("/api/v1/capabilities", {
                signal,
                params: { query },
              });
      return requireData(result.data, result.response);
    },
    getNextPageParam: (page, _pages, offset) =>
      page.length === 100 ? offset + 100 : undefined,
  });
export function useNetworkReferences() {
  const { scope } = useSession();
  return {
    countries: useQuery(countryOptions(scope)),
    regions: useInfiniteQuery(referenceOptions(scope, "regions")),
    clusters: useInfiniteQuery(referenceOptions(scope, "industrial-clusters")),
    capabilities: useInfiniteQuery(referenceOptions(scope, "capabilities")),
  };
}
export type NetworkReferences = ReturnType<typeof useNetworkReferences>;
export const referenceName = (v: {
  nameEn?: string;
  nameNative?: string;
  nameLocal?: string;
}) => v.nameNative || v.nameLocal || v.nameEn || "Label unavailable";
export function countryName(
  refs: NetworkReferences,
  id?: string,
  alpha2?: string,
) {
  if (!id && !alpha2) return "Country not recorded";
  const country = refs.countries.data?.find((c) =>
    id ? c.id === id : c.alpha2 === alpha2,
  );
  return country
    ? referenceName(country)
    : refs.countries.isPending
      ? "Loading country label…"
      : `Country label unavailable (${alpha2 || id})`;
}
export function geographyName(
  refs: NetworkReferences,
  kind: "regions" | "clusters",
  id?: string,
) {
  const noun = kind === "regions" ? "Region" : "Industrial Cluster";
  if (!id) return `${noun} not recorded`;
  const query = refs[kind],
    record = query.data?.pages.flat().find((v) => v.id === id);
  return record
    ? referenceName(record)
    : `${noun} label unavailable · Reference: ${id}`;
}
