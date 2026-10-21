import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { SupplierPicker, SupplierLabel } from "../materials/SupplierPicker";
import { facilityTypes } from "../network/filters";
import { useCheckedForm } from "../admin-sources/FormUI";
import { ambiguous, useAdminMutation } from "../admin-sources/data";
import {
  CountryField,
  GeographyField,
  TextField,
  SelectField,
  EvidenceField,
  ServerComparison,
  CommandFeedback,
} from "./Fields";
import {
  facilityFields,
  facilityDefaults,
  facilityBaseline,
  facilityBody,
  statuses,
  type FacilityFields,
  type FacilityBaseline,
} from "./model";
import { refreshFacility, invalidateFacility } from "./data";

export function FacilityForm({
  initial,
  fixedParent,
  close,
}: {
  initial?: FacilityBaseline;
  fixedParent?: { id: string; name: string };
  close: () => void;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [baseline, setBaseline] = useState(initial),
    [latest, setLatest] = useState<FacilityBaseline>(),
    [blocked, block] = useState(false),
    [notice, setNotice] = useState(""),
    [discard, setDiscard] = useState(false);
  const editing = !!initial,
    form = useCheckedForm(
      facilityFields,
      initial?.fields ?? {
        ...facilityDefaults,
        supplierId: fixedParent?.id ?? "",
      },
    ),
    parent = initial?.fields.supplierId ?? fixedParent?.id;
  useEffect(() => {
    form.setFocus("name");
  }, []);
  async function compare(current: () => boolean = () => true) {
    if (!initial) {
      await invalidateFacility(cache, scope, form.getValues("supplierId"));
      return;
    }
    const fresh = await refreshFacility(cache, scope, initial.id);
    if (current()) setLatest(fresh);
  }
  const mutation = useAdminMutation(
    "facility-profile",
    async (v: FacilityFields, signal) => {
      const body = facilityBody(
        v,
        editing ? baseline!.version : 0,
        parent ?? v.supplierId,
      );
      const r = editing
        ? await api.PUT("/api/v1/admin/facilities/{id}", {
            signal,
            params: { path: { id: initial!.id } },
            body,
          })
        : await api.POST("/api/v1/admin/facilities", { signal, body });
      const view = requireData(r.data, r.response),
        safe = facilityBaseline(view);
      if (
        !safe ||
        (editing && safe.id !== initial!.id) ||
        safe.fields.supplierId !== body.supplierId
      )
        throw new ApiError(502);
      return safe;
    },
    async (saved, _v, current) => {
      await invalidateFacility(cache, scope, saved.fields.supplierId);
      if (!current()) return;
      if (!editing) {
        navigate(`/admin/facilities/${saved.id}`);
        return;
      }
      const fresh = await refreshFacility(cache, scope, saved.id);
      if (!current()) return;
      block(!fresh);
      setLatest(undefined);
      if (fresh) {
        setBaseline(fresh);
        form.reset(fresh.fields);
        setNotice(
          "Facility updated. The server profile version was refreshed.",
        );
      } else
        setNotice(
          "Update confirmed; reload a safe Facility baseline before another profile write.",
        );
    },
    async (error, _v, current) => {
      if (
        editing &&
        ((error instanceof ApiError && error.status === 409) ||
          ambiguous(error))
      ) {
        block(true);
        await compare(current);
      }
    },
  );
  return (
    <section
      className="admin-panel"
      aria-label={editing ? "Edit Facility form" : "Create Facility form"}
    >
      <h2>{editing ? "Edit Facility" : "Create Facility"}</h2>
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          if (!blocked) {
            setNotice("");
            mutation.mutate(v);
          }
        })}
      >
        <fieldset
          disabled={mutation.isPending || blocked}
          className="admin-fields"
        >
          {parent ? (
            <div className="evidence-field">
              <p>
                Parent Supplier — read-only
                {editing
                  ? "; immutable after creation"
                  : "; fixed by Supplier context"}
              </p>
              <p className="admin-wrap">
                {fixedParent?.name ?? <SupplierLabel id={parent} />}
              </p>
              <p className="record-reference">Supplier reference: {parent}</p>
            </div>
          ) : (
            <div className="evidence-field">
              <SupplierPicker
                label="Parent Supplier"
                value={form.watch("supplierId")}
                onChange={(id) =>
                  form.setValue("supplierId", id, { shouldDirty: true })
                }
              />
              {form.formState.errors.supplierId && (
                <p role="alert" className="field-error">
                  Select a parent Supplier by name.
                </p>
              )}
            </div>
          )}
          <TextField form={form} name="name" label="Facility name" />
          <SelectField
            form={form}
            name="facilityType"
            label="Facility type"
            values={facilityTypes}
          />
          <CountryField
            form={form}
            onChange={() => {
              form.setValue("regionId", "", { shouldDirty: true });
              form.setValue("industrialClusterId", "", { shouldDirty: true });
              setNotice(
                "Country changed. Region and Industrial Cluster were cleared; select compatible geography again.",
              );
            }}
          />
          <SelectField
            form={form}
            name="status"
            label="Facility lifecycle"
            values={statuses}
          />
          <GeographyField
            form={form}
            kind="regions"
            country={form.watch("countryId")}
          />
          <GeographyField
            form={form}
            kind="industrial-clusters"
            country={form.watch("countryId")}
          />
          <TextField
            form={form}
            name="addressLine1"
            label="Address line 1 (optional)"
          />
          <TextField
            form={form}
            name="addressLine2"
            label="Address line 2 (optional)"
          />
          <TextField
            form={form}
            name="postalCode"
            label="Postal code (optional)"
          />
          <TextField form={form} name="phone" label="Phone (optional)" />
          <TextField form={form} name="email" label="Email (optional)" />
          <TextField form={form} name="latitude" label="Latitude (optional)" />
          <TextField
            form={form}
            name="longitude"
            label="Longitude (optional)"
          />
          <p className="filter-help">
            Coordinates must be both absent or both present. Use plain decimal
            strings with at most six fractional digits; zero is a known
            coordinate.
          </p>
          <EvidenceField form={form} />
          {editing && (
            <p className="record-reference">
              Loaded Facility profile version:{" "}
              {baseline?.version ?? "Unavailable"}. Capability assignment
              versions are independent.
            </p>
          )}
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending
                ? "Saving Facility…"
                : editing
                  ? "Save Facility"
                  : "Create Facility"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(
                  baseline?.fields ?? {
                    ...facilityDefaults,
                    supplierId: fixedParent?.id ?? "",
                  },
                );
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Facility draft
            </Button>
          </div>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={notice}
        noun={editing ? "Facility update" : "Facility creation"}
        conflict="The Facility changed or conflicts with the current server state."
        refresh={() => void compare()}
      />
      {blocked && (
        <>
          <p className="notice">
            A safe server refresh and explicit reconciliation are required
            before another write.
          </p>
          {latest ? (
            <ServerComparison
              title="Current Facility server state"
              values={[
                ["Name", latest.fields.name],
                ["Parent Supplier reference", latest.fields.supplierId],
                ["Facility type", latest.fields.facilityType],
                ["Country reference", latest.fields.countryId],
                ["Region", latest.fields.regionId],
                ["Industrial Cluster", latest.fields.industrialClusterId],
                ["Address line 1", latest.fields.addressLine1],
                ["Address line 2", latest.fields.addressLine2],
                ["Postal code", latest.fields.postalCode],
                ["Latitude", latest.fields.latitude],
                ["Longitude", latest.fields.longitude],
                ["Phone", latest.fields.phone],
                ["Email", latest.fields.email],
                ["Lifecycle", latest.fields.status],
                ["Profile version", latest.version],
              ]}
              label="Use refreshed Facility version, keep draft"
              adopt={() => {
                if (latest.fields.supplierId !== parent) return;
                setBaseline(latest);
                block(false);
                mutation.reset();
                setNotice(
                  "Server version adopted. Draft retained; review before explicitly saving.",
                );
              }}
            />
          ) : (
            <Button className="secondary" onClick={() => void compare()}>
              Reload Facility server state
            </Button>
          )}
        </>
      )}
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => (form.formState.isDirty ? setDiscard(true) : close())}
      >
        Cancel Facility form
      </Button>
      {discard && (
        <div className="notice" role="alert">
          <p>Discard this Facility draft?</p>
          <Button onClick={close}>Discard Facility draft</Button>
          <Button className="secondary" onClick={() => setDiscard(false)}>
            Keep Facility draft
          </Button>
        </div>
      )}
    </section>
  );
}
