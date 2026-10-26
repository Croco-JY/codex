import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace, useWorkspaceCommand } from "../../app/workspace";
import { Button, Surface, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { stylePath, type Project, type Style } from "../workspace/model";
import {
  path,
  detailPath,
  historyPath,
  useGradings,
  useGrading,
  useGradingHistory,
  useGradingRevision,
} from "./data";
import {
  checkedGrading,
  checkedRevision,
  checkedLifecycle,
  bodyOf,
  draftOf,
  type Draft,
  type Grading,
  type Filter,
  type Summary,
} from "./model";
import { Matrix, MatrixEditor } from "./Matrix";
import "./grading.css";

type Context = {
  project: Project;
  style: Style;
  available: boolean;
  refreshParents: () => Promise<unknown>;
};
function ReadOnly({ writer, active }: { writer: boolean; active: boolean }) {
  return (
    <>
      {!writer && (
        <p>Your VIEWER membership provides read-only grading access.</p>
      )}
      {!active && (
        <p>Grading is read-only while the Project or Style is archived.</p>
      )}
    </>
  );
}
export function GradingList({
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
  const q = useGradings(
    project.id,
    style.id,
    filter,
    cursors.at(-1) ?? null,
    available,
  );
  const active = project.status === "ACTIVE" && style.status === "ACTIVE",
    writable = w.writer && active && available && !q.isError;
  async function refresh() {
    setCursors([]);
    await cache.invalidateQueries({
      queryKey: queryKeys
        .gradings(
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
    <Surface aria-label="Grading collection">
      <h2>Grade rule sets</h2>
      <ReadOnly writer={w.writer} active={active} />
      <label htmlFor="grading-filter">Grading status</label>
      <select
        id="grading-filter"
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
      {q.isPending && <Skeleton label="Loading grading" />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          <ul className="grading-list">
            {q.data.items.map((g) => (
              <li key={g.id}>
                <Link
                  to={`${stylePath(w.organizationId, project.id, style.id)}/grading/${g.id}`}
                >
                  {g.latestRevision.name}
                </Link>
                <p>
                  {g.status} · Revision {g.latestRevision.revisionNumber} ·{" "}
                  {g.latestRevision.sizeCount} sizes ×{" "}
                  {g.latestRevision.ruleCount} rules ·{" "}
                  {g.latestRevision.unitSystem}
                </p>
                <p className="grading-id">GradeRuleSet ID: {g.id}</p>
              </li>
            ))}
          </ul>
          {q.data.items.length === 0 && <p>No grade rule sets in this page.</p>}
          <Button
            disabled={!cursors.length || q.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Newer grade rule sets
          </Button>
          <Button
            disabled={!q.data.nextCursor || q.isFetching}
            onClick={() => {
              if (q.data?.nextCursor)
                setCursors([...cursors, q.data.nextCursor]);
            }}
          >
            Older grade rule sets
          </Button>
        </>
      )}
      {writable && !editing && (
        <Button
          onClick={() => {
            setEditing(true);
            setNotice("");
          }}
        >
          Create grade rule set
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
            setNotice("Grade rule set and revision 1 created.");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}
export function GradingDetail({
  project,
  style,
  id,
  available,
  refreshParents,
}: Context & { id: string }) {
  const q = useGrading(project.id, style.id, id, available);
  if (q.isPending) return <Skeleton label="Loading grade rule set" />;
  if (!q.data)
    return (
      <ApiErrorState error={q.error} page retry={() => void q.refetch()} />
    );
  const active = project.status === "ACTIVE" && style.status === "ACTIVE";
  return (
    <Detail
      projectId={project.id}
      value={q.data}
      active={active}
      available={available && !q.isError && !q.isFetching}
      error={q.isError ? q.error : null}
      refresh={() => q.refetch()}
      refreshParents={refreshParents}
    />
  );
}
function Detail({
  projectId,
  value,
  active,
  available,
  error,
  refresh,
  refreshParents,
}: {
  projectId: string;
  value: Grading;
  active: boolean;
  available: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient();
  const [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  async function reconcileRead() {
    const result = (await refresh()) as { data?: Grading };
    if (!w.current()) return;
    if (result.data?.latestRevision.id === value.latestRevision.id)
      await cache.invalidateQueries({
        queryKey: [
          ...queryKeys.grading(
            w.scope,
            w.organizationId,
            projectId,
            value.styleId,
            value.id,
          ),
          "revisions",
        ],
      });
  }
  const writable = w.writer && active && available;
  return (
    <Surface aria-label="Grading detail">
      <h2>{value.latestRevision.name}</h2>
      {error != null && <ApiErrorState error={error} />}
      <ReadOnly writer={w.writer} active={active} />
      <p>
        Grade rule set status: {value.status} · Lifecycle version:{" "}
        {value.version}
      </p>
      <p className="grading-id">GradeRuleSet ID: {value.id}</p>
      <Matrix
        value={value.latestRevision}
        title={`Latest grading revision ${value.latestRevision.revisionNumber}`}
      />
      <History
        key={value.latestRevision.id}
        projectId={projectId}
        value={value}
        available={available}
      />
      {w.writer && active && (
        <Lifecycle
          projectId={projectId}
          value={value}
          available={available}
          refresh={reconcileRead}
          refreshParents={refreshParents}
        />
      )}
      {value.status === "ARCHIVED" && (
        <p>
          This grade rule set is archived. History remains readable; reactivate
          before creating a revision.
        </p>
      )}
      {writable && value.status === "ACTIVE" && !editing && (
        <Button
          onClick={() => {
            setEditing(true);
            setNotice("");
          }}
        >
          Create new grading revision
        </Button>
      )}
      {editing && w.writer && (
        <Editor
          projectId={projectId}
          styleId={value.styleId}
          value={value}
          writable={writable && value.status === "ACTIVE"}
          refresh={reconcileRead}
          refreshParents={refreshParents}
          saved={() => {
            setEditing(false);
            setNotice("Grading revision created.");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}
function History({
  projectId,
  value,
  available,
}: {
  projectId: string;
  value: Grading;
  available: boolean;
}) {
  const [bounds, setBounds] = useState([value.latestRevision.revisionNumber]),
    [selected, setSelected] = useState<Summary | null>(null);
  const max = bounds.at(-1)!,
    q = useGradingHistory(projectId, value.styleId, value.id, max, available);
  return (
    <section aria-label="Grading revision history">
      <h3>Grading revision history</h3>
      {q.isPending && <Skeleton label="Loading grading history" />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          <ol>
            {q.data.items.map((r) => (
              <li key={r.id}>
                Revision {r.revisionNumber} · {r.name} · {r.sizeCount} sizes ×{" "}
                {r.ruleCount} rules
                {r.id !== value.latestRevision.id && (
                  <Button disabled={!available} onClick={() => setSelected(r)}>
                    Open grading revision {r.revisionNumber}
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <Button
            disabled={!available || bounds.length === 1 || q.isFetching}
            onClick={() => {
              setBounds(bounds.slice(0, -1));
              setSelected(null);
            }}
          >
            Newer grading revisions
          </Button>
          <Button
            disabled={
              !available || !q.data.nextMaxRevisionNumber || q.isFetching
            }
            onClick={() => {
              if (q.data?.nextMaxRevisionNumber)
                setBounds([...bounds, q.data.nextMaxRevisionNumber]);
              setSelected(null);
            }}
          >
            Older grading revisions
          </Button>
        </>
      )}
      {selected && (
        <>
          <Historical
            projectId={projectId}
            value={value}
            expected={selected}
            available={available}
          />
          <Button onClick={() => setSelected(null)}>
            Close historical grading revision
          </Button>
        </>
      )}
    </section>
  );
}
function Historical({
  projectId,
  value,
  expected,
  available,
}: {
  projectId: string;
  value: Grading;
  expected: Summary;
  available: boolean;
}) {
  const q = useGradingRevision(
    projectId,
    value.styleId,
    value.id,
    expected,
    available,
  );
  if (q.isPending)
    return <Skeleton label="Loading historical grading revision" />;
  if (q.isError || !q.data)
    return <ApiErrorState error={q.error} retry={() => void q.refetch()} />;
  return (
    <Matrix
      value={q.data}
      title={`Historical grading revision ${q.data.revisionNumber}`}
    />
  );
}
function Lifecycle({
  projectId,
  value,
  available,
  refresh,
  refreshParents,
}: {
  projectId: string;
  value: Grading;
  available: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace();
  const [intent, setIntent] = useState<{
      status: "ACTIVE" | "ARCHIVED";
      version: number;
    } | null>(null),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const command = useWorkspaceCommand(
    [
      ...queryKeys.grading(
        w.scope,
        w.organizationId,
        projectId,
        value.styleId,
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
            styleId: value.styleId,
            gradeRuleSetId: value.id,
          },
        },
        body: input,
      });
      const saved = checkedLifecycle(
        requireData(r.data, r.response),
        value.styleId,
        value.id,
      );
      if (
        saved.status !== input.status ||
        saved.version !==
          (value.status === input.status ? input.version : input.version + 1)
      )
        throw new ApiError(502);
      return saved;
    },
    async () => {
      setIntent(null);
      setFailure(null);
      setNotice("Grading lifecycle confirmed.");
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
    <section aria-label="Grading lifecycle">
      <Button
        disabled={!available || command.isPending}
        onClick={() => {
          setIntent({
            status: value.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
            version: value.version,
          });
          setBlocked(false);
          setFailure(null);
          setNotice("");
        }}
      >
        {value.status === "ACTIVE"
          ? "Archive grade rule set"
          : "Reactivate grade rule set"}
      </Button>
      {intent && (
        <section
          role="alertdialog"
          aria-label="Confirm grading lifecycle change"
        >
          <h3>
            Confirm {intent.status === "ARCHIVED" ? "archive" : "reactivation"}
          </h3>
          <p className="grading-id">
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
            disabled={command.isPending}
            onClick={() => {
              setIntent(null);
              setBlocked(false);
            }}
          >
            Cancel lifecycle change
          </Button>
          {blocked && (
            <p role="alert">
              Outcome or lifecycle version changed. Review current status{" "}
              {value.status}, version {value.version}. No automatic retry.
            </p>
          )}
        </section>
      )}
      {failure != null && <ApiErrorState error={failure} />}{" "}
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
  value?: Grading;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  saved: () => void;
}) {
  const w = useWorkspace();
  const [draft, setDraft] = useState(() => draftOf(value?.latestRevision)),
    [baseline, setBaseline] = useState(
      value?.latestRevision.revisionNumber ?? null,
    ),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [validation, setValidation] = useState("");
  const command = useWorkspaceCommand(
    [
      ...queryKeys.grading(
        w.scope,
        w.organizationId,
        projectId,
        styleId,
        value?.id ?? "new",
      ),
      "save",
    ],
    async (d: Draft, signal) => {
      const body = bodyOf(d),
        params = {
          path: { organizationId: w.organizationId, projectId, styleId },
        };
      if (value) {
        if (baseline === null) throw new ApiError(400);
        const r = await api.POST(historyPath, {
          signal,
          params: { path: { ...params.path, gradeRuleSetId: value.id } },
          body: { ...body, expectedLatestRevisionNumber: baseline },
        });
        const confirmed = checkedRevision(
          requireData(r.data, r.response),
          styleId,
          value.id,
        );
        if (confirmed.revisionNumber !== baseline + 1) throw new ApiError(502);
        return;
      }
      const r = await api.POST(path, { signal, params, body });
      const confirmed = checkedGrading(
        requireData(r.data, r.response),
        styleId,
      );
      if (
        confirmed.status !== "ACTIVE" ||
        confirmed.version !== 0 ||
        confirmed.latestRevision.revisionNumber !== 1
      )
        throw new ApiError(502);
    },
    async () => {
      saved();
      await refresh();
    },
    async (e) => {
      setFailure(e);
      setBlocked(true);
      if (e instanceof ApiError && e.status === 409) await refreshParents();
      if (w.current()) await refresh();
    },
  );
  return (
    <form
      aria-label="Grading snapshot editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!writable || blocked || command.isPending) return;
        try {
          bodyOf(draft);
          setValidation("");
          command.mutate(draft);
        } catch {
          setValidation(
            "Enter valid unique codes, labels, unit and base size, and a complete ordered decimal matrix. Every base-size delta must be zero.",
          );
        }
      }}
    >
      <h3>{value ? "New grading revision" : "New grade rule set"}</h3>
      {value && (
        <p>
          Draft baseline revision {baseline}; current latest revision{" "}
          {value.latestRevision.revisionNumber}.
        </p>
      )}
      <MatrixEditor
        draft={draft}
        change={setDraft}
        disabled={!writable || command.isPending}
      />
      {validation && (
        <p role="alert" id="grading-validation">
          {validation}
        </p>
      )}
      {failure != null && <ApiErrorState error={failure} />}
      {blocked && (
        <section role="alert">
          <p>
            The draft is retained. The outcome may be ambiguous; matching
            content does not prove success. No automatic resend.
          </p>
          <Button
            type="button"
            disabled={!writable || command.isPending}
            onClick={() => {
              if (value) setBaseline(value.latestRevision.revisionNumber);
              setBlocked(false);
              setFailure(null);
            }}
          >
            {value
              ? "Reconcile baseline without changing draft"
              : "Review current state before another create attempt"}
          </Button>
        </section>
      )}
      <Button
        type="submit"
        disabled={!writable || blocked || command.isPending}
      >
        {value ? "Save grading revision" : "Save new grade rule set"}
      </Button>
    </form>
  );
}
