import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { useSession } from "../app/session";
import { Button, Skeleton, Stack, Surface, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Facts, shown } from "../features/commercial/ReadUI";
import { SupplierLabel } from "../features/materials/SupplierPicker";
import { titleCase } from "../features/materials/MaterialSummary";
import {
  countryName,
  geographyName,
  referenceName,
  useNetworkReferences,
  type NetworkReferences,
} from "../features/network/references";
import { ChildSection } from "../features/network/SupplierChildren";
import {
  networkReturn,
  networkDirectory,
} from "../features/network/navigation";
function FacilityCapabilities({
  id,
  refs,
}: {
  id: string;
  refs: NetworkReferences;
}) {
  const { scope } = useSession();
  const query = useQuery({
    queryKey: ["supply", scope, "facility", id, "capabilities"] as const,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET(
        "/api/v1/facilities/{id}/capabilities",
        { signal, params: { path: { id } } },
      );
      return requireData(data, response);
    },
  });
  const labels = refs.capabilities.data?.pages.flat() ?? [];
  return (
    <ChildSection
      title="Facility capabilities"
      pending={query.isPending}
      error={query.error}
      retry={() => void query.refetch()}
    >
      <p className="muted">
        Verification describes each capability assignment. Order quantities do
        not imply monthly production capacity.
      </p>
      <ul className="read-list">
        {query.data?.map((c, i) => {
          const label = labels.find((v) => v.id === c.capabilityId);
          return (
            <li key={c.capabilityId ?? i}>
              <h3>
                {label ? referenceName(label) : "Capability label unavailable"}
              </h3>
              {!label && (
                <p className="record-reference">
                  Capability reference: {c.capabilityId || "Not recorded"}
                </p>
              )}
              <Facts
                values={[
                  [
                    "Category",
                    label && "category" in label
                      ? titleCase(label.category)
                      : "Category label unavailable",
                  ],
                  ["Proficiency", titleCase(c.proficiencyLevel)],
                  ["Capability verification", titleCase(c.verificationStatus)],
                  ["Minimum order quantity", shown(c.minimumOrderQuantity)],
                  ["Maximum order quantity", shown(c.maximumOrderQuantity)],
                  ["Quantity unit", shown(c.quantityUnit)],
                ]}
              />
            </li>
          );
        })}
      </ul>
      {query.data?.length === 0 && (
        <p>No capabilities recorded for this Facility.</p>
      )}
      {query.data?.length === 100 && (
        <p className="muted">
          First 100 capability assignments; further records are not exposed by
          this read.
        </p>
      )}
      {refs.capabilities.isError && (
        <ApiErrorState
          error={refs.capabilities.error}
          retry={() => void refs.capabilities.refetch()}
        />
      )}
      {refs.capabilities.hasNextPage && (
        <Button
          disabled={refs.capabilities.isFetching}
          onClick={() =>
            void refs.capabilities.fetchNextPage({ cancelRefetch: false })
          }
        >
          Load more capability labels
        </Button>
      )}
    </ChildSection>
  );
}
export default function FacilityDetailPage() {
  const { id = "" } = useParams(),
    { scope } = useSession(),
    refs = useNetworkReferences(),
    location = useLocation();
  const query = useQuery({
    queryKey: queryKeys.facility(scope, id),
    staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/facilities/{id}", {
        signal,
        params: { path: { id } },
      });
      return requireData(data, response);
    },
  });
  if (query.isPending) return <Skeleton label="Loading Facility" />;
  if (query.isError)
    return (
      <ApiErrorState
        page
        error={query.error}
        title={
          query.error instanceof ApiError && query.error.status === 404
            ? "Facility not found"
            : undefined
        }
        retry={() => void query.refetch()}
      />
    );
  const f = query.data;
  return (
    <Stack>
      <Link
        className="text-link"
        to={networkReturn(location.state, "/facilities")}
        state={{
          networkReturn: networkDirectory(location.state, "/facilities"),
        }}
      >
        Return to Supply Network
      </Link>
      <header className="network-heading">
        <p className="eyebrow">SUPPLY NETWORK · FACILITY</p>
        <h1>{f.name || "Facility name not entered"}</h1>
        <StatusBadge>{f.status ?? "Status not entered"}</StatusBadge>
      </header>
      <Surface aria-label="Facility identity">
        <h2>Facility identity</h2>
        <Facts
          values={[
            ["Facility type", titleCase(f.facilityType)],
            [
              "Parent Supplier",
              f.supplierId ? (
                <Link
                  to={`/suppliers/${f.supplierId}`}
                  state={{
                    networkReturn: `/facilities/${id}`,
                    networkDirectory: networkDirectory(
                      location.state,
                      "/facilities",
                    ),
                  }}
                >
                  <SupplierLabel id={f.supplierId} />
                </Link>
              ) : (
                "Parent Supplier not recorded"
              ),
            ],
          ]}
        />
        <p className="muted">
          A Facility is a physical site. Its type and capabilities are separate
          from its parent Supplier’s roles and verification.
        </p>
      </Surface>
      <Surface aria-label="Geography and contact">
        <h2>Geography and contact</h2>
        <Facts
          values={[
            ["Country", countryName(refs, f.countryId)],
            ["Region", geographyName(refs, "regions", f.regionId)],
            [
              "Industrial Cluster",
              geographyName(refs, "clusters", f.industrialClusterId),
            ],
            [
              "Address",
              [f.addressLine1, f.addressLine2].filter(Boolean).join("\n"),
            ],
            ["Postal code", f.postalCode],
            ["Phone", f.phone],
            ["Email", f.email],
            ["Latitude", shown(f.latitude)],
            ["Longitude", shown(f.longitude)],
          ]}
        />
        {(["regions", "clusters"] as const).map((kind) =>
          refs[kind].isError ? (
            <ApiErrorState
              key={kind}
              error={refs[kind].error}
              retry={() => void refs[kind].refetch()}
            />
          ) : refs[kind].hasNextPage ? (
            <Button
              key={kind}
              className="secondary"
              disabled={refs[kind].isFetching}
              onClick={() =>
                void refs[kind].fetchNextPage({ cancelRefetch: false })
              }
            >
              Load more {kind === "clusters" ? "Industrial Cluster" : "Region"}{" "}
              labels
            </Button>
          ) : null,
        )}
      </Surface>
      <FacilityCapabilities key={id} id={id} refs={refs} />
    </Stack>
  );
}
