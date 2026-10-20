import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "react-router";

import { ApiError } from "../api/errors";

import { useSession } from "../app/session";
import {
  Composition,
  MaterialFacts,
  titleCase,
} from "../features/materials/MaterialSummary";
import {
  PhysicalSpec,
  MaterialVariants,
  MaterialListings,
} from "../features/materials/MaterialChildren";
import { discoveryReturn } from "../features/materials/navigation";
import {
  detailOptions,
  useReferences,
} from "../features/materials/materialQueries";
import { Skeleton, Stack, StatusBadge, Surface } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
export default function MaterialDetailPage() {
  const { id = "" } = useParams();
  const { scope } = useSession();
  const references = useReferences();
  const returnTo = discoveryReturn(useLocation().state);
  const material = useQuery(detailOptions(scope, id));
  if (material.isPending) return <Skeleton label="Loading material" />;
  if (material.isError)
    return (
      <ApiErrorState
        error={material.error}
        title={
          material.error instanceof ApiError && material.error.status === 404
            ? "Material not found"
            : undefined
        }
        retry={
          material.error instanceof ApiError &&
          (material.error.status === 0 || material.error.status >= 500)
            ? () => void material.refetch()
            : undefined
        }
        page
      />
    );
  const value = material.data;
  return (
    <Stack>
      <Link to={returnTo} className="text-link">
        Browse active materials
      </Link>
      <header>
        <p className="eyebrow">MATERIAL · {titleCase(value.materialType)}</p>
        <h1>{value.displayName || "Material name not entered"}</h1>
        <StatusBadge tone={value.status === "ACTIVE" ? "success" : "neutral"}>
          {titleCase(value.status)}
        </StatusBadge>
      </header>
      <Surface>
        <h2>Catalog identity</h2>
        <MaterialFacts material={value} references={references} />
      </Surface>
      <PhysicalSpec material={value} />
      <Surface>
        <h2>Composition</h2>
        <Composition material={value} references={references} />
      </Surface>
      <div className="stack material-related-records">
        <MaterialVariants id={id} />
        <MaterialListings id={id} returnTo={returnTo} />
      </div>
      <Surface>
        <h2>Description</h2>
        <p className="material-description">
          {value.description || "Description not entered"}
        </p>
      </Surface>
    </Stack>
  );
}
