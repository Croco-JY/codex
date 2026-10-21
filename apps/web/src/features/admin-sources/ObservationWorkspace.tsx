import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button, Input } from "../../ui";
import { Facts } from "../commercial/ReadUI";
import {
  ambiguous,
  observationOptions,
  uniqueRows,
  useAdminMutation,
  useAdminReadError,
} from "./data";
import {
  Field,
  HistoryStatus,
  MutationFeedback,
  useCheckedForm,
} from "./FormUI";
import {
  isUuid,
  observationBody,
  observationDefaults,
  observationFields,
  text,
  type Observation,
  type ObservationFields,
} from "./model";
import type { RecordContext } from "./RecordWorkspace";
import { Reviews } from "./Reviews";
export function ObservationWorkspace({ record }: { record: RecordContext }) {
  const { scope, capability } = useSession(),
    cache = useQueryClient();
  const options = observationOptions(scope, record.id);
  const history = useInfiniteQuery({
    ...options,
    enabled: capability === "ADMIN",
  });
  useAdminReadError(history.error);
  const rows = uniqueRows(history.data?.pages);
  const [selected, setSelected] = useState<Observation & { id: string }>();
  const [returned, setReturned] = useState<Observation & { id: string }>();
  const [notice, setNotice] = useState("");
  const form = useCheckedForm(observationFields, observationDefaults);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: options.queryKey, exact: true });
  const mutation = useAdminMutation(
    "observation",
    async (fields: ObservationFields, signal) => {
      const { data, response } = await api.POST(
        "/api/v1/admin/source-observations",
        { signal, body: observationBody(record.id, fields) },
      );
      const observed = requireData(data, response);
      if (
        !isUuid(observed.id) ||
        (observed.sourceRecordId != null &&
          observed.sourceRecordId !== record.id)
      )
        throw new ApiError(502);
      return { ...observed, id: observed.id };
    },
    async (observed, fields) => {
      setReturned(observed);
      form.reset(fields);
      setNotice(
        "Observation registration confirmed. Exact identity/fact retries may reuse the existing immutable Observation; differing facts conflict.",
      );
      await cache.resetQueries({ queryKey: options.queryKey, exact: true });
    },
    async (error) => {
      if (ambiguous(error)) await refresh();
    },
  );
  const hash = form.watch("contentHash"),
    matchingKey = form.watch("observationKey");
  const uncertain = ambiguous(mutation.error);
  const all =
    returned && !rows.some((row) => row.id === returned.id)
      ? [returned, ...rows]
      : rows;
  return (
    <section aria-labelledby="observations-title">
      <h2 id="observations-title">Immutable Observations</h2>
      <p>
        Append an observed fact for this SourceRecord. Date/time controls below
        are UTC, not local timezone.
      </p>
      <form
        className="admin-form"
        onSubmit={form.submit((fields) => {
          setNotice("");
          mutation.mutate(fields);
        })}
      >
        <fieldset className="admin-fields" disabled={mutation.isPending}>
          <Field
            label="Observation key"
            name="observationKey"
            error={form.formState.errors.observationKey?.message}
          >
            {(p) => <Input {...p} {...form.register("observationKey")} />}
          </Field>
          <Field
            label="Observed at (UTC)"
            name="observedAt"
            error={form.formState.errors.observedAt?.message}
          >
            {(p) => (
              <Input
                type="datetime-local"
                step="0.001"
                {...p}
                {...form.register("observedAt")}
              />
            )}
          </Field>
          <Field
            label="Retrieved at (UTC, optional)"
            name="retrievedAt"
            error={form.formState.errors.retrievedAt?.message}
          >
            {(p) => (
              <Input
                type="datetime-local"
                step="0.001"
                {...p}
                {...form.register("retrievedAt")}
              />
            )}
          </Field>
          <Field
            label="Content hash (optional)"
            name="contentHash"
            error={form.formState.errors.contentHash?.message}
          >
            {(p) => (
              <textarea
                className="input"
                rows={2}
                spellCheck={false}
                autoCapitalize="off"
                {...p}
                {...form.register("contentHash")}
              />
            )}
          </Field>
          <div className="filter-field">
            <label htmlFor="observation-hash-algorithm">Hash algorithm</label>
            <Input
              id="observation-hash-algorithm"
              readOnly
              value={hash ? "SHA-256" : ""}
            />
            <p className="filter-help">
              Optional pair: 64 lowercase hexadecimal characters + SHA-256. No
              hash is calculated here.
            </p>
          </div>
          <Field
            label="Supersedes Observation UUID (optional)"
            name="supersedesObservationId"
            error={form.formState.errors.supersedesObservationId?.message}
          >
            {(p) => (
              <Input
                {...p}
                list="current-record-observations"
                {...form.register("supersedesObservationId")}
              />
            )}
          </Field>
          <datalist id="current-record-observations">
            {rows
              .filter((row) => isUuid(row.id))
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {text(row.observationKey)}
                </option>
              ))}
          </datalist>
          <p className="filter-help">
            Supersession is deliberate; none is selected automatically. The
            server checks same-Record integrity.
          </p>
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending
                ? "Registering observation…"
                : "Register Observation"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(observationDefaults);
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Observation draft
            </Button>
          </div>
        </fieldset>
      </form>
      <MutationFeedback
        error={mutation.error}
        noun="Observation registration"
        success={notice}
        refresh={() => void refresh()}
        conflictTitle="An Observation with this identity conflicts with the submitted facts."
        conflictDetail="An Observation with this identity exists but does not match the submitted facts, or another integrity conflict occurred."
      />
      {uncertain && (
        <p className="notice">
          Visible matches for your Observation key are highlighted for
          comparison. Absence from this bounded history is not proof that
          registration failed.
        </p>
      )}
      <div className="section-heading">
        <h3>Observation history</h3>
        <Button className="secondary small" onClick={() => void refresh()}>
          Refresh Observations
        </Button>
      </div>
      <HistoryStatus
        query={history}
        count={rows.length}
        noun="observations"
        empty={
          record.confirmed
            ? "No observations recorded for this SourceRecord."
            : "No observations returned. This read does not confirm whether the SourceRecord exists."
        }
      />
      <ul className="read-list">
        {all.map((observed, i) => (
          <li
            key={observed.id ?? i}
            className={
              uncertain && observed.observationKey === matchingKey
                ? "admin-match"
                : undefined
            }
          >
            <h3>{text(observed.observationKey)}</h3>
            {uncertain && observed.observationKey === matchingKey && (
              <p className="notice">
                Visible identity match — compare the facts before any retry.
              </p>
            )}
            {observed.id === returned?.id &&
              !rows.some((row) => row.id === observed.id) && (
                <p className="filter-help">
                  Just returned by the command; outside the currently loaded
                  history.
                </p>
              )}
            <Facts
              values={[
                ["Observed at", observed.observedAt],
                ["Recorded at", observed.recordedAt],
                ["Retrieved at", observed.retrievedAt],
                ["Content hash", observed.contentHash],
                ["Hash algorithm", observed.hashAlgorithm],
                ["Supersedes", observed.supersedesObservationId],
              ]}
            />
            <p className="record-reference">
              Observation reference: {text(observed.id)}
            </p>
            <Button
              className="secondary"
              disabled={!isUuid(observed.id)}
              onClick={() => {
                if (isUuid(observed.id))
                  setSelected({ ...observed, id: observed.id });
              }}
            >
              Open Reviews for {text(observed.observationKey)}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <Button className="secondary" onClick={() => setSelected(undefined)}>
            Close Reviews and clear draft
          </Button>
          <Reviews key={selected.id} observation={selected} />
        </>
      )}
    </section>
  );
}
