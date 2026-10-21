import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Field, useCheckedForm, HistoryStatus } from "../admin-sources/FormUI";
import {
  useAdminMutation,
  useAdminReadError,
  ambiguous,
} from "../admin-sources/data";
import { TextField } from "../admin-network/Fields";
import { uuid } from "../admin-sources/model";
import { z } from "zod";
import { evidenceOptions, refreshPrices } from "./data";
import {
  PriceSummary,
  EvidenceHelper,
  CommercialFeedback,
} from "./CreateForms";
import {
  safePrice,
  safeEvidence,
  closeFields,
  instant,
  type SafePrice,
  type ListingContext,
  type Schemas,
} from "./model";
export function PriceEvidence({
  price,
  ready,
}: {
  price: SafePrice;
  ready: boolean;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    options = evidenceOptions(scope, price.id),
    q = useInfiniteQuery(options),
    form = useCheckedForm(z.object({ observationId: uuid }), {
      observationId: "",
    });
  const rows = q.data?.pages.flat() ?? [];
  const [message, setMessage] = useState("");
  useAdminReadError(q.error);
  const refresh = async () => {
    await cache.resetQueries({ queryKey: options.queryKey, exact: true });
  };
  const mutation = useAdminMutation<Schemas["PriceEvidence"], void>(
    "price-evidence",
    async (body, signal) => {
      await api.POST("/api/v1/admin/material-prices/{id}/sources", {
        signal,
        params: { path: { id: price.id } },
        body,
      });
    },
    async (_v, _body, current) => {
      await refresh();
      if (current()) {
        setMessage(
          "Supporting Observation appended. Price version is unchanged.",
        );
        form.reset({ observationId: "" });
      }
    },
    async (e, body, current) => {
      if (ambiguous(e)) {
        await refresh();
        if (current()) {
          const currentRows =
            cache
              .getQueryData<NonNullable<typeof q.data>>(options.queryKey)
              ?.pages.flat() ?? [];
          setMessage(
            currentRows.some(
              (r) =>
                safeEvidence(r) &&
                r.observationId!.toLowerCase() ===
                  body.observationId.toLowerCase(),
            )
              ? "This supporting Observation association is visible; no automatic append retry was sent."
              : "The evidence outcome is still unknown in this bounded view.",
          );
        }
      }
    },
  );
  return (
    <section className="admin-panel" aria-label="Selected Price evidence">
      <h3>Selected Price evidence</h3>
      <p>
        Provider reference: {price.dataSourceId}. Evidence is append-only and
        consumes no Price version.
      </p>
      <HistoryStatus
        query={q}
        count={rows.length}
        noun="supporting observations"
        empty="No supporting observations returned in this bounded view."
      />
      <ul className="read-list">
        {rows.map((r, i) => (
          <li key={safeEvidence(r) ? r.observationId : `unsupported-${i}`}>
            {safeEvidence(r) ? (
              <>
                <p>Observation reference: {r.observationId}</p>
                <p>Associated at: {r.createdAt}</p>
              </>
            ) : (
              <p>Citation data is unavailable in a supported format.</p>
            )}
          </li>
        ))}
      </ul>
      <EvidenceHelper />
      <form
        className="admin-form"
        noValidate
        onSubmit={form.submit((v) => {
          if (ready) mutation.mutate(v);
        })}
      >
        <fieldset disabled={!ready || mutation.isPending}>
          <legend>Append supporting Observation</legend>
          <TextField
            form={form}
            name="observationId"
            label="Additional Price Observation UUID"
          />
        </fieldset>
        <Button type="submit" disabled={!ready || mutation.isPending}>
          Append Price evidence
        </Button>
        <Button
          className="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            form.reset();
            mutation.reset();
            setMessage("");
          }}
        >
          Reset evidence draft
        </Button>
      </form>
      <CommercialFeedback
        error={mutation.error}
        noun="Price evidence"
        success={message}
        conflictTitle="The supporting Observation conflicts with this Price's provider or current integrity constraints."
      />
      {ambiguous(mutation.error) && <p role="status">{message}</p>}
    </section>
  );
}
export function PriceClose({
  initial,
  listing,
  ready,
  update,
}: {
  initial: SafePrice;
  listing: ListingContext;
  ready: boolean;
  update: (p: SafePrice) => void;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    [baseline, setBaseline] = useState(initial),
    [server, setServer] = useState<SafePrice>(),
    [reconciled, setReconciled] = useState(false),
    [message, setMessage] = useState("");
  const form = useCheckedForm(closeFields(baseline.validFrom), { validTo: "" }),
    [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const inspect = async (
    intended: string,
    current: () => boolean = () => true,
  ) => {
    const rows = await refreshPrices(cache, scope, listing.id);
    if (!current()) return;
    const raw = rows?.find((v) => v.id === initial.id),
      p = raw && safePrice(raw, listing);
    setServer(p);
    setReconciled(false);
    setMessage(
      !p
        ? "The close outcome is unresolved in this bounded history view."
        : p.validTo != null
          ? instant(p.validTo) === instant(intended)
            ? "The Price is already closed at the requested time."
            : `The Price has a different actual closure: ${p.validTo}.`
          : "The refreshed Price remains open. Explicitly confirm its server version before retrying.",
    );
  };
  const mutation = useAdminMutation<
    Schemas["PriceCloseInput"],
    Schemas["PriceView"]
  >(
    "price-close",
    async (body, signal) => {
      const r = await api.POST("/api/v1/admin/material-prices/{id}/close", {
        signal,
        params: { path: { id: baseline.id } },
        body,
      });
      return requireData(r.data, r.response);
    },
    async (v, _body, current) => {
      const p = safePrice(v, listing);
      if (current()) {
        setConfirmed(false);
        if (p && p.id === baseline.id && p.validTo != null) {
          update(p);
          setMessage(
            "Price closed. Values remain immutable; reopening and a second close are not supported.",
          );
        } else
          setMessage(
            "Success response received but closure state is unsafe. Inspect refreshed history.",
          );
      }
      await refreshPrices(cache, scope, listing.id);
    },
    async (e, body, current) => {
      if (
        ambiguous(e) ||
        (e instanceof ApiError && [404, 409].includes(e.status))
      )
        await inspect(body.validTo, current);
    },
  );
  const blockedRecovery = attempted && !reconciled;
  if (initial.validTo != null)
    return (
      <section className="notice" aria-label="Closed Price">
        <h3>Closed Price</h3>
        <p>
          Actual valid to: {initial.validTo}. No reopen, edit or second close is
          supported.
        </p>
      </section>
    );
  if (initial.validTo === undefined)
    return (
      <p role="alert">
        Close unavailable: whether this Price is open is not safely known.
      </p>
    );
  return (
    <section className="admin-panel" aria-label="One-time Price close">
      <h3>One-time Price close</h3>
      <form
        className="admin-form"
        noValidate
        onSubmit={form.submit((v) => {
          if (ready && confirmed && !blockedRecovery) {
            setAttempted(true);
            setReconciled(false);
            mutation.mutate({ validTo: v.validTo, version: baseline.version });
          }
        })}
      >
        <fieldset disabled={!ready || mutation.isPending}>
          <legend>Irreversible closure</legend>
          <TextField
            form={form}
            name="validTo"
            label="Close Price valid to (UTC)"
          />
          <Field name="confirmClose" label="Confirm irreversible Price closure">
            {(p) => (
              <input
                type="checkbox"
                {...p}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            )}
          </Field>
          <p>
            This sets validTo once. Price values remain immutable; it cannot be
            reopened or closed a second time. Current Price version:{" "}
            {baseline.version}.
          </p>
        </fieldset>
        <Button
          type="submit"
          disabled={
            !ready || !confirmed || blockedRecovery || mutation.isPending
          }
        >
          Close Price
        </Button>
        <Button
          className="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            form.reset();
            setConfirmed(false);
          }}
        >
          Reset close draft
        </Button>
      </form>
      <CommercialFeedback
        error={mutation.error}
        noun="Price close"
        success={message}
        conflictTitle="The Price changed or is already closed."
      />
      {attempted && (
        <>
          {mutation.error && <p role="status">{message}</p>}
          <Button
            className="secondary"
            disabled={mutation.isPending}
            onClick={() => void inspect(form.getValues("validTo"))}
          >
            Refresh Price closure
          </Button>
        </>
      )}
      {server && (
        <section className="notice" aria-label="Refreshed server Price">
          <h4>Refreshed server Price</h4>
          <PriceSummary price={server} />
          {server.validTo === null && !reconciled && (
            <Button
              onClick={() => {
                setBaseline(server);
                setReconciled(true);
                setConfirmed(false);
              }}
            >
              Confirm refreshed open Price for explicit retry
            </Button>
          )}
        </section>
      )}
    </section>
  );
}
