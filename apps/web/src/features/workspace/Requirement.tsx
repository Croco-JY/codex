import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import {
  useWorkspace,
  useWorkspaceCommand,
  isCancelled,
} from "../../app/workspace";
import { Button, Input, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import type { Project, Style } from "./model";
import {
  checkedRequirement,
  requirementBody,
  requirementDraft,
  requirementSchema,
  type Requirement,
  type RequirementDraft,
} from "./requirementModel";
const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/requirement" as const;
const labels = {
  productType: "Product type",
  targetQuantity: "Target quantity",
  quantityUnit: "Quantity unit",
  targetCost: "Target unit cost",
  currency: "Currency",
  targetDeliveryDate: "Target delivery date",
  notes: "Requirement notes",
};
function Facts({
  value,
  label = "Recorded Requirement",
}: {
  value: Requirement;
  label?: string;
}) {
  return (
    <section aria-label={label}>
      <h3>{label}</h3>
      <dl className="read-facts">
        {(Object.keys(labels) as (keyof typeof labels)[]).map((field) => (
          <div key={field}>
            <dt>{labels[field]}</dt>
            <dd>{value[field] ?? "Not recorded"}</dd>
          </div>
        ))}
        <div>
          <dt>Requirement version</dt>
          <dd>{value.version}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{value.createdAt}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{value.updatedAt}</dd>
        </div>
      </dl>
    </section>
  );
}
export function RequirementSection({
  project,
  style,
  available,
  refreshParents,
}: {
  project: Project;
  style: Style;
  available: boolean;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    key = queryKeys.requirement(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
    );
  const query = useQuery({
    queryKey: key,
    retry: false,
    enabled: available,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        try {
          const r = await api.GET(path, {
            signal,
            params: {
              path: {
                organizationId: w.organizationId,
                projectId: project.id,
                styleId: style.id,
              },
            },
          });
          return checkedRequirement(requireData(r.data, r.response), style.id);
        } catch (error) {
          // Only this singular read, after the page resolved both parents, treats 404 as absence.
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      }),
  });
  return (
    <Surface aria-label="Style Requirement">
      <h2>Style Requirement</h2>
      <p>
        A private planning sheet. Target unit cost is per quantity unit; these
        targets are not accepted commercial terms.
      </p>
      {query.isPending &&
        (available ? (
          <Skeleton label="Loading Requirement" />
        ) : (
          <p>Parent context is unavailable.</p>
        ))}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data !== undefined && (
        <RequirementEditor
          value={query.data}
          styleId={style.id}
          projectId={project.id}
          available={available && !query.isError && !query.isFetching}
          active={project.status === "ACTIVE" && style.status === "ACTIVE"}
          refresh={() => query.refetch()}
          refreshParents={refreshParents}
        />
      )}
    </Surface>
  );
}
function RequirementEditor({
  value,
  styleId,
  projectId,
  available,
  active,
  refresh,
  refreshParents,
}: {
  value: Requirement | null;
  styleId: string;
  projectId: string;
  available: boolean;
  active: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    prefix = useId();
  const key = queryKeys.requirement(
    w.scope,
    w.organizationId,
    projectId,
    styleId,
  );
  const [baseline, setBaseline] = useState(value),
    [mode, setMode] = useState<"create" | "update">(
      value ? "update" : "create",
    ),
    [conflict, setConflict] = useState(false),
    [notice, setNotice] = useState(""),
    [failure, setFailure] = useState<ApiError | null>(null);
  const form = useForm<RequirementDraft>({
    defaultValues: requirementDraft(value),
  });
  const writable = w.writer && active && available;
  const mutation = useWorkspaceCommand(
    [...key, mode],
    async (draft: RequirementDraft, signal) => {
      const r = await api.PUT(path, {
        signal,
        params: {
          path: { organizationId: w.organizationId, projectId, styleId },
          ...(mode === "create" ? { header: { "If-None-Match": "*" } } : {}),
        },
        body: requirementBody(draft, mode === "create" ? 0 : baseline!.version),
      });
      return checkedRequirement(requireData(r.data, r.response), styleId);
    },
    async (saved) => {
      setBaseline(saved);
      setMode("update");
      setConflict(false);
      setFailure(null);
      form.reset(requirementDraft(saved));
      setNotice("Requirement saved.");
      cache.setQueryData(key, saved);
      await cache.invalidateQueries({ queryKey: key, exact: true });
    },
    async (error) => {
      if (!(error instanceof ApiError)) return;
      setFailure(error);
      if ([0, 404, 409, 412].includes(error.status) || error.status >= 500) {
        setConflict(true);
        if (error.status === 409 || error.status === 404)
          await Promise.all([refresh(), refreshParents()]);
        else await refresh();
      }
    },
  );
  const problem = failure ?? mutation.error;
  const adopt = (keepDraft = false) => {
    if (!available) return;
    setBaseline(value);
    setMode(value ? "update" : "create");
    setConflict(false);
    setFailure(null);
    mutation.reset();
    setNotice("");
    if (!keepDraft) form.reset(requirementDraft(value));
  };
  return (
    <>
      {value === null ? (
        <p>No Requirement sheet has been created for this Style.</p>
      ) : (
        <Facts value={value} />
      )}
      {!active && (
        <p role="status">
          Requirement is read-only while its Project or Style is archived.
          Reactivate the parent to make changes.
        </p>
      )}
      {!w.writer && (
        <p>Requirement access is read-only for your VIEWER membership.</p>
      )}
      {w.writer && (value !== null || active || form.formState.isDirty) && (
        <form
          className="workspace-metadata"
          aria-label="Requirement planning sheet"
          onSubmit={form.handleSubmit((draft) => {
            form.clearErrors();
            const parsed = requirementSchema.safeParse(draft);
            if (!parsed.success) {
              parsed.error.issues.forEach((issue) =>
                form.setError(issue.path[0] as keyof RequirementDraft, {
                  message: issue.message,
                }),
              );
              return;
            }
            if (
              writable &&
              !conflict &&
              !mutation.isPending &&
              (mode === "create" || baseline)
            ) {
              setNotice("");
              mutation.mutate(parsed.data);
            }
          })}
        >
          {(Object.keys(labels) as (keyof typeof labels)[]).map((field) => {
            const id = `${prefix}-${field}`,
              error = form.formState.errors[field];
            const props = {
              id,
              "aria-invalid": !!error,
              "aria-describedby": error ? `${id}-error` : undefined,
              ...form.register(field),
            };
            return (
              <div className="filter-field" key={field}>
                <label htmlFor={id}>{labels[field]}</label>
                {field === "quantityUnit" ? (
                  <select
                    className="input"
                    {...props}
                    disabled={!writable || mutation.isPending}
                  >
                    <option value="">Not set</option>
                    <option>PCS</option>
                    <option>SET</option>
                  </select>
                ) : field === "notes" ? (
                  <textarea
                    className="input"
                    rows={4}
                    {...props}
                    readOnly={!writable || mutation.isPending}
                  />
                ) : (
                  <Input
                    {...props}
                    type={field === "targetDeliveryDate" ? "date" : "text"}
                    inputMode={
                      field === "targetQuantity" || field === "targetCost"
                        ? "decimal"
                        : undefined
                    }
                    readOnly={!writable || mutation.isPending}
                  />
                )}
                {error && (
                  <p id={`${id}-error`} role="alert" className="field-error">
                    {error.message}
                  </p>
                )}
              </div>
            );
          })}
          <div className="workspace-actions">
            {writable && (
              <Button type="submit" disabled={mutation.isPending || conflict}>
                {mode === "create" ? "Create Requirement" : "Save Requirement"}
              </Button>
            )}
            <Button
              className="secondary"
              disabled={!available || mutation.isPending}
              onClick={() => adopt()}
            >
              Reset Requirement draft
            </Button>
          </div>
        </form>
      )}
      {problem && !isCancelled(problem) && <ApiErrorState error={problem} />}
      {conflict && (
        <section
          role="alert"
          aria-label="Requirement conflict"
          className="notice"
        >
          <h3>
            {problem instanceof ApiError && problem.status === 412
              ? "A Requirement already exists."
              : "The Requirement or its parent context changed, or the outcome needs review."}
          </h3>
          <p>
            Your draft is retained above. Refresh and compare the authoritative
            state before explicitly deciding what to submit.
          </p>
          {problem instanceof ApiError &&
            (problem.status === 0 || problem.status >= 500) && (
              <p>Save outcome unknown. Do not resubmit automatically.</p>
            )}
          {value && <Facts value={value} label="Current server Requirement" />}
          {value === null && (
            <p>
              The latest read returned no Requirement. This does not convert an
              update into a create.
            </p>
          )}
          <div className="workspace-actions">
            <Button disabled={!available} onClick={() => adopt()}>
              {value
                ? "Use existing Requirement"
                : "Discard draft and use absence"}
            </Button>
            {writable && (
              <Button onClick={() => adopt(true)}>
                {value
                  ? "Reconcile draft with existing"
                  : "Create from this draft"}
              </Button>
            )}
            <Button
              className="secondary"
              onClick={() => void Promise.all([refresh(), refreshParents()])}
            >
              Refresh Requirement comparison
            </Button>
          </div>
          <p>
            Reconciliation does not submit. Review the draft, then save
            explicitly.
          </p>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
