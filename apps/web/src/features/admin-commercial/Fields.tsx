import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { UseFormReturn, FieldValues, Path } from "react-hook-form";
import { api, requireData } from "../../api/client";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Field } from "../admin-sources/FormUI";
import {
  sourceOptions,
  useAdminReadError,
  uniqueRows,
} from "../admin-sources/data";
import { isUuid } from "../admin-sources/model";
import { variantOptions } from "../materials/materialQueries";
import { facilityOptions } from "../admin-network/data";
import type { ListingContext } from "./model";
export function ProviderField<T extends FieldValues>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  const { scope } = useSession(),
    q = useInfiniteQuery(sourceOptions(scope)),
    name = "dataSourceId" as Path<T>;
  const sources = uniqueRows(q.data?.pages).filter(
    (s) =>
      isUuid(s.id) &&
      typeof s.name === "string" &&
      typeof s.sourceCode === "string" &&
      typeof s.active === "boolean",
  );
  const selected = sources.find((s) => s.id === form.watch(name));
  useAdminReadError(q.error);
  return (
    <div>
      <Field
        name={name}
        label="Provider Source"
        error={form.getFieldState(name, form.formState).error?.message}
      >
        {(p) => (
          <select className="input" {...p} {...form.register(name)}>
            <option value="">Choose provider Source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.sourceCode}
                {s.active === false ? " · inactive" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      {selected && (
        <>
          <p className="record-reference">
            Selected provider: {selected.name} · {selected.sourceCode} ·{" "}
            {selected.active ? "active" : "inactive"}
          </p>
          <p className="record-reference">
            Provider Source reference: {selected.id}
          </p>
        </>
      )}
      <p>{sources.length} provider Sources loaded</p>
      <p>
        Provider Source is distinct from Seller. Inactive Sources may support
        historical Price facts.
      </p>
      {q.error && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.hasNextPage && (
        <Button disabled={q.isFetching} onClick={() => void q.fetchNextPage()}>
          Load more provider Sources
        </Button>
      )}
    </div>
  );
}
export function VariantField<T extends FieldValues>({
  form,
  listing,
}: {
  form: UseFormReturn<T>;
  listing: ListingContext;
}) {
  const { scope } = useSession(),
    q = useInfiniteQuery(variantOptions(scope, listing.materialId)),
    name = "materialVariantId" as Path<T>;
  const selected = q.data?.pages
    .flat()
    .find(
      (v) => v.id === form.watch(name) && v.materialId === listing.materialId,
    );
  return (
    <div>
      <Field
        name={name}
        label="Observation Variant (optional)"
        error={form.getFieldState(name, form.formState).error?.message}
      >
        {(p) => (
          <select className="input" {...p} {...form.register(name)}>
            <option value="">Material-level · no Variant recorded</option>
            {q.data?.pages
              .flat()
              .filter(
                (v) => isUuid(v.id) && v.materialId === listing.materialId,
              )
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.variantName ?? "Variant label unavailable"} ·{" "}
                  {v.status ?? "Status unavailable"}
                </option>
              ))}
          </select>
        )}
      </Field>
      {selected && (
        <p className="record-reference">
          Selected Variant:{" "}
          {typeof selected.variantName === "string"
            ? selected.variantName
            : "Variant label unavailable"}{" "}
          · {selected.status ?? "Status unavailable"} · Variant reference:{" "}
          {selected.id}
        </p>
      )}
      {q.error && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.hasNextPage && (
        <Button disabled={q.isFetching} onClick={() => void q.fetchNextPage()}>
          Load more commercial Variant choices
        </Button>
      )}
    </div>
  );
}
export function FacilityField<T extends FieldValues>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  const { scope } = useSession(),
    name = "facilityId" as Path<T>,
    [known, setKnown] = useState(""),
    [target, setTarget] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["supply", scope, "commercial-facility-picker", 25],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET("/api/v1/facilities", {
        signal,
        params: {
          query: { limit: 25, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      });
      return requireData(r.data, r.response);
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
  const detail = useQuery({
    ...facilityOptions(scope, target),
    enabled: isUuid(target),
  });
  const loaded =
    detail.data?.id === target &&
    typeof detail.data.name === "string" &&
    ["ACTIVE", "ARCHIVED"].includes(detail.data.status ?? "")
      ? detail.data
      : undefined;
  const rows = q.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const selected =
    rows.find((r) => r.id === form.watch(name)) ??
    (loaded?.id === form.watch(name) ? loaded : undefined);
  return (
    <div>
      <Field
        name={name}
        label="Observation Facility (optional)"
        error={form.getFieldState(name, form.formState).error?.message}
      >
        {(p) => (
          <select className="input" {...p} {...form.register(name)}>
            <option value="">No Facility recorded</option>
            {rows
              .filter((f) => isUuid(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name ?? "Facility label unavailable"}
                </option>
              ))}
            {loaded && !rows.some((r) => r.id === loaded.id) && (
              <option value={loaded.id}>
                {loaded.name} · {loaded.status}
              </option>
            )}
          </select>
        )}
      </Field>
      {selected && (
        <p className="record-reference">
          Selected Facility: {selected.name} · Facility reference: {selected.id}
        </p>
      )}
      <p>
        Third-party Facilities are allowed; Seller ownership is not required.
      </p>
      {q.error && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.hasNextPage && (
        <Button disabled={q.isFetching} onClick={() => void q.fetchNextPage()}>
          Load more Facility choices
        </Button>
      )}
      <p>Resolve a known reference, including an archived Facility.</p>
      <Field name="knownFacility" label="Known Facility UUID">
        {(p) => (
          <input
            className="input"
            {...p}
            value={known}
            onChange={(e) => setKnown(e.target.value)}
          />
        )}
      </Field>
      <Button
        disabled={!isUuid(known)}
        onClick={() => setTarget(known.toLowerCase())}
      >
        Resolve known Facility
      </Button>
      {target && detail.isPending && <p role="status">Resolving Facility…</p>}
      {detail.error && <ApiErrorState error={detail.error} />}
      {loaded && (
        <p>
          {loaded.name} · {loaded.status}
          <Button
            onClick={() =>
              form.setValue(name, loaded.id as never, { shouldDirty: true })
            }
          >
            Use resolved Facility
          </Button>
        </p>
      )}
    </div>
  );
}
