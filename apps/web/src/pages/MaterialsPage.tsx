import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../api/errors";
import { useSession } from "../app/session";
import { Button, EmptyState, Skeleton, Stack, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import {
  commercialKeys,
  filterKeys,
  filterLabels,
  parseFilters,
  removeFilter,
  serializeFilters,
  type FilterKey,
  type Filters,
} from "../features/materials/filters";
import { MaterialFilters } from "../features/materials/MaterialFilters";
import {
  Composition,
  MaterialFacts,
  originLabel,
  titleCase,
} from "../features/materials/MaterialSummary";
import {
  materialOptions,
  useReferences,
} from "../features/materials/materialQueries";
import { SupplierLabel } from "../features/materials/SupplierPicker";
export default function MaterialsPage() {
  const [search, setSearch] = useSearchParams();
  const parsed = useMemo(() => parseFilters(search.toString()), [search]);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => {
    if (parsed.cleaned) {
      setCleaned(true);
      setSearch(parsed.canonical, { replace: true });
    }
  }, [parsed.cleaned, parsed.canonical, setSearch]);
  const { scope } = useSession();
  const cache = useQueryClient();
  const references = useReferences();
  const options = materialOptions(scope, parsed.filters);
  const results = useInfiniteQuery({
    ...options,
    placeholderData: keepPreviousData,
  });
  const items = results.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const active = filterKeys.filter((key) => parsed.filters[key] !== undefined);
  const commercial = commercialKeys.some(
    (key) => parsed.filters[key] !== undefined,
  );
  const apply = (filters: Filters) => {
    setCleaned(false);
    // Applying filters starts a fresh cursor sequence, including a previously cached search.
    const target = materialOptions(scope, filters).queryKey;
    if (serializeFilters(filters) === parsed.canonical) {
      void cache.resetQueries({ queryKey: target, exact: true });
    } else {
      cache.setQueryData(options.queryKey, (previous: typeof results.data) =>
        previous
          ? {
              ...previous,
              pages: previous.pages.slice(0, 1),
              pageParams: previous.pageParams.slice(0, 1),
            }
          : previous,
      );
      cache.removeQueries({ queryKey: target, exact: true });
    }
    setSearch(serializeFilters(filters));
  };
  const chipValue = (key: FilterKey) => {
    const value = parsed.filters[key];
    if (key === "catalogSupplierId" || key === "sellerSupplierId")
      return <SupplierLabel id={String(value)} />;
    if (key === "originCountryId")
      return originLabel(String(value), references);
    if (key === "fiberTypeId") {
      const fiber = references.fiberList.find((fiber) => fiber.id === value);
      return (
        fiber?.nameEn ||
        fiber?.nameLocal ||
        fiber?.code ||
        "Fiber label unavailable"
      );
    }
    return typeof value === "string" &&
      (key === "materialType" || key === "listingStatus")
      ? titleCase(value)
      : String(value);
  };
  return (
    <Stack>
      <header>
        <p className="eyebrow">MATERIAL SOURCING</p>
        <h1>Find your next material.</h1>
        <p className="lead">
          Explore active catalog materials by origin, composition and the needs
          of your next product.
        </p>
      </header>
      {cleaned && (
        <p role="status" className="notice">
          Unsupported or invalid URL filters were removed. This workspace
          searches active materials.
        </p>
      )}
      <div className="material-workspace">
        <MaterialFilters
          key={parsed.canonical}
          applied={parsed.filters}
          references={references}
          apply={apply}
          clear={() => apply({})}
        />
        <section
          className="material-results"
          aria-label="Material results"
          aria-busy={results.isFetching}
        >
          <div className="section-heading">
            <h2>Active materials</h2>
            <span className="muted">
              {results.isPending
                ? "Searching…"
                : results.isPlaceholderData
                  ? "Updating results…"
                  : results.isError && !results.isFetchNextPageError
                    ? "Search unavailable"
                    : `${items.length} loaded`}
            </span>
          </div>
          {active.length > 0 && (
            <ul className="filter-chips" aria-label="Applied filters">
              {active.map((key) => (
                <li key={key}>
                  <span>
                    {filterLabels[key]}: {chipValue(key)}
                  </span>
                  <Button
                    className="chip-remove"
                    aria-label={`Remove ${filterLabels[key].toLowerCase()} filter`}
                    onClick={() => apply(removeFilter(parsed.filters, key))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {commercial && (
            <p className="notice">
              Materials with at least one seller listing matching these terms.
            </p>
          )}
          {results.isPlaceholderData && (
            <p role="status">
              Updating results. Previous search results remain visible.
            </p>
          )}
          {results.isPending ? (
            <Skeleton label="Searching materials" />
          ) : results.isError && !results.isFetchNextPageError ? (
            <ApiErrorState
              error={results.error}
              retry={() => void results.refetch()}
            />
          ) : items.length === 0 ? (
            <div role="status">
              <EmptyState
                title={
                  active.length
                    ? "No materials match these filters"
                    : "No active materials yet"
                }
              >
                {active.length
                  ? "Try fewer criteria or clear the filters to explore the catalog."
                  : "Active catalog materials will appear here when available."}
              </EmptyState>
              {active.length > 0 && (
                <Button className="secondary" onClick={() => apply({})}>
                  Clear applied filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <ul className="material-list">
                {items.map((material, index) => (
                  <li className="material-card" key={material.id ?? index}>
                    <div className="section-heading">
                      <span className="eyebrow">
                        {titleCase(material.materialType)}
                      </span>
                      <StatusBadge>
                        {titleCase(material.compositionCompleteness)}{" "}
                        composition
                      </StatusBadge>
                    </div>
                    <h3>
                      {material.id ? (
                        <Link
                          to={`/materials/${encodeURIComponent(material.id)}`}
                          state={{
                            discoveryReturn: `/materials${parsed.canonical ? `?${parsed.canonical}` : ""}`,
                          }}
                        >
                          {material.displayName || "Material name not entered"}
                        </Link>
                      ) : (
                        "Material unavailable"
                      )}
                    </h3>
                    <MaterialFacts
                      material={material}
                      references={references}
                    />
                    <Composition material={material} references={references} />
                  </li>
                ))}
              </ul>
              {results.isFetchNextPageError && (
                <div role="alert">
                  {results.error instanceof ApiError &&
                  results.error.status === 400 ? (
                    <>
                      <p>
                        The results cursor is no longer usable. Keep these
                        filters and reload the first results.
                      </p>
                      <Button
                        onClick={() =>
                          void cache.resetQueries({
                            queryKey: options.queryKey,
                            exact: true,
                          })
                        }
                      >
                        Reload first results
                      </Button>
                    </>
                  ) : (
                    <ApiErrorState
                      error={results.error}
                      retry={() =>
                        void results.fetchNextPage({ cancelRefetch: false })
                      }
                    />
                  )}
                </div>
              )}
              {results.hasNextPage && (
                <Button
                  className="load-more"
                  disabled={
                    results.isFetching ||
                    results.isPlaceholderData ||
                    results.isFetchNextPageError
                  }
                  onClick={() =>
                    void results.fetchNextPage({ cancelRefetch: false })
                  }
                >
                  {results.isFetchingNextPage
                    ? "Loading more materials…"
                    : "Load more"}
                </Button>
              )}
              <p role="status" className="result-status">
                {results.isFetchingNextPage
                  ? "Loading more materials; loaded results remain available."
                  : results.isPlaceholderData
                    ? ""
                    : `${items.length} materials loaded${results.hasNextPage ? ". More results available." : "."}`}
              </p>
            </>
          )}
        </section>
      </div>
    </Stack>
  );
}
