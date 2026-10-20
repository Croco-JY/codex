import { useId, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { components, paths } from "../../api/schema";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Button, Input, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { units } from "../materials/filters";
import { decimal } from "../materials/decimal";
import { variantOptions } from "../materials/materialQueries";
import { Facts, Pagination, Reference } from "./ReadUI";
import { variantName, type Variant } from "./PriceFacts";
import { validUtc } from "./priceScope";
import type { Listing } from "./ListingTerms";
type Scope = Omit<
  NonNullable<
    paths["/api/v1/material-listings/{id}/inventory"]["get"]["parameters"]["query"]
  >,
  "cursor" | "limit"
>;
type Observation = components["schemas"]["InventoryView"];
export function FacilityLabel({ id }: { id?: string }) {
  const { scope } = useSession();
  const query = useQuery({
    queryKey: queryKeys.facility(scope, id ?? ""),
    enabled: !!id,
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/facilities/{id}", {
        signal,
        params: { path: { id: id! } },
      });
      return requireData(data, response);
    },
  });
  if (!id) return <>Facility not recorded</>;
  if (query.isPending) return <>Loading facility label…</>;
  return (
    <>
      {query.isError || !query.data.name
        ? "Facility label unavailable"
        : query.data.name}{" "}
      <span className="facility-reference">
        <Reference label="Facility reference" value={id} />
      </span>
    </>
  );
}
function Observations({
  rows,
  variants,
}: {
  rows: Observation[];
  variants: Variant[];
}) {
  return (
    <ul className="read-list inventory-observations">
      {rows.map((row, index) => (
        <li key={row.id ?? index}>
          <p className="inventory-state">
            {row.quantity == null
              ? "Quantity not recorded"
              : decimal(row.quantity) === "0"
                ? "Known zero quantity for this observation scope"
                : "Recorded quantity for this observation scope"}
          </p>
          <p className="inventory-quantity">
            {row.quantity ?? "Unknown quantity"}{" "}
            <span>{row.unit ?? "Unit unknown"}</span>
          </p>
          <Facts
            values={[
              ["Variant context", variantName(row.materialVariantId, variants)],
              ["Facility", <FacilityLabel id={row.facilityId} />],
              ["Capture mode", row.captureMode ?? "Not recorded"],
              ["Observed at (UTC)", row.observedAt],
              ["Recorded at (UTC)", row.recordedAt],
              ["Created at (UTC)", row.createdAt],
            ]}
          />
          {row.sourceObservationId ? (
            <p>
              <Reference
                label="Source observation reference"
                value={row.sourceObservationId}
              />
            </p>
          ) : (
            <p className="muted">
              {row.captureMode === "MANUAL"
                ? "Manual observation · no imported source observation"
                : "Source observation reference unavailable"}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
export function InventoryReads({
  listing,
}: {
  listing: Listing & { id: string };
}) {
  const { scope: session } = useSession();
  const cache = useQueryClient();
  const prefix = useId();
  const [draft, setDraft] = useState<Scope>({});
  const [applied, setApplied] = useState<Scope>({});
  const [timeError, setTimeError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const variantsQuery = useInfiniteQuery(
    variantOptions(session, listing.materialId ?? ""),
  );
  const variants = variantsQuery.data?.pages.flat() ?? [];
  const currentKey = queryKeys.commercial(
    session,
    listing.id,
    "inventory-current",
    applied,
  );
  const historyKey = queryKeys.commercial(
    session,
    listing.id,
    "inventory-history",
    applied,
  );
  const current = useInfiniteQuery({
    queryKey: currentKey,
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/material-listings/{id}/inventory",
        {
          signal,
          params: {
            path: { id: listing.id },
            query: {
              ...applied,
              limit: 25,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        },
      );
      const page = requireData(data, response);
      if (!Array.isArray(page.items))
        throw new ApiError(
          502,
          response.headers.get("X-Request-ID") ?? undefined,
        );
      return page;
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
  const history = useInfiniteQuery({
    queryKey: historyKey,
    enabled: historyOpen,
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/material-listings/{id}/inventory-snapshots",
        {
          signal,
          params: {
            path: { id: listing.id },
            query: {
              ...applied,
              limit: 25,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        },
      );
      const page = requireData(data, response);
      if (!Array.isArray(page.items))
        throw new ApiError(
          502,
          response.headers.get("X-Request-ID") ?? undefined,
        );
      return page;
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
  const rows = current.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const past = history.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const facilities = [
    ...new Set(
      [...rows, ...past]
        .flatMap((row) => (row.facilityId ? [row.facilityId] : []))
        .concat(applied.facilityId ? [applied.facilityId] : []),
    ),
  ];
  const apply = () => {
    const asOf = draft.asOf?.trim();
    if (asOf && !validUtc(asOf)) {
      setTimeError(
        "Enter a valid UTC instant, for example 2025-06-01T00:00:00Z.",
      );
      return;
    }
    setTimeError("");
    const next: Scope = {
      ...(draft.variantId ? { variantId: draft.variantId } : {}),
      ...(draft.facilityId ? { facilityId: draft.facilityId } : {}),
      ...(draft.unit ? { unit: draft.unit } : {}),
      ...(draft.captureMode ? { captureMode: draft.captureMode } : {}),
      ...(asOf ? { asOf } : {}),
    };
    if (JSON.stringify(next) === JSON.stringify(applied)) {
      void cache.resetQueries({ queryKey: currentKey, exact: true });
      if (historyOpen)
        void cache.resetQueries({ queryKey: historyKey, exact: true });
    } else {
      cache.removeQueries({
        queryKey: queryKeys.commercial(
          session,
          listing.id,
          "inventory-current",
          next,
        ),
        exact: true,
      });
      cache.removeQueries({
        queryKey: queryKeys.commercial(
          session,
          listing.id,
          "inventory-history",
          next,
        ),
        exact: true,
      });
      setApplied(next);
    }
  };
  return (
    <>
      <Surface aria-label="Inventory knowledge">
        <h2>Inventory knowledge</h2>
        <p className="muted">
          Latest observations within each Variant, facility, unit, capture mode
          and source scope. Quantities are never summed and do not establish
          orderability.
        </p>
        <form
          className="scope-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div>
            <label htmlFor={`${prefix}-variant`}>Inventory variant</label>
            <select
              className="input"
              id={`${prefix}-variant`}
              value={draft.variantId ?? ""}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  variantId: event.target.value || undefined,
                }))
              }
            >
              <option value="">All Variant contexts</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.variantName || "Variant name not entered"}
                  {variant.status === "ARCHIVED" ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-facility`}>
              Inventory facility reference
            </label>
            <select
              className="input"
              id={`${prefix}-facility`}
              value={draft.facilityId ?? ""}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  facilityId: event.target.value || undefined,
                }))
              }
            >
              <option value="">All facility contexts</option>
              {facilities.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <p className="filter-help">
              Choices come from loaded observations; names appear with each
              observation.
            </p>
          </div>
          <div>
            <label htmlFor={`${prefix}-unit`}>Inventory unit</label>
            <select
              className="input"
              id={`${prefix}-unit`}
              value={draft.unit ?? ""}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  unit: units.find((unit) => unit === event.target.value),
                }))
              }
            >
              <option value="">All independent units</option>
              {units.map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-mode`}>Inventory capture mode</label>
            <select
              className="input"
              id={`${prefix}-mode`}
              value={draft.captureMode ?? ""}
              onChange={(event) =>
                setDraft((old) => ({
                  ...old,
                  captureMode:
                    event.target.value === "IMPORTED"
                      ? "IMPORTED"
                      : event.target.value === "MANUAL"
                        ? "MANUAL"
                        : undefined,
                }))
              }
            >
              <option value="">All capture modes</option>
              <option value="MANUAL">Manual</option>
              <option value="IMPORTED">Imported</option>
            </select>
          </div>
          <div className="scope-wide">
            <label htmlFor={`${prefix}-asOf`}>
              Observation cutoff (UTC, optional)
            </label>
            <Input
              id={`${prefix}-asOf`}
              value={draft.asOf ?? ""}
              onChange={(event) =>
                setDraft((old) => ({ ...old, asOf: event.target.value }))
              }
              aria-invalid={!!timeError}
              aria-describedby={timeError ? `${prefix}-time-error` : undefined}
            />
            {timeError && (
              <p
                role="alert"
                className="field-error"
                id={`${prefix}-time-error`}
              >
                {timeError}
              </p>
            )}
          </div>
          <div className="scope-actions scope-wide">
            <Button type="submit">Apply inventory scope</Button>
            <Button
              className="secondary"
              disabled={current.isFetching}
              onClick={() =>
                void cache.resetQueries({ queryKey: currentKey, exact: true })
              }
            >
              Refresh inventory knowledge
            </Button>
          </div>
        </form>
        <div className="applied-scope">
          <p>
            Inventory Variant:{" "}
            {applied.variantId
              ? variantName(applied.variantId, variants)
              : "All Variant contexts"}{" "}
            · Unit: {applied.unit ?? "All independent units"} · Capture mode:{" "}
            {applied.captureMode ?? "All modes"}
          </p>
          {applied.facilityId && (
            <p>
              <Reference label="Facility filter" value={applied.facilityId} />
            </p>
          )}
          <p>
            {applied.asOf
              ? `Latest observations with observed time at or before ${applied.asOf} (UTC).`
              : "Latest recorded observations; read their observation times before using this knowledge."}
          </p>
          <p>This scope also applies to inventory history.</p>
        </div>
        {variantsQuery.isError && (
          <ApiErrorState
            title="Inventory Variant choices unavailable"
            error={variantsQuery.error}
            retry={() => void variantsQuery.refetch()}
          />
        )}
        {variantsQuery.hasNextPage && (
          <Button
            className="secondary"
            disabled={variantsQuery.isFetching}
            onClick={() =>
              void variantsQuery.fetchNextPage({ cancelRefetch: false })
            }
          >
            Load more inventory Variant choices
          </Button>
        )}
        {current.isPending ? (
          <Skeleton label="Loading inventory knowledge" />
        ) : current.isError && !current.isFetchNextPageError ? (
          <ApiErrorState
            title="Inventory information unavailable"
            error={current.error}
            retry={() =>
              void cache.resetQueries({ queryKey: currentKey, exact: true })
            }
          />
        ) : (
          <>
            {rows.length === 0 ? (
              <p role="status">
                No stock observation within this scope · stock unknown.
              </p>
            ) : (
              <>
                <p>{rows.length} observation scopes loaded</p>
                <Observations rows={rows} variants={variants} />
              </>
            )}
            <Pagination
              noun="inventory observations"
              hasNext={!!current.hasNextPage}
              fetching={current.isFetching}
              error={current.isFetchNextPageError ? current.error : null}
              next={() => void current.fetchNextPage({ cancelRefetch: false })}
              reload={() =>
                void cache.resetQueries({ queryKey: currentKey, exact: true })
              }
            />
          </>
        )}
      </Surface>
      <Surface aria-label="Inventory history">
        <h2>Inventory history</h2>
        <p className="muted">
          Immutable observations, separate from latest knowledge. Earlier
          quantities are not added to current quantities.
        </p>
        {!historyOpen ? (
          <Button className="secondary" onClick={() => setHistoryOpen(true)}>
            Show inventory history
          </Button>
        ) : (
          <>
            {history.isPending ? (
              <Skeleton label="Loading inventory history" />
            ) : history.isError && !history.isFetchNextPageError ? (
              <ApiErrorState
                title="Inventory history unavailable"
                error={history.error}
                retry={() =>
                  void cache.resetQueries({ queryKey: historyKey, exact: true })
                }
              />
            ) : (
              <>
                <p>{past.length} historical observations loaded</p>
                <Observations rows={past} variants={variants} />
                {past.length === 0 && (
                  <p>No historical observations recorded within this scope.</p>
                )}
                <Pagination
                  noun="inventory history"
                  hasNext={!!history.hasNextPage}
                  fetching={history.isFetching}
                  error={history.isFetchNextPageError ? history.error : null}
                  next={() =>
                    void history.fetchNextPage({ cancelRefetch: false })
                  }
                  reload={() =>
                    void cache.resetQueries({
                      queryKey: historyKey,
                      exact: true,
                    })
                  }
                />
                <Button
                  className="secondary"
                  disabled={history.isFetching}
                  onClick={() =>
                    void cache.resetQueries({
                      queryKey: historyKey,
                      exact: true,
                    })
                  }
                >
                  Refresh inventory history
                </Button>
              </>
            )}
          </>
        )}
      </Surface>
    </>
  );
}
