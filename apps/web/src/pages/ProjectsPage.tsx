import { Stack } from "../ui";
import { useWorkspace } from "../app/workspace";
import { Collection } from "../features/workspace/Collection";
export default function ProjectsPage() {
  const w = useWorkspace();
  return (
    <Stack>
      <header>
        <p className="eyebrow">DEVELOP · {w.organization.name}</p>
        <h1>Projects</h1>
        <p className="lead">
          Private product development starts with a Project and its Styles.
        </p>
      </header>
      <Collection />
    </Stack>
  );
}
