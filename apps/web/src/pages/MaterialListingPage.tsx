import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { useSession } from "../app/session";
import { detailOptions } from "../features/materials/materialQueries";
import { discoveryReturn } from "../features/materials/navigation";
import { SupplierLabel } from "../features/materials/SupplierPicker";
import { InventoryReads } from "../features/commercial/InventoryReads";
import { PriceReads } from "../features/commercial/PriceReads";
import { ListingTerms } from "../features/commercial/ListingTerms";
import { Skeleton, Stack, Surface } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import {
  networkReturn,
  networkDirectory,
} from "../features/network/navigation";
export default function MaterialListingPage() {
  const { id = "" } = useParams();
  return <ListingPage key={id} id={id} />;
}
function ListingPage({ id }: { id: string }) {
  const { scope } = useSession();
  const location = useLocation();
  const returnTo = discoveryReturn(location.state);
  const networkTo =
    location.state &&
    typeof location.state === "object" &&
    "networkReturn" in location.state
      ? networkReturn(location.state)
      : undefined;
  const listing = useQuery({
    queryKey: queryKeys.listing(scope, id),
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET(
        "/api/v1/material-listings/{id}",
        { signal, params: { path: { id } } },
      );
      return requireData(data, response);
    },
  });
  const material = useQuery(
    detailOptions(scope, listing.data?.materialId ?? ""),
  );
  if (listing.isPending)
    return (
      <>
        <h1>Seller Listing</h1>
        <Skeleton label="Loading seller Listing" />
      </>
    );
  if (listing.isError)
    return (
      <ApiErrorState
        page
        error={listing.error}
        title={
          listing.error instanceof ApiError && listing.error.status === 404
            ? "Listing not found"
            : undefined
        }
        retry={
          listing.error instanceof ApiError &&
          (listing.error.status === 0 || listing.error.status >= 500)
            ? () => void listing.refetch()
            : undefined
        }
      />
    );
  const value = listing.data;
  return (
    <Stack>
      <div className="read-navigation">
        {networkTo && (
          <Link
            to={networkTo}
            state={{ networkReturn: networkDirectory(location.state) }}
          >
            Return to Supply Network
          </Link>
        )}
        <Link to={returnTo} className="text-link">
          Return to Material search
        </Link>
        {value.materialId && (
          <Link
            to={`/materials/${encodeURIComponent(value.materialId)}`}
            state={{
              discoveryReturn: returnTo,
              ...(networkTo
                ? {
                    networkReturn: networkTo,
                    networkDirectory: networkDirectory(location.state),
                  }
                : {}),
            }}
            className="text-link"
          >
            Return to catalog Material
          </Link>
        )}
      </div>
      <header>
        <p className="eyebrow">MATERIAL SOURCING · SELLER LISTING</p>
        <h1>
          {value.sellerArticleNumber
            ? `Seller Listing · ${value.sellerArticleNumber}`
            : "Seller Listing"}
        </h1>
        <p className="lead">
          Commercial terms from a Seller for one catalog Material.
        </p>
      </header>
      <Surface aria-label="Catalog Material context">
        <h2>Catalog Material</h2>
        {material.isPending ? (
          <Skeleton label="Loading catalog Material context" />
        ) : material.isError ? (
          <ApiErrorState
            error={material.error}
            retry={() => void material.refetch()}
          />
        ) : (
          <>
            <h3>{material.data.displayName || "Material name not entered"}</h3>
            <p>
              Catalog supplier:{" "}
              <SupplierLabel id={material.data.catalogSupplierId} />
            </p>
            <p>
              Catalog article:{" "}
              {material.data.catalogArticleNumber || "Not entered"}
            </p>
          </>
        )}
      </Surface>
      <Surface aria-label="Listing terms">
        <h2>Listing terms</h2>
        <ListingTerms listing={value} />
        {value.sellerSupplierId && (
          <p>
            <Link
              to={`/suppliers/${value.sellerSupplierId}`}
              state={{ networkReturn: `/material-listings/${id}` }}
            >
              View Seller profile
            </Link>
          </p>
        )}
      </Surface>
      <PriceReads listing={{ ...value, id }} />
      <InventoryReads listing={{ ...value, id }} />
    </Stack>
  );
}
