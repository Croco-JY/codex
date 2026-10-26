import { Link, useParams } from "react-router";
import { Stack, Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { useWorkspace } from "../app/workspace";
import { useProject, useStyle } from "../features/workspace/data";
import {
  collectionPath,
  projectPath,
  stylePath,
  type Project,
} from "../features/workspace/model";
import { Editor } from "../features/workspace/Editor";
import { RequirementSection } from "../features/workspace/Requirement";
import { MaterialSelections } from "../features/workspace/MaterialSelections";
import { FacilityCandidates } from "../features/workspace/FacilityCandidates";
import { DevelopmentReferences } from "../features/workspace/DevelopmentReferences";
export default function StyleDetailPage() {
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
      {parent.isError && (
        <ApiErrorState
          error={parent.error}
          retry={() => void parent.refetch()}
        />
      )}
      <StyleContent
        key={`${projectId}:${styleId}`}
        parent={parent.data}
        parentAvailable={!parent.isError}
        id={styleId}
        refreshParent={() => parent.refetch()}
      />
    </>
  );
}
function StyleContent({
  parent,
  parentAvailable,
  id,
  refreshParent,
}: {
  parent: Project;
  parentAvailable: boolean;
  id: string;
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
      <nav className="read-navigation" aria-label="Workspace breadcrumbs">
        <Link to={collectionPath(w.organizationId)}>Organization Projects</Link>
        <Link to={projectPath(w.organizationId, parent.id)}>{parent.name}</Link>
      </nav>
      <header>
        <p className="eyebrow">STYLE · {w.organization.name}</p>
        <h1>{style.data.name}</h1>
        {style.data.styleCode && <p>{style.data.styleCode}</p>}
        <p className="record-reference">Style ID: {style.data.id}</p>
        <Link
          to={`${stylePath(w.organizationId, parent.id, style.data.id)}/measurements`}
        >
          Measurements
        </Link>
        <Link
          to={`${stylePath(w.organizationId, parent.id, style.data.id)}/patterns`}
        >
          Patterns
        </Link>
        <Link to={`${stylePath(w.organizationId, parent.id, style.data.id)}/grading`}>
          Grading
        </Link>
      </header>
      {style.isError && (
        <ApiErrorState error={style.error} retry={() => void style.refetch()} />
      )}
      <Editor
        available={parentAvailable && !style.isError}
        entity={style.data}
        project={parent.id}
        parentActive={parent.status === "ACTIVE"}
        refresh={() => Promise.all([refreshParent(), style.refetch()])}
      />
      <RequirementSection
        project={parent}
        style={style.data}
        available={parentAvailable && !style.isError}
        refreshParents={() => Promise.all([refreshParent(), style.refetch()])}
      />
      <MaterialSelections
        project={parent}
        style={style.data}
        available={parentAvailable && !style.isError}
        refreshParents={() => Promise.all([refreshParent(), style.refetch()])}
      />
      <FacilityCandidates
        project={parent}
        style={style.data}
        available={parentAvailable && !style.isError}
        refreshParents={() => Promise.all([refreshParent(), style.refetch()])}
      />
      <DevelopmentReferences
        project={parent}
        style={style.data}
        available={parentAvailable && !style.isError}
        refreshParents={() => Promise.all([refreshParent(), style.refetch()])}
      />
    </Stack>
  );
}
