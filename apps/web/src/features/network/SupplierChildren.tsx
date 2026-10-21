import type { ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts, Pagination } from "../commercial/ReadUI";
import { titleCase } from "../materials/MaterialSummary";
import { ListingTerms } from "../commercial/ListingTerms";
import { countryName, type NetworkReferences } from "./references";
export function ChildSection({
  title,
  pending,
  error,
  retry,
  children,
}: {
  title: string;
  pending: boolean;
  error: unknown;
  retry: () => void;
  children: ReactNode;
}) {
  return (
    <Surface aria-label={title}>
      <h2>{title}</h2>
      {pending ? (
        <Skeleton label={`Loading ${title.toLowerCase()}`} />
      ) : error ? (
        <ApiErrorState error={error} retry={retry} />
      ) : (
        children
      )}
    </Surface>
  );
}
const childKey = (scope: string, id: string, kind: string) =>
  ["supply", scope, "supplier", id, kind, 25] as const;
export function SupplierAliases({ id }: { id: string }) {
  const { scope } = useSession();
  const query = useQuery({
    queryKey: childKey(scope, id, "aliases"),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET(
        "/api/v1/suppliers/{id}/aliases",
        { signal, params: { path: { id } } },
      );
      return requireData(data, response);
    },
  });
  return (
    <ChildSection
      title="Aliases"
      pending={query.isPending}
      error={query.error}
      retry={() => void query.refetch()}
    >
      <ul className="read-list">
        {query.data?.map((a, i) => (
          <li key={a.id ?? i}>
            <h3>{a.alias || "Alias not entered"}</h3>
            <Facts
              values={[
                ["Alias type", titleCase(a.aliasType)],
                ["Language", a.languageCode],
              ]}
            />
          </li>
        ))}
      </ul>
      {query.data?.length === 0 && (
        <p>No aliases recorded for this Supplier.</p>
      )}
      {query.data?.length === 100 && (
        <p className="muted">
          First 100 aliases; further records are not exposed by this read.
        </p>
      )}
    </ChildSection>
  );
}
export function SupplierVerification({ id }: { id: string }) {
  const { scope } = useSession();
  const query = useQuery({
    queryKey: childKey(scope, id, "verification-events"),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET(
        "/api/v1/suppliers/{id}/verification-events",
        { signal, params: { path: { id } } },
      );
      return requireData(data, response);
    },
  });
  return (
    <ChildSection
      title="Verification history"
      pending={query.isPending}
      error={query.error}
      retry={() => void query.refetch()}
    >
      <p className="muted">
        History explains transitions. The Supplier identity shows the
        authoritative current state.
      </p>
      <ul className="read-list">
        {query.data?.map((v, i) => (
          <li key={v.id ?? i}>
            <h3>
              {titleCase(v.previousStatus)} → {titleCase(v.newStatus)}
            </h3>
            <Facts
              values={[
                ["Occurred at (UTC)", v.occurredAt],
                ["Reason", v.reason],
              ]}
            />
          </li>
        ))}
      </ul>
      {query.data?.length === 0 && (
        <p>No verification history recorded for this Supplier.</p>
      )}
      {query.data?.length === 100 && (
        <p className="muted">
          Latest 100 events; further history is not exposed by this read.
        </p>
      )}
    </ChildSection>
  );
}
export function SupplierFacilities({
  id,
  refs,
  directory,
  curation = false,
}: {
  id: string;
  refs: NetworkReferences;
  directory: string;
  curation?: boolean;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    queryKey = childKey(scope, id, "facilities");
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/suppliers/{id}/facilities",
        {
          signal,
          params: { path: { id }, query: { limit: 25, cursor: pageParam } },
        },
      );
      const page = requireData(data, response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <ChildSection
      title="Facilities"
      pending={query.isPending}
      error={query.isFetchNextPageError ? undefined : query.error}
      retry={() => void query.refetch()}
    >
      <p>{rows.length} facilities loaded</p>
      <ul className="read-list">
        {rows.map((f, i) => (
          <li key={f.id ?? i}>
            <h3>
              {f.id ? (
                <Link
                  to={`${curation ? "/admin" : ""}/facilities/${f.id}`}
                  state={{
                    networkReturn: `/suppliers/${id}`,
                    networkDirectory: directory,
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
                ["Facility country", countryName(refs, undefined, f.country)],
              ]}
            />
          </li>
        ))}
      </ul>
      {!rows.length && (
        <p>
          {curation
            ? "No Facilities returned in this active-directory view. Known Facility detail links remain usable."
            : "No facilities recorded for this Supplier."}
        </p>
      )}
      <Pagination
        noun="facilities"
        hasNext={!!query.hasNextPage}
        fetching={query.isFetching}
        error={query.isFetchNextPageError ? query.error : undefined}
        next={() => void query.fetchNextPage({ cancelRefetch: false })}
        reload={() => void cache.resetQueries({ queryKey, exact: true })}
      />
    </ChildSection>
  );
}
export function SupplierCatalog({
  id,
  directory,
}: {
  id: string;
  directory: string;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    queryKey = childKey(scope, id, "catalog-materials");
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/suppliers/{id}/catalog-materials",
        {
          signal,
          params: { path: { id }, query: { limit: 25, cursor: pageParam } },
        },
      );
      const page = requireData(data, response);
      if (!Array.isArray(page.items)) throw new ApiError(502);
      return page;
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <ChildSection
      title="Catalog materials"
      pending={query.isPending}
      error={query.isFetchNextPageError ? undefined : query.error}
      retry={() => void query.refetch()}
    >
      <p className="muted">
        Materials for which this Supplier is the canonical catalog supplier.
        Seller relationships are separate.
      </p>
      <p>{rows.length} catalog materials loaded</p>
      <ul className="read-list">
        {rows.map((m, i) => (
          <li key={m.id ?? i}>
            <h3>
              {m.id ? (
                <Link
                  to={`/materials/${m.id}`}
                  state={{
                    networkReturn: `/suppliers/${id}`,
                    networkDirectory: directory,
                  }}
                >
                  {m.displayName || "Material name not entered"}
                </Link>
              ) : (
                "Material unavailable"
              )}
            </h3>
            <Facts
              values={[
                ["Material type", titleCase(m.materialType)],
                ["Catalog article", m.catalogArticleNumber],
                ["Status", titleCase(m.status)],
              ]}
            />
          </li>
        ))}
      </ul>
      {!rows.length && <p>No catalog materials recorded for this Supplier.</p>}
      <Pagination
        noun="catalog materials"
        hasNext={!!query.hasNextPage}
        fetching={query.isFetching}
        error={query.isFetchNextPageError ? query.error : undefined}
        next={() => void query.fetchNextPage({ cancelRefetch: false })}
        reload={() => void cache.resetQueries({ queryKey, exact: true })}
      />
    </ChildSection>
  );
}
export function SupplierListings({
  id,
  directory,
}: {
  id: string;
  directory: string;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    queryKey = childKey(scope, id, "material-listings");
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/suppliers/{id}/material-listings",
        {
          signal,
          params: { path: { id }, query: { limit: 25, offset: pageParam } },
        },
      );
      return requireData(data, response);
    },
    getNextPageParam: (p, _pages, offset) =>
      p.length === 25 ? offset + 25 : undefined,
  });
  const rows = query.data?.pages.flat() ?? [];
  return (
    <ChildSection
      title="Seller listings"
      pending={query.isPending}
      error={query.isFetchNextPageError ? undefined : query.error}
      retry={() => void query.refetch()}
    >
      <p className="muted">
        Listings where this Supplier acts as Seller. This does not imply catalog
        ownership.
      </p>
      <p>{rows.length} listings loaded</p>
      <ul className="read-list">
        {rows.map((l, i) => (
          <li key={l.id ?? i}>
            <h3>
              {l.id ? (
                <Link
                  to={`/material-listings/${l.id}`}
                  state={{
                    networkReturn: `/suppliers/${id}`,
                    networkDirectory: directory,
                  }}
                >
                  Open seller Listing
                  {l.sellerArticleNumber ? ` · ${l.sellerArticleNumber}` : ""}
                </Link>
              ) : (
                "Listing unavailable"
              )}
            </h3>
            <ListingTerms listing={l} />
          </li>
        ))}
      </ul>
      {!rows.length && <p>No seller Listings recorded for this Supplier.</p>}
      <Pagination
        noun="seller listings"
        hasNext={!!query.hasNextPage}
        fetching={query.isFetching}
        error={query.isFetchNextPageError ? query.error : undefined}
        next={() => void query.fetchNextPage({ cancelRefetch: false })}
        reload={() => void cache.resetQueries({ queryKey, exact: true })}
      />
    </ChildSection>
  );
}
