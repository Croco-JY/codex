import { useState } from "react";
import { useQuery, useIsMutating } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { useSession } from "../app/session";
import { Button, Skeleton, Stack, Surface, StatusBadge } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Facts } from "../features/commercial/ReadUI";
import { supplierOptions } from "../features/materials/materialQueries";
import { isUuid, text, safeVersion } from "../features/admin-sources/model";
import {
  useNetworkReferences,
  countryName,
} from "../features/network/references";
import { SupplierFacilities } from "../features/network/SupplierChildren";
import { SupplierForm } from "../features/admin-network/SupplierForm";
import {
  AliasForm,
  VerificationForm,
  SupplierHistories,
} from "../features/admin-network/SupplierCommands";
import { Citations } from "../features/admin-network/Citations";
import {
  supplierBaseline,
  type SupplierBaseline,
} from "../features/admin-network/model";
import {
  CurationHeader,
  ArchivedNotice,
} from "../features/admin-network/Fields";
import "../features/admin-network/workspace.css";
type Command = "profile" | "alias" | "verification";
export default function AdminSupplierDetailPage() {
  const { id = "" } = useParams();
  return <SupplierWorkspace key={id} id={id} />;
}
function SupplierWorkspace({ id }: { id: string }) {
  const { scope } = useSession(),
    refs = useNetworkReferences(),
    query = useQuery({
      ...supplierOptions(scope, id),
      enabled: isUuid(id),
      staleTime: 0,
      refetchOnMount: "always",
    });
  const busy =
    useIsMutating({ mutationKey: [...queryKeys.admin(scope), "command"] }) > 0;
  const [commandBaseline, setCommandBaseline] = useState<SupplierBaseline>();
  const [command, setCommand] = useState<Command>(),
    [pending, setPending] = useState<Command>(),
    [sequence, setSequence] = useState(0);
  if (!isUuid(id)) return <ApiErrorState error={new ApiError(404)} page />;
  if (query.isPending) return <Skeleton label="Loading Supplier curation" />;
  if (!query.data)
    return (
      <ApiErrorState
        error={query.error ?? new ApiError(502)}
        page
        retry={() => void query.refetch()}
      />
    );
  const s = query.data,
    safe = supplierBaseline(s),
    usable = query.isSuccess && safe?.id === id;
  const open = (next: Command) => {
    if (!usable || !safe || busy) return;
    if (command) setPending(next);
    else {
      setCommandBaseline(safe);
      setCommand(next);
      setSequence((v) => v + 1);
    }
  };
  const close = () => setCommand(undefined);
  return (
    <div className="provenance-workspace curation-network">
      <Stack>
        <CurationHeader title={text(s.displayName)} kind="suppliers">
          <StatusBadge>{text(s.status)}</StatusBadge>
          <p className="record-reference">Supplier reference: {id}</p>
        </CurationHeader>
        {s.status === "ARCHIVED" && <ArchivedNotice />}
        {query.error && (
          <ApiErrorState
            error={query.error}
            retry={() => void query.refetch()}
          />
        )}
        <Surface>
          <h2>Supplier profile</h2>
          <Facts
            values={[
              ["Legal name", text(s.legalName)],
              ["Native name", text(s.nativeName)],
              ["English name", text(s.englishName)],
              ["Country", countryName(refs, s.countryId)],
              ["Business registration", text(s.businessRegistrationNumber)],
              ["Website", text(s.websiteUrl)],
              ["Description", text(s.description)],
            ]}
          />
          <h3>Roles / lifecycle / verification</h3>
          <Facts
            values={[
              [
                "Roles",
                Array.isArray(s.roles) &&
                s.roles.every((r) => typeof r === "string")
                  ? s.roles.join(", ") || "No roles recorded"
                  : "Roles unavailable",
              ],
              ["Lifecycle", text(s.status)],
              ["Supplier verification", text(s.verificationStatus)],
              [
                "Parent Supplier version",
                safeVersion(s.version) ? s.version : "Unavailable",
              ],
            ]}
          />
          {!usable && (
            <p className="notice">
              Supplier state is incomplete, unsafe or not successfully
              refreshed. Versioned mutations are blocked.
            </p>
          )}
          <div className="scope-actions">
            <Button disabled={!usable || busy} onClick={() => open("profile")}>
              Edit Supplier
            </Button>
            <Button disabled={!usable || busy} onClick={() => open("alias")}>
              Append Alias
            </Button>
            <Button
              disabled={!usable || busy}
              onClick={() => open("verification")}
            >
              Manual verification
            </Button>
            {usable && (
              <Link
                className="text-link"
                to="/admin/facilities"
                state={{ curationParentSupplier: id }}
              >
                Add Facility
              </Link>
            )}
            <Link className="text-link" to={`/suppliers/${id}`}>
              Open buyer Supplier view
            </Link>
          </div>
        </Surface>
        {pending && (
          <div className="notice" role="alert">
            <p>
              Opening another Supplier command discards the current command
              draft.
            </p>
            <Button
              onClick={() => {
                if (!usable || !safe || busy) return;
                setCommandBaseline(safe);
                setCommand(pending);
                setPending(undefined);
                setSequence((v) => v + 1);
              }}
            >
              Switch command and discard draft
            </Button>
            <Button className="secondary" onClick={() => setPending(undefined)}>
              Keep current command draft
            </Button>
          </div>
        )}
        {commandBaseline && command && (
          <div key={sequence}>
            {command === "profile" ? (
              <SupplierForm initial={commandBaseline} close={close} />
            ) : command === "alias" ? (
              <AliasForm initial={commandBaseline} close={close} />
            ) : (
              <VerificationForm initial={commandBaseline} close={close} />
            )}
          </div>
        )}
        <SupplierHistories id={id} />
        {s.id === id && <Citations kind="suppliers" id={id} />}
        <SupplierFacilities
          id={id}
          refs={refs}
          directory="/suppliers"
          curation
        />
      </Stack>
    </div>
  );
}
