import {
  useIdentityResolution,
  ResolutionControls,
  ResolutionOutcome,
  PermanentBinding,
} from "../admin-identity/Workspace";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { variantOptions } from "../materials/materialQueries";
import { useCheckedForm, HistoryStatus } from "../admin-sources/FormUI";
import { useAdminMutation, ambiguous } from "../admin-sources/data";
import {
  TextField,
  SelectField,
  EvidenceField,
  CommandFeedback,
} from "../admin-network/Fields";
import { AttributesEditor } from "./Editors";
import { CatalogCitations } from "./Citations";
import { variantDetailOptions, invalidateCatalog } from "./data";
import {
  variantFields,
  variantDefaults,
  variantBaseline,
  variantBody,
  childLifecycle,
  type VariantFields,
  fieldLabels,
  type AttributeRow,
} from "./model";
export function Variants({ material }: { material: string }) {
  const { scope } = useSession(),
    q = useInfiniteQuery(variantOptions(scope, material));
  const [selected, setSelected] = useState<string>(),
    [creating, setCreating] = useState(false);
  const rows = q.data?.pages.flat() ?? [];
  return (
    <section className="admin-panel">
      <h2>Material Variants</h2>
      <HistoryStatus
        query={q}
        count={rows.length}
        noun="variants"
        empty="No Variants returned."
      />
      <ul className="read-list">
        {rows.map((v) => (
          <li key={v.id}>
            <strong>{v.variantName ?? "Variant name unavailable"}</strong>
            <p>{v.status}</p>
            {v.id && (
              <Button
                className="secondary"
                onClick={() => {
                  setCreating(false);
                  setSelected(v.id);
                }}
              >
                Open Variant · {v.variantName}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        onClick={() => {
          setSelected(undefined);
          setCreating(true);
        }}
      >
        Create Variant
      </Button>
      {creating && (
        <VariantForm
          key="new"
          material={material}
          close={() => setCreating(false)}
        />
      )}{" "}
      {selected && (
        <VariantDetail
          key={selected}
          id={selected}
          material={material}
          close={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
function VariantDetail({
  id,
  material,
  close,
}: {
  id: string;
  material: string;
  close: () => void;
}) {
  const { scope } = useSession(),
    q = useQuery(variantDetailOptions(scope, id));
  const fresh = variantBaseline(q.data, material);
  const [opened, setOpened] = useState<typeof fresh>();
  if (!opened && fresh) setOpened(fresh);
  const safe = opened;
  return (
    <>
      {safe ? (
        <>
          <VariantForm
            material={material}
            baseline={safe}
            close={close}
            ready={!!fresh && q.isSuccess}
          />
          <PermanentBinding
            type="variant"
            id={id}
            label={safe.fields.variantName}
            ready={!!fresh && q.isSuccess}
          />
          <CatalogCitations id={id} kind="material-variants" />
        </>
      ) : q.error ? (
        <ApiErrorState error={q.error} />
      ) : (
        <p role="alert">
          Variant preservation warning: unsafe or incomplete loaded state blocks
          editing.
        </p>
      )}
    </>
  );
}
function VariantForm({
  material,
  baseline,
  close,
  ready = true,
}: {
  material: string;
  baseline?: NonNullable<ReturnType<typeof variantBaseline>>;
  close: () => void;
  ready?: boolean;
}) {
  const resolution = useIdentityResolution("variant");
  const form = useCheckedForm(
      variantFields,
      baseline?.fields ?? { ...variantDefaults, materialId: material },
    ),
    { scope } = useSession(),
    cache = useQueryClient();
  const [current, setCurrent] = useState(baseline),
    [comparison, setComparison] = useState<typeof baseline>(),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const m = useAdminMutation(
    "variant",
    async (v: VariantFields, signal) => {
      const body = variantBody(
        { ...v, materialId: material },
        current?.version ?? 0,
      );
      if (!baseline && resolution.enabled) return resolution.send(body, signal);
      const r = baseline
        ? await api.PUT("/api/v1/admin/material-variants/{id}", {
            signal,
            params: { path: { id: baseline.id } },
            body,
          })
        : await api.POST("/api/v1/admin/materials/{id}/variants", {
            signal,
            params: { path: { id: material } },
            body,
          });
      return requireData(r.data, r.response);
    },
    async (data, _v, active) => {
      if (!baseline && resolution.enabled) {
        await resolution.complete();
        return;
      }
      const safe = variantBaseline(data, material);
      if (!safe) {
        setBlocked(true);
        setNotice(
          "Response cannot be safely represented. Refresh before continuing.",
        );
        return;
      }
      const fresh = variantBaseline(
        await cache.fetchQuery({
          ...variantDetailOptions(scope, safe.id),
          staleTime: 0,
        }),
        material,
      );
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: variantOptions(scope, material).queryKey,
        exact: true,
      });
      if (!active()) return;
      await invalidateCatalog(cache, scope, material);
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: [
          "admin",
          scope,
          "catalog-citations",
          "material-variants",
          safe.id,
        ],
      });
      if (!active()) return;
      if (fresh) {
        setCurrent(fresh);
        form.reset(fresh.fields);
        setNotice(`Variant saved. Server version: ${fresh.version}.`);
        if (!baseline) close();
      } else setBlocked(true);
    },
    async (error, _v, active) => {
      if (!baseline && resolution.enabled) return;
      if (
        (error instanceof ApiError && error.status === 409) ||
        ambiguous(error)
      ) {
        setBlocked(true);
        if (baseline)
          try {
            const r = await cache.fetchQuery({
              ...variantDetailOptions(scope, baseline.id),
              staleTime: 0,
            });
            if (active()) setComparison(variantBaseline(r, material));
          } catch {
            /* Safe error feedback retains draft. */
          }
      }
    },
  );
  return (
    <section className="admin-panel">
      <h3>{baseline ? "Edit" : "Create"} Variant</h3>
      <p className="record-reference">
        Parent Material (read-only): {material}
      </p>
      {!baseline && (
        <ResolutionControls resolution={resolution} pending={m.isPending} />
      )}
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          if (resolution.canSubmit) m.mutate(v);
        })}
      >
        <fieldset disabled={m.isPending || !ready || resolution.locked}>
          <div className="admin-fields">
            {(
              [
                "variantName",
                "catalogVariantSku",
                "colorName",
                "colorCode",
                "batchNumber",
              ] as const
            ).map((k) => (
              <TextField
                key={k}
                form={form}
                name={k}
                label={fieldLabels[k] ?? k}
              />
            ))}
            <SelectField
              form={form}
              name="status"
              label="Variant status"
              values={childLifecycle}
            />
          </div>
          <AttributesEditor
            form={
              form as unknown as UseFormReturn<{ attributes: AttributeRow[] }>
            }
          />
          <EvidenceField form={form} />
          <Button type="submit" disabled={blocked}>
            {!baseline && resolution.enabled
              ? "Resolve external identity"
              : "Save Variant"}
          </Button>
          <Button className="secondary" onClick={() => form.reset()}>
            Reset Variant
          </Button>
          <Button className="secondary" onClick={close}>
            Close Variant
          </Button>
        </fieldset>
      </form>
      {!baseline && (
        <ResolutionOutcome
          resolution={resolution}
          error={m.error}
          pending={m.isPending}
          retry={() => m.mutate(form.getValues())}
          reset={() => m.reset()}
        />
      )}
      <CommandFeedback
        error={!baseline && resolution.enabled ? null : m.error}
        success={notice}
        noun="Variant"
        conflict="The Variant changed or conflicts with the current server state."
      />
      {comparison && (
        <div className="notice">
          <h3>Current server Variant</h3>
          <p>
            {comparison.fields.variantName} · version {comparison.version}
          </p>
          <Button
            onClick={() => {
              setCurrent(comparison);
              setComparison(undefined);
              setBlocked(false);
              m.reset();
            }}
          >
            Use current Variant version; retain draft
          </Button>
        </div>
      )}
    </section>
  );
}
