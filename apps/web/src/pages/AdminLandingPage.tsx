import { Stack, Surface } from "../ui";
export default function AdminLandingPage() {
  return (
    <Stack>
      <header>
        <p className="eyebrow">CURATION</p>
        <h1>Curation workspace</h1>
        <p className="lead">
          Maintain shared supply information with reviewed evidence.
        </p>
      </header>
      <Surface>
        <h2>Workspace ready</h2>
        <p>Curation tools will become available in subsequent releases.</p>
      </Surface>
    </Stack>
  );
}
