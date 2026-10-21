import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts } from "../commercial/ReadUI";
import { isUuid } from "../admin-sources/model";
import { ambiguous, useAdminMutation } from "../admin-sources/data";
import { bindIdentity, resolveIdentity } from "./data";
import {
  identityKinds,
  resolvedState,
  draftDiffers,
  type CreateBodies,
  type IdentityType,
} from "./model";

export function IdentityError({
  error,
  resolve = false,
}: {
  error: unknown;
  resolve?: boolean;
}) {
  if (!error) return null;
  const status = error instanceof ApiError ? error.status : undefined;
  return (
    <div role="alert">
      {status === 0 ? (
        <p>
          {resolve
            ? "The identity-resolution outcome is unknown. Retain this command and retry only the exact same identity resolution."
            : "The binding outcome is unknown because this API has no passive binding read."}
        </p>
      ) : (
        <>
          {status === 400 && (
            <p>
              {resolve
                ? "The SourceRecord kind or its supporting Observation does not match this identity-resolution request. Ordinary validation may also reject the request."
                : "The SourceRecord is missing, has the wrong identity kind, or the binding request is invalid."}
            </p>
          )}
          {status === 404 && (
            <p>
              {resolve
                ? "A required parent or reference no longer exists."
                : "The canonical target no longer exists."}
            </p>
          )}
          {status === 409 && (
            <p>
              {resolve
                ? "The identity resolution conflicts with current domain or reference integrity constraints."
                : "This SourceRecord is already bound to another canonical target or conflicts with the current permanent identity state."}
            </p>
          )}
        </>
      )}
      <ApiErrorState error={error} />
    </div>
  );
}
function Helper() {
  return (
    <>
      <p>
        SourceRecord metadata is not passively available in this context. A UUID
        validates syntax only. The server verifies the SourceRecord kind when
        binding.
      </p>
      <p>
        <a href="/admin/sources" target="_blank" rel="noopener noreferrer">
          Open Sources &amp; Evidence
        </a>
      </p>
    </>
  );
}
export function PermanentBinding({
  type,
  id,
  label,
  ready = true,
}: {
  type: IdentityType;
  id: string;
  label: string;
  ready?: boolean;
}) {
  const [record, setRecord] = useState(""),
    [confirmed, confirm] = useState(false),
    [snapshot, freeze] = useState<{
      type: IdentityType;
      id: string;
      record: string;
    }>(),
    [success, succeeded] = useState(false);
  const meta = identityKinds[type];
  const mutation = useAdminMutation(
    "permanent-binding",
    async (command: NonNullable<typeof snapshot>, signal) => {
      await bindIdentity(command.type, command.id, command.record, signal);
    },
    () => succeeded(true),
  );
  function send() {
    if (!ready || !isUuid(id) || !isUuid(record) || !confirmed) return;
    const command = { type, id, record };
    freeze(command);
    mutation.mutate(command);
  }
  return (
    <section
      className="admin-panel"
      aria-label={`${meta.label} permanent identity binding`}
    >
      <h2>Permanent external identity binding</h2>
      <p className="admin-wrap">
        Canonical {meta.label}: {label}
      </p>
      <p className="record-reference">
        Canonical target: {id} · Expected SourceRecord kind: {meta.kind}
      </p>
      <p>
        This SourceRecord will permanently identify this canonical target. The
        binding cannot currently be reassigned or unlinked. Observation
        citations are separate. Name similarity is not identity proof.
      </p>
      <Helper />
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <fieldset disabled={!ready || !!snapshot || mutation.isPending}>
          <label>
            SourceRecord UUID
            <input
              className="input"
              value={record}
              onChange={(e) => {
                setRecord(e.target.value);
                confirm(false);
              }}
              required
              aria-invalid={!!record && !isUuid(record)}
            />
          </label>
          {record && !isUuid(record) && (
            <p role="alert">Enter a valid SourceRecord UUID.</p>
          )}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => confirm(e.target.checked)}
            />
            I confirm this permanent binding to this canonical target. It cannot
            currently be reassigned or unlinked.
          </label>
          <Button type="submit" disabled={!confirmed || !isUuid(record)}>
            Permanently bind external identity
          </Button>
        </fieldset>
      </form>
      <IdentityError error={mutation.error} />
      {snapshot && (
        <p className="record-reference">
          Frozen SourceRecord reference: {snapshot.record}. Target reference:{" "}
          {snapshot.id}.
        </p>
      )}
      {snapshot && ambiguous(mutation.error) && (
        <Button
          disabled={!ready || mutation.isPending}
          onClick={() => mutation.mutate(snapshot)}
        >
          Retry exact same permanent binding
        </Button>
      )}
      {success && snapshot && (
        <div role="status">
          <p className="admin-wrap">
            SourceRecord {snapshot.record} is bound to this canonical target.
          </p>
          <p>
            No complete binding-list read exists; this confirmation describes
            this command only. After reload, absence of this confirmation does
            not mean no binding exists.
          </p>
        </div>
      )}
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => {
          freeze(undefined);
          setRecord("");
          confirm(false);
          succeeded(false);
          mutation.reset();
        }}
      >
        Abandon / reset binding intention
      </Button>
    </section>
  );
}

export function useIdentityResolution<K extends IdentityType>(type: K) {
  const { scope } = useSession(),
    cache = useQueryClient();
  const [enabled, enable] = useState(false),
    [record, setRecord] = useState(""),
    [ack, acknowledge] = useState(false);
  const snapshot = useRef<
    { record: string; body: CreateBodies[K]; scope: string } | undefined
  >(undefined);
  const returned = useRef<unknown>(undefined);
  const [locked, lock] = useState(false),
    [result, setResult] = useState<ReturnType<typeof resolvedState>>(),
    [different, differs] = useState(false);
  async function send(body: CreateBodies[K], signal: AbortSignal) {
    if (!snapshot.current) {
      if (!enabled || !isUuid(record) || !ack) throw new ApiError(400);
      // Freeze the exact final transport; no form references survive dispatch.
      snapshot.current = { record, body: structuredClone(body), scope };
      lock(true);
    }
    const command = snapshot.current;
    if (command.scope !== scope)
      throw new DOMException("Request cancelled", "AbortError");
    const data = await resolveIdentity(
      type,
      command.record,
      command.body,
      signal,
    );
    returned.current = data;
    if (!resolvedState(type, data)) throw new ApiError(502);
    return data;
  }
  async function complete() {
    const state = resolvedState(type, returned.current);
    if (!state || !snapshot.current) return;
    setResult(state);
    differs(draftDiffers(snapshot.current.body, returned.current));
    // Invalidate the RETURNED context, including any different immutable parent.
    await cache.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey;
        if (k[1] !== scope) return false;
        return (
          (k[0] === "supply" || k[0] === "admin") &&
          (k.includes(state.id) ||
            (!!state.material && k.includes(state.material)) ||
            (!!state.supplier && k.includes(state.supplier)) ||
            k.includes("supplier-directory") ||
            k.includes("supplier-search") ||
            k.includes("facility-directory") ||
            k.includes("materials") ||
            k.includes("material-search"))
        );
      },
    });
  }
  function abandon() {
    snapshot.current = undefined;
    returned.current = undefined;
    lock(false);
    setResult(undefined);
    differs(false);
    acknowledge(false);
  }
  return {
    type,
    enabled,
    enable,
    record,
    setRecord,
    ack,
    acknowledge,
    locked,
    result,
    different,
    send,
    complete,
    abandon,
    canSubmit: !enabled || (isUuid(record) && ack && !locked),
  };
}
export function ResolutionControls({
  resolution: r,
  pending,
}: {
  resolution: Omit<ReturnType<typeof useIdentityResolution>, "send">;
  pending: boolean;
}) {
  return (
    <section className="notice" aria-label="Creation strategy">
      <label>
        Creation mode
        <select
          className="input"
          value={r.enabled ? "resolve" : "normal"}
          disabled={pending || r.locked}
          onChange={(e) => {
            r.enable(e.target.value === "resolve");
            r.acknowledge(false);
          }}
        >
          <option value="normal">Normal create</option>
          <option value="resolve">Create or reuse from SourceRecord</option>
        </select>
      </label>
      {r.enabled && (
        <>
          <p>
            Resolve external identity · Expected SourceRecord kind:{" "}
            {identityKinds[r.type].kind}. Use a genuine persistent external
            identity, never a manufactured retry token.
          </p>
          <Helper />
          <label>
            Resolve SourceRecord UUID
            <input
              className="input"
              value={r.record}
              disabled={pending || r.locked}
              onChange={(e) => {
                r.setRecord(e.target.value);
                r.acknowledge(false);
              }}
              aria-invalid={!!r.record && !isUuid(r.record)}
            />
          </label>
          {r.record && !isUuid(r.record) && (
            <p role="alert">Enter a valid SourceRecord UUID.</p>
          )}
          <p>
            If this SourceRecord is already bound, the existing canonical record
            will be returned and the draft fields below will not update it. The
            nested Observation must belong to this SourceRecord.
          </p>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={r.ack}
              disabled={pending || r.locked}
              onChange={(e) => r.acknowledge(e.target.checked)}
            />
            I acknowledge permanent identity resolution and reuse without
            updating an already-bound canonical record.
          </label>
        </>
      )}
    </section>
  );
}
export function ResolutionOutcome({
  resolution: r,
  error,
  pending,
  retry,
  reset,
}: {
  resolution: Omit<ReturnType<typeof useIdentityResolution>, "send">;
  error: unknown;
  pending: boolean;
  retry: () => void;
  reset: () => void;
}) {
  if (!r.enabled) return null;
  return (
    <section aria-label="Identity resolution result">
      <IdentityError error={error} resolve />
      {ambiguous(error) && r.locked && (
        <Button disabled={pending} onClick={retry}>
          Retry exact same identity resolution
        </Button>
      )}
      {r.result && (
        <div role="status" className="notice">
          <h3>Identity resolved to canonical {identityKinds[r.type].label}</h3>
          {r.different && (
            <p>
              Existing canonical data was returned. Resolve does not update an
              already-bound canonical record.
            </p>
          )}
          <p>
            Resolution does not indicate whether this command created or reused
            the record. Only the RECORD fact is cited, not all draft fields.
          </p>
          <Facts values={r.result.values} />
          <Link className="text-link" to={r.result.href}>
            Open resolved canonical {identityKinds[r.type].label}
          </Link>
        </div>
      )}
      {r.locked && (
        <Button
          className="secondary"
          disabled={pending}
          onClick={() => {
            r.abandon();
            reset();
          }}
        >
          Abandon identity resolution intention and unlock draft
        </Button>
      )}
    </section>
  );
}
