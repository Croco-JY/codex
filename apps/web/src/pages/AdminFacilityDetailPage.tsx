import { PermanentBinding } from "../features/admin-identity/Workspace";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/errors";
import { useSession } from "../app/session";
import { Button, Skeleton, Stack, Surface, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Facts } from "../features/commercial/ReadUI";
import { SupplierLabel } from "../features/materials/SupplierPicker";
import { isUuid, text, safeVersion } from "../features/admin-sources/model";
import {
  useNetworkReferences,
  countryName,
  geographyName,
} from "../features/network/references";
import { FacilityForm } from "../features/admin-network/FacilityForm";
import { Citations } from "../features/admin-network/Citations";
import { Capabilities } from "../features/admin-network/Capabilities";
import { facilityOptions } from "../features/admin-network/data";
import {
  facilityBaseline,
  type FacilityBaseline,
} from "../features/admin-network/model";
import {
  CurationHeader,
  ArchivedNotice,
} from "../features/admin-network/Fields";
import "../features/admin-network/workspace.css";
export default function AdminFacilityDetailPage() {
  const { id = "" } = useParams();
  return <FacilityWorkspace key={id} id={id} />;
}
function FacilityWorkspace({ id }: { id: string }) {
  const { scope } = useSession(),
    refs = useNetworkReferences(),
    query = useQuery({
      ...facilityOptions(scope, id),
      enabled: isUuid(id),
      staleTime: 0,
      refetchOnMount: "always",
    }),
    [editing, setEditing] = useState<FacilityBaseline>();
  const [knownParent, setKnownParent] = useState<FacilityBaseline>();
  const liveParent = facilityBaseline(query.data);
  useEffect(() => {
    if (query.isSuccess && liveParent?.id === id) setKnownParent(liveParent);
  }, [query.data, query.isSuccess, id]);
  if (!isUuid(id)) return <ApiErrorState error={new ApiError(404)} page />;
  if (query.isPending) return <Skeleton label="Loading Facility curation" />;
  if (!query.data)
    return (
      <ApiErrorState
        error={query.error ?? new ApiError(502)}
        page
        retry={() => void query.refetch()}
      />
    );
  const f = query.data,
    safe = facilityBaseline(f),
    usable = query.isSuccess && safe?.id === id;
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <CurationHeader title={text(f.name)} kind="facilities">
          <StatusBadge>{text(f.status)}</StatusBadge>
          <p className="record-reference">Facility reference: {id}</p>
        </CurationHeader>
        {f.status === "ARCHIVED" && <ArchivedNotice />}
        {query.error && (
          <ApiErrorState
            error={query.error}
            retry={() => void query.refetch()}
          />
        )}
        <Surface>
          <h2>Facility profile</h2>
          <Facts
            values={[
              ["Facility type", text(f.facilityType)],
              ["Lifecycle", text(f.status)],
              [
                "Facility profile version",
                safeVersion(f.version) ? f.version : "Unavailable",
              ],
            ]}
          />
          {!usable && (
            <p className="notice">
              Facility state is incomplete, unsafe or not successfully
              refreshed. Mutations are blocked.
            </p>
          )}
          <div className="scope-actions">
            <Button
              disabled={!usable || !!editing}
              onClick={() => {
                if (safe) setEditing(safe);
              }}
            >
              Edit Facility
            </Button>
            <Link className="text-link" to={`/facilities/${id}`}>
              Open buyer Facility view
            </Link>
          </div>
        </Surface>
        <Surface>
          <h2>Parent Supplier</h2>
          {isUuid(f.supplierId) ? (
            <>
              <Link
                className="text-link"
                to={`/admin/suppliers/${f.supplierId}`}
              >
                <SupplierLabel id={f.supplierId} />
              </Link>
              <p className="record-reference">
                Supplier reference: {f.supplierId}
              </p>
              <p>
                Parent Supplier is immutable after Facility creation. Facility
                type does not change Supplier roles.
              </p>
            </>
          ) : (
            <p>Parent Supplier reference unavailable.</p>
          )}
        </Surface>
        <Surface>
          <h2>Geography / contact</h2>
          <Facts
            values={[
              ["Country", countryName(refs, f.countryId)],
              ["Region", geographyName(refs, "regions", f.regionId)],
              [
                "Industrial Cluster",
                geographyName(refs, "clusters", f.industrialClusterId),
              ],
              ["Address line 1", text(f.addressLine1)],
              ["Address line 2", text(f.addressLine2)],
              ["Postal code", text(f.postalCode)],
              ["Latitude", text(f.latitude)],
              ["Longitude", text(f.longitude)],
              ["Phone", text(f.phone)],
              ["Email", text(f.email)],
            ]}
          />
        </Surface>
        {editing && (
          <FacilityForm initial={editing} close={() => setEditing(undefined)} />
        )}
        <PermanentBinding
          type="facility"
          id={id}
          label={text(f.name)}
          ready={!!usable}
        />
        {f.id === id && <Citations kind="facilities" id={id} />}
        {(safe?.id === id ? safe : knownParent) ? (
          <Capabilities
            facility={(safe?.id === id ? safe : knownParent)!}
            parentConfirmed={!!usable}
          />
        ) : (
          <Surface>
            <h2>Capability assignments</h2>
            <p>
              A safely loaded Facility is required before inspecting assignment
              edit/create state.
            </p>
          </Surface>
        )}
      </Stack>
    </div>
  );
}
