import { useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useSession } from "../../app/session";
import { Button, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts } from "../commercial/ReadUI";
import { useCheckedForm } from "../admin-sources/FormUI";
import { uuid } from "../admin-sources/model";
import { useAdminMutation, useAdminReadError } from "../admin-sources/data";
import { CommandFeedback, EvidenceField, SelectField } from "./Fields";
import { supplierFacts, facilityFacts, parseCitation } from "./model";
import { citationOptions } from "./data";

export function Citations({
  id,
  kind,
}: {
  id: string;
  kind: "suppliers" | "facilities";
}) {
  const { scope } = useSession(),
    query = useQuery(citationOptions(scope, kind, id)),
    [notice, setNotice] = useState("");
  useAdminReadError(query.error);
  const allowed = kind === "suppliers" ? supplierFacts : facilityFacts;
  const schema = z.object({
    observationId: uuid,
    fieldName: z
      .enum([...supplierFacts, ...facilityFacts])
      .refine(
        (v) => allowed.includes(v as never),
        "Select a supported fact field.",
      ),
  });
  const form = useCheckedForm<z.infer<typeof schema>>(schema, {
    observationId: "",
    fieldName: "RECORD",
  });
  const mutation = useAdminMutation(
    `${kind}-citation`,
    async (v: z.infer<typeof schema>, signal) => {
      if (kind === "suppliers")
        await api.POST("/api/v1/admin/suppliers/{id}/sources", {
          signal,
          params: { path: { id } },
          body: {
            observationId: v.observationId,
            fieldName: z.enum(supplierFacts).parse(v.fieldName),
          },
        });
      else
        await api.POST("/api/v1/admin/facilities/{id}/sources", {
          signal,
          params: { path: { id } },
          body: {
            observationId: v.observationId,
            fieldName: z.enum(facilityFacts).parse(v.fieldName),
          },
        });
    },
    async (_data, v, current) => {
      await query.refetch();
      if (current()) {
        form.reset({ ...v, observationId: "" });
        setNotice(
          "Fact citation appended. The parent profile version is unchanged by this command.",
        );
      }
    },
    async (error, _v, current) => {
      if (error && current()) await query.refetch();
    },
  );
  const rows = Array.isArray(query.data) ? query.data : [],
    badShape = query.data !== undefined && !Array.isArray(query.data);
  return (
    <Surface
      aria-label={`${kind === "suppliers" ? "Supplier" : "Facility"} fact citations`}
    >
      <h2>Fact citations</h2>
      <p>
        Observations support canonical facts. These citations are not identity
        bindings, claims or permission approvals.
      </p>
      {query.isPending ? (
        <p role="status">Loading protected fact citations…</p>
      ) : query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {badShape && (
            <p>Citation data is unavailable in a supported format.</p>
          )}
          <ul className="read-list">
            {rows.map((raw, i) => {
              const row = parseCitation(raw, allowed);
              return (
                <li key={i}>
                  {row ? (
                    <Facts
                      values={[
                        ["Fact field", row.fieldName],
                        ["Observation reference", row.observationId],
                        ["Recorded at", row.createdAt],
                      ]}
                    />
                  ) : (
                    <p>Citation data is unavailable in a supported format.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {!badShape && !rows.length && (
            <p>No fact citations recorded in this bounded view.</p>
          )}
          {rows.length >= 100 && (
            <p>
              Latest 100 citations; this bounded view may omit earlier facts.
            </p>
          )}
        </>
      )}
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          setNotice("");
          mutation.mutate(v);
        })}
      >
        <fieldset disabled={mutation.isPending} className="admin-fields">
          <SelectField
            form={form}
            name="fieldName"
            label="Fact field"
            values={allowed}
          />
          <EvidenceField form={form} />
          <div className="scope-actions">
            <Button type="submit">Append fact citation</Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset();
                mutation.reset();
                setNotice("");
              }}
            >
              Reset citation draft
            </Button>
          </div>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={notice}
        noun="Fact citation append"
        conflict="Fact citation conflicts with the current integrity state."
        refresh={() => void query.refetch()}
      />
    </Surface>
  );
}
