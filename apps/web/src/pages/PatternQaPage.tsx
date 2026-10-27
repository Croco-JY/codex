import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, requireData } from "../api/client";
import { queryKeys } from "../api/queryKeys";
import { useWorkspace, useWorkspaceCommand } from "../app/workspace";
import { useProject, useStyle } from "../features/workspace/data";
import {
  stylePath,
  type Project,
  type Style,
} from "../features/workspace/model";
import { usePattern, usePatternRevision } from "../features/pattern/data";
import type { Pattern, Revision } from "../features/pattern/model";
import {
  useQa,
  useQaScope,
  useQaHistory,
  useAssessment,
  useQaArtifact,
  historyPath,
} from "../features/patternqa/data";
import {
  bodyOf,
  checkedCreated,
  outcomes,
  type Qa,
  type Assessment,
  type Summary,
  type Draft,
  type Input as QaInput,
} from "../features/patternqa/model";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Button, Surface, Stack, Skeleton } from "../ui";

const qualification =
  "Human review recorded. This is not automated validation, sample approval, production verification, or authorization to manufacture.";
export default function PatternQaPage() {
  const {
    projectId = "",
    styleId = "",
    patternId = "",
    revisionId = "",
  } = useParams();
  const p = useProject(projectId);
  if (p.isPending) return <Skeleton label="Loading parent Project" />;
  if (!p.data)
    return <ApiErrorState error={p.error} retry={() => void p.refetch()} />;
  return (
    <>
      {p.isError && (
        <ApiErrorState error={p.error} retry={() => void p.refetch()} />
      )}
      <StyleGate
        key={`${projectId}:${styleId}:${patternId}:${revisionId}`}
        project={p.data}
        styleId={styleId}
        patternId={patternId}
        revisionId={revisionId}
      />
    </>
  );
}
function StyleGate({
  project,
  styleId,
  patternId,
  revisionId,
}: {
  project: Project;
  styleId: string;
  patternId: string;
  revisionId: string;
}) {
  const s = useStyle(project.id, styleId);
  if (s.isPending) return <Skeleton label="Loading Style" />;
  if (!s.data)
    return <ApiErrorState error={s.error} retry={() => void s.refetch()} />;
  return (
    <>
      {s.isError && (
        <ApiErrorState error={s.error} retry={() => void s.refetch()} />
      )}
      <PatternGate
        project={project}
        style={s.data}
        patternId={patternId}
        revisionId={revisionId}
      />
    </>
  );
}
function PatternGate({
  project,
  style,
  patternId,
  revisionId,
}: {
  project: Project;
  style: Style;
  patternId: string;
  revisionId: string;
}) {
  const p = usePattern(project.id, style.id, patternId);
  if (p.isPending) return <Skeleton label="Loading parent Pattern" />;
  if (!p.data)
    return <ApiErrorState error={p.error} retry={() => void p.refetch()} />;
  return (
    <>
      {p.isError && (
        <ApiErrorState error={p.error} retry={() => void p.refetch()} />
      )}
      <RevisionGate
        project={project}
        style={style}
        pattern={p.data}
        revisionId={revisionId}
      />
    </>
  );
}
function RevisionGate({
  project,
  style,
  pattern,
  revisionId,
}: {
  project: Project;
  style: Style;
  pattern: Pattern;
  revisionId: string;
}) {
  const r = usePatternRevision(
    project.id,
    style.id,
    pattern.id,
    revisionId,
    true,
  );
  if (r.isPending) return <Skeleton label="Loading exact Pattern revision" />;
  if (!r.data)
    return <ApiErrorState error={r.error} retry={() => void r.refetch()} />;
  return (
    <>
      {r.isError && (
        <ApiErrorState error={r.error} retry={() => void r.refetch()} />
      )}
      <QaPanel
        key={r.data.id}
        project={project}
        style={style}
        pattern={pattern}
        revision={r.data}
      />
    </>
  );
}
function AssessmentFacts({
  value,
  title,
}: {
  value: Assessment;
  title: string;
}) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <dl className="read-facts">
        <div>
          <dt>Outcome</dt>
          <dd>{value.outcome}</dd>
        </div>
        <div>
          <dt>Review basis</dt>
          <dd>{value.evidenceBasis}</dd>
        </div>
        <div>
          <dt>Artifact reference</dt>
          <dd style={{ overflowWrap: "anywhere" }}>
            {value.artifactId ?? "No artifact attestation"}
          </dd>
        </div>
        <div>
          <dt>Reviewed at</dt>
          <dd>{value.reviewedAt}</dd>
        </div>
        <div>
          <dt>Assessment ID</dt>
          <dd style={{ overflowWrap: "anywhere" }}>{value.id}</dd>
        </div>
      </dl>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {value.notes}
      </p>
      {value.outcome === "HUMAN_REVIEWED" && <p>{qualification}</p>}
    </section>
  );
}
function QaPanel({
  project,
  style,
  pattern,
  revision,
}: {
  project: Project;
  style: Style;
  pattern: Pattern;
  revision: Revision;
}) {
  const w = useWorkspace(),
    q = useQa(project.id, revision),
    scope = useQaScope(project.id, revision),
    cache = useQueryClient();
  const [expanded, setExpanded] = useState(false),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  const head = q.data?.latestAssessment?.assessmentNumber ?? 0;
  const parentKeys = [
    queryKeys.project(w.scope, w.organizationId, project.id),
    queryKeys.style(w.scope, w.organizationId, project.id, style.id),
    queryKeys.pattern(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
      pattern.id,
    ),
  ];
  const parentsAvailable = [
    ...parentKeys,
    queryKeys.patternRevision(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
      pattern.id,
      revision.id,
    ),
  ].every((key) => cache.getQueryState(key)?.status !== "error");
  const active =
    project.status === "ACTIVE" &&
    style.status === "ACTIVE" &&
    pattern.status === "ACTIVE";
  async function refresh(parents = false) {
    if (parents)
      for (const key of parentKeys) {
        if (!w.current()) return;
        await cache.refetchQueries({
          queryKey: key,
          exact: true,
          type: "active",
        });
        if (!w.current() || cache.getQueryState(key)?.status === "error")
          return;
      }
    const r = await q.refetch();
    if (
      w.current() &&
      r.data &&
      (r.data.latestAssessment?.assessmentNumber ?? 0) === head
    )
      await cache.invalidateQueries({
        queryKey: [...scope.key, "assessments"],
      });
  }
  return (
    <Stack>
      <Link
        to={`${stylePath(w.organizationId, project.id, style.id)}/patterns/${pattern.id}`}
      >
        Back to Pattern
      </Link>
      <Surface>
        <h1>Human Pattern QA</h1>
        <h2>
          {revision.name} · Pattern revision {revision.revisionNumber}
        </h2>
        <p>
          {pattern.latestRevision.id === revision.id
            ? "Latest Pattern revision"
            : "Historical Pattern revision"}{" "}
          · Assessment applies only to this exact revision.
        </p>
        <p style={{ overflowWrap: "anywhere" }}>Revision ID: {revision.id}</p>
        <p>
          QA is human attestation. It grants no release, manufacturing, sample
          or production approval.
        </p>
        {!w.writer && (
          <p>Your VIEWER membership provides read-only QA access.</p>
        )}
        {!active && (
          <p>
            QA is read-only while the Project, Style or Pattern is archived.
          </p>
        )}
        {q.isPending && <Skeleton label="Loading Pattern QA" />}
        {q.isError && (
          <ApiErrorState error={q.error} retry={() => void q.refetch()} />
        )}
        {q.data && (
          <>
            <p>
              QA state: <strong>{q.data.state}</strong>
            </p>
            {q.data.latestAssessment ? (
              <AssessmentFacts
                value={q.data.latestAssessment}
                title={`Latest QA assessment ${head}`}
              />
            ) : (
              <p>This exact revision has no assessments.</p>
            )}
            <Button
              disabled={q.isError || !parentsAvailable}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Close QA history" : "Expand QA history"}
            </Button>
            {expanded && (
              <History
                key={q.data.latestAssessment?.id ?? "unreviewed"}
                projectId={project.id}
                revision={revision}
                head={head}
              />
            )}
            {w.writer && active && !editing && (
              <Button
                disabled={q.isError || !parentsAvailable}
                onClick={() => {
                  setEditing(true);
                  setNotice("");
                }}
              >
                Record QA assessment
              </Button>
            )}
            {editing && (
              <Editor
                projectId={project.id}
                revision={revision}
                current={q.data}
                writable={w.writer && active && !q.isError && parentsAvailable}
                refresh={refresh}
                saved={() => {
                  setEditing(false);
                  setNotice("QA assessment recorded.");
                }}
              />
            )}
          </>
        )}
        {notice && <p role="status">{notice}</p>}
      </Surface>
    </Stack>
  );
}
function History({
  projectId,
  revision,
  head,
}: {
  projectId: string;
  revision: Revision;
  head: number;
}) {
  const [bounds, setBounds] = useState([head]),
    [selected, setSelected] = useState<Summary | null>(null);
  const q = useQaHistory(projectId, revision, bounds.at(-1)!);
  return (
    <section aria-label="QA assessment history">
      <h3>QA assessment history</h3>
      {q.isPending && <Skeleton label="Loading QA history" />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          {!q.data.items.length && (
            <p>No assessments in this history snapshot.</p>
          )}
          <ol>
            {q.data.items.map((a) => (
              <li key={a.id}>
                Assessment {a.assessmentNumber} · {a.outcome} · {a.reviewedAt}{" "}
                <Button onClick={() => setSelected(a)}>
                  Open QA assessment {a.assessmentNumber}
                </Button>
              </li>
            ))}
          </ol>
          <Button
            disabled={bounds.length === 1 || q.isFetching}
            onClick={() => {
              setBounds(bounds.slice(0, -1));
              setSelected(null);
            }}
          >
            Newer QA assessments
          </Button>
          <Button
            disabled={!q.data.nextMaxAssessmentNumber || q.isFetching}
            onClick={() => {
              if (q.data?.nextMaxAssessmentNumber)
                setBounds([...bounds, q.data.nextMaxAssessmentNumber]);
              setSelected(null);
            }}
          >
            Older QA assessments
          </Button>
        </>
      )}
      {selected && (
        <>
          <Historical
            projectId={projectId}
            revision={revision}
            expected={selected}
          />
          <Button onClick={() => setSelected(null)}>
            Close historical QA assessment
          </Button>
        </>
      )}
    </section>
  );
}
function Historical({
  projectId,
  revision,
  expected,
}: {
  projectId: string;
  revision: Revision;
  expected: Summary;
}) {
  const q = useAssessment(projectId, revision, expected);
  if (q.isPending) return <Skeleton label="Loading historical QA assessment" />;
  if (q.isError || !q.data)
    return <ApiErrorState error={q.error} retry={() => void q.refetch()} />;
  return (
    <AssessmentFacts
      value={q.data}
      title={`Historical QA assessment ${q.data.assessmentNumber}`}
    />
  );
}
function Editor({
  projectId,
  revision,
  current,
  writable,
  refresh,
  saved,
}: {
  projectId: string;
  revision: Revision;
  current: Qa;
  writable: boolean;
  refresh: (parents?: boolean) => Promise<void>;
  saved: () => void;
}) {
  const { w, params, key } = useQaScope(projectId, revision),
    artifact = useQaArtifact(projectId, revision);
  const [baseline, setBaseline] = useState(
      current.latestAssessment?.assessmentNumber ?? 0,
    ),
    [failure, setFailure] = useState<unknown>(null),
    [blocked, setBlocked] = useState(false),
    [confirmation, setConfirmation] = useState<QaInput | null>(null),
    [validation, setValidation] = useState("");
  const form = useForm<Draft>({
    defaultValues: {
      outcome: "OBSERVED",
      evidenceBasis: "METADATA_ONLY",
      notes: "",
    },
  });
  const command = useWorkspaceCommand(
    [...key, "record-assessment"],
    async (body: QaInput, signal) => {
      const r = await api.POST(historyPath, {
        signal,
        params: { path: params },
        body,
      });
      return checkedCreated(requireData(r.data, r.response), revision, body);
    },
    async () => {
      await refresh();
      if (w.current()) saved();
    },
    async (e) => {
      setFailure(e);
      setBlocked(true);
      setConfirmation(null);
      await refresh(true);
    },
  );
  const allowed =
    writable &&
    !blocked &&
    !command.isPending &&
    !artifact.isError &&
    !artifact.isPending;
  function submit(draft: Draft) {
    if (!allowed) return;
    try {
      const body = bodyOf(draft, baseline, artifact.data ?? null);
      setValidation("");
      setFailure(null);
      if (body.outcome === "HUMAN_REVIEWED") setConfirmation(body);
      else command.mutate(body);
    } catch {
      setValidation(
        "Check the outcome, review basis and 1–2,000 character notes. Human review requires this revision's READY artifact.",
      );
    }
  }
  return (
    <form aria-label="QA assessment draft" onSubmit={form.handleSubmit(submit)}>
      <h3>Record a human assessment</h3>
      <p>
        Draft baseline assessment {baseline}; current latest{" "}
        {current.latestAssessment?.assessmentNumber ?? 0}.
      </p>
      <label htmlFor="qa-outcome">QA outcome</label>
      <select
        id="qa-outcome"
        {...form.register("outcome")}
        aria-describedby="qa-validation"
        disabled={!writable || command.isPending || !!confirmation}
      >
        {outcomes.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <label htmlFor="qa-basis">Review basis</label>
      <select
        id="qa-basis"
        {...form.register("evidenceBasis")}
        aria-describedby="qa-validation"
        disabled={!writable || command.isPending || !!confirmation}
      >
        <option>METADATA_ONLY</option>
        <option disabled={artifact.data?.state !== "READY"}>
          READY_ARTIFACT
        </option>
      </select>
      {artifact.isPending && (
        <Skeleton label="Checking exact artifact metadata" />
      )}
      {artifact.isError && (
        <ApiErrorState
          error={artifact.error}
          retry={() => void artifact.refetch()}
        />
      )}
      {!artifact.isPending &&
        !artifact.isError &&
        (artifact.data?.state === "READY" ? (
          <p style={{ overflowWrap: "anywhere" }}>
            Exact READY artifact: {artifact.data.id}
          </p>
        ) : (
          <p>
            READY_ARTIFACT is unavailable:{" "}
            {artifact.data?.state ?? "this revision has no artifact"}.
          </p>
        ))}
      <label htmlFor="qa-notes">Human review notes</label>
      <textarea
        id="qa-notes"
        {...form.register("notes")}
        rows={5}
        style={{ width: "100%", boxSizing: "border-box" }}
        aria-describedby="qa-validation"
        aria-invalid={!!validation}
        disabled={!writable || command.isPending || !!confirmation}
      />
      <p id="qa-validation" role={validation ? "alert" : undefined}>
        {validation ||
          "Required: 1–2,000 Unicode characters. Notes are not interpreted as HTML."}
      </p>
      {failure != null && (
        <>
          <ApiErrorState error={failure} />
          <p role="alert">
            Draft retained. Review authoritative QA before another submission.
            Similar server notes or outcomes do not prove this request
            succeeded.
          </p>
        </>
      )}
      {blocked && (
        <Button
          disabled={!writable}
          onClick={() => {
            setBaseline(current.latestAssessment?.assessmentNumber ?? 0);
            setBlocked(false);
            setFailure(null);
          }}
        >
          Reconcile QA baseline without changing draft
        </Button>
      )}
      <Button type="submit" disabled={!allowed || !!confirmation}>
        Submit QA assessment
      </Button>
      {confirmation && (
        <section
          role="alertdialog"
          aria-label="Confirm human review attestation"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmation(null);
          }}
        >
          <p>{qualification}</p>
          <p>
            I attest that I inspected the exact READY artifact{" "}
            {confirmation.artifactId}.
          </p>
          <Button
            autoFocus
            disabled={!allowed}
            onClick={() => {
              const body = confirmation;
              setConfirmation(null);
              command.mutate(body);
            }}
          >
            Confirm human review attestation
          </Button>
          <Button onClick={() => setConfirmation(null)}>
            Cancel attestation
          </Button>
        </section>
      )}
    </form>
  );
}
