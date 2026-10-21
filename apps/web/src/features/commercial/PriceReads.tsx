import { useId, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Button, Input, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { variantOptions } from "../materials/materialQueries";
import { units } from "../materials/filters";
import { ListingTerms, type Listing } from "./ListingTerms";
import { Facts, Pagination, Reference } from "./ReadUI";
import { PriceFacts, variantName } from "./PriceFacts";
import {
  initialPriceDraft,
  validatePrice,
  type PriceDraft,
  type PriceScope,
  type HistoryScope,
} from "./priceScope";

export function PriceReads({
  listing,
  renderHistoryPrice,
}: {
  listing: Listing & { id: string };
  renderHistoryPrice?: (
    price: import("../../api/schema").components["schemas"]["PriceView"],
    variants: import("./PriceFacts").Variant[],
  ) => ReactNode;
}) {
  const { scope: session } = useSession();
  const cache = useQueryClient();
  const prefix = useId();
  const errorSummary = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(initialPriceDraft);
  const [errors, setErrors] = useState<
    Partial<Record<keyof PriceDraft, string>>
  >({});
  const [applied, setApplied] = useState<PriceScope>({
    allowMaterialFallback: false,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDraft, setHistoryDraft] = useState<HistoryScope>({});
  const [historyScope, setHistoryScope] = useState<HistoryScope>({});
  const [historyError, setHistoryError] = useState("");
  const variantsQuery = useInfiniteQuery(
    variantOptions(session, listing.materialId ?? ""),
  );
  const variants = variantsQuery.data?.pages.flat() ?? [];
  const key = queryKeys.commercial(
    session,
    listing.id,
    "effective-prices",
    applied,
  );
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/material-listings/{id}/effective-prices",
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
      const resolution = requireData(data, response);
      if (
        !Array.isArray(resolution.scopes) ||
        typeof resolution.asOf !== "string"
      )
        throw new ApiError(
          502,
          response.headers.get("X-Request-ID") ?? undefined,
        );
      return resolution;
    },
    getNextPageParam: (page) => page.nextCursor || undefined,
  });
  const historyKey = queryKeys.commercial(
    session,
    listing.id,
    "price-history",
    historyScope,
  );
  const history = useInfiniteQuery({
    queryKey: historyKey,
    enabled: historyOpen,
    initialPageParam: undefined as string | undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/material-listings/{id}/prices",
        {
          signal,
          params: {
            path: { id: listing.id },
            query: {
              ...historyScope,
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
  const first = query.data?.pages[0];
  const historyRows =
    history.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const providers = [
    ...new Set([
      ...(query.data?.pages.flatMap(
        (page) =>
          page.scopes?.flatMap((value) =>
            value.dataSourceId ? [value.dataSourceId] : [],
          ) ?? [],
      ) ?? []),
      ...historyRows.flatMap((value) =>
        value.dataSourceId ? [value.dataSourceId] : [],
      ),
      ...(applied.dataSourceId ? [applied.dataSourceId] : []),
    ]),
  ];
  const update = <K extends keyof PriceDraft>(key: K, value: PriceDraft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const errorFor = (key: keyof PriceDraft) =>
    errors[key] && (
      <p id={`${prefix}-${key}-error`} className="field-error">
        {errors[key]}
      </p>
    );
  const apply = () => {
    const parsed = validatePrice(draft);
    setErrors(parsed.errors);
    if (Object.keys(parsed.errors).length) {
      requestAnimationFrame(() => errorSummary.current?.focus());
      return;
    }
    const target = queryKeys.commercial(
      session,
      listing.id,
      "effective-prices",
      parsed.scope,
    );
    if (JSON.stringify(parsed.scope) === JSON.stringify(applied))
      void cache.resetQueries({ queryKey: key, exact: true });
    else {
      cache.removeQueries({ queryKey: target, exact: true });
      setApplied(parsed.scope);
    }
  };
  return (
    <>
      <Surface aria-label="Price resolver">
        <h2>Price resolver</h2>
        <p className="muted">
          Each source, currency and unit is an independent price scope. A price
          match does not establish orderability. Current eligibility checks MOQ
          only; MCQ is not evaluated.
        </p>
        <form
          className="scope-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          {Object.keys(errors).length > 0 && (
            <div
              className="error scope-wide"
              role="alert"
              tabIndex={-1}
              ref={errorSummary}
            >
              Check the highlighted price scope fields.
            </div>
          )}
          <div>
            <label htmlFor={`${prefix}-mode`}>Price mode</label>
            <select
              className="input"
              id={`${prefix}-mode`}
              value={draft.mode}
              onChange={(event) =>
                update(
                  "mode",
                  event.target.value === "historical"
                    ? "historical"
                    : "current",
                )
              }
            >
              <option value="current">Current price</option>
              <option value="historical">Specified-time price</option>
            </select>
          </div>
          {draft.mode === "historical" && (
            <div>
              <label htmlFor={`${prefix}-asOf`}>
                Historical price instant (UTC)
              </label>
              <Input
                id={`${prefix}-asOf`}
                value={draft.asOf}
                onChange={(event) => update("asOf", event.target.value)}
                aria-invalid={!!errors.asOf}
                aria-describedby={
                  errors.asOf ? `${prefix}-asOf-error` : undefined
                }
              />
              {errorFor("asOf")}
            </div>
          )}
          <div>
            <label htmlFor={`${prefix}-variant`}>Price variant</label>
            <select
              className="input"
              id={`${prefix}-variant`}
              value={draft.requestedVariantId}
              onChange={(event) =>
                update("requestedVariantId", event.target.value)
              }
            >
              <option value="">Material-level · no Variant requested</option>
              {variants.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.variantName || "Variant name not entered"}
                  {value.status === "ARCHIVED" ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-quantity`}>
              Requested quantity (in price unit)
            </label>
            <Input
              id={`${prefix}-quantity`}
              inputMode="decimal"
              value={draft.requestedQuantity}
              onChange={(event) =>
                update("requestedQuantity", event.target.value)
              }
              aria-invalid={!!errors.requestedQuantity}
              aria-describedby={`${prefix}-quantity-help${errors.requestedQuantity ? ` ${prefix}-requestedQuantity-error` : ""}`}
            />
            <p className="filter-help" id={`${prefix}-quantity-help`}>
              Blank means base prices only; it does not mean zero.
            </p>
            {errorFor("requestedQuantity")}
          </div>
          <div>
            <label htmlFor={`${prefix}-currency`}>Price currency</label>
            <Input
              id={`${prefix}-currency`}
              maxLength={3}
              value={draft.currency}
              onChange={(event) => update("currency", event.target.value)}
              aria-invalid={!!errors.currency}
              aria-describedby={
                errors.currency ? `${prefix}-currency-error` : undefined
              }
            />
            {errorFor("currency")}
          </div>
          <div>
            <label htmlFor={`${prefix}-unit`}>Price unit</label>
            <select
              className="input"
              id={`${prefix}-unit`}
              value={draft.priceUnit}
              onChange={(event) =>
                update(
                  "priceUnit",
                  units.find((unit) => unit === event.target.value) ?? "",
                )
              }
            >
              <option value="">All independent units</option>
              {units.map((unit) => (
                <option key={unit}>{unit}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${prefix}-source`}>Price source reference</label>
            <select
              className="input"
              id={`${prefix}-source`}
              value={draft.dataSourceId}
              onChange={(event) => update("dataSourceId", event.target.value)}
            >
              <option value="">All independent sources</option>
              {providers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <p className="filter-help">
              Choices come from loaded price scopes.
            </p>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.allowMaterialFallback}
              onChange={(event) =>
                update("allowMaterialFallback", event.target.checked)
              }
            />{" "}
            Allow Material-level fallback
          </label>
          <div className="scope-actions scope-wide">
            <Button type="submit">Resolve price</Button>
            <Button
              className="secondary"
              disabled={query.isFetching}
              onClick={() =>
                void cache.resetQueries({ queryKey: key, exact: true })
              }
            >
              {applied.asOf
                ? "Refresh specified-time price"
                : "Refresh current price"}
            </Button>
          </div>
        </form>
        {variantsQuery.isError && (
          <ApiErrorState
            title="Variant choices unavailable"
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
            Load more Variant choices
          </Button>
        )}
        <div className="applied-scope">
          <p>
            Source scope: {applied.dataSourceId ?? "All independent sources"} ·
            Currency: {applied.currency ?? "All independent currencies"} · Price
            unit: {applied.priceUnit ?? "All independent units"}
          </p>
          <p>
            {applied.asOf
              ? `Specified-time price query · ${applied.asOf} (UTC)`
              : "Current price query · server evaluation time"}
          </p>
          <p>
            Requested Variant:{" "}
            {applied.requestedVariantId
              ? variantName(applied.requestedVariantId, variants)
              : "None · Material-level"}{" "}
            · Requested quantity:{" "}
            {applied.requestedQuantity ?? "Omitted · base prices only"}
          </p>
          <p>
            {applied.allowMaterialFallback
              ? "Material-level fallback allowed"
              : "Material-level fallback disabled"}
          </p>
        </div>
        <p className="filter-help">
          Friendly source labels are not available. Source references identify
          the provider; currencies and units are not converted.
        </p>
        {query.isPending ? (
          <Skeleton label="Resolving price" />
        ) : query.isError && !query.isFetchNextPageError ? (
          <ApiErrorState
            error={query.error}
            retry={() =>
              void cache.resetQueries({ queryKey: key, exact: true })
            }
          />
        ) : (
          <>
            <p>
              Price evaluated at:{" "}
              <time dateTime={first?.asOf}>
                {first?.asOf ?? "Evaluation time unavailable"}
              </time>{" "}
              (UTC)
            </p>
            <p className="notice">
              {first?.listingTermsScope === "HISTORICAL_TERMS_NOT_RECONSTRUCTED"
                ? "Historical Listing terms are not reconstructed. Commercial eligibility is not evaluated for this historical query."
                : first?.listingTermsScope === "CURRENT_TERMS_ONLY"
                  ? "Listing terms scope: Current terms only."
                  : "Listing terms scope unavailable."}
            </p>
            {first?.currentListingTerms && (
              <details className="read-disclosure">
                <summary>
                  Current Listing terms returned for this evaluation
                </summary>
                <ListingTerms listing={first.currentListingTerms} />
              </details>
            )}
            <ul className="read-list price-outcomes">
              {query.data?.pages.flatMap(
                (page, pageIndex) =>
                  page.scopes?.map((outcome, index) => (
                    <li key={`${pageIndex}-${index}`}>
                      <Facts
                        values={[
                          [
                            "Price match",
                            outcome.priceMatch === "MATCHED"
                              ? "Matched"
                              : outcome.priceMatch === "NO_MATCH"
                                ? "No match"
                                : "Unavailable",
                          ],
                          [
                            "Match scope",
                            outcome.matchScope
                              ? {
                                  VARIANT_EXACT: "Variant exact",
                                  MATERIAL_FALLBACK: "Material fallback",
                                  MATERIAL_EXACT: "Material exact",
                                  NO_MATCH: "No match",
                                }[outcome.matchScope]
                              : "Unavailable",
                          ],
                          [
                            "Commercial eligibility",
                            outcome.commercialEligibility
                              ? {
                                  ELIGIBLE: "Eligible under current terms",
                                  INELIGIBLE: "Ineligible under current terms",
                                  UNKNOWN_TERMS: "Unknown terms",
                                  NOT_EVALUATED_FOR_HISTORICAL_QUERY:
                                    "Not evaluated for historical query",
                                }[outcome.commercialEligibility]
                              : "Unavailable",
                          ],
                          [
                            "Currency / price unit",
                            `${outcome.currency ?? "Unknown currency"} / ${outcome.priceUnit ?? "Unknown unit"}`,
                          ],
                        ]}
                      />
                      {outcome.matchScope === "MATERIAL_FALLBACK" && (
                        <p className="notice">
                          Material-level fallback result · this is not an exact
                          Variant price.
                        </p>
                      )}
                      <p>
                        <Reference
                          label="Source reference"
                          value={outcome.dataSourceId}
                        />
                      </p>
                      {outcome.price ? (
                        <PriceFacts
                          price={outcome.price}
                          variants={variants}
                          showSource={false}
                        />
                      ) : (
                        <p>No matching price within this returned scope.</p>
                      )}
                    </li>
                  )) ?? [],
              )}
            </ul>
            {first?.scopes?.length === 0 && (
              <p>No price scopes returned for this query.</p>
            )}
            <Pagination
              noun="price scopes"
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
      <Surface aria-label="Price history">
        <h2>Price history</h2>
        <p className="muted">
          Historical price facts retain their own source, currency, unit,
          Variant and validity. This list is not a cross-scope price trend.
        </p>
        {!historyOpen ? (
          <Button className="secondary" onClick={() => setHistoryOpen(true)}>
            Show price history
          </Button>
        ) : (
          <>
            <form
              className="scope-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const currency = historyDraft.currency?.trim().toUpperCase();
                if (currency && !/^[A-Z]{3}$/.test(currency)) {
                  setHistoryError("Use a three-letter currency code.");
                  return;
                }
                setHistoryError("");
                const next: HistoryScope = {
                  ...(currency ? { currency } : {}),
                  ...(historyDraft.priceUnit
                    ? { priceUnit: historyDraft.priceUnit }
                    : {}),
                  ...(historyDraft.dataSourceId
                    ? { dataSourceId: historyDraft.dataSourceId }
                    : {}),
                };
                cache.removeQueries({
                  queryKey: queryKeys.commercial(
                    session,
                    listing.id,
                    "price-history",
                    next,
                  ),
                  exact: true,
                });
                setHistoryScope(next);
              }}
            >
              <div>
                <label htmlFor={`${prefix}-history-currency`}>
                  History currency
                </label>
                <Input
                  id={`${prefix}-history-currency`}
                  maxLength={3}
                  value={historyDraft.currency ?? ""}
                  onChange={(event) =>
                    setHistoryDraft((old) => ({
                      ...old,
                      currency: event.target.value,
                    }))
                  }
                  aria-invalid={!!historyError}
                  aria-describedby={
                    historyError ? `${prefix}-history-error` : undefined
                  }
                />
                {historyError && (
                  <p role="alert" id={`${prefix}-history-error`}>
                    {historyError}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor={`${prefix}-history-unit`}>
                  History price unit
                </label>
                <select
                  className="input"
                  id={`${prefix}-history-unit`}
                  value={historyDraft.priceUnit ?? ""}
                  onChange={(event) =>
                    setHistoryDraft((old) => ({
                      ...old,
                      priceUnit: units.find(
                        (unit) => unit === event.target.value,
                      ),
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
                <label htmlFor={`${prefix}-history-source`}>
                  History source reference
                </label>
                <select
                  className="input"
                  id={`${prefix}-history-source`}
                  value={historyDraft.dataSourceId ?? ""}
                  onChange={(event) =>
                    setHistoryDraft((old) => ({
                      ...old,
                      dataSourceId: event.target.value || undefined,
                    }))
                  }
                >
                  <option value="">All independent sources</option>
                  {providers.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Apply history scope</Button>
            </form>
            {history.isPending ? (
              <Skeleton label="Loading price history" />
            ) : history.isError && !history.isFetchNextPageError ? (
              <ApiErrorState
                error={history.error}
                retry={() =>
                  void cache.resetQueries({ queryKey: historyKey, exact: true })
                }
              />
            ) : (
              <>
                <p>{historyRows.length} price facts loaded</p>
                <ul className="read-list">
                  {historyRows.map((price, index) => (
                    <li key={price.id ?? index}>
                      {renderHistoryPrice ? (
                        renderHistoryPrice(price, variants)
                      ) : (
                        <PriceFacts price={price} variants={variants} />
                      )}
                    </li>
                  ))}
                </ul>
                {historyRows.length === 0 && (
                  <p>No price facts recorded within this scope.</p>
                )}
                <Pagination
                  noun="price history"
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
              </>
            )}
          </>
        )}
      </Surface>
    </>
  );
}
