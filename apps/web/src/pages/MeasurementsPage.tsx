import { Link, useParams } from "react-router";
import { Stack, Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { useWorkspace } from "../app/workspace";
import { useProject, useStyle } from "../features/workspace/data";
import { stylePath, type Project } from "../features/workspace/model";
import { Measurements } from "../features/measurement/Measurements";
export default function MeasurementsPage() {
  const { projectId = "", styleId = "" } = useParams(),
    parent = useProject(projectId);
  if (parent.isPending) return <Skeleton label="Loading parent Project" />;
  if (!parent.data)
    return (
      <ApiErrorState
        error={parent.error}
        page
        retry={() => void parent.refetch()}
      />
    );
  return (
    <>
      <ApiErrorStateIf error={parent.isError ? parent.error : null} />
      <StyleGate
        key={`${projectId}:${styleId}`}
        parent={parent.data}
        id={styleId}
        parentAvailable={!parent.isError}
        refreshParent={() => parent.refetch()}
      />
    </>
  );
}
function ApiErrorStateIf({ error }: { error: unknown }) {
  return error ? <ApiErrorState error={error} /> : null;
}
function StyleGate({
  parent,
  id,
  parentAvailable,
  refreshParent,
}: {
  parent: Project;
  id: string;
  parentAvailable: boolean;
  refreshParent: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    style = useStyle(parent.id, id);
  if (style.isPending) return <Skeleton label="Loading Style" />;
  if (!style.data)
    return (
      <ApiErrorState
        error={style.error}
        page
        retry={() => void style.refetch()}
      />
    );
  return (
    <Stack>
      <nav aria-label="Measurement navigation">
        <Link to={stylePath(w.organizationId, parent.id, id)}>
          Back to Style
        </Link>
      </nav>
      <header className="measurement-heading">
        <h1>Measurements</h1>
        <p>
          {style.data.name} · Complete immutable measurement snapshots. A
          revision is not approval.
        </p>
      </header>
      <ApiErrorStateIf error={style.isError ? style.error : null} />
      <Measurements
        key={`${parent.id}:${id}`}
        project={parent}
        style={style.data}
        available={parentAvailable && !style.isError}
        refreshParents={() => Promise.all([refreshParent(), style.refetch()])}
      />
    </Stack>
  );
}
