import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Button, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts } from "../commercial/ReadUI";
import { useCheckedForm } from "../admin-sources/FormUI";
import { ambiguous, useAdminMutation } from "../admin-sources/data";
import {
  EvidenceField,
  TextField,
  SelectField,
  CommandFeedback,
  ServerComparison,
} from "./Fields";
import {
  aliasFields,
  aliasBody,
  aliasTypes,
  verificationFields,
  manualVerification,
  type AliasFields,
  type VerificationFields,
  type SupplierBaseline,
} from "./model";
import {
  aliasOptions,
  verificationOptions,
  refreshSupplier,
  invalidateSupplier,
} from "./data";

function useSupplierCommand(
  initial: SupplierBaseline,
  kind: "alias" | "verification",
) {
  const { scope } = useSession(),
    cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial),
    [latest, setLatest] = useState<SupplierBaseline>(),
    [blocked, block] = useState(false),
    [notice, setNotice] = useState("");
  async function refresh(current: () => boolean = () => true) {
    const fresh = await refreshSupplier(cache, scope, initial.id);
    await Promise.all([
      cache.invalidateQueries({
        queryKey:
          kind === "alias"
            ? aliasOptions(scope, initial.id).queryKey
            : verificationOptions(scope, initial.id).queryKey,
      }),
      cache.invalidateQueries({
        queryKey: queryKeys.adminCitations(scope, "suppliers", initial.id),
      }),
      invalidateSupplier(cache, scope),
    ]);
    if (current()) setLatest(fresh);
    return fresh;
  }
  async function failure(error: unknown, current: () => boolean) {
    if (
      (error instanceof ApiError && error.status === 409) ||
      ambiguous(error)
    ) {
      block(true);
      await refresh(current);
    }
  }
  const reconciliation = blocked ? (
    <>
      <p className="notice">
        The draft is retained. Refreshed state does not automatically authorize
        a retry.
      </p>
      {latest ? (
        <ServerComparison
          title="Current Supplier version and verification"
          values={[
            ["Display name", latest.fields.displayName],
            ["Verification", latest.verificationStatus],
            ["Parent Supplier version", latest.version],
          ]}
          label="Use refreshed Supplier version, keep command draft"
          adopt={() => {
            setBaseline(latest);
            block(false);
            setNotice(
              "Server baseline adopted. Review and explicitly submit the retained command.",
            );
          }}
        />
      ) : (
        <Button className="secondary" onClick={() => void refresh()}>
          Reload Supplier and command history
        </Button>
      )}
    </>
  ) : null;
  return {
    scope,
    cache,
    baseline,
    setBaseline,
    latest,
    blocked,
    block,
    notice,
    setNotice,
    refresh,
    failure,
    reconciliation,
  };
}
export function AliasForm({
  initial,
  close,
}: {
  initial: SupplierBaseline;
  close: () => void;
}) {
  const state = useSupplierCommand(initial, "alias"),
    [discard, setDiscard] = useState(false);
  const form = useCheckedForm(aliasFields, {
    alias: "",
    languageCode: "",
    aliasType: "ORIGINAL",
    observationId: "",
  } as AliasFields);
  const aliases = useQuery(aliasOptions(state.scope, initial.id));
  const mutation = useAdminMutation(
    "supplier-alias",
    async (v: AliasFields, signal) => {
      const r = await api.POST("/api/v1/admin/suppliers/{id}/aliases", {
        signal,
        params: { path: { id: initial.id } },
        body: aliasBody(v, state.baseline.version),
      });
      return requireData(r.data, r.response);
    },
    async (_id, v, current) => {
      const fresh = await state.refresh(current);
      if (!current()) return;
      state.block(!fresh);
      if (fresh) state.setBaseline(fresh);
      form.reset({ ...v, observationId: "" });
      state.setNotice(
        fresh
          ? "Alias appended. Supplier parent version and alias history refetched."
          : "Alias append confirmed. Reload a safe Supplier baseline before another versioned command.",
      );
    },
    (error, _v, current) => state.failure(error, current),
  );
  const match = ambiguous(mutation.error)
    ? aliases.data?.filter((a) => a.alias === form.getValues("alias"))
    : [];
  return (
    <section className="admin-panel" aria-label="Append Alias form">
      <h2>Append Alias</h2>
      <p className="record-reference">
        Parent Supplier version: {state.baseline.version}. Alias append advances
        this shared version.
      </p>
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          if (!state.blocked) {
            state.setNotice("");
            mutation.mutate(v);
          }
        })}
      >
        <fieldset
          className="admin-fields"
          disabled={mutation.isPending || state.blocked}
        >
          <TextField form={form} name="alias" label="Alias" />
          <SelectField
            form={form}
            name="aliasType"
            label="Alias type"
            values={aliasTypes}
          />
          <TextField
            form={form}
            name="languageCode"
            label="Language code (optional)"
          />
          <EvidenceField form={form} />
          <div className="scope-actions">
            <Button type="submit">Append Alias</Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset();
                mutation.reset();
              }}
            >
              Reset Alias draft
            </Button>
          </div>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={state.notice}
        noun="Alias append"
        conflict="The Supplier changed or conflicts with the current server state."
        refresh={() => void state.refresh()}
      />
      {!!match?.length && (
        <p className="notice" role="status">
          A visible matching alias was returned. Inspect alias history before
          another explicit append.
        </p>
      )}
      {state.reconciliation}
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => (form.formState.isDirty ? setDiscard(true) : close())}
      >
        Close Alias form
      </Button>
      {discard && (
        <div className="notice" role="alert">
          <p>Discard the Alias draft?</p>
          <Button onClick={close}>Discard Alias draft</Button>
          <Button className="secondary" onClick={() => setDiscard(false)}>
            Keep Alias draft
          </Button>
        </div>
      )}
    </section>
  );
}
export function VerificationForm({
  initial,
  close,
}: {
  initial: SupplierBaseline;
  close: () => void;
}) {
  const state = useSupplierCommand(initial, "verification"),
    [discard, setDiscard] = useState(false);
  const defaults = (status: string): VerificationFields => ({
    status: manualVerification.find((s) => s !== status)!,
    reason: "",
    observationId: "",
  });
  const form = useCheckedForm(
      verificationFields,
      defaults(initial.verificationStatus),
    ),
    events = useQuery(verificationOptions(state.scope, initial.id));
  const mutation = useAdminMutation(
    "supplier-verification",
    async (v: VerificationFields, signal) => {
      if (v.status === state.baseline.verificationStatus)
        throw new ApiError(409);
      const r = await api.POST(
        "/api/v1/admin/suppliers/{id}/verification-events",
        {
          signal,
          params: { path: { id: initial.id } },
          body: { ...v, version: state.baseline.version },
        },
      );
      return requireData(r.data, r.response);
    },
    async (_result, _v, current) => {
      const fresh = await state.refresh(current);
      if (!current()) return;
      state.block(!fresh);
      if (fresh) {
        state.setBaseline(fresh);
        form.reset(defaults(fresh.verificationStatus));
      }
      state.setNotice(
        fresh
          ? "Verification changed. Supplier parent version and verification history refetched."
          : "Verification command confirmed; reload a safe Supplier baseline before another versioned command.",
      );
    },
    (error, _v, current) => state.failure(error, current),
  );
  const visible = ambiguous(mutation.error)
    ? events.data?.filter(
        (e) =>
          e.newStatus === form.getValues("status") &&
          e.reason === form.getValues("reason") &&
          e.observationId === form.getValues("observationId"),
      )
    : [];
  return (
    <section className="admin-panel" aria-label="Manual Verification form">
      <h2>Manual verification</h2>
      <p>
        Current verification: {state.baseline.verificationStatus}. Parent
        Supplier version: {state.baseline.version}.
      </p>
      <p className="filter-help">
        Manual targets are DISCOVERED, VERIFIED and AUDITED. Transitions can
        move in either direction. Claim and transaction workflows are separate.
      </p>
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          if (!state.blocked) {
            state.setNotice("");
            mutation.mutate(v);
          }
        })}
      >
        <fieldset
          className="admin-fields"
          disabled={mutation.isPending || state.blocked}
        >
          <SelectField
            form={form}
            name="status"
            label="Manual verification target"
            values={manualVerification.filter(
              (s) => s !== state.baseline.verificationStatus,
            )}
          />
          <TextField
            form={form}
            name="reason"
            label="Verification reason"
            multiline
          />
          <EvidenceField form={form} />
          <div className="scope-actions">
            <Button type="submit">Change verification</Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(defaults(state.baseline.verificationStatus));
                mutation.reset();
              }}
            >
              Reset Verification draft
            </Button>
          </div>
        </fieldset>
      </form>
      <CommandFeedback
        error={mutation.error}
        success={state.notice}
        noun="Verification command"
        conflict="The Supplier changed or conflicts with the current server state."
        refresh={() => void state.refresh()}
      />
      {!!visible?.length && (
        <p className="notice" role="status">
          A visible matching verification event was returned. Compare it before
          another explicit command.
        </p>
      )}
      {state.reconciliation}
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => (form.formState.isDirty ? setDiscard(true) : close())}
      >
        Close Verification form
      </Button>
      {discard && (
        <div className="notice" role="alert">
          <p>Discard the Verification draft?</p>
          <Button onClick={close}>Discard Verification draft</Button>
          <Button className="secondary" onClick={() => setDiscard(false)}>
            Keep Verification draft
          </Button>
        </div>
      )}
    </section>
  );
}
export function SupplierHistories({ id }: { id: string }) {
  const { scope } = useSession(),
    aliases = useQuery(aliasOptions(scope, id)),
    events = useQuery(verificationOptions(scope, id));
  return (
    <>
      <Surface>
        <h2>Aliases</h2>
        {aliases.isPending ? (
          <p role="status">Loading aliases…</p>
        ) : aliases.error ? (
          <ApiErrorState
            error={aliases.error}
            retry={() => void aliases.refetch()}
          />
        ) : (
          <>
            <ul className="read-list">
              {aliases.data?.map((a, i) => (
                <li key={a.id ?? i}>
                  <h3>{a.alias ?? "Alias unavailable"}</h3>
                  <Facts
                    values={[
                      ["Alias type", a.aliasType],
                      ["Language code", a.languageCode],
                    ]}
                  />
                </li>
              ))}
            </ul>
            {aliases.data?.length === 0 && (
              <p>No aliases recorded for this Supplier.</p>
            )}
            {aliases.data?.length === 100 && (
              <p>
                Up to 100 recorded aliases; additional aliases are not exposed
                by this read.
              </p>
            )}
          </>
        )}
      </Surface>
      <Surface>
        <h2>Verification history</h2>
        {events.isPending ? (
          <p role="status">Loading verification events…</p>
        ) : events.error ? (
          <ApiErrorState
            error={events.error}
            retry={() => void events.refetch()}
          />
        ) : (
          <>
            <ul className="read-list">
              {events.data?.map((e, i) => (
                <li key={e.id ?? i}>
                  <h3>
                    {e.previousStatus ?? "Initial discovery"} →{" "}
                    {e.newStatus ?? "Status unavailable"}
                  </h3>
                  <Facts
                    values={[
                      ["Reason", e.reason],
                      ["Occurred at", e.occurredAt],
                      ["Observation reference", e.observationId],
                    ]}
                  />
                  <details>
                    <summary>Protected Actor audit reference</summary>
                    <Facts
                      values={[
                        ["Issuer", e.actorIssuer],
                        ["Subject", e.actorSubject],
                      ]}
                    />
                  </details>
                </li>
              ))}
            </ul>
            {events.data?.length === 0 && (
              <p>No verification events returned.</p>
            )}
            {events.data?.length === 100 && (
              <p>Latest 100 events; the bounded view is not exhaustive.</p>
            )}
          </>
        )}
      </Surface>
    </>
  );
}
