import { Stack, Surface } from "../ui";
import { Link } from "react-router";
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
        <h2>Sources &amp; Evidence</h2>
        <p>
          Manage Data Sources, register persistent external records, and append
          observations and reviews.
        </p>
        <Link className="text-link" to="/admin/sources">
          Open Sources &amp; Evidence
        </Link>
      </Surface>
    </Stack>
  );
}
