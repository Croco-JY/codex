import { useLayoutEffect, useRef, useState } from "react";
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

// Shared by dismissal, live focus repair and keyboard boundaries. Focus is a
// presentation concern; this predicate never grants permission to submit QA.
function qaFocusVisible(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (element.checkVisibility) return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const view = element.ownerDocument.defaultView;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.opacity === "0") return false;
  }
  return true;
}
function qaFocusActions(region: HTMLElement) {
  return [...region.querySelectorAll<HTMLButtonElement>("button")].filter(
    button => !button.matches(":disabled") && button.getAttribute("aria-disabled") !== "true" && qaFocusVisible(button),
  );
}

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
                key={JSON.stringify([w.generation, ...scope.key])}
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
  const submitControl = useRef<HTMLButtonElement>(null),
    editorHeading = useRef<HTMLHeadingElement>(null),
    confirmationRegion = useRef<HTMLElement>(null),
    cancelControl = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<{ scope: string; current: () => boolean } | null>(null);
  const editorScope = JSON.stringify([w.generation, ...key]);
  useLayoutEffect(() => () => { returnFocus.current = null; }, []);
  useLayoutEffect(() => {
    if (!confirmation) {
      const intent = returnFocus.current;
      returnFocus.current = null;
      if (!intent || intent.scope !== editorScope || !intent.current() || !w.current()) return;
      const trigger = submitControl.current;
      if (trigger && !trigger.disabled && qaFocusVisible(trigger)) trigger.focus();
      else if (qaFocusVisible(editorHeading.current)) editorHeading.current.focus();
      return;
    }
    const region = confirmationRegion.current;
    if (!region) return;
    const doc = region.ownerDocument, view = doc.defaultView;
    let retired = false, repairing = false;
    const repair = () => {
      // Revalidate on every DOM/event callback, including queued observer delivery.
      if (retired || repairing || !w.current() || !qaFocusVisible(region)) return;
      const actions = qaFocusActions(region), active = doc.activeElement;
      if (actions.some(button => button === active) || (!actions.length && active === region)) return;
      const cancel = cancelControl.current;
      const target = actions.find(button => button === cancel) ?? actions[0] ?? region;
      repairing = true;
      try { target.focus(); } finally { repairing = false; }
    };
    const observer = new MutationObserver(repair);
    const attributes = ["disabled", "hidden", "inert", "aria-hidden", "aria-disabled", "style", "class"];
    observer.observe(region, { subtree: true, childList: true, attributes: true, attributeFilter: attributes });
    // Ancestor eligibility can change without a React render. Observe attributes
    // only there, not every mutation in the surrounding application.
    for (let node = region.parentElement; node; node = node.parentElement)
      observer.observe(node, { attributes: true, attributeFilter: attributes });
    const outsideKey = (event: KeyboardEvent) => {
      if (!retired && !region.contains(event.target as Node | null)) handleConfirmationKey(event);
    };
    const focus = (event: FocusEvent) => {
      if (event.target === doc.body || event.target === doc.documentElement || region.contains(event.target as Node | null)) repair();
    };
    // BODY-origin keyboard events never reach the section's React handler.
    doc.addEventListener("keydown", outsideKey, true);
    doc.addEventListener("focusin", focus, true);
    doc.addEventListener("keyup", protectConfirmationActivation, true);
    region.addEventListener("transitionend", repair);
    region.addEventListener("animationend", repair);
    view?.addEventListener("resize", repair);
    repair();
    return () => {
      retired = true;
      observer.disconnect();
      doc.removeEventListener("keydown", outsideKey, true);
      doc.removeEventListener("focusin", focus, true);
      doc.removeEventListener("keyup", protectConfirmationActivation, true);
      region.removeEventListener("transitionend", repair);
      region.removeEventListener("animationend", repair);
      view?.removeEventListener("resize", repair);
    };
  }, [confirmation, allowed, editorScope, w.current]);
  function handleConfirmationKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault" | "stopPropagation">) {
    const region = confirmationRegion.current;
    if (!confirmation || !w.current() || !qaFocusVisible(region)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissConfirmation();
    } else if (event.key === "Tab") {
      const actions = qaFocusActions(region), active = region.ownerDocument.activeElement;
      const index = actions.findIndex(button => button === active);
      if (index < 0 || (!event.shiftKey && index === actions.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? actions.at(-1) ?? region : actions[0] ?? region).focus();
      }
    } else protectConfirmationActivation(event);
  }
  function protectConfirmationActivation(event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const region = confirmationRegion.current;
    if (!confirmation || !w.current() || !qaFocusVisible(region)) return;
    const doc = region.ownerDocument, active = doc.activeElement, actions = qaFocusActions(region);
    if (actions.some(button => button === active) || (active !== doc.body && active !== doc.documentElement && !region.contains(active))) return;
    // A CSSOM-only change can leave an invisible action focused. Consume its
    // activation key (including Space release) before the browser clicks it.
    event.preventDefault();
    event.stopPropagation();
    const target = actions.find(button => button === cancelControl.current) ?? actions[0] ?? region;
    if (target !== active) target.focus();
  }
  function dismissConfirmation() {
    returnFocus.current = { scope: editorScope, current: w.current };
    setConfirmation(null);
  }
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
      <h3 ref={editorHeading} tabIndex={-1}>Record a human assessment</h3>
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
      <Button ref={submitControl} type="submit" disabled={!allowed || !!confirmation}>
        Submit QA assessment
      </Button>
      {confirmation && (
        <section
          ref={confirmationRegion}
          role="alertdialog"
          aria-label="Confirm human review attestation"
          tabIndex={-1}
          onKeyDown={handleConfirmationKey}
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
              returnFocus.current = null;
              setConfirmation(null);
              command.mutate(body);
            }}
          >
            Confirm human review attestation
          </Button>
          <Button ref={cancelControl} type="button" onClick={dismissConfirmation}>
            Cancel attestation
          </Button>
        </section>
      )}
    </form>
  );
}
