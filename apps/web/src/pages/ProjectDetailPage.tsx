import { Link, useParams } from "react-router";
import { Stack, Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { useWorkspace } from "../app/workspace";
import { useProject } from "../features/workspace/data";
import { collectionPath } from "../features/workspace/model";
import { Collection } from "../features/workspace/Collection";
import { Editor } from "../features/workspace/Editor";
export default function ProjectDetailPage() {
  const { projectId = "" } = useParams(),
    w = useWorkspace(),
    project = useProject(projectId);
  if (project.isPending) return <Skeleton label="Loading Project" />;
  if (!project.data)
    return (
      <ApiErrorState
        error={project.error}
        page
        retry={() => void project.refetch()}
      />
    );
  return (
    <Stack>
      <nav className="read-navigation" aria-label="Workspace breadcrumbs">
        <Link to={collectionPath(w.organizationId)}>Organization Projects</Link>
      </nav>
      <header>
        <p className="eyebrow">PROJECT · {w.organization.name}</p>
        <h1>{project.data.name}</h1>
        <p className="record-reference">Project ID: {project.data.id}</p>
      </header>
      {project.isError && (
        <ApiErrorState
          error={project.error}
          retry={() => void project.refetch()}
        />
      )}
      <Editor
        available={!project.isError}
        key={projectId}
        entity={project.data}
        refresh={() => project.refetch()}
      />
      <Collection
        key={`styles:${projectId}`}
        project={projectId}
        writable={!project.isError && project.data.status === "ACTIVE"}
      />
    </Stack>
  );
}
