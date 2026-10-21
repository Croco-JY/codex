import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, requireData } from "../../api/client";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import {
  useAdminMutation,
  useAdminReadError,
  nextOffset,
} from "../admin-sources/data";
import { useCheckedForm, HistoryStatus } from "../admin-sources/FormUI";
import {
  EvidenceField,
  SelectField,
  CommandFeedback,
} from "../admin-network/Fields";
import { uuid } from "../admin-sources/model";
import {
  citation,
  materialFacts,
  variantFacts,
  listingFacts,
  type Schemas,
} from "./model";
export function CatalogCitations({
  id,
  kind,
}: {
  id: string;
  kind: "materials" | "material-variants" | "material-listings";
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    [notice, setNotice] = useState("");
  const facts =
    kind === "materials"
      ? materialFacts
      : kind === "material-variants"
        ? variantFacts
        : listingFacts;
  const key = ["admin", scope, "catalog-citations", kind, id, 25];
  const path =
    kind === "materials"
      ? "/api/v1/admin/materials/{id}/sources"
      : kind === "material-variants"
        ? "/api/v1/admin/material-variants/{id}/sources"
        : "/api/v1/admin/material-listings/{id}/sources";
  const q = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET(path, {
        signal,
        params: { path: { id }, query: { limit: 25, offset: pageParam } },
      });
      return requireData(r.data, r.response);
    },
    getNextPageParam: nextOffset,
  });
  useAdminReadError(q.error);
  const form = useCheckedForm<{
    observationId: string;
    fieldName: (typeof facts)[number];
  }>(z.object({ observationId: uuid, fieldName: z.enum(facts) }), {
    observationId: "",
    fieldName: "RECORD",
  });
  const m = useAdminMutation(
    `catalog-citation-${kind}`,
    async (
      v: { observationId: string; fieldName: (typeof facts)[number] },
      signal,
    ) => {
      const params = { path: { id } };
      if (kind === "materials")
        await api.POST("/api/v1/admin/materials/{id}/sources", {
          signal,
          params,
          body: v as Schemas["MaterialCitation"],
        });
      else if (kind === "material-variants")
        await api.POST("/api/v1/admin/material-variants/{id}/sources", {
          signal,
          params,
          body: v as Schemas["MaterialVariantCitation"],
        });
      else
        await api.POST("/api/v1/admin/material-listings/{id}/sources", {
          signal,
          params,
          body: v as Schemas["ListingCitation"],
        });
    },
    async (_d, _v, active) => {
      await cache.invalidateQueries({ queryKey: key });
      if (active()) {
        form.reset();
        setNotice("Fact citation appended.");
      }
    },
  );
  const rows = q.data?.pages.flat() ?? [];
  return (
    <section className="admin-panel">
      <h2>
        {kind === "materials"
          ? "Material"
          : kind === "material-variants"
            ? "Variant"
            : "Listing"}{" "}
        fact citations
      </h2>
      <p>
        An Observation supports a canonical fact. This is not external identity
        binding.
      </p>
      <HistoryStatus
        query={q}
        count={rows.length}
        noun="citations"
        empty="No fact citations recorded in this bounded view."
      />
      <ul className="read-list">
        {rows.map((row, i) => {
          const v = citation(row, facts);
          return (
            <li
              key={v ? `${v.observationId}-${v.fieldName}-${v.createdAt}` : i}
            >
              {v ? (
                <>
                  <strong>{v.fieldName}</strong>
                  <p className="record-reference">{v.observationId}</p>
                  <p>{v.createdAt}</p>
                </>
              ) : (
                <p>Citation data is unavailable in a supported format.</p>
              )}
            </li>
          );
        })}
      </ul>
      <form className="admin-form" onSubmit={form.submit((v) => m.mutate(v))}>
        <fieldset disabled={m.isPending}>
          <SelectField
            form={form}
            name="fieldName"
            label="Fact field"
            values={facts}
          />
          <EvidenceField form={form} />
          <Button type="submit">Append fact citation</Button>
          <Button className="secondary" onClick={() => form.reset()}>
            Reset citation
          </Button>
        </fieldset>
      </form>
      <CommandFeedback
        error={m.error}
        success={notice}
        noun="Citation"
        conflict="The citation conflicts with the current server state."
      />
    </section>
  );
}
