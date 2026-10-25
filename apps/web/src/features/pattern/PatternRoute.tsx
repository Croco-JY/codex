import { Link, useParams } from "react-router";
import { useProject, useStyle } from "../workspace/data";
import type { Project, Style } from "../workspace/model";
import { stylePath } from "../workspace/model";
import { useWorkspace } from "../../app/workspace";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Stack, Skeleton } from "../../ui";
import { PatternList, PatternDetail } from "./Patterns";
export function PatternRoute({ detail = false }: { detail?: boolean }) {
  const { projectId = "", styleId = "", patternId = "" } = useParams(),
    p = useProject(projectId);
  if (p.isPending) return <Skeleton label="Loading parent Project" />;
  if (!p.data)
    return (
      <ApiErrorState error={p.error} page retry={() => void p.refetch()} />
    );
  return (
    <StyleGate
      key={`${projectId}:${styleId}:${patternId}`}
      project={p.data}
      id={styleId}
      patternId={patternId}
      detail={detail}
      parentAvailable={!p.isError}
      refreshProject={() => p.refetch()}
    />
  );
}
function StyleGate({
  project,
  id,
  patternId,
  detail,
  parentAvailable,
  refreshProject,
}: {
  project: Project;
  id: string;
  patternId: string;
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
      <nav aria-label="Pattern navigation">
        <Link to={stylePath(w.organizationId, project.id, id)}>
          Back to Style
        </Link>
        {detail && (
          <>
            {" "}
            ·{" "}
            <Link
              to={`${stylePath(w.organizationId, project.id, id)}/patterns`}
            >
              All Patterns
            </Link>
          </>
        )}
      </nav>
      <h1>{detail ? "Pattern" : "Patterns"}</h1>
      <p className="pattern-id">
        {s.data.name} · Immutable revisions. Artifacts are private attachments,
        not geometry or quality approval.
      </p>
      {s.isError && <ApiErrorState error={s.error} />}
      {detail ? (
        <PatternDetail {...props} id={patternId} />
      ) : (
        <PatternList {...props} />
      )}
    </Stack>
  );
}
