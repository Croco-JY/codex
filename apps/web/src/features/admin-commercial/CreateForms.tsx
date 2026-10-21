import { useState, type ComponentProps } from "react";
import { useFieldArray } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import {
  Field,
  useCheckedForm,
  MutationFeedback,
} from "../admin-sources/FormUI";
import { ambiguous, useAdminMutation } from "../admin-sources/data";
import { TextField, SelectField } from "../admin-network/Fields";
import { Facts } from "../commercial/ReadUI";
import { ProviderField, VariantField, FacilityField } from "./Fields";
import { refreshPrices, refreshInventory } from "./data";
import {
  priceDefaults,
  priceFields,
  priceBody,
  inventoryDefaults,
  inventoryFields,
  inventoryBody,
  freezePrice,
  freezeInventory,
  safePrice,
  matchesPrice,
  matchesInventory,
  units,
  type ListingContext,
  type PriceCommand,
  type InventoryCommand,
  type SafePrice,
  type Schemas,
} from "./model";
export function EvidenceHelper() {
  return (
    <p>
      All supporting Observations must originate from the selected provider
      Source. UUID validation does not prove provider identity; the server
      enforces it. No ACCEPTED Review is required.{" "}
      <a href="/admin/sources" target="_blank" rel="noopener noreferrer">
        Open Sources &amp; Evidence
      </a>{" "}
      in another tab to keep this draft.
    </p>
  );
}
export function PriceSummary({ price }: { price: SafePrice }) {
  return (
    <Facts
      values={[
        ["Price reference", price.id],
        ["Amount", `${price.amount} ${price.currency} / ${price.priceUnit}`],
        ["Variant", price.materialVariantId ?? "Material-level"],
        ["Tier MOQ", price.minimumOrderQuantity ?? "No tier MOQ recorded"],
        ["Provider reference", price.dataSourceId],
        ["Valid from", price.validFrom],
        [
          "Recorded valid to",
          price.validTo === undefined
            ? "Validity end unavailable"
            : price.validTo === null
              ? "Open · no end recorded"
              : price.validTo,
        ],
        ["Observed at", price.observedAt],
        ["Price version", price.version],
      ]}
    />
  );
}
export function PriceCreate({
  listing,
  ready,
  select,
}: {
  listing: ListingContext;
  ready: boolean;
  select: (p: SafePrice) => void;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    form = useCheckedForm(priceFields, priceDefaults);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [sent, setSent] = useState<PriceCommand>(),
    [result, setResult] = useState<SafePrice>(),
    [message, setMessage] = useState("");
  const rows = useFieldArray({ control: form.control, name: "observations" });
  const inspect = async (current: () => boolean = () => true) => {
    const history = await refreshPrices(cache, scope, listing.id, true);
    if (!current()) return;
    const raw = history?.find((p) => p.id === (sent?.key ?? key));
    const p = raw && safePrice(raw, listing);
    setResult(p);
    setMessage(
      p
        ? "A Price with this command reference is visible. Inspect its actual validity; a retry does not change validTo."
        : "The creation outcome is still unknown in this bounded history view.",
    );
  };
  const mutation = useAdminMutation<PriceCommand, Schemas["PriceView"]>(
    "price-create",
    async (c, signal) => {
      const r = await api.POST("/api/v1/admin/material-prices", {
        signal,
        params: { header: { "Idempotency-Key": c.key } },
        body: c.body,
      });
      return requireData(r.data, r.response);
    },
    async (v, c, current) => {
      const p = safePrice(v, listing);
      if (current()) {
        setResult(p);
        setMessage(
          p && matchesPrice(p, c)
            ? "Price fact confirmed. This does not imply it is the effective or cheapest Price."
            : "A success response was received, but Price state is unsafe or incompatible. Retain the command reference and inspect refreshed history.",
        );
      }
      await refreshPrices(cache, scope, listing.id, true);
    },
    async (e, _c, current) => {
      if (ambiguous(e)) await inspect(current);
    },
  );
  const newIntention = () => {
    mutation.reset();
    setKey(crypto.randomUUID());
    setSent(undefined);
    setResult(undefined);
    setMessage("");
    form.reset(priceDefaults);
  };
  return (
    <section className="admin-panel" aria-label="Manual Price creation">
      <h2>Manual Price creation</h2>
      <p>
        Listing reference: {listing.id}. A Price is an immutable provider-scoped
        fact; overlapping facts may coexist.
      </p>
      <form
        className="admin-form"
        noValidate
        onSubmit={form.submit((v) => {
          if (sent || !ready) return;
          const c = freezePrice(key, priceBody(listing, v));
          setSent(c);
          mutation.mutate(c);
        })}
      >
        <fieldset disabled={!!sent || mutation.isPending || !ready}>
          <legend>Price fact draft</legend>
          <div className="admin-fields">
            <VariantField form={form} listing={listing} />
            <ProviderField form={form} />
            <TextField form={form} name="amount" label="Price amount" />
            <Field
              name="currency"
              label="Commercial currency"
              error={form.formState.errors.currency?.message}
            >
              {(p) => (
                <input
                  className="input"
                  {...p}
                  {...form.register("currency", {
                    onChange: (e) =>
                      form.setValue(
                        "currency",
                        e.target.value.trim().toUpperCase(),
                        { shouldDirty: true },
                      ),
                  })}
                />
              )}
            </Field>
            <SelectField
              form={form}
              name="priceUnit"
              label="Fact price unit"
              values={units}
              optional
            />
            <TextField
              form={form}
              name="minimumOrderQuantity"
              label="Price tier MOQ (optional)"
            />
            <TextField
              form={form}
              name="validFrom"
              label="Price valid from (UTC)"
            />
            <TextField
              form={form}
              name="validTo"
              label="Price valid to (UTC, optional)"
            />
            <TextField
              form={form}
              name="observedAt"
              label="Price observed at (UTC)"
            />
          </div>
          <p>
            Use UTC ending in Z, up to six fractional second digits. A recorded
            validTo creates an already closed historical fact.
          </p>
          <EvidenceHelper />
          <fieldset>
            <legend>Supporting Observation rows</legend>
            {form.formState.errors.observations?.message && (
              <p role="alert">{form.formState.errors.observations.message}</p>
            )}
            {rows.fields.map((r, i) => (
              <div key={r.id} className="evidence-field">
                <TextField
                  form={form}
                  name={`observations.${i}.observationId`}
                  label={`Price Observation UUID ${i + 1}`}
                />
                <Button className="secondary" onClick={() => rows.remove(i)}>
                  Remove Price Observation {i + 1}
                </Button>
              </div>
            ))}
            <Button
              className="secondary"
              disabled={rows.fields.length >= 100}
              onClick={() => rows.append({ observationId: "" })}
            >
              Add supporting Observation
            </Button>
          </fieldset>
        </fieldset>
        <p className="record-reference">Price command reference: {key}</p>
        <Button type="submit" disabled={!!sent || mutation.isPending || !ready}>
          Create manual Price
        </Button>
        <Button
          className="secondary"
          disabled={mutation.isPending}
          onClick={newIntention}
        >
          {sent ? "Start a new Price intention" : "Reset Price draft"}
        </Button>
      </form>
      <CommercialFeedback
        error={mutation.error}
        noun="Price creation"
        success={message}
        conflictTitle="The Price intention conflicts with an existing Price fact or its evidence/reference constraints."
      />
      {ambiguous(mutation.error) && <p role="status">{message}</p>}
      {sent && mutation.isError && (
        <div className="scope-actions">
          <p>
            Fact fields are locked. Retrying resends the exact original body and
            key, including validTo and evidence. Same-key creation is never an
            edit.
          </p>
          <Button
            disabled={mutation.isPending || !ready}
            onClick={() => mutation.mutate(sent)}
          >
            Retry same Price intention
          </Button>
          <Button
            className="secondary"
            disabled={mutation.isPending}
            onClick={() => void inspect()}
          >
            Refresh Price outcome
          </Button>
        </div>
      )}
      {result && (
        <section className="notice" aria-label="Actual Price command result">
          <h3>Actual server Price</h3>
          <PriceSummary price={result} />
          {sent && matchesPrice(result, sent) && (
            <Button className="secondary" onClick={() => select(result)}>
              Manage this Price
            </Button>
          )}
        </section>
      )}
    </section>
  );
}
export function InventoryCreate({
  listing,
  ready,
}: {
  listing: ListingContext;
  ready: boolean;
}) {
  const { scope, identity } = useSession(),
    cache = useQueryClient(),
    form = useCheckedForm(inventoryFields, inventoryDefaults);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [sent, setSent] = useState<InventoryCommand>(),
    [message, setMessage] = useState("");
  const inspect = async (
    c: InventoryCommand,
    current: () => boolean = () => true,
  ) => {
    const rows = await refreshInventory(cache, scope, listing.id);
    if (!current()) return;
    const row = rows?.find((v) => v.manualIdempotencyKey === c.key);
    setMessage(
      !row
        ? "The creation outcome is still unknown in this bounded history view."
        : matchesInventory(row, listing, c)
          ? `The manual Snapshot exists: ${row.id}. Quantity ${row.quantity} ${row.unit}.`
          : "A Snapshot with this key is visible, but its Actor or fact context conflicts with the command.",
    );
  };
  const mutation = useAdminMutation<InventoryCommand, Schemas["InventoryView"]>(
    "inventory-create",
    async (c, signal) => {
      const r = await api.POST("/api/v1/admin/material-inventory-snapshots", {
        signal,
        body: c.body,
      });
      return requireData(r.data, r.response);
    },
    async (v, c, current) => {
      if (current())
        setMessage(
          matchesInventory(v, listing, c)
            ? `Manual Snapshot confirmed: ${v.id}. ${v.quantity} ${v.unit}${/^0(?:\.0+)?$/.test(v.quantity ?? "") ? " · known zero quantity" : ""}.`
            : "A success response was received but Snapshot state cannot be safely confirmed. Retain the command reference and inspect history.",
        );
      await refreshInventory(cache, scope, listing.id);
    },
    async (e, c, current) => {
      if (ambiguous(e)) await inspect(c, current);
    },
  );
  const newIntention = () => {
    mutation.reset();
    setKey(crypto.randomUUID());
    setSent(undefined);
    setMessage("");
    form.reset(inventoryDefaults);
  };
  return (
    <section className="admin-panel" aria-label="Manual Inventory observation">
      <h2>Manual Inventory observation</h2>
      <p>
        Capture mode: MANUAL. Record a new observation; existing Snapshots
        cannot be edited or deleted. Zero means known zero, not unknown.
      </p>
      <form
        className="admin-form"
        noValidate
        onSubmit={form.submit((v) => {
          if (sent || !ready || !identity) return;
          const c = freezeInventory(inventoryBody(listing, v, key), identity);
          setSent(c);
          mutation.mutate(c);
        })}
      >
        <fieldset disabled={!!sent || mutation.isPending || !ready}>
          <legend>Inventory observation draft</legend>
          <div className="admin-fields">
            <VariantField form={form} listing={listing} />
            <FacilityField form={form} />
            <TextField
              form={form}
              name="quantity"
              label="Manual Inventory quantity"
            />
            <SelectField
              form={form}
              name="unit"
              label="Observation quantity unit"
              values={units}
              optional
            />
            <TextField
              form={form}
              name="observedAt"
              label="Inventory observed at (UTC)"
            />
          </div>
        </fieldset>
        <p className="record-reference">Inventory command reference: {key}</p>
        <Button type="submit" disabled={!!sent || mutation.isPending || !ready}>
          Record manual observation
        </Button>
        <Button
          className="secondary"
          disabled={mutation.isPending}
          onClick={newIntention}
        >
          {sent ? "Record a new observation" : "Reset Inventory draft"}
        </Button>
      </form>
      <CommercialFeedback
        error={mutation.error}
        noun="Inventory recording"
        success={message}
        conflictTitle="This Inventory command key conflicts with an existing Snapshot, Actor, or submitted fact context."
      />
      {ambiguous(mutation.error) && <p role="status">{message}</p>}
      {sent && mutation.isError && (
        <div className="scope-actions">
          <p>
            Fact fields are locked; a retry uses the exact original body and
            manual key. Corrections require a new observation/key.
          </p>
          <Button
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate(sent)}
          >
            Retry same Inventory intention
          </Button>
          <Button
            className="secondary"
            disabled={mutation.isPending}
            onClick={() => void inspect(sent)}
          >
            Refresh Inventory outcome
          </Button>
        </div>
      )}
    </section>
  );
}

/** Commercial recovery uses Listing history; the Source workspace's list is not a command-outcome lookup. */
export function CommercialFeedback(
  props: ComponentProps<typeof MutationFeedback>,
) {
  if (ambiguous(props.error))
    return (
      <div className="notice" role="alert">
        <h3>{props.noun} outcome unknown</h3>
        <p>
          The connection ended before confirmation. Your draft is preserved.
          Inspect refreshed history and server state before explicitly
          resubmitting. A bounded view cannot prove that the command failed. No
          automatic retry occurs.
        </p>
      </div>
    );
  return <MutationFeedback {...props} />;
}
