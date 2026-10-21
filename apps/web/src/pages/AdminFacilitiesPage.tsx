import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { useSession } from "../app/session";
import { Button } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import FacilitiesPage from "./FacilitiesPage";
import { supplierOptions } from "../features/materials/materialQueries";
import { isUuid } from "../features/admin-sources/model";
import { supplierBaseline } from "../features/admin-network/model";
import { FacilityForm } from "../features/admin-network/FacilityForm";
import "../features/admin-network/workspace.css";
export default function AdminFacilitiesPage() {
  const location = useLocation(),
    context: unknown = location.state;
  const parentId =
    context &&
    typeof context === "object" &&
    "curationParentSupplier" in context &&
    isUuid(context.curationParentSupplier)
      ? context.curationParentSupplier
      : "";
  return (
    <FacilityDirectoryWorkspace
      key={parentId || "standalone"}
      parentId={parentId}
    />
  );
}
function FacilityDirectoryWorkspace({ parentId }: { parentId: string }) {
  const { scope } = useSession();
  const [creating, setCreating] = useState(!!parentId),
    parent = useQuery(supplierOptions(scope, parentId)),
    safe = parent.data && supplierBaseline(parent.data);
  return (
    <div className="provenance-workspace curation-network">
      <FacilitiesPage curation>
        <div className="scope-actions">
          <Link className="text-link" to="/admin">
            Curation workspace
          </Link>
          {!creating && (
            <Button onClick={() => setCreating(true)}>New Facility</Button>
          )}
        </div>
        <p className="filter-help">
          Active directory only; no Facility keyword query. Known archived
          Facility details remain available.
        </p>
        {creating &&
          (parentId ? (
            parent.isPending ? (
              <p role="status">Loading fixed parent Supplier…</p>
            ) : parent.error ? (
              <ApiErrorState
                error={parent.error}
                retry={() => void parent.refetch()}
              />
            ) : safe && safe.id === parentId ? (
              <FacilityForm
                fixedParent={{ id: safe.id, name: safe.fields.displayName }}
                close={() => setCreating(false)}
              />
            ) : (
              <p>
                Parent Supplier state is incomplete. Facility creation is
                blocked.
              </p>
            )
          ) : (
            <FacilityForm close={() => setCreating(false)} />
          ))}
      </FacilitiesPage>
    </div>
  );
}
