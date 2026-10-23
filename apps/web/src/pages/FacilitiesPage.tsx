import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useSession } from "../app/session";
import { Skeleton, Stack } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Facts, Pagination } from "../features/commercial/ReadUI";
import {
  parseDirectory,
  serializeDirectory,
  type FacilityFilters,
} from "../features/network/filters";
import { DirectoryFilters } from "../features/network/DirectoryFilters";
import {
  countryName,
  geographyName,
  useNetworkReferences,
} from "../features/network/references";
import { SupplierLabel } from "../features/materials/SupplierPicker";
import { titleCase } from "../features/materials/MaterialSummary";
import {
  facilityDirectoryKey,
  facilityDirectoryOptions,
} from "../features/network/facilityQueries";
export default function FacilitiesPage({
  curation = false,
  children,
}: { curation?: boolean; children?: ReactNode } = {}) {
  const [search, setSearch] = useSearchParams();
  const parsed = useMemo(
    () => parseDirectory("facilities", search.toString()),
    [search],
  );
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => {
    if (parsed.cleaned) {
      setCleaned(true);
      setSearch(parsed.canonical, { replace: true });
    }
  }, [parsed.cleaned, parsed.canonical, setSearch]);
  const { scope } = useSession(),
    cache = useQueryClient(),
    refs = useNetworkReferences();
  const keyFor = (filters: FacilityFilters) =>
    facilityDirectoryKey(scope, filters);
  const queryKey = keyFor(parsed.filters);
  const results = useInfiniteQuery(
    facilityDirectoryOptions(scope, parsed.filters),
  );
  const apply = (filters: FacilityFilters) => {
    const canonical = serializeDirectory("facilities", filters);
    setCleaned(false);
    if (canonical === parsed.canonical)
      void cache.resetQueries({ queryKey, exact: true });
    else cache.removeQueries({ queryKey: keyFor(filters), exact: true });
    setSearch(canonical);
  };
  const items = results.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <Stack>
      <header>
        <p className="eyebrow">SUPPLY NETWORK</p>
        <h1>Facilities</h1>
        <p className="lead">
          Explore recorded physical sites by geography, Facility type and
          capabilities.
        </p>
      </header>
      {children}
      {cleaned && (
        <p role="status" className="notice">
          Unsupported or invalid URL filters were removed.
        </p>
      )}
      <DirectoryFilters
        kind="facilities"
        key={parsed.canonical}
        applied={parsed.filters}
        refs={refs}
        apply={apply}
      />
      <section aria-label="Facility results" aria-busy={results.isFetching}>
        <h2>Active facilities</h2>
        {results.isPending ? (
          <Skeleton label="Searching facilities" />
        ) : results.isError && !results.isFetchNextPageError ? (
          <ApiErrorState
            error={results.error}
            retry={() => void results.refetch()}
          />
        ) : (
          <>
            <p role="status">{items.length} facilities loaded</p>
            {!items.length ? (
              <p>No facilities match these filters.</p>
            ) : (
              <ul className="read-list">
                {items.map((f, i) => (
                  <li key={f.id ?? i}>
                    <h3>
                      {f.id ? (
                        <Link
                          to={`${curation ? "/admin" : ""}/facilities/${f.id}`}
                          state={{
                            networkReturn: `/facilities${parsed.canonical ? `?${parsed.canonical}` : ""}`,
                          }}
                        >
                          {f.name || "Facility name not entered"}
                        </Link>
                      ) : (
                        "Facility unavailable"
                      )}
                    </h3>
                    <Facts
                      values={[
                        ["Facility type", titleCase(f.facilityType)],
                        ["Country", countryName(refs, undefined, f.country)],
                        ["Region", geographyName(refs, "regions", f.regionId)],
                        [
                          "Industrial Cluster",
                          geographyName(
                            refs,
                            "clusters",
                            f.industrialClusterId,
                          ),
                        ],
                      ]}
                    />
                    {f.supplierId && (
                      <p>
                        Parent Supplier:{" "}
                        <Link
                          to={`${curation ? "/admin" : ""}/suppliers/${f.supplierId}`}
                          state={{
                            networkReturn: `/facilities${parsed.canonical ? `?${parsed.canonical}` : ""}`,
                          }}
                        >
                          <SupplierLabel id={f.supplierId} />
                        </Link>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Pagination
              hasNext={!!results.hasNextPage}
              fetching={results.isFetching}
              error={results.isFetchNextPageError ? results.error : undefined}
              next={() => void results.fetchNextPage({ cancelRefetch: false })}
              reload={() => void cache.resetQueries({ queryKey, exact: true })}
              noun="facilities"
            />
          </>
        )}
      </section>
    </Stack>
  );
}
