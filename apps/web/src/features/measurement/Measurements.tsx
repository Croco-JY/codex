import { useId, useState } from "react";
import { useForm, useFieldArray, type Path } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace, useWorkspaceCommand } from "../../app/workspace";
import { Button, Input, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import type { Project, Style } from "../workspace/model";
import {
  path,
  revisionsPath,
  useMeasurementSpec,
  useMeasurementHistory,
  useMeasurementRevision,
} from "./data";
import {
  bodyOf,
  checkedSpec,
  checkedRevision,
  draftOf,
  draftSchema,
  emptyPoint,
  type Draft,
  type Revision,
  type Spec,
  type Summary,
} from "./model";
import "./measurement.css";

export function RevisionFacts({
  value,
  title,
}: {
  value: Revision;
  title: string;
}) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <dl className="read-facts">
        <div>
          <dt>Revision number</dt>
          <dd>{value.revisionNumber}</dd>
        </div>
        <div>
          <dt>Base size</dt>
          <dd>{value.baseSize}</dd>
        </div>
        <div>
          <dt>Unit system</dt>
          <dd>{value.unitSystem}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{value.createdAt}</dd>
        </div>
        <div>
          <dt>Revision ID</dt>
          <dd className="measurement-reference">{value.id}</dd>
        </div>
      </dl>
      <ol>
        {value.points.map((p) => (
          <li key={p.code}>
            <strong>
              {p.code} · {p.label}
            </strong>
            <p>
              {p.value} {value.unitSystem} · tolerance +
              {p.tolerancePlus ?? "not recorded"} / −
              {p.toleranceMinus ?? "not recorded"}
            </p>
            {p.notes && <p style={{ whiteSpace: "pre-wrap" }}>{p.notes}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
export function Measurements({
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
  const query = useMeasurementSpec(project.id, style.id, available);
  return (
    <Surface aria-label="Measurement workspace">
      <h2>Measurement Spec</h2>
      {query.isPending && <Skeleton label="Loading Measurement Spec" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data !== undefined && (
        <Workspace
          value={query.data}
          projectId={project.id}
          styleId={style.id}
          available={available && !query.isError && !query.isFetching}
          active={project.status === "ACTIVE" && style.status === "ACTIVE"}
          refreshSpec={() => query.refetch()}
          refreshParents={refreshParents}
        />
      )}
    </Surface>
  );
}
function Workspace({
  value,
  projectId,
  styleId,
  available,
  active,
  refreshSpec,
  refreshParents,
}: {
  value: Spec | null;
  projectId: string;
  styleId: string;
  available: boolean;
  active: boolean;
  refreshSpec: () => Promise<{ data: Spec | null | undefined }>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    prefix = useId();
  const key = queryKeys.measurementSpec(
    w.scope,
    w.organizationId,
    projectId,
    styleId,
  );
  const [mode, setMode] = useState<"create" | "revision" | null>(
      value ? null : "create",
    ),
    [baseline, setBaseline] = useState<number | null>(null),
    [conflict, setConflict] = useState(false),
    [failure, setFailure] = useState<ApiError | null>(null),
    [notice, setNotice] = useState(""),
    [cursors, setCursors] = useState<number[]>([]),
    [selected, setSelected] = useState<Summary | null>(null);
  const form = useForm<Draft>({ defaultValues: draftOf() }),
    rows = useFieldArray({ control: form.control, name: "points" });
  const writable = w.writer && active && available;
  async function refresh() {
    const next = await refreshSpec();
    if (!w.current()) return;
    setCursors([]);
    setSelected(null);
    if (next.data) {
      const head = next.data.latestRevision.revisionNumber;
      await cache.invalidateQueries({
        queryKey: queryKeys.measurementRevisions(
          w.scope,
          w.organizationId,
          projectId,
          styleId,
          25,
          head,
        ),
      });
    }
  }
  const command = useWorkspaceCommand(
    [...key, mode ?? "idle"],
    async (draft: Draft, signal) => {
      const params = {
        path: { organizationId: w.organizationId, projectId, styleId },
      };
      if (mode === "create") {
        const r = await api.PUT(path, {
          signal,
          params: { ...params, header: { "If-None-Match": "*" } },
          body: bodyOf(draft),
        });
        const saved = checkedSpec(requireData(r.data, r.response), styleId);
        if (saved.latestRevision.revisionNumber !== 1) throw new ApiError(502);
        return saved.latestRevision;
      }
      if (mode !== "revision" || baseline === null || !value)
        throw new ApiError(400);
      const r = await api.POST(revisionsPath, {
        signal,
        params,
        body: { ...bodyOf(draft), expectedLatestRevisionNumber: baseline },
      });
      const saved = checkedRevision(
        requireData(r.data, r.response),
        styleId,
        value.id,
      );
      if (saved.revisionNumber !== baseline + 1) throw new ApiError(502);
      return saved;
    },
    async () => {
      setMode(null);
      setBaseline(null);
      setConflict(false);
      setFailure(null);
      form.reset(draftOf());
      setNotice("Measurement revision created.");
      await refresh();
    },
    async (error) => {
      const problem = error instanceof ApiError ? error : new ApiError(502);
      setFailure(problem);
      setNotice("");
      setConflict(true);
      if (problem.status === 409) await refreshParents();
      if (!w.current()) return;
      await refresh();
    },
  );
  function begin() {
    if (!value) return;
    form.reset(draftOf(value.latestRevision));
    setBaseline(value.latestRevision.revisionNumber);
    setMode("revision");
    setFailure(null);
    setNotice("");
    setConflict(false);
  }
  function reconcile() {
    if (!value) return;
    setBaseline(value.latestRevision.revisionNumber);
    setMode("revision");
    setConflict(false);
    setFailure(null);
    setNotice(
      "Draft reconciled to the displayed latest revision. Review and submit explicitly.",
    );
  }
  const submitting = command.isPending;
  return (
    <>
      {!value && <p>No Measurement Spec has been created for this Style.</p>}
      {!w.writer && (
        <p>Your VIEWER membership provides read-only measurement access.</p>
      )}
      {!active && (
        <p>
          Measurements are read-only while the Project or Style is archived.
        </p>
      )}
      {value && (
        <>
          <p className="measurement-reference">
            Measurement Spec ID: {value.id}
          </p>
          <RevisionFacts
            value={value.latestRevision}
            title={`Latest revision ${value.latestRevision.revisionNumber}`}
          />
          <History
            spec={value}
            projectId={projectId}
            available={available}
            cursors={cursors}
            onCursors={setCursors}
            onSelect={setSelected}
          />
          {selected && (
            <Selected
              key={selected.id}
              summary={selected}
              spec={value}
              projectId={projectId}
              available={available}
            />
          )}
        </>
      )}
      {writable && value && mode === null && (
        <Button onClick={begin}>Create new revision</Button>
      )}
      {w.writer && active && mode !== null && (
        <form
          aria-label="Measurement draft"
          onSubmit={form.handleSubmit((draft) => {
            const parsed = draftSchema.safeParse(draft);
            if (!parsed.success) {
              for (const issue of parsed.error.issues)
                form.setError(issue.path.join(".") as Path<Draft>, {
                  type: "validate",
                  message: issue.message,
                });
              return;
            }
            if (writable && !submitting && !conflict)
              command.mutate(parsed.data);
          })}
        >
          <h3>
            {mode === "create"
              ? "Create Measurement Spec"
              : "New complete revision"}
          </h3>
          {mode === "revision" && <p>Draft baseline revision: {baseline}</p>}
          <fieldset disabled={!writable || submitting}>
            <legend>Revision snapshot</legend>
            <div className="measurement-grid">
              <div>
                <label htmlFor={`${prefix}-size`}>Base size</label>
                <Input
                  id={`${prefix}-size`}
                  {...form.register("baseSize")}
                  aria-invalid={!!form.formState.errors.baseSize}
                  aria-describedby={`${prefix}-size-error`}
                />
                <p id={`${prefix}-size-error`} className="measurement-error">
                  {form.formState.errors.baseSize?.message}
                </p>
              </div>
              <div>
                <label htmlFor={`${prefix}-unit`}>Unit system</label>
                <select
                  id={`${prefix}-unit`}
                  {...form.register("unitSystem")}
                  aria-invalid={!!form.formState.errors.unitSystem}
                  aria-describedby={`${prefix}-unit-error`}
                >
                  <option value="">Choose unit system</option>
                  <option>MM</option>
                  <option>CM</option>
                  <option>IN</option>
                </select>
                <p id={`${prefix}-unit-error`} className="measurement-error">
                  {form.formState.errors.unitSystem?.message}
                </p>
              </div>
            </div>
            {rows.fields.map((row, index) => (
              <fieldset className="measurement-point" key={row.id}>
                <legend>POM {index + 1}</legend>
                <div className="measurement-grid">
                  {(
                    [
                      "code",
                      "label",
                      "value",
                      "tolerancePlus",
                      "toleranceMinus",
                      "notes",
                    ] as const
                  ).map((field) => {
                    const labels = {
                        code: "Code",
                        label: "Label",
                        value: "Value",
                        tolerancePlus: "Tolerance plus",
                        toleranceMinus: "Tolerance minus",
                        notes: "Notes",
                      },
                      id = `${prefix}-${index}-${field}`,
                      error = form.formState.errors.points?.[index]?.[field];
                    return (
                      <div key={field}>
                        <label htmlFor={id}>
                          {labels[field]} · POM {index + 1}
                        </label>
                        {field === "notes" ? (
                          <textarea
                            id={id}
                            {...form.register(`points.${index}.${field}`)}
                            aria-invalid={!!error}
                            aria-describedby={`${id}-error`}
                          />
                        ) : (
                          <Input
                            id={id}
                            {...form.register(`points.${index}.${field}`)}
                            inputMode={
                              [
                                "value",
                                "tolerancePlus",
                                "toleranceMinus",
                              ].includes(field)
                                ? "decimal"
                                : undefined
                            }
                            aria-invalid={!!error}
                            aria-describedby={`${id}-error`}
                          />
                        )}
                        <p id={`${id}-error`} className="measurement-error">
                          {error?.message}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="workspace-actions">
                  <Button
                    disabled={rows.fields.length === 1}
                    onClick={() => rows.remove(index)}
                  >
                    Remove POM {index + 1}
                  </Button>
                  <Button
                    disabled={index === 0}
                    onClick={() => rows.move(index, index - 1)}
                  >
                    Move POM {index + 1} up
                  </Button>
                  <Button
                    disabled={index === rows.fields.length - 1}
                    onClick={() => rows.move(index, index + 1)}
                  >
                    Move POM {index + 1} down
                  </Button>
                </div>
              </fieldset>
            ))}
            <p className="measurement-error" role="alert">
              {form.formState.errors.points?.root?.message}
            </p>
            <Button
              disabled={rows.fields.length >= 500}
              onClick={() => rows.append(emptyPoint())}
            >
              Add POM
            </Button>
          </fieldset>
          {writable && (
            <Button type="submit" disabled={submitting || conflict}>
              {mode === "create"
                ? "Create Measurement Spec"
                : "Create revision"}
            </Button>
          )}
        </form>
      )}
      {failure && <ApiErrorState error={failure} />}
      {conflict && (
        <section role="alert" aria-label="Measurement reconciliation">
          <h3>Review authoritative measurements before submitting again</h3>
          <p>
            Your unsaved draft is retained. Draft baseline:{" "}
            {baseline ?? "initial creation"}. Current latest:{" "}
            {value?.latestRevision.revisionNumber ?? "not available"}.
          </p>
          {failure && (failure.status === 0 || failure.status >= 500) && (
            <p>
              Outcome is uncertain. The server may have committed. A matching
              revision is not proof that your request succeeded. No automatic
              resend.
            </p>
          )}
          {writable && value && (
            <Button onClick={reconcile}>
              Reconcile draft with latest revision
            </Button>
          )}
          {writable && !value && (
            <Button
              onClick={() => {
                setMode("create");
                setBaseline(null);
                setConflict(false);
                setFailure(null);
                setNotice(
                  "Authoritative absence reviewed. Submit a new create-only request explicitly.",
                );
              }}
            >
              Use draft for initial creation
            </Button>
          )}
          <Button onClick={() => void refresh()}>
            Refresh measurement comparison
          </Button>
          <p>
            Reconciliation does not submit. Review the complete draft, then
            explicitly create a revision.
          </p>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
function History({
  spec,
  projectId,
  available,
  cursors,
  onCursors,
  onSelect,
}: {
  spec: Spec;
  projectId: string;
  available: boolean;
  cursors: number[];
  onCursors: (v: number[]) => void;
  onSelect: (v: Summary) => void;
}) {
  const max = cursors.at(-1) ?? spec.latestRevision.revisionNumber,
    query = useMeasurementHistory(projectId, spec, max, available);
  return (
    <section aria-label="Measurement revision history">
      <h3>Revision history</h3>
      <p>History upper bound: {max}. Complete snapshots, newest first.</p>
      {query.isPending && <Skeleton label="Loading Measurement history" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <ol>
            {query.data.items.map((r) => (
              <li key={r.id}>
                <p>
                  Revision {r.revisionNumber} · {r.baseSize} · {r.unitSystem} ·{" "}
                  {r.pointCount} POM · {r.createdAt}
                </p>
                <Button
                  disabled={!available || query.isError}
                  onClick={() => onSelect(r)}
                >
                  Open revision {r.revisionNumber}
                </Button>
              </li>
            ))}
          </ol>
          <div className="workspace-actions">
            <Button
              disabled={!available || cursors.length === 0}
              onClick={() => onCursors(cursors.slice(0, -1))}
            >
              Newer revisions
            </Button>
            <Button
              disabled={
                !available ||
                query.isFetching ||
                query.isError ||
                query.data.nextMaxRevisionNumber === null
              }
              onClick={() => {
                if (query.data?.nextMaxRevisionNumber)
                  onCursors([...cursors, query.data.nextMaxRevisionNumber]);
              }}
            >
              Older revisions
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
function Selected({
  summary,
  spec,
  projectId,
  available,
}: {
  summary: Summary;
  spec: Spec;
  projectId: string;
  available: boolean;
}) {
  const embedded = summary.id === spec.latestRevision.id,
    query = useMeasurementRevision(
      projectId,
      spec,
      summary.id,
      available && !embedded,
    );
  if (embedded)
    return (
      <RevisionFacts
        value={spec.latestRevision}
        title={`Selected revision ${summary.revisionNumber}`}
      />
    );
  if (query.isPending)
    return <Skeleton label="Loading historical Measurement revision" />;
  if (query.isError)
    return (
      <ApiErrorState error={query.error} retry={() => void query.refetch()} />
    );
  if (query.data.revisionNumber !== summary.revisionNumber)
    return <ApiErrorState error={new ApiError(502)} />;
  return (
    <RevisionFacts
      value={query.data}
      title={`Selected revision ${query.data.revisionNumber}`}
    />
  );
}
