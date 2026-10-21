import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { useAdminMutation, ambiguous } from "../admin-sources/data";
import { useCheckedForm } from "../admin-sources/FormUI";
import {
  TextField,
  SelectField,
  EvidenceField,
  CommandFeedback,
} from "../admin-network/Fields";
import { AttributesEditor } from "./Editors";
import { specOptions, refreshMaterial, invalidateCatalog } from "./data";
import {
  fabricFields,
  leatherFields,
  fabricDefaults,
  leatherDefaults,
  specBaseline,
  specBody,
  constructions,
  hides,
  tannings,
  type FabricFields,
  type LeatherFields,
  fieldLabels,
  type AttributeRow,
  type Schemas,
} from "./model";
type Fields = FabricFields | LeatherFields;
export function SpecEditor({
  id,
  type,
  confirmed,
}: {
  id: string;
  type: "FABRIC" | "LEATHER";
  confirmed: boolean;
}) {
  const { scope } = useSession(),
    q = useQuery(specOptions(scope, id, type));
  const initial = specBaseline(q.data, type, id),
    absent = q.error instanceof ApiError && q.error.status === 404;
  const [opened, setOpened] = useState<{
    initial: ReturnType<typeof specBaseline>;
  }>();
  if (!opened && confirmed && (initial || absent)) setOpened({ initial });
  if (opened)
    return (
      <>
        <SpecForm
          id={id}
          type={type}
          initial={opened.initial}
          confirmed={confirmed && (!!initial || absent)}
        />
        {!initial && !absent && (
          <p role="alert">
            Specification preservation warning: current server state is unsafe
            or unavailable. Draft retained; writes blocked.
          </p>
        )}
      </>
    );
  if (q.isPending) return <Skeleton label="Loading subtype specification" />;
  if (q.error && !absent)
    return <ApiErrorState error={q.error} retry={() => void q.refetch()} />;
  return (
    <p role="alert">
      Specification preservation warning: loaded state or parent cannot be
      safely represented. Mutation is blocked.
    </p>
  );
}
function SpecForm({
  id,
  type,
  initial,
  confirmed,
}: {
  id: string;
  type: "FABRIC" | "LEATHER";
  initial: ReturnType<typeof specBaseline>;
  confirmed: boolean;
}) {
  const { scope } = useSession(),
    cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial),
    [mode, setMode] = useState<"create" | "edit">(initial ? "edit" : "create"),
    [comparison, setComparison] = useState<ReturnType<typeof specBaseline>>(),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const form = useCheckedForm<Fields>(
    type === "FABRIC" ? fabricFields : leatherFields,
    initial?.fields ?? (type === "FABRIC" ? fabricDefaults : leatherDefaults),
  );
  const read = async (active: () => boolean) => {
    if (!active()) return undefined;
    try {
      await cache.cancelQueries({
        queryKey: specOptions(scope, id, type).queryKey,
      });
      if (!active()) return undefined;
      return specBaseline(
        await cache.fetchQuery({
          ...specOptions(scope, id, type),
          staleTime: 0,
        }),
        type,
        id,
      );
    } catch {
      return undefined;
    }
  };
  const mutation = useAdminMutation(
    `spec-${type}`,
    async (v: Fields, signal) => {
      const params = {
        path: { id },
        ...(mode === "create" ? { header: { "If-None-Match": "*" } } : {}),
      };
      const body = specBody(v, mode === "create" ? 0 : baseline!.version);
      const r =
        type === "FABRIC"
          ? await api.PUT("/api/v1/admin/materials/{id}/fabric-spec", {
              signal,
              params,
              body: body as Schemas["MaterialFabricInput"],
            })
          : await api.PUT("/api/v1/admin/materials/{id}/leather-spec", {
              signal,
              params,
              body: body as Schemas["MaterialLeatherInput"],
            });
      return requireData(r.data, r.response);
    },
    async (data, _v, active) => {
      if (!specBaseline(data, type, id)) {
        setBlocked(true);
        setNotice(
          "Saved response cannot be safely represented. Refresh before continuing.",
        );
        return;
      }
      const latest = await read(active);
      if (!active()) return;
      await refreshMaterial(cache, scope, id);
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: ["supply", scope, "material", id, "physical", type],
      });
      if (!active()) return;
      await invalidateCatalog(cache, scope, id);
      if (!active()) return;
      if (!latest) {
        setBlocked(true);
        setNotice("Saved; specification refresh is unavailable.");
        return;
      }
      setBaseline(latest);
      setMode("edit");
      setBlocked(false);
      form.reset(latest.fields);
      setNotice(`Specification saved. Server version: ${latest.version}.`);
    },
    async (error, _v, active) => {
      if (
        ambiguous(error) ||
        (error instanceof ApiError && [404, 409, 412].includes(error.status))
      ) {
        setBlocked(true);
        const latest = await read(active);
        if (!active()) return;
        setComparison(latest);
        if (error instanceof ApiError && error.status === 404)
          await refreshMaterial(cache, scope, id);
      }
    },
  );
  const fabric = form as UseFormReturn<FabricFields>;
  const construction = fabric.watch("construction");
  useEffect(() => {
    if (type === "FABRIC") {
      if (construction !== "WOVEN") fabric.setValue("weaveType", "");
      if (construction !== "KNIT") fabric.setValue("knitType", "");
    }
  }, [construction, type]);
  return (
    <section className="admin-panel">
      <h2>
        {mode === "create" ? "Create" : "Edit"}{" "}
        {type === "FABRIC" ? "Fabric" : "Leather"} specification
      </h2>
      <form
        className="admin-form"
        onSubmit={form.submit((v) => mutation.mutate(v))}
      >
        <fieldset disabled={!confirmed || mutation.isPending}>
          <div className="admin-fields">
            {type === "FABRIC" ? (
              <>
                <SelectField
                  form={fabric}
                  name="construction"
                  label="Construction"
                  values={constructions}
                  optional
                />
                {fabric.watch("construction") === "WOVEN" && (
                  <TextField
                    form={fabric}
                    name="weaveType"
                    label="Weave type"
                  />
                )}
                {fabric.watch("construction") === "KNIT" && (
                  <TextField form={fabric} name="knitType" label="Knit type" />
                )}
                {(
                  [
                    "gsm",
                    "widthMm",
                    "thicknessMm",
                    "stretchWarpPercentage",
                    "stretchWeftPercentage",
                    "shrinkageWarpPercentage",
                    "shrinkageWeftPercentage",
                  ] as const
                ).map((k) => (
                  <TextField
                    key={k}
                    form={fabric}
                    name={k}
                    label={fieldLabels[k] ?? k}
                  />
                ))}
              </>
            ) : (
              <>
                <SelectField
                  form={form as UseFormReturn<LeatherFields>}
                  name="hideType"
                  label="Hide type"
                  values={hides}
                  optional
                />
                <SelectField
                  form={form as UseFormReturn<LeatherFields>}
                  name="tanningMethod"
                  label="Tanning method"
                  values={tannings}
                  optional
                />
                {(
                  [
                    "thicknessMinMm",
                    "thicknessMaxMm",
                    "averageHideAreaM2",
                  ] as const
                ).map((k) => (
                  <TextField
                    key={k}
                    form={form as UseFormReturn<LeatherFields>}
                    name={k}
                    label={fieldLabels[k] ?? k}
                  />
                ))}
              </>
            )}
            {(["finish", "surface", "handfeel", "luster"] as const).map((k) => (
              <TextField
                key={k}
                form={form}
                name={k}
                label={fieldLabels[k] ?? k}
              />
            ))}
            {type === "FABRIC" && (
              <TextField form={fabric} name="drape" label="Drape" />
            )}
          </div>
          <AttributesEditor
            form={
              form as unknown as UseFormReturn<{ attributes: AttributeRow[] }>
            }
          />
          <EvidenceField form={form} />
          <Button type="submit" disabled={blocked}>
            Save {type === "FABRIC" ? "Fabric" : "Leather"} specification
          </Button>
          <Button className="secondary" onClick={() => form.reset()}>
            Reset specification
          </Button>
        </fieldset>
      </form>
      {mutation.error instanceof ApiError && mutation.error.status === 412 ? (
        <div className="error" role="alert">
          <h3>Create-only precondition failed (412)</h3>
          <p>
            The specification already exists or another first writer won. Your
            draft is preserved and has not been submitted as an update.
          </p>
          {mutation.error.requestId && (
            <p className="record-reference">
              Request reference: {mutation.error.requestId}
            </p>
          )}
        </div>
      ) : (
        <CommandFeedback
          error={mutation.error}
          success={notice}
          noun="Specification"
          conflict="The specification changed or conflicts with the current server state."
        />
      )}

      {comparison && (
        <div className="notice">
          <h3>Current server specification</h3>
          <p>Server version: {comparison.version}</p>

          <Button
            onClick={() => {
              setBaseline(comparison);
              setMode("edit");
              setComparison(undefined);
              setBlocked(false);
              mutation.reset();
            }}
          >
            {mode === "create"
              ? "Switch to edit mode"
              : "Use current specification version; retain draft"}
          </Button>
          <dl>
            {Object.entries(comparison.fields)
              .filter(([k]) => k !== "observationId" && k !== "attributes")
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{fieldLabels[k] ?? k}</dt>
                  <dd>{String(v) || "Not entered"}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
      {blocked && !comparison && (
        <p role="alert">
          Saving is blocked. Refresh and confirm the current parent and
          specification before explicitly opening a new edit/create context.
        </p>
      )}
    </section>
  );
}
