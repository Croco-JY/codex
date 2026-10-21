import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { useSession } from "../app/session";
import { ApiError } from "../api/errors";
import { Skeleton, Stack, Surface, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { supplierOptions } from "../features/materials/materialQueries";
import { titleCase } from "../features/materials/MaterialSummary";
import { Facts } from "../features/commercial/ReadUI";
import {
  countryName,
  useNetworkReferences,
} from "../features/network/references";
import {
  SupplierAliases,
  SupplierCatalog,
  SupplierFacilities,
  SupplierListings,
  SupplierVerification,
} from "../features/network/SupplierChildren";
import { safeWebsite } from "../features/network/filters";
import {
  networkReturn,
  networkDirectory,
} from "../features/network/navigation";
export default function SupplierDetailPage() {
  const { id = "" } = useParams(),
    { scope } = useSession(),
    refs = useNetworkReferences(),
    location = useLocation();
  const query = useQuery(supplierOptions(scope, id));
  if (query.isPending) return <Skeleton label="Loading Supplier" />;
  if (query.isError)
    return (
      <ApiErrorState
        page
        title={
          query.error instanceof ApiError && query.error.status === 404
            ? "Supplier not found"
            : undefined
        }
        error={query.error}
        retry={() => void query.refetch()}
      />
    );
  const s = query.data,
    url = safeWebsite(s.websiteUrl);
  return (
    <Stack>
      <Link to={networkReturn(location.state)} className="text-link">
        Return to Supply Network
      </Link>
      <header className="network-heading">
        <p className="eyebrow">SUPPLY NETWORK · SUPPLIER</p>
        <h1>{s.displayName || "Supplier name not entered"}</h1>
        <StatusBadge>{s.status ?? "Status not entered"}</StatusBadge>
      </header>
      <Surface aria-label="Supplier identity">
        <h2>Identity</h2>
        <Facts
          values={[
            ["Legal name", s.legalName],
            ["Native name", s.nativeName],
            ["English name", s.englishName],
            ["Supplier country", countryName(refs, s.countryId)],
            ["Business registration number", s.businessRegistrationNumber],
            [
              "Website",
              url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              ) : s.websiteUrl ? (
                "Website link unavailable"
              ) : (
                "Not entered"
              ),
            ],
          ]}
        />
        <p className="material-description">
          {s.description || "Description not entered"}
        </p>
      </Surface>
      <Surface aria-label="Roles and verification">
        <h2>Roles and verification</h2>
        <p>
          Supplier roles describe the business, independently of Facility types.
        </p>
        <div className="network-badges">
          {s.roles?.map((r) => (
            <StatusBadge key={r}>{titleCase(r)}</StatusBadge>
          ))}
          {!s.roles?.length && <p>No roles recorded.</p>}
        </div>
        <p>
          Supplier verification:{" "}
          <StatusBadge>{titleCase(s.verificationStatus)}</StatusBadge>
        </p>
        <p className="muted">
          Verification is a recorded sourcing state, not a score or legal
          certification.
        </p>
      </Surface>
      <SupplierAliases key={`aliases-${id}`} id={id} />
      <div className="stack supplier-related-records">
        <SupplierFacilities
          key={`facilities-${id}`}
          id={id}
          refs={refs}
          directory={networkDirectory(location.state)}
        />
        <SupplierCatalog
          key={`catalog-${id}`}
          id={id}
          directory={networkDirectory(location.state)}
        />
        <SupplierListings
          key={`listings-${id}`}
          id={id}
          directory={networkDirectory(location.state)}
        />
      </div>
      <SupplierVerification key={`verification-${id}`} id={id} />
    </Stack>
  );
}
