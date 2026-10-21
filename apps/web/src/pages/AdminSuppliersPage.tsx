import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../ui";
import SuppliersPage from "./SuppliersPage";
import { SupplierForm } from "../features/admin-network/SupplierForm";
import "../features/admin-network/workspace.css";
export default function AdminSuppliersPage() {
  const [creating, setCreating] = useState(false);
  return (
    <div className="provenance-workspace curation-network">
      <SuppliersPage curation>
        <div className="scope-actions">
          <Link className="text-link" to="/admin">
            Curation workspace
          </Link>
          {!creating && (
            <Button onClick={() => setCreating(true)}>New Supplier</Button>
          )}
        </div>
        <p className="filter-help">
          Active directory only. A known archived Supplier can still be opened
          by its direct detail route.
        </p>
        {creating && <SupplierForm close={() => setCreating(false)} />}
      </SuppliersPage>
    </div>
  );
}
