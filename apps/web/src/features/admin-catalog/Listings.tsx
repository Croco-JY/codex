import { useState } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { useCheckedForm, HistoryStatus } from "../admin-sources/FormUI";
import { useAdminMutation, ambiguous } from "../admin-sources/data";
import {
  TextField,
  SelectField,
  EvidenceField,
  CommandFeedback,
} from "../admin-network/Fields";
import { SupplierPicker, SupplierLabel } from "../materials/SupplierPicker";
import { detailOptions } from "../materials/materialQueries";
import { isUuid } from "../admin-sources/model";
import { MaterialDiscovery } from "./Discovery";
import { listingsOptions, listingOptions, invalidateCatalog } from "./data";
import {
  listingFields,
  listingDefaults,
  listingBaseline,
  listingBody,
  childLifecycle,
  units,
  type ListingFields,
} from "./model";
function MaterialLabel({ id }: { id: string }) {
  const { scope } = useSession(),
    q = useQuery({
      ...detailOptions(scope, id),
      enabled: isUuid(id),
      staleTime: 300000,
    });
  return (
    <>
      {typeof q.data?.displayName === "string"
        ? q.data.displayName
        : "Material label unavailable"}
      <span className="record-reference"> · {id}</span>
    </>
  );
}
export function ListingContext({
  id,
  mode,
}: {
  id: string;
  mode: "material" | "seller";
}) {
  const { scope } = useSession(),
    q = useInfiniteQuery(listingsOptions(scope, id, mode)),
    rows = q.data?.pages.flat() ?? [];
  return (
    <section className="admin-panel">
      <h2>{mode === "material" ? "Material" : "Seller"} Listings</h2>
      <HistoryStatus
        query={q}
        count={rows.length}
        noun="listings"
        empty="No Listings returned in this context."
      />
      <ul className="read-list">
        {rows.map((l) => (
          <li key={l.id}>
            {l.id && (
              <Link to={`/admin/listings/${l.id}`}>
                {l.sellerArticleNumber || "Open Seller Listing"}
              </Link>
            )}
            <p>
              {l.status} · MOQ {l.minimumOrderQuantity ?? "Unknown"} · MCQ{" "}
              {l.minimumColorQuantity ?? "Unknown"} ·{" "}
              {l.quantityUnit ?? "Unit unknown"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function ListingForm({
  baseline,
  fixedMaterial,
  fixedSeller,
  cancel,
  ready = true,
}: {
  baseline?: NonNullable<ReturnType<typeof listingBaseline>>;
  fixedMaterial?: string;
  fixedSeller?: string;
  cancel: () => void;
  ready?: boolean;
}) {
  const form = useCheckedForm(
      listingFields,
      baseline?.fields ?? {
        ...listingDefaults,
        materialId: fixedMaterial ?? "",
        sellerSupplierId: fixedSeller ?? "",
      },
    ),
    { scope } = useSession(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [current, setCurrent] = useState(baseline),
    [comparison, setComparison] = useState<typeof baseline>(),
    [blocked, setBlocked] = useState(false),
    [notice, setNotice] = useState(""),
    [choose, setChoose] = useState(false);
  const m = useAdminMutation(
    "listing",
    async (v: ListingFields, signal) => {
      const body = listingBody(
        {
          ...v,
          ...(current
            ? {
                materialId: current.fields.materialId,
                sellerSupplierId: current.fields.sellerSupplierId,
              }
            : {}),
        },
        current?.version ?? 0,
      );
      const r = baseline
        ? await api.PUT("/api/v1/admin/material-listings/{id}", {
            signal,
            params: { path: { id: baseline.id } },
            body,
          })
        : await api.POST("/api/v1/admin/material-listings", { signal, body });
      return requireData(r.data, r.response);
    },
    async (data, _v, active) => {
      const safe = listingBaseline(data);
      if (!safe) {
        setBlocked(true);
        setNotice(
          "Saved response cannot safely hydrate an edit. Refresh before continuing.",
        );
        return;
      }
      const fresh = listingBaseline(
        await cache.fetchQuery({
          ...listingOptions(scope, safe.id),
          staleTime: 0,
        }),
      );
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: listingsOptions(scope, safe.fields.materialId, "material")
          .queryKey,
        exact: true,
      });
      if (!active()) return;
      await invalidateCatalog(
        cache,
        scope,
        safe.fields.materialId,
        safe.fields.sellerSupplierId,
      );
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: ["supply", scope, "listing", safe.id],
      });
      if (!active()) return;
      await cache.invalidateQueries({
        queryKey: [
          "admin",
          scope,
          "catalog-citations",
          "material-listings",
          safe.id,
        ],
      });
      if (!active()) return;
      if (!fresh) {
        setBlocked(true);
        return;
      }
      if (baseline) {
        setCurrent(fresh);
        form.reset(fresh.fields);
        setNotice(`Listing saved. Server version: ${fresh.version}.`);
      } else navigate(`/admin/listings/${safe.id}`);
    },
    async (error, _v, active) => {
      if (
        (error instanceof ApiError && error.status === 409) ||
        ambiguous(error)
      ) {
        setBlocked(true);
        if (baseline)
          try {
            const v = await cache.fetchQuery({
              ...listingOptions(scope, baseline.id),
              staleTime: 0,
            });
            if (active()) setComparison(listingBaseline(v));
          } catch {
            /* Draft remains; ordinary safe error state. */
          }
      }
    },
  );
  return (
    <section className="admin-panel">
      <h2>{baseline ? "Edit" : "Create"} Seller Listing</h2>
      <p>A Seller may differ from the Material’s catalog Supplier.</p>
      {choose && (
        <MaterialDiscovery
          select={(id) => {
            form.setValue("materialId", id);
            setChoose(false);
          }}
        />
      )}
      <form className="admin-form" onSubmit={form.submit((v) => m.mutate(v))}>
        <fieldset disabled={m.isPending || !ready}>
          <div className="admin-fields">
            {baseline || fixedMaterial ? (
              <p className="record-reference">
                Material (read-only):{" "}
                <MaterialLabel
                  id={current?.fields.materialId ?? fixedMaterial ?? ""}
                />
              </p>
            ) : (
              <div>
                <p className="record-reference">
                  Selected Material:{" "}
                  {form.watch("materialId") ? (
                    <MaterialLabel id={form.watch("materialId")} />
                  ) : (
                    "Not selected"
                  )}
                </p>
                <Button className="secondary" onClick={() => setChoose(true)}>
                  Choose Listing Material
                </Button>
                {form.formState.errors.materialId && (
                  <p role="alert">Choose Material.</p>
                )}
              </div>
            )}
            {baseline || fixedSeller ? (
              <p>
                Seller (read-only):{" "}
                <SupplierLabel
                  id={current?.fields.sellerSupplierId ?? fixedSeller}
                />
              </p>
            ) : (
              <SupplierPicker
                label="Seller"
                value={form.watch("sellerSupplierId")}
                onChange={(id) => form.setValue("sellerSupplierId", id)}
              />
            )}
            <TextField
              form={form}
              name="sellerArticleNumber"
              label="Seller article number"
            />
            <TextField
              form={form}
              name="minimumOrderQuantity"
              label="Listing MOQ"
            />
            <TextField
              form={form}
              name="minimumColorQuantity"
              label="Listing MCQ"
            />
            <SelectField
              form={form}
              name="quantityUnit"
              label="Listing quantity unit"
              values={units}
              optional
            />
            <TextField
              form={form}
              name="standardLeadTimeDays"
              label="Standard lead time (days)"
            />
            <TextField
              form={form}
              name="reproductionLeadTimeDays"
              label="Reproduction lead time (days)"
            />
            <SelectField
              form={form}
              name="status"
              label="Listing status"
              values={childLifecycle}
            />
          </div>
          <EvidenceField form={form} />
          <Button type="submit" disabled={blocked}>
            Save Listing
          </Button>
          <Button className="secondary" onClick={() => form.reset()}>
            Reset Listing
          </Button>
          <Button className="secondary" onClick={cancel}>
            Cancel Listing
          </Button>
        </fieldset>
      </form>
      <CommandFeedback
        error={m.error}
        success={notice}
        noun="Listing"
        conflict="The Listing changed or conflicts with the current server state."
      />
      {comparison && (
        <div className="notice">
          <h3>Current server Listing</h3>
          <p>
            {comparison.fields.sellerArticleNumber || "No seller article"} ·
            version {comparison.version}
          </p>
          <p>
            MOQ {comparison.fields.minimumOrderQuantity || "Unknown"} · MCQ{" "}
            {comparison.fields.minimumColorQuantity || "Unknown"} ·{" "}
            {comparison.fields.quantityUnit || "Unit unknown"}
          </p>
          <Button
            onClick={() => {
              setCurrent(comparison);
              setComparison(undefined);
              setBlocked(false);
              m.reset();
            }}
          >
            Use current Listing version; retain draft
          </Button>
        </div>
      )}
    </section>
  );
}
