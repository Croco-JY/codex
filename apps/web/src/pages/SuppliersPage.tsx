import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { useSession } from "../app/session";
import { Skeleton, Stack, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Pagination } from "../features/commercial/ReadUI";
import {
  parseDirectory,
  serializeDirectory,
  type SupplierFilters,
} from "../features/network/filters";
import { DirectoryFilters } from "../features/network/DirectoryFilters";
import {
  countryName,
  useNetworkReferences,
} from "../features/network/references";
import { titleCase } from "../features/materials/MaterialSummary";
export default function SuppliersPage() {
  const [search, setSearch] = useSearchParams();
  const parsed = useMemo(
    () => parseDirectory("suppliers", search.toString()),
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
  const keyFor = (filters: SupplierFilters) =>
    ["supply", scope, "supplier-directory", filters, 25] as const;
  const queryKey = keyFor(parsed.filters);
  const results = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET("/api/v1/suppliers", {
        signal,
        params: { query: { ...parsed.filters, limit: 25, cursor: pageParam } },
      });
      const page = requireData(data, response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
  const apply = (filters: SupplierFilters) => {
    const canonical = serializeDirectory("suppliers", filters);
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
        <h1>Suppliers</h1>
        <p className="lead">
          Explore canonical Supplier records and their recorded sourcing
          relationships.
        </p>
      </header>
      {cleaned && (
        <p role="status" className="notice">
          Unsupported or invalid URL filters were removed.
        </p>
      )}
      <DirectoryFilters
        key={parsed.canonical}
        applied={parsed.filters}
        refs={refs}
        apply={apply}
      />
      <section aria-label="Supplier results" aria-busy={results.isFetching}>
        <h2>Active suppliers</h2>
        {results.isPending ? (
          <Skeleton label="Searching suppliers" />
        ) : results.isError && !results.isFetchNextPageError ? (
          <ApiErrorState
            error={results.error}
            retry={() => void results.refetch()}
          />
        ) : (
          <>
            <p role="status">{items.length} suppliers loaded</p>
            {!items.length ? (
              <p>No suppliers match these filters.</p>
            ) : (
              <ul className="read-list">
                {items.map((s, i) => (
                  <li key={s.id ?? i}>
                    <h3>
                      {s.id ? (
                        <Link
                          to={`/suppliers/${s.id}`}
                          state={{
                            networkReturn: `/suppliers${parsed.canonical ? `?${parsed.canonical}` : ""}`,
                          }}
                        >
                          {s.displayName || "Supplier name not entered"}
                        </Link>
                      ) : (
                        "Supplier unavailable"
                      )}
                    </h3>
                    <p>
                      Supplier country:{" "}
                      {countryName(refs, undefined, s.country)}
                    </p>
                    <StatusBadge>{titleCase(s.verificationStatus)}</StatusBadge>
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
              noun="suppliers"
            />
          </>
        )}
      </section>
    </Stack>
  );
}
