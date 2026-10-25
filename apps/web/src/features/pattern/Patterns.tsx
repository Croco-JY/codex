import { useId, useState } from "react";
import { Link } from "react-router";
import { useForm, type Path } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace, useWorkspaceCommand } from "../../app/workspace";
import { Button, Input, Surface, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { stylePath, type Project, type Style } from "../workspace/model";
import { useMeasurementSpec, useMeasurementHistory } from "../measurement/data";
import type { Spec } from "../measurement/model";
import {
  path,
  detailPath,
  historyPath,
  usePatterns,
  usePattern,
  usePatternHistory,
  usePatternRevision,
} from "./data";
import {
  checkedPattern,
  checkedRevision,
  bodyOf,
  draftOf,
  draftSchema,
  type Draft,
  type Revision,
  type Pattern,
  type Filter,
} from "./model";
import "./pattern.css";
type Context = {
  project: Project;
  style: Style;
  available: boolean;
  refreshParents: () => Promise<unknown>;
};
function readonly(w: boolean, active: boolean) {
  return (
    <>
      {!w && <p>Your VIEWER membership provides read-only Pattern access.</p>}
      {!active && (
        <p>Patterns are read-only while the Project or Style is archived.</p>
      )}
    </>
  );
}
export function PatternList({
  project,
  style,
  available,
  refreshParents,
}: Context) {
  const w = useWorkspace(),
    cache = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ACTIVE"),
    [cursors, setCursors] = useState<string[]>([]),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  const cursor = cursors.at(-1) ?? null,
    query = usePatterns(project.id, style.id, filter, cursor, available),
    active = project.status === "ACTIVE" && style.status === "ACTIVE",
    writable = w.writer && active && available && !query.isError;
  async function refresh() {
    setCursors([]);
    await cache.invalidateQueries({
      queryKey: queryKeys
        .patterns(
          w.scope,
          w.organizationId,
          project.id,
          style.id,
          filter,
          25,
          null,
        )
        .slice(0, 8),
    });
  }
  return (
    <Surface aria-label="Pattern collection">
      <h2>Pattern families</h2>
      {readonly(w.writer, active)}
      <label htmlFor="pattern-filter">Pattern status</label>
      <select
        id="pattern-filter"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value as Filter);
          setCursors([]);
        }}
      >
        <option>ACTIVE</option>
        <option>ARCHIVED</option>
        <option>ALL</option>
      </select>
      {query.isPending && <Skeleton label="Loading Patterns" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <p>
            {query.data.items.length === 0
              ? "No Patterns in this page."
              : "Pattern metadata families"}
          </p>
          <ul className="pattern-list">
            {query.data.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`${stylePath(w.organizationId, project.id, style.id)}/patterns/${p.id}`}
                >
                  {p.latestRevision.name}
                </Link>
                <p>
                  {p.status} · Revision {p.latestRevision.revisionNumber}
                </p>
                {p.latestRevision.purpose && <p>{p.latestRevision.purpose}</p>}
                <p className="pattern-id">Pattern ID: {p.id}</p>
              </li>
            ))}
          </ul>
          <div className="workspace-actions">
            <Button
              disabled={cursors.length === 0 || query.isFetching}
              onClick={() => setCursors(cursors.slice(0, -1))}
            >
              Newer Patterns
            </Button>
            <Button
              disabled={!query.data.nextCursor || query.isFetching}
              onClick={() => {
                if (query.data?.nextCursor)
                  setCursors([...cursors, query.data.nextCursor]);
              }}
            >
              Older Patterns
            </Button>
          </div>
        </>
      )}
      {writable && !editing && (
        <Button
          onClick={() => {
            setEditing(true);
            setNotice("");
          }}
        >
          Create Pattern
        </Button>
      )}
      {editing && w.writer && (
        <Editor
          projectId={project.id}
          styleId={style.id}
          writable={writable}
          refresh={refresh}
          refreshParents={refreshParents}
          saved={() => {
            setEditing(false);
            setNotice("Pattern and revision 1 created.");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}
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
          <dt>Name</dt>
          <dd>{value.name}</dd>
        </div>
        <div>
          <dt>Purpose</dt>
          <dd>{value.purpose ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Revision number</dt>
          <dd>{value.revisionNumber}</dd>
        </div>
        <div>
          <dt>Measurement revision pin</dt>
          <dd className="pattern-id">
            {value.measurementRevisionId ?? "No Measurement pin"}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{value.createdAt}</dd>
        </div>
        <div>
          <dt>Revision ID</dt>
          <dd className="pattern-id">{value.id}</dd>
        </div>
      </dl>
      <p>
        Metadata only. A measurement association does not establish geometry,
        fit or approval.
      </p>
    </section>
  );
}
export function PatternDetail({
  project,
  style,
  id,
  available,
  refreshParents,
}: Context & { id: string }) {
  const q = usePattern(project.id, style.id, id);
  if (q.isPending) return <Skeleton label="Loading Pattern" />;
  if (!q.data)
    return (
      <ApiErrorState error={q.error} page retry={() => void q.refetch()} />
    );
  return (
    <Detail
      key={id}
      projectId={project.id}
      styleId={style.id}
      value={q.data}
      writable={writable()}
      activeParents={project.status === "ACTIVE" && style.status === "ACTIVE"}
      available={available && !q.isError && !q.isFetching}
      error={q.isError ? q.error : null}
      refresh={() => q.refetch()}
      refreshParents={refreshParents}
    />
  );
  function writable() {
    return (
      available &&
      !q.isError &&
      !q.isFetching &&
      project.status === "ACTIVE" &&
      style.status === "ACTIVE"
    );
  }
}
function Detail({
  projectId,
  styleId,
  value,
  writable,
  activeParents,
  available,
  error,
  refresh,
  refreshParents,
}: {
  projectId: string;
  styleId: string;
  value: Pattern;
  writable: boolean;
  activeParents: boolean;
  available: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  async function reconcileRead() {
    const result = (await refresh()) as { data?: Pattern };
    if (!w.current()) return;
    if (result.data?.latestRevision.id === value.latestRevision.id)
      await cache.invalidateQueries({
        queryKey: [
          ...queryKeys.pattern(
            w.scope,
            w.organizationId,
            projectId,
            styleId,
            value.id,
          ),
          "revisions",
        ],
      });
  }

  return (
    <Surface aria-label="Pattern detail">
      <h2>{value.latestRevision.name}</h2>
      {error != null && <ApiErrorState error={error} />}
      {readonly(w.writer, activeParents)}
      <p>
        Pattern status: {value.status} · Lifecycle version: {value.version}
      </p>
      <p className="pattern-id">Pattern ID: {value.id}</p>
      <RevisionFacts
        value={value.latestRevision}
        title={`Latest Pattern revision ${value.latestRevision.revisionNumber}`}
      />
      <History
        key={value.latestRevision.id}
        projectId={projectId}
        value={value}
        available={available}
      />
      {w.writer && activeParents && (
        <Lifecycle
          available={writable}
          projectId={projectId}
          styleId={styleId}
          value={value}
          refresh={reconcileRead}
          refreshParents={refreshParents}
        />
      )}
      {value.status === "ARCHIVED" && (
        <p>
          This Pattern is archived. History remains readable; reactivate before
          creating a revision.
        </p>
      )}
      {w.writer && writable && value.status === "ACTIVE" && !editing && (
        <Button
          onClick={() => {
            setEditing(true);
            setNotice("");
          }}
        >
          Create new Pattern revision
        </Button>
      )}
      {editing && w.writer && (
        <Editor
          projectId={projectId}
          styleId={styleId}
          value={value}
          writable={writable && value.status === "ACTIVE"}
          refresh={reconcileRead}
          refreshParents={refreshParents}
          saved={() => {
            setEditing(false);
            setNotice("Pattern revision created.");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}
function Lifecycle({
  available,
  projectId,
  styleId,
  value,
  refresh,
  refreshParents,
}: {
  available: boolean;
  projectId: string;
  styleId: string;
  value: Pattern;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    [intent, setIntent] = useState<{
      status: "ACTIVE" | "ARCHIVED";
      version: number;
    } | null>(null),
    [failure, setFailure] = useState<unknown>(null),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState("");
  const command = useWorkspaceCommand(
    [
      ...queryKeys.pattern(
        w.scope,
        w.organizationId,
        projectId,
        styleId,
        value.id,
      ),
      "lifecycle",
    ],
    async (
      input: { status: "ACTIVE" | "ARCHIVED"; version: number },
      signal,
    ) => {
      const r = await api.PUT(detailPath, {
        signal,
        params: {
          path: {
            organizationId: w.organizationId,
            projectId,
            styleId,
            patternId: value.id,
          },
        },
        body: input,
      });
      const saved = checkedPattern(
        requireData(r.data, r.response),
        styleId,
        value.id,
      );
      if (saved.status !== input.status || saved.version !== input.version + 1)
        throw new ApiError(502);
      return saved;
    },
    async () => {
      setIntent(null);
      setFailure(null);
      setNotice("Pattern lifecycle updated.");
      await refresh();
    },
    async (e) => {
      setFailure(e);
      setBlocked(true);
      await refreshParents();
      if (w.current()) await refresh();
    },
  );
  return (
    <section aria-label="Pattern lifecycle">
      <Button
        disabled={!available || command.isPending}
        onClick={() => {
          setIntent({
            status: value.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
            version: value.version,
          });
          setFailure(null);
          setBlocked(false);
          setNotice("");
        }}
      >
        {value.status === "ACTIVE" ? "Archive Pattern" : "Reactivate Pattern"}
      </Button>
      {intent && (
        <section
          role="alertdialog"
          aria-label={`Confirm ${intent.status === "ARCHIVED" ? "archive" : "reactivation"} Pattern`}
        >
          <h3>
            Confirm {intent.status === "ARCHIVED" ? "archive" : "reactivation"}
          </h3>
          <p className="pattern-id">
            {value.latestRevision.name} · {value.id} · expected lifecycle
            version {intent.version}
          </p>
          <Button
            disabled={!available || command.isPending || blocked}
            onClick={() => command.mutate(intent)}
          >
            Confirm {intent.status === "ARCHIVED" ? "archive" : "reactivation"}
          </Button>
          <Button
            disabled={!available || command.isPending}
            onClick={() => setIntent(null)}
          >
            Cancel lifecycle change
          </Button>
          {blocked && (
            <div role="alert">
              <p>
                Outcome or version changed. Review current status {value.status}
                , version {value.version}; no automatic retry.
              </p>
              <Button
                onClick={() => {
                  setIntent(null);
                  setBlocked(false);
                  setFailure(null);
                }}
              >
                Review current lifecycle
              </Button>
            </div>
          )}
        </section>
      )}
      {failure != null && <ApiErrorState error={failure} />}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
function Editor({
  projectId,
  styleId,
  value,
  writable,
  refresh,
  refreshParents,
  saved,
}: {
  projectId: string;
  styleId: string;
  value?: Pattern;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents?: () => Promise<unknown>;
  saved: () => void;
}) {
  const w = useWorkspace(),
    prefix = useId(),
    form = useForm<Draft>({ defaultValues: draftOf(value?.latestRevision) }),
    [baseline, setBaseline] = useState(
      value?.latestRevision.revisionNumber ?? null,
    ),
    [picker, setPicker] = useState(false),
    [failure, setFailure] = useState<ApiError | null>(null),
    [blocked, setBlocked] = useState(false);
  const command = useWorkspaceCommand(
    [
      ...queryKeys.pattern(
        w.scope,
        w.organizationId,
        projectId,
        styleId,
        value?.id ?? "new",
      ),
      "save",
    ],
    async (d: Draft, signal) => {
      const params = {
        path: { organizationId: w.organizationId, projectId, styleId },
      };
      if (value) {
        if (baseline === null) throw new ApiError(400);
        const r = await api.POST(historyPath, {
          signal,
          params: { path: { ...params.path, patternId: value.id } },
          body: { ...bodyOf(d), expectedLatestRevisionNumber: baseline },
        });
        const v = checkedRevision(
          requireData(r.data, r.response),
          styleId,
          value.id,
        );
        if (v.revisionNumber !== baseline + 1) throw new ApiError(502);
        return;
      }
      const r = await api.POST(path, { signal, params, body: bodyOf(d) });
      const v = checkedPattern(requireData(r.data, r.response), styleId);
      if (
        v.latestRevision.revisionNumber !== 1 ||
        v.status !== "ACTIVE" ||
        v.version !== 0
      )
        throw new ApiError(502);
    },
    async () => {
      form.reset(draftOf());
      saved();
      await refresh();
    },
    async (e) => {
      const p = e instanceof ApiError ? e : new ApiError(502);
      setFailure(p);
      setBlocked(true);
      if (p.status === 409 && refreshParents) await refreshParents();
      if (w.current()) await refresh();
    },
  );
  return (
    <form
      aria-label={value ? "Pattern revision draft" : "Create Pattern draft"}
      onSubmit={form.handleSubmit((d) => {
        const p = draftSchema.safeParse(d);
        if (!p.success) {
          for (const issue of p.error.issues)
            form.setError(issue.path.join(".") as Path<Draft>, {
              type: "validate",
              message: issue.message,
            });
          return;
        }
        if (writable && !blocked && !command.isPending) command.mutate(d);
      })}
    >
      <h3>{value ? "New immutable Pattern revision" : "Create Pattern"}</h3>
      {value && (
        <p>
          Draft baseline revision: {baseline}. Current latest:{" "}
          {value.latestRevision.revisionNumber}.
        </p>
      )}
      <fieldset disabled={!writable || command.isPending}>
        <legend>Pattern metadata snapshot</legend>
        {(["name", "purpose"] as const).map((field) => (
          <div key={field}>
            <label htmlFor={`${prefix}-${field}`}>
              {field === "name" ? "Pattern name" : "Pattern purpose"}
            </label>
            <Input
              id={`${prefix}-${field}`}
              {...form.register(field)}
              aria-invalid={!!form.formState.errors[field]}
              aria-describedby={`${prefix}-${field}-error`}
            />
            <p id={`${prefix}-${field}-error`} role="alert">
              {form.formState.errors[field]?.message}
            </p>
          </div>
        ))}
        <p className="pattern-id">
          Selected Measurement revision:{" "}
          {form.watch("measurementRevisionId") || "No Measurement pin"}
        </p>
        <p>
          Optional exact same-Style association; no geometry or approval is
          implied.
        </p>
        <Button onClick={() => setPicker(true)}>
          Pin measurement revision
        </Button>
        <Button onClick={() => form.setValue("measurementRevisionId", "")}>
          No Measurement pin
        </Button>
        {picker && (
          <MeasurementPicker
            projectId={projectId}
            styleId={styleId}
            choose={(id) => {
              form.setValue("measurementRevisionId", id);
              setPicker(false);
            }}
            close={() => setPicker(false)}
          />
        )}
      </fieldset>
      {failure && <ApiErrorState error={failure} />}
      {blocked && (
        <section role="alert" aria-label="Pattern reconciliation">
          <p>
            Your draft is retained. Review authoritative state before another
            explicit submission.
          </p>
          {failure && (failure.status === 0 || failure.status >= 500) && (
            <p>
              Outcome unknown. A matching Pattern or revision is not proof that
              this request succeeded. No automatic resend.
            </p>
          )}
          <Button
            disabled={!writable || command.isPending}
            onClick={() => {
              setBaseline(value?.latestRevision.revisionNumber ?? null);
              setBlocked(false);
              setFailure(null);
            }}
          >
            Reconcile Pattern draft
          </Button>
          <p>Reconciliation does not submit.</p>
        </section>
      )}
      {writable && (
        <Button
          type="submit"
          disabled={!writable || command.isPending || blocked}
        >
          {value ? "Create Pattern revision" : "Save new Pattern"}
        </Button>
      )}
    </form>
  );
}
function MeasurementPicker({
  projectId,
  styleId,
  choose,
  close,
}: {
  projectId: string;
  styleId: string;
  choose: (id: string) => void;
  close: () => void;
}) {
  const q = useMeasurementSpec(projectId, styleId, true, true);
  return (
    <section aria-label="Measurement revision selector">
      <h4>Choose an exact Measurement revision</h4>
      <Button onClick={close}>Close measurement selector</Button>
      {q.isFetching && <Skeleton label="Loading Measurements for pin" />}
      {q.isError && <ApiErrorState error={q.error} />}
      {q.data === null && !q.isFetching && (
        <p>No Measurement Spec exists for this Style.</p>
      )}
      {q.data && !q.isError && !q.isFetching && (
        <MeasurementChoices
          projectId={projectId}
          spec={q.data}
          choose={choose}
        />
      )}
    </section>
  );
}
function MeasurementChoices({
  projectId,
  spec,
  choose,
}: {
  projectId: string;
  spec: Spec;
  choose: (id: string) => void;
}) {
  const [cursors, setCursors] = useState<number[]>([]),
    q = useMeasurementHistory(
      projectId,
      spec,
      cursors.at(-1) ?? spec.latestRevision.revisionNumber,
      true,
      true,
    );
  return (
    <>
      {q.isPending && <Skeleton label="Loading Measurement revision choices" />}
      {q.isError && <ApiErrorState error={q.error} />}
      {q.data && (
        <>
          <ul>
            {q.data.items.map((r) => (
              <li key={r.id}>
                <Button
                  disabled={q.isError || q.isFetching}
                  onClick={() => choose(r.id)}
                >
                  Use Measurement revision {r.revisionNumber}
                </Button>
                <span>
                  {" "}
                  {r.baseSize} · {r.unitSystem}
                </span>
              </li>
            ))}
          </ul>
          <Button
            disabled={!cursors.length || q.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Newer Measurement choices
          </Button>
          <Button
            disabled={
              q.data.nextMaxRevisionNumber === null || q.isFetching || q.isError
            }
            onClick={() => {
              if (q.data?.nextMaxRevisionNumber)
                setCursors([...cursors, q.data.nextMaxRevisionNumber]);
            }}
          >
            Older Measurement choices
          </Button>
        </>
      )}
    </>
  );
}
function History({
  projectId,
  value,
  available,
}: {
  projectId: string;
  value: Pattern;
  available: boolean;
}) {
  const [cursors, setCursors] = useState<number[]>([]),
    [selected, setSelected] = useState<Revision | null>(null),
    q = usePatternHistory(
      projectId,
      value.styleId,
      value.id,
      cursors.at(-1) ?? value.latestRevision.revisionNumber,
      available,
    );
  return (
    <section aria-label="Pattern revision history">
      <h3>Pattern revision history</h3>
      {q.isPending && <Skeleton label="Loading Pattern history" />}
      {q.isError && <ApiErrorState error={q.error} />}
      {q.data && (
        <>
          <ol>
            {q.data.items.map((r) => (
              <li key={r.id}>
                <p>
                  Revision {r.revisionNumber} · {r.name}
                </p>
                <Button
                  disabled={!available || q.isError}
                  onClick={() => setSelected(r)}
                >
                  Open Pattern revision {r.revisionNumber}
                </Button>
              </li>
            ))}
          </ol>
          <Button
            disabled={!cursors.length || q.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Newer Pattern revisions
          </Button>
          <Button
            disabled={
              q.data.nextMaxRevisionNumber === null || q.isFetching || q.isError
            }
            onClick={() => {
              if (q.data?.nextMaxRevisionNumber)
                setCursors([...cursors, q.data.nextMaxRevisionNumber]);
            }}
          >
            Older Pattern revisions
          </Button>
        </>
      )}
      {selected && (
        <Selected
          key={selected.id}
          projectId={projectId}
          value={value}
          selected={selected}
          available={available}
        />
      )}
    </section>
  );
}
function Selected({
  projectId,
  value,
  selected,
  available,
}: {
  projectId: string;
  value: Pattern;
  selected: Revision;
  available: boolean;
}) {
  const embedded = value.latestRevision.id === selected.id,
    q = usePatternRevision(
      projectId,
      value.styleId,
      value.id,
      selected.id,
      available && !embedded,
    );
  if (embedded)
    return (
      <RevisionFacts
        value={value.latestRevision}
        title={`Selected Pattern revision ${selected.revisionNumber}`}
      />
    );
  if (q.isPending)
    return <Skeleton label="Loading historical Pattern revision" />;
  if (q.isError) return <ApiErrorState error={q.error} />;
  if (q.data.revisionNumber !== selected.revisionNumber)
    return <ApiErrorState error={new ApiError(502)} />;
  return (
    <RevisionFacts
      value={q.data}
      title={`Selected Pattern revision ${q.data.revisionNumber}`}
    />
  );
}
