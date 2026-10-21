import { useState } from "react";
import { useLocation } from "react-router";
import { Stack, Button } from "../ui";
import { isUuid } from "../features/admin-sources/model";
import { MaterialDiscovery } from "../features/admin-catalog/Discovery";
import { MaterialForm } from "../features/admin-catalog/MaterialForms";
import "../features/admin-network/workspace.css";
export default function AdminMaterialsPage() {
  const loc = useLocation(),
    [create, setCreate] = useState(false);
  const raw = loc.state?.curationCatalogSupplier;
  const fixed = typeof raw === "string" && isUuid(raw) ? raw : undefined;
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <header>
          <p className="eyebrow">PROTECTED CURATION</p>
          <h1>Material curation</h1>
          <p>Canonical catalog Materials are distinct from Seller Listings.</p>
        </header>
        <Button onClick={() => setCreate(true)}>New Material</Button>
        {create && (
          <MaterialForm fixedSupplier={fixed} cancel={() => setCreate(false)} />
        )}
        <MaterialDiscovery />
      </Stack>
    </div>
  );
}
