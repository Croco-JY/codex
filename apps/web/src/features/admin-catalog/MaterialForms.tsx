import {
  useIdentityResolution,
  ResolutionControls,
  ResolutionOutcome,
} from "../admin-identity/Workspace";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { useCheckedForm, Field } from "../admin-sources/FormUI";
import { useAdminMutation, ambiguous } from "../admin-sources/data";
import {
  TextField,
  SelectField,
  EvidenceField,
  CommandFeedback,
} from "../admin-network/Fields";
import { countryOptions, referenceName } from "../network/references";
import { useQuery } from "@tanstack/react-query";
import { SupplierPicker, SupplierLabel } from "../materials/SupplierPicker";
import { CompositionEditor } from "./Editors";
import {
  materialFields,
  materialDefaults,
  materialTypes,
  lifecycle,
  materialBody,
  materialBaseline,
  compositionFields,
  type MaterialBaseline,
  type MaterialFields,
  type CompositionFields,
} from "./model";
import { refreshMaterial, invalidateCatalog } from "./data";
export function Origin({
  form,
}: {
  form: ReturnType<typeof useCheckedForm<MaterialFields>>;
}) {
  const { scope } = useSession(),
    q = useQuery(countryOptions(scope));
  return (
    <div>
      {q.error && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      <Field name="originCountryId" label="Origin Country (optional)">
        {(p) => (
          <select
            className="input"
            {...p}
            {...form.register("originCountryId")}
            value={form.watch("originCountryId")}
          >
            <option value="">Not recorded</option>
            {q.data
              ?.filter((c) => c.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {referenceName(c)}
                </option>
              ))}
            {form.watch("originCountryId") &&
              !q.data?.some((c) => c.id === form.watch("originCountryId")) && (
                <option value={form.watch("originCountryId")}>
                  Country label unavailable
                </option>
              )}
          </select>
        )}
      </Field>
    </div>
  );
}
export function MaterialForm({
  baseline,
  fixedSupplier,
  cancel,
  ready = true,
}: {
  baseline?: MaterialBaseline;
  fixedSupplier?: string;
  cancel: () => void;
  ready?: boolean;
}) {
  const resolution = useIdentityResolution("material");
  const form = useCheckedForm(
      materialFields,
      baseline ?? {
        ...materialDefaults,
        catalogSupplierId: fixedSupplier ?? "",
      },
    ),
    comp = useCheckedForm(compositionFields, {
      completeness: "UNKNOWN",
      parts: [],
      observationId: "",
    } as CompositionFields);
  const { scope } = useSession(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [current, setCurrent] = useState(baseline),
    [comparison, setComparison] = useState<MaterialBaseline>(),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const refresh = async () => {
    if (!baseline) return;
    const v = await refreshMaterial(cache, scope, baseline.id);
    setComparison(v);
  };
  const mutation = useAdminMutation(
    "material-profile",
    async (v: MaterialFields, signal) => {
      const composition = baseline
        ? {
            completeness: current!.compositionCompleteness,
            parts: current!.composition,
            observationId: v.observationId,
          }
        : compositionFields.parse({
            ...comp.getValues(),
            observationId: v.observationId,
          });
      const body = materialBody(
        {
          ...v,
          ...(current
            ? {
                catalogSupplierId: current.catalogSupplierId,
                materialType: current.materialType,
              }
            : {}),
        },
        composition,
        current?.version ?? 0,
      );
      if (!baseline && resolution.enabled) return resolution.send(body, signal);
      const r = baseline
        ? await api.PUT("/api/v1/admin/materials/{id}", {
            signal,
            params: { path: { id: baseline.id } },
            body,
          })
        : await api.POST("/api/v1/admin/materials", { signal, body });
      return requireData(r.data, r.response);
    },
    async (data, _v, active) => {
      if (!baseline && resolution.enabled) {
        await resolution.complete();
        return;
      }
      const safe = materialBaseline(data);
      if (!safe) {
        setBlocked(true);
        setNotice(
          "Saved response is incomplete. Refresh server state before continuing.",
        );
        return;
      }
      const fresh = await refreshMaterial(cache, scope, safe.id);
      if (!active()) return;
      await invalidateCatalog(cache, scope, safe.id);
      if (!active()) return;
      if (!fresh) {
        setBlocked(true);
        setNotice("Saved; authoritative refresh is unavailable.");
        return;
      }
      if (baseline) cancel();
      else navigate(`/admin/materials/${safe.id}`);
    },
    async (error, _v, active) => {
      if (!baseline && resolution.enabled) return;
      if (
        (error instanceof ApiError && error.status === 409) ||
        ambiguous(error)
      ) {
        setBlocked(true);
        if (baseline) {
          const v = await refreshMaterial(cache, scope, baseline.id);
          if (active()) setComparison(v);
        }
      }
    },
  );
  const submit = form.submit((v) => {
    if (!resolution.canSubmit) return;
    if (baseline) {
      mutation.mutate(v);
      return;
    }
    const r = compositionFields.safeParse({
      ...comp.getValues(),
      observationId: v.observationId,
    });
    if (!r.success) {
      comp.setError("parts", {
        message: r.error.issues.map((i) => i.message).join(" "),
      });
      return;
    }
    mutation.mutate(v);
  });
  return (
    <section className="admin-panel">
      <h2>{baseline ? "Edit Material profile" : "Create Material"}</h2>
      {!baseline && (
        <ResolutionControls
          resolution={resolution}
          pending={mutation.isPending}
        />
      )}
      <form className="admin-form" onSubmit={submit}>
        <fieldset disabled={mutation.isPending || !ready || resolution.locked}>
          <div className="admin-fields">
            {baseline || fixedSupplier ? (
              <p>
                Catalog Supplier (read-only):{" "}
                <SupplierLabel
                  id={current?.catalogSupplierId ?? fixedSupplier}
                />
              </p>
            ) : (
              <div>
                <SupplierPicker
                  label="Catalog Supplier"
                  value={form.watch("catalogSupplierId")}
                  onChange={(v) => form.setValue("catalogSupplierId", v)}
                />
                {form.formState.errors.catalogSupplierId && (
                  <p role="alert">Choose a catalog Supplier.</p>
                )}
              </div>
            )}
            {baseline ? (
              <p>Material type (read-only): {current?.materialType}</p>
            ) : (
              <SelectField
                form={form}
                name="materialType"
                label="Material type"
                values={materialTypes}
              />
            )}
            <TextField form={form} name="displayName" label="Material name" />
            <TextField
              form={form}
              name="catalogArticleNumber"
              label="Catalog article number"
            />
            <TextField
              form={form}
              name="description"
              label="Material description"
              multiline
            />
            <Origin form={form} />
            <SelectField
              form={form}
              name="status"
              label="Material status"
              values={lifecycle}
            />
          </div>
          {!baseline && <CompositionEditor form={comp} />}
          <EvidenceField form={form} />
          <div className="scope-actions">
            <Button type="submit" disabled={blocked}>
              {baseline
                ? "Save Material profile"
                : resolution.enabled
                  ? "Resolve external identity"
                  : "Create Material"}
            </Button>
            <Button
              className="secondary"
              onClick={() => form.reset(current ?? materialDefaults)}
            >
              Reset profile
            </Button>
            <Button className="secondary" onClick={cancel}>
              Cancel Material form
            </Button>
          </div>
        </fieldset>
      </form>
      {!baseline && (
        <ResolutionOutcome
          resolution={resolution}
          error={mutation.error}
          pending={mutation.isPending}
          retry={() => mutation.mutate(form.getValues())}
          reset={() => mutation.reset()}
        />
      )}
      <CommandFeedback
        error={!baseline && resolution.enabled ? null : mutation.error}
        success={notice}
        noun="Material"
        conflict="The Material changed or conflicts with the current server state."
        refresh={() => void refresh()}
      />
      {comparison && (
        <section className="notice">
          <h3>Current server Material</h3>
          <p>
            {comparison.displayName} · version {comparison.version} ·{" "}
            {comparison.compositionCompleteness}
          </p>
          <ul>
            {comparison.composition.map((p) => (
              <li key={p.fiberTypeId}>
                {p.fiberTypeId}: {p.percentage}%
              </li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setCurrent(comparison);
              setBlocked(false);
              mutation.reset();
              setComparison(undefined);
            }}
          >
            Use current Material version and Composition; retain profile draft
          </Button>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
export function CompositionForm({
  baseline,
  cancel,
  ready,
}: {
  baseline: MaterialBaseline;
  cancel: () => void;
  ready: boolean;
}) {
  const form = useCheckedForm(compositionFields, {
    completeness: baseline.compositionCompleteness,
    parts: baseline.composition.map((p) => ({
      fiberTypeId: p.fiberTypeId,
      percentage: p.percentage,
    })),
    observationId: "",
  });
  const { scope } = useSession(),
    cache = useQueryClient();
  const [current, setCurrent] = useState(baseline),
    [comparison, setComparison] = useState<MaterialBaseline>(),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const mutation = useAdminMutation(
    "material-composition",
    async (v: CompositionFields, signal) => {
      const r = await api.PUT("/api/v1/admin/materials/{id}/composition", {
        signal,
        params: { path: { id: baseline.id } },
        body: { ...v, version: current.version },
      });
      return requireData(r.data, r.response);
    },
    async (data, _v, active) => {
      if (!materialBaseline(data)) {
        setBlocked(true);
        setNotice(
          "Response cannot be used safely. Refresh Material before continuing.",
        );
        return;
      }
      const fresh = await refreshMaterial(cache, scope, baseline.id);
      if (!active()) return;
      await invalidateCatalog(cache, scope, baseline.id);
      if (!active()) return;
      if (fresh) cancel();
      else {
        setBlocked(true);
        setNotice("Saved; authoritative Material refresh is unavailable.");
      }
    },
    async (error, _v, active) => {
      if (
        (error instanceof ApiError && error.status === 409) ||
        ambiguous(error)
      ) {
        setBlocked(true);
        const v = await refreshMaterial(cache, scope, baseline.id);
        if (active()) setComparison(v);
      }
    },
  );
  return (
    <section className="admin-panel">
      <h2>Replace Composition</h2>
      <form
        className="admin-form"
        onSubmit={form.submit((v) => mutation.mutate(v))}
      >
        <fieldset disabled={mutation.isPending || !ready}>
          <CompositionEditor
            form={form}
            preserved={baseline.composition.map((p) => p.fiberTypeId)}
          />
          <EvidenceField form={form} />
          <Button type="submit" disabled={blocked}>
            Save Composition
          </Button>
          <Button className="secondary" onClick={() => form.reset()}>
            Reset Composition
          </Button>
          <Button className="secondary" onClick={cancel}>
            Cancel Composition
          </Button>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={notice}
        noun="Composition"
        conflict="The Material changed or conflicts with the current server state."
      />
      {comparison && (
        <div className="notice">
          <h3>Current server Composition</h3>
          <p>
            {comparison.compositionCompleteness} · Material version{" "}
            {comparison.version}
          </p>
          <ul>
            {comparison.composition.map((p) => (
              <li key={p.fiberTypeId}>
                {p.fiberTypeId}: {p.percentage}%
              </li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setCurrent(comparison);
              setComparison(undefined);
              setBlocked(false);
              mutation.reset();
            }}
          >
            Use current Material version; retain Composition draft
          </Button>
        </div>
      )}
    </section>
  );
}
