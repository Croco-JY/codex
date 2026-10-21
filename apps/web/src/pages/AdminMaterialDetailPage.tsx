import { useState } from "react";
import { useQuery, useIsMutating } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { queryKeys } from "../api/queryKeys";
import { ApiError } from "../api/errors";
import { useSession } from "../app/session";
import { Stack, Surface, Button, Skeleton, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { detailOptions } from "../features/materials/materialQueries";
import { SupplierLabel } from "../features/materials/SupplierPicker";
import { isUuid, text, safeVersion } from "../features/admin-sources/model";
import {
  materialBaseline,
  type MaterialBaseline,
} from "../features/admin-catalog/model";
import {
  MaterialForm,
  CompositionForm,
} from "../features/admin-catalog/MaterialForms";
import { SpecEditor } from "../features/admin-catalog/SpecEditor";
import { Variants } from "../features/admin-catalog/Variants";
import { CatalogCitations } from "../features/admin-catalog/Citations";
import { ListingContext } from "../features/admin-catalog/Listings";
import "../features/admin-network/workspace.css";
export default function AdminMaterialDetailPage() {
  const { id = "" } = useParams();
  return <Workspace key={id} id={id} />;
}
function Workspace({ id }: { id: string }) {
  const { scope } = useSession(),
    q = useQuery({
      ...detailOptions(scope, id),
      enabled: isUuid(id),
      refetchOnMount: "always",
    }),
    busy =
      useIsMutating({ mutationKey: [...queryKeys.admin(scope), "command"] }) >
      0;
  const [command, setCommand] = useState<"profile" | "composition">(),
    [baseline, setBaseline] = useState<MaterialBaseline>();
  if (!isUuid(id)) return <ApiErrorState error={new ApiError(404)} page />;
  if (q.isPending) return <Skeleton label="Loading Material curation" />;
  if (!q.data) return <ApiErrorState error={q.error} page />;
  const safe = materialBaseline(q.data),
    ready = q.isSuccess && safe?.id === id;
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <header>
          <Link to="/admin/materials">Return to Material curation</Link>
          <p className="eyebrow">PROTECTED CURATION</p>
          <h1>{text(q.data.displayName)}</h1>
          <StatusBadge>{text(q.data.status)}</StatusBadge>
          {q.data.status === "ARCHIVED" && (
            <p className="notice">
              This record is archived and may no longer appear in active buyer
              discovery.
            </p>
          )}
        </header>
        <Surface>
          <h2>Catalog identity / Profile</h2>
          <p>
            Catalog Supplier:{" "}
            <SupplierLabel
              id={
                isUuid(q.data.catalogSupplierId)
                  ? q.data.catalogSupplierId
                  : undefined
              }
            />
          </p>
          <p>Material type (immutable): {text(q.data.materialType)}</p>
          <p>Catalog article: {text(q.data.catalogArticleNumber)}</p>
          <p>{text(q.data.description)}</p>
          <p>
            Composition: {text(q.data.compositionCompleteness)} · Material
            version{" "}
            {safeVersion(q.data.version) ? q.data.version : "Unavailable"}
          </p>
          <ul>
            {(Array.isArray(q.data.composition) ? q.data.composition : [])
              .filter((p) => p && typeof p === "object")
              .map((p, i) => (
                <li key={isUuid(p.fiberTypeId) ? p.fiberTypeId : i}>
                  {text(p.fiberCode ?? p.fiberTypeId)}: {text(p.percentage)}%
                </li>
              ))}
          </ul>
          {!ready && (
            <p role="alert">
              Material preservation warning: incomplete or unsafe
              Composition/profile blocks parent mutations.
            </p>
          )}
          <div className="scope-actions">
            <Button
              disabled={!ready || busy || !!command}
              onClick={() => {
                setBaseline(safe);
                setCommand("profile");
              }}
            >
              Edit Material profile
            </Button>
            <Button
              disabled={!ready || busy || !!command}
              onClick={() => {
                setBaseline(safe);
                setCommand("composition");
              }}
            >
              Replace Composition
            </Button>
            <Link to="/admin/listings" state={{ curationMaterial: id }}>
              Add Listing
            </Link>
            <Link to={`/materials/${id}`}>Open buyer Material view</Link>
          </div>
        </Surface>
        {command &&
          baseline &&
          (command === "profile" ? (
            <MaterialForm
              key={command}
              baseline={baseline}
              ready={!!ready}
              cancel={() => setCommand(undefined)}
            />
          ) : (
            <CompositionForm
              key={command}
              baseline={baseline}
              ready={!!ready}
              cancel={() => setCommand(undefined)}
            />
          ))}
        {safe &&
          (safe.materialType === "FABRIC" ||
            safe.materialType === "LEATHER") && (
            <SpecEditor
              key={safe.materialType}
              id={id}
              type={safe.materialType}
              confirmed={!!ready}
            />
          )}
        <CatalogCitations id={id} kind="materials" />
        <Variants material={id} />
        <ListingContext id={id} mode="material" />
      </Stack>
    </div>
  );
}
