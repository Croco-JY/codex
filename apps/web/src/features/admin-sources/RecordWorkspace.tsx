import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { Button, Input, Surface } from "../../ui";
import { Facts } from "../commercial/ReadUI";
import { useAdminMutation } from "./data";
import { Field, MutationFeedback, Options, useCheckedForm } from "./FormUI";
import {
  isUuid,
  recordFields,
  recordKinds,
  sourceLabel,
  uuid,
  type RecordFields,
  type RecordView,
  type Source,
} from "./model";
import { ObservationWorkspace } from "./ObservationWorkspace";
export type RecordContext = {
  id: string;
  confirmed?: RecordView;
  label?: string;
  sequence: number;
};
export function RecordWorkspace({
  source,
  onContextActive,
}: {
  source?: Source;
  onContextActive: (active: boolean) => void;
}) {
  const [context, setContext] = useState<RecordContext>();
  const [pending, setPending] = useState<Omit<RecordContext, "sequence">>();
  const [notice, setNotice] = useState("");
  const contextHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (context) contextHeading.current?.focus();
  }, [context?.id, context?.sequence]);
  const form = useCheckedForm(recordFields, {
    recordKind: "SUPPLIER",
    externalRecordKey: "",
  } as RecordFields);
  const known = useCheckedForm(z.object({ id: uuid }), { id: "" });
  useEffect(() => {
    onContextActive(
      !!context || form.formState.isDirty || known.formState.isDirty,
    );
  }, [
    context,
    form.formState.isDirty,
    known.formState.isDirty,
    onContextActive,
  ]);
  const open = (value: Omit<RecordContext, "sequence">) => {
    if (context) setPending(value);
    else setContext({ ...value, sequence: 0 });
  };
  const mutation = useAdminMutation(
    "record",
    async (fields: RecordFields, signal) => {
      if (!isUuid(source?.id) || source.active !== true)
        throw new ApiError(400);
      const { data, response } = await api.POST(
        "/api/v1/admin/source-records",
        { signal, body: { dataSourceId: source.id, ...fields } },
      );
      const record = requireData(data, response);
      if (
        !isUuid(record.id) ||
        (record.dataSourceId != null && record.dataSourceId !== source.id)
      )
        throw new ApiError(502);
      return record;
    },
    (record, fields) => {
      setNotice(
        "Record registration/reuse confirmed. This explicit command may audit even when an existing identity is reused.",
      );
      form.reset(fields);
      open({
        id: record.id!,
        confirmed: record,
        label:
          record.dataSourceId === source?.id ? sourceLabel(source!) : undefined,
      });
    },
  );
  return (
    <Surface>
      <h2>SourceRecord registration &amp; history context</h2>
      <p>
        SourceRecord is persistent external identity. Registration/reuse is an
        audited command, not a passive search.
      </p>
      <div className="admin-columns">
        <section>
          <h3>Register / reuse record</h3>
          {source ? (
            <p className="admin-wrap">
              Selected Source: <strong>{sourceLabel(source)}</strong>
            </p>
          ) : (
            <p>
              Select a loaded Source to register or reuse an external record.
            </p>
          )}
          {source?.active === false && (
            <p className="notice">
              New/reused SourceRecord registration requires an active Source.
            </p>
          )}
          {source && source.active == null && (
            <p className="notice">
              Source active state is unavailable. Refresh it before
              registration.
            </p>
          )}
          <form
            onSubmit={form.submit((v) => {
              if (source?.active === true) {
                setNotice("");
                mutation.mutate(v);
              }
            })}
          >
            <fieldset
              className="admin-fields single"
              disabled={
                !isUuid(source?.id) ||
                source?.active !== true ||
                mutation.isPending
              }
            >
              <Field
                label="Record kind"
                name="recordKind"
                error={form.formState.errors.recordKind?.message}
              >
                {(p) => (
                  <select
                    className="input"
                    {...p}
                    {...form.register("recordKind")}
                  >
                    <Options values={recordKinds} />
                  </select>
                )}
              </Field>
              <Field
                label="External record key"
                name="externalRecordKey"
                error={form.formState.errors.externalRecordKey?.message}
              >
                {(p) => (
                  <Input {...p} {...form.register("externalRecordKey")} />
                )}
              </Field>
              <p className="filter-help">
                Original key is submitted unchanged. The server applies this
                Source's normalization policy.
              </p>
              <div className="scope-actions">
                <Button type="submit">
                  {mutation.isPending
                    ? "Registering record…"
                    : "Register / reuse record"}
                </Button>
                <Button
                  className="secondary"
                  onClick={() => {
                    form.reset();
                    mutation.reset();
                    setNotice("");
                  }}
                >
                  Reset Record draft
                </Button>
              </div>
            </fieldset>
          </form>
          <MutationFeedback
            error={mutation.error}
            noun="Record registration"
            success={notice}
            conflictTitle="Registration conflicts with the existing source identity."
          />
        </section>
        <section>
          <h3>Open history by known SourceRecord UUID</h3>
          <p>
            No global SourceRecord directory or record-by-ID read exists. This
            workflow only reads bounded Observation history.
          </p>
          <form onSubmit={known.submit(({ id }) => open({ id }))}>
            <Field
              label="Known SourceRecord UUID"
              name="knownRecordId"
              error={known.formState.errors.id?.message}
            >
              {(p) => <Input {...p} {...known.register("id")} />}
            </Field>
            <Button type="submit">Open Record history</Button>
          </form>
        </section>
      </div>
      {pending && (
        <div role="alert" className="notice">
          <p>
            Changing Record context clears current Observation and Review
            drafts.
          </p>
          <div className="scope-actions">
            <Button
              onClick={() => {
                setContext({
                  ...pending,
                  sequence: (context?.sequence ?? 0) + 1,
                });
                setPending(undefined);
              }}
            >
              Change Record and clear drafts
            </Button>
            <Button className="secondary" onClick={() => setPending(undefined)}>
              Keep current Record
            </Button>
          </div>
        </div>
      )}
      {context && (
        <div className="stack admin-context">
          <header>
            <h3 ref={contextHeading} tabIndex={-1}>
              Current Record context
            </h3>
            <p className="record-reference">Record reference: {context.id}</p>
            {context.label && (
              <p className="admin-wrap">Source: {context.label}</p>
            )}
          </header>
          {context.confirmed ? (
            <Facts
              values={[
                ["Source reference", context.confirmed.dataSourceId],
                ["Record kind", context.confirmed.recordKind],
                ["Original external key", context.confirmed.externalRecordKey],
                [
                  "Normalized external key",
                  context.confirmed.normalizedExternalRecordKey,
                ],
                ["First seen", context.confirmed.firstSeenAt],
                ["Last seen", context.confirmed.lastSeenAt],
              ]}
            />
          ) : (
            <div className="notice">
              <p>
                An empty observation result does not prove whether this
                SourceRecord exists.
              </p>
              <p>
                UUID-only context: Source, provider, Record kind and external
                key are not known from this read.
              </p>
            </div>
          )}
          <Button
            className="secondary"
            onClick={() => {
              setContext(undefined);
              setPending(undefined);
            }}
          >
            Close Record context and clear drafts
          </Button>
          <ObservationWorkspace
            key={`${context.id}-${context.sequence}`}
            record={context}
          />
        </div>
      )}
    </Surface>
  );
}
