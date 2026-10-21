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
      <Surface>
        <h2>Suppliers</h2>
        <p>
          Curate Supplier profiles, aliases, manual verification and fact
          citations.
        </p>
        <Link className="text-link" to="/admin/suppliers">
          Open Supplier curation
        </Link>
      </Surface>
      <Surface>
        <h2>Facilities</h2>
        <p>Curate physical sites, fact citations and Capability assignments.</p>
        <Link className="text-link" to="/admin/facilities">
          Open Facility curation
        </Link>
      </Surface>
    </Stack>
  );
}
