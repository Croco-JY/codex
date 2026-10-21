import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { roles } from "../network/filters";
import { useCheckedForm } from "../admin-sources/FormUI";
import { ambiguous, useAdminMutation } from "../admin-sources/data";
import {
  CountryField,
  TextField,
  SelectField,
  EvidenceField,
  ServerComparison,
  CommandFeedback,
} from "./Fields";
import {
  supplierFields,
  supplierDefaults,
  supplierBaseline,
  supplierBody,
  statuses,
  type SupplierFields,
  type SupplierBaseline,
} from "./model";
import { refreshSupplier, invalidateSupplier } from "./data";

export function SupplierForm({
  initial,
  close,
  dirty,
}: {
  initial?: SupplierBaseline;
  close: () => void;
  dirty?: (v: boolean) => void;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [baseline, setBaseline] = useState(initial),
    [latest, setLatest] = useState<SupplierBaseline>(),
    [blocked, block] = useState(false),
    [notice, setNotice] = useState(""),
    [discard, setDiscard] = useState(false);
  const editing = !!initial,
    form = useCheckedForm(supplierFields, initial?.fields ?? supplierDefaults);
  useEffect(() => {
    form.setFocus("displayName");
  }, []);
  useEffect(() => {
    dirty?.(form.formState.isDirty);
  }, [form.formState.isDirty, dirty]);
  async function compare(current: () => boolean = () => true) {
    if (!initial) {
      await invalidateSupplier(cache, scope);
      return;
    }
    const result = await refreshSupplier(cache, scope, initial.id);
    if (current()) setLatest(result);
  }
  const mutation = useAdminMutation(
    "supplier-profile",
    async (v: SupplierFields, signal) => {
      const body = supplierBody(v, editing ? baseline!.version : 0);
      const r = editing
        ? await api.PUT("/api/v1/admin/suppliers/{id}", {
            signal,
            params: { path: { id: initial!.id } },
            body,
          })
        : await api.POST("/api/v1/admin/suppliers", { signal, body });
      const view = requireData(r.data, r.response),
        safe = supplierBaseline(view);
      if (!safe || (editing && safe.id !== initial!.id))
        throw new ApiError(502);
      return safe;
    },
    async (saved, _v, current) => {
      await invalidateSupplier(cache, scope);
      if (!current()) return;
      if (!editing) {
        navigate(`/admin/suppliers/${saved.id}`);
        return;
      }
      const fresh = await refreshSupplier(cache, scope, saved.id);
      if (!current()) return;
      block(!fresh);
      setLatest(undefined);
      if (fresh) {
        setBaseline(fresh);
        form.reset(fresh.fields);
        setNotice(
          "Supplier updated. The server version was refetched before another versioned command.",
        );
      } else
        setNotice(
          "Update confirmed; a safe refreshed Supplier is unavailable. Reload server state before another command.",
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
      aria-label={editing ? "Edit Supplier form" : "Create Supplier form"}
    >
      <h2>{editing ? "Edit Supplier" : "Create Supplier"}</h2>
      {!editing && (
        <p>
          New Suppliers begin at DISCOVERED verification status. Verification
          can be adjusted after creation.
        </p>
      )}
      {editing && (
        <p className="record-reference">
          Loaded Supplier version: {baseline?.version ?? "Unavailable"}.
          Profile, Alias and Verification commands share this parent version.
        </p>
      )}
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
          className="admin-fields"
          disabled={mutation.isPending || blocked}
        >
          <TextField form={form} name="displayName" label="Display name" />
          <CountryField form={form} />
          <TextField
            form={form}
            name="legalName"
            label="Legal name (optional)"
          />
          <TextField
            form={form}
            name="nativeName"
            label="Native name (optional)"
          />
          <TextField
            form={form}
            name="englishName"
            label="English name (optional)"
          />
          <TextField
            form={form}
            name="businessRegistrationNumber"
            label="Business registration number (optional)"
          />
          <TextField
            form={form}
            name="websiteUrl"
            label="Website URL (optional)"
          />
          <SelectField
            form={form}
            name="status"
            label="Supplier lifecycle"
            values={statuses}
          />
          <fieldset className="role-choices">
            <legend>Supplier roles — multiple or none</legend>
            {roles.map((role) => (
              <label key={role} className="checkbox-field">
                <input
                  type="checkbox"
                  value={role}
                  {...form.register("roles")}
                />
                {role.replaceAll("_", " ")}
              </label>
            ))}
          </fieldset>
          <TextField
            form={form}
            name="description"
            label="Description (optional)"
            multiline
          />
          <EvidenceField form={form} />
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending
                ? "Saving Supplier…"
                : editing
                  ? "Save Supplier"
                  : "Create Supplier"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(baseline?.fields ?? supplierDefaults);
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Supplier draft
            </Button>
          </div>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={notice}
        noun={editing ? "Supplier update" : "Supplier creation"}
        conflict="The Supplier changed or conflicts with the current server state."
        refresh={() => void compare()}
      />
      {blocked && (
        <>
          <p className="notice">
            A server refresh and explicit reconciliation are required before
            another write.
          </p>
          {latest ? (
            <ServerComparison
              title="Current Supplier server state"
              values={[
                ["Display name", latest.fields.displayName],
                ["Country reference", latest.fields.countryId],
                ["Lifecycle", latest.fields.status],
                [
                  "Roles",
                  latest.fields.roles.join(", ") || "No roles recorded",
                ],
                ["Verification", latest.verificationStatus],
                ["Version", latest.version],
                ["Legal name", latest.fields.legalName],
                ["Native name", latest.fields.nativeName],
                ["English name", latest.fields.englishName],
                [
                  "Business registration",
                  latest.fields.businessRegistrationNumber,
                ],
                ["Website", latest.fields.websiteUrl],
                ["Description", latest.fields.description],
              ]}
              label="Use refreshed Supplier version, keep draft"
              adopt={() => {
                setBaseline(latest);
                block(false);
                mutation.reset();
                setNotice(
                  "Server version adopted. Draft preserved; review it before explicitly saving.",
                );
              }}
            />
          ) : (
            <Button className="secondary" onClick={() => void compare()}>
              Reload Supplier server state
            </Button>
          )}
        </>
      )}
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => (form.formState.isDirty ? setDiscard(true) : close())}
      >
        Cancel Supplier form
      </Button>
      {discard && (
        <div className="notice" role="alert">
          <p>Discard this Supplier draft?</p>
          <Button onClick={close}>Discard Supplier draft</Button>
          <Button className="secondary" onClick={() => setDiscard(false)}>
            Keep Supplier draft
          </Button>
        </div>
      )}
    </section>
  );
}
