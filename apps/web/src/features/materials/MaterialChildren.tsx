import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts, Pagination } from "../commercial/ReadUI";
import { ListingTerms } from "../commercial/ListingTerms";
import { titleCase, type Material } from "./MaterialSummary";
import { variantOptions } from "./materialQueries";

export function PhysicalSpec({ material }: { material: Material }) {
  const { scope } = useSession();
  const type = material.materialType;
  const query = useQuery({
    queryKey: queryKeys.materialChild(
      scope,
      material.id ?? "",
      "physical",
      type,
    ),
    enabled: !!material.id && (type === "FABRIC" || type === "LEATHER"),
    queryFn: async ({ signal }) => {
      if (type === "FABRIC") {
        const { data, response } = await api.GET(
          "/api/v1/materials/{id}/fabric-spec",
          { signal, params: { path: { id: material.id! } } },
        );
        return { fabric: requireData(data, response) };
      }
      const { data, response } = await api.GET(
        "/api/v1/materials/{id}/leather-spec",
        { signal, params: { path: { id: material.id! } } },
      );
      return { leather: requireData(data, response) };
    },
  });
  const fabric = query.data?.fabric;
  const leather = query.data?.leather;
  const values: [string, string | undefined][] = fabric
    ? [
        ["Construction", fabric.construction],
        ["Weave", fabric.weaveType],
        ["Knit", fabric.knitType],
        ["GSM", fabric.gsm],
        ["Width (mm)", fabric.widthMm],
        ["Thickness (mm)", fabric.thicknessMm],
        ["Warp stretch (%)", fabric.stretchWarpPercentage],
        ["Weft stretch (%)", fabric.stretchWeftPercentage],
        ["Warp shrinkage (%)", fabric.shrinkageWarpPercentage],
        ["Weft shrinkage (%)", fabric.shrinkageWeftPercentage],
        ["Finish", fabric.finish],
        ["Surface", fabric.surface],
        ["Handfeel", fabric.handfeel],
        ["Drape", fabric.drape],
        ["Luster", fabric.luster],
      ]
    : leather
      ? [
          ["Hide type", leather.hideType],
          ["Tanning", leather.tanningMethod],
          ["Minimum thickness (mm)", leather.thicknessMinMm],
          ["Maximum thickness (mm)", leather.thicknessMaxMm],
          ["Average hide area (m²)", leather.averageHideAreaM2],
          ["Finish", leather.finish],
          ["Surface", leather.surface],
          ["Handfeel", leather.handfeel],
          ["Luster", leather.luster],
        ]
      : [];

  return (
    <Surface>
      <h2>Physical specification</h2>
      {type !== "FABRIC" && type !== "LEATHER" ? (
        <p>No subtype specification is exposed for this material type.</p>
      ) : query.isPending ? (
        <Skeleton label="Loading physical specification" />
      ) : query.error instanceof ApiError && query.error.status === 404 ? (
        <p>Physical specification not entered</p>
      ) : query.isError ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <Facts values={values} />
      )}
    </Surface>
  );
}
export function MaterialVariants({ id }: { id: string }) {
  const { scope } = useSession();
  const cache = useQueryClient();
  const options = variantOptions(scope, id);
  const query = useInfiniteQuery(options);
  const rows = query.data?.pages.flat() ?? [];
  return (
    <Surface>
      <h2>Variants</h2>
      <p className="muted">
        Variants describe this catalog Material. No Variant is selected
        automatically for a price lookup.
      </p>
      {query.isPending ? (
        <Skeleton label="Loading variants" />
      ) : query.isError && !query.isFetchNextPageError ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <p>{rows.length} variants loaded</p>
          <ul className="read-list">
            {rows.map((variant, index) => (
              <li key={variant.id ?? index}>
                <h3>{variant.variantName || "Variant name not entered"}</h3>
                <Facts
                  values={[
                    ["Catalog variant SKU", variant.catalogVariantSku],
                    ["Color", variant.colorName],
                    ["Color code", variant.colorCode],
                    ["Batch", variant.batchNumber],
                    ["Status", titleCase(variant.status)],
                  ]}
                />
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p>No variants entered</p>}
          <Pagination
            noun="variants"
            hasNext={!!query.hasNextPage}
            fetching={query.isFetching}
            error={query.isFetchNextPageError ? query.error : null}
            next={() => void query.fetchNextPage({ cancelRefetch: false })}
            reload={() =>
              void cache.resetQueries({
                queryKey: options.queryKey,
                exact: true,
              })
            }
          />
        </>
      )}
    </Surface>
  );
}
export function MaterialListings({
  id,
  returnTo,
}: {
  id: string;
  returnTo: string;
}) {
  const { scope } = useSession();
  const cache = useQueryClient();
  const key = queryKeys.materialChild(scope, id, "listings", 25);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/materials/{id}/listings",
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
  const rows = query.data?.pages.flat() ?? [];
  return (
    <Surface>
      <h2>Seller Listings</h2>
      <p className="muted">
        Seller terms belong to each Listing. These are loaded Listings for this
        Material, independently of your discovery filters.
      </p>
      {query.isPending ? (
        <Skeleton label="Loading seller Listings" />
      ) : query.isError && !query.isFetchNextPageError ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          <p>{rows.length} listings loaded</p>
          <ul className="read-list">
            {rows.map((listing, index) => (
              <li key={listing.id ?? index}>
                <h3>
                  {listing.id ? (
                    <Link
                      to={`/material-listings/${encodeURIComponent(listing.id)}`}
                      state={{ discoveryReturn: returnTo }}
                    >
                      Open seller Listing
                      {listing.sellerArticleNumber
                        ? ` · ${listing.sellerArticleNumber}`
                        : ""}
                    </Link>
                  ) : (
                    "Listing unavailable"
                  )}
                </h3>
                <ListingTerms listing={listing} />
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p>No seller Listings entered</p>}
          <Pagination
            noun="listings"
            hasNext={!!query.hasNextPage}
            fetching={query.isFetching}
            error={query.isFetchNextPageError ? query.error : null}
            next={() => void query.fetchNextPage({ cancelRefetch: false })}
            reload={() =>
              void cache.resetQueries({ queryKey: key, exact: true })
            }
          />
        </>
      )}
    </Surface>
  );
}
