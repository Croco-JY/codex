import { Link, useParams } from "react-router";
import { useProject, useStyle } from "../workspace/data";
import type { Project, Style } from "../workspace/model";
import { stylePath } from "../workspace/model";
import { useWorkspace } from "../../app/workspace";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Stack, Skeleton } from "../../ui";
import { GradingList, GradingDetail } from "./Gradings";
export function GradingRoute({ detail = false }: { detail?: boolean }) {
  const { projectId = "", styleId = "", gradeRuleSetId = "" } = useParams(),
    p = useProject(projectId);
  if (p.isPending) return <Skeleton label="Loading parent Project" />;
  if (!p.data)
    return (
      <ApiErrorState error={p.error} page retry={() => void p.refetch()} />
    );
  return (
    <StyleGate
      key={`${projectId}:${styleId}:${gradeRuleSetId}`}
      project={p.data}
      id={styleId}
      gradeRuleSetId={gradeRuleSetId}
      detail={detail}
      parentAvailable={!p.isError}
      refreshProject={() => p.refetch()}
    />
  );
}
function StyleGate({
  project,
  id,
  gradeRuleSetId,
  detail,
  parentAvailable,
  refreshProject,
}: {
  project: Project;
  id: string;
  gradeRuleSetId: string;
  detail: boolean;
  parentAvailable: boolean;
  refreshProject: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    s = useStyle(project.id, id);
  if (s.isPending) return <Skeleton label="Loading Style" />;
  if (!s.data)
    return (
      <ApiErrorState error={s.error} page retry={() => void s.refetch()} />
    );
  const props = {
    project,
    style: s.data as Style,
    available: parentAvailable && !s.isError,
    refreshParents: () => Promise.all([refreshProject(), s.refetch()]),
  };
  return (
    <Stack>
      <nav aria-label="Grading navigation">
        <Link to={stylePath(w.organizationId, project.id, id)}>
          Back to Style
        </Link>
        {detail && (
          <>
            {" "}
            ·{" "}
            <Link to={`${stylePath(w.organizationId, project.id, id)}/grading`}>
              All Gradings
            </Link>
          </>
        )}
      </nav>
      <h1>{detail ? "Grading" : "Grading"}</h1>
      <p className="grading-id">
        {s.data.name} · Immutable grading snapshots. Deltas are base-relative;
        this is not a geometry engine.
      </p>
      {s.isError && <ApiErrorState error={s.error} />}
      {detail ? (
        <GradingDetail {...props} id={gradeRuleSetId} />
      ) : (
        <GradingList {...props} />
      )}
    </Stack>
  );
}
