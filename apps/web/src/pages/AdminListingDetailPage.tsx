import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useSession } from "../app/session";
import { Stack, Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { ApiError } from "../api/errors";
import { isUuid } from "../features/admin-sources/model";
import { listingOptions } from "../features/admin-catalog/data";
import { listingBaseline } from "../features/admin-catalog/model";
import { ListingForm } from "../features/admin-catalog/Listings";
import { CatalogCitations } from "../features/admin-catalog/Citations";
import "../features/admin-network/workspace.css";
import { CommercialWorkspace } from "../features/admin-commercial/Workspace";
import { listingContext } from "../features/admin-commercial/model";
export default function AdminListingDetailPage() {
  const { id = "" } = useParams();
  return <Workspace key={id} id={id} />;
}
function Workspace({ id }: { id: string }) {
  const { scope } = useSession(),
    q = useQuery({ ...listingOptions(scope, id), enabled: isUuid(id) });
  const [opened, setOpened] = useState<ReturnType<typeof listingBaseline>>();
  const [commercial, setCommercial] =
    useState<ReturnType<typeof listingContext>>();
  const context = listingContext(q.data);
  if (!commercial && context?.id === id) setCommercial(context);
  const fresh = listingBaseline(q.data);
  if (!opened && fresh) setOpened(fresh);
  if (!isUuid(id)) return <ApiErrorState error={new ApiError(404)} page />;
  if (q.isPending) return <Skeleton label="Loading Listing curation" />;
  if (!q.data) return <ApiErrorState error={q.error} page />;
  const safe = opened;
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <header>
          <Link to="/admin/listings">Return to Listing curation</Link>
          <h1>Seller Listing curation</h1>
          {q.data.status === "ARCHIVED" && (
            <p className="notice">
              This record is archived and may no longer appear in active
              directories.
            </p>
          )}
          <Link to={`/material-listings/${id}`}>Open buyer Listing view</Link>
        </header>
        {safe ? (
          <ListingForm
            baseline={safe}
            ready={!!fresh && q.isSuccess}
            cancel={() => window.history.back()}
          />
        ) : (
          <p role="alert">
            Listing preservation warning: incomplete or unsafe state blocks
            editing.
          </p>
        )}
        <CatalogCitations id={id} kind="material-listings" />
        {commercial && (
          <CommercialWorkspace
            listing={commercial}
            ready={
              q.isSuccess &&
              context?.id === commercial.id &&
              context.materialId === commercial.materialId &&
              context.sellerSupplierId === commercial.sellerSupplierId
            }
          />
        )}
      </Stack>
    </div>
  );
}
