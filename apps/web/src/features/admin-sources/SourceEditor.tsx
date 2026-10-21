import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Button, Input } from "../../ui";
import { Facts } from "../commercial/ReadUI";
import {
  ambiguous,
  uniqueRows,
  useAdminMutation,
  type SourcePages,
} from "./data";
import { Field, MutationFeedback, Options, useCheckedForm } from "./FormUI";
import {
  accessMethods,
  editableSource,
  isUuid,
  policies,
  sourceBody,
  sourceDefaults,
  sourceFields,
  sourceTypes,
  type EditableSource,
  type Source,
  type SourceFields,
} from "./model";
export function SourceEditor({
  initial,
  close,
  changed,
  dirty,
}: {
  initial?: EditableSource;
  close: () => void;
  changed: (source?: Source) => void;
  dirty: (value: boolean) => void;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    key = queryKeys.adminSources(scope);
  const [baseline, setBaseline] = useState(initial);
  const [latest, setLatest] = useState<EditableSource>();
  const [notice, setNotice] = useState("");
  const form = useCheckedForm(sourceFields, initial?.fields ?? sourceDefaults);
  const editing = !!initial;
  useEffect(() => {
    form.setFocus(editing ? "name" : "sourceCode");
  }, []);
  useEffect(() => {
    dirty(form.formState.isDirty);
  }, [form.formState.isDirty, dirty]);
  async function refresh() {
    await cache.invalidateQueries({ queryKey: key, exact: true });
    if (cache.getQueryState(key)?.status !== "success") return undefined;
    const found = uniqueRows(cache.getQueryData<SourcePages>(key)?.pages).find(
      (s) => s.id === initial?.id,
    );
    return found;
  }
  const mutation = useAdminMutation(
    "source",
    async (values: SourceFields, signal) => {
      const body = sourceBody(values, editing ? baseline!.version : 0);
      if (editing) {
        // Immutable transport fields come only from the safely loaded baseline.
        body.sourceCode = baseline!.fields.sourceCode;
        body.normalizationPolicy = baseline!.fields.normalizationPolicy;
      }
      const result = editing
        ? await api.PUT("/api/v1/admin/sources/{id}", {
            signal,
            params: { path: { id: baseline!.id } },
            body,
          })
        : await api.POST("/api/v1/admin/sources", { signal, body });
      const id = requireData(result.data, result.response);
      if (!isUuid(id) || (editing && id !== baseline!.id))
        throw new ApiError(502);
      return id;
    },
    async (id, values, current) => {
      if (!editing) {
        form.reset(sourceDefaults);
        setNotice(
          `Source created. Reference: ${id}. The Source list restarts at its first page; this row may require Load more.`,
        );
        await cache.resetQueries({ queryKey: key, exact: true });
        if (current()) changed();
      } else {
        const found = await refresh();
        if (!current()) return;
        const updated = found && editableSource(found);
        if (updated) {
          setBaseline(updated);
          form.reset(updated.fields);
          changed(found);
          setNotice(
            "Source updated. The current loaded pages and server version have been refreshed.",
          );
        } else {
          form.reset(values);
          setNotice(
            "Update confirmed. The Source is not safely editable in the refreshed loaded pages; reload the list before another edit.",
          );
          setBaseline(undefined);
        }
        setLatest(undefined);
      }
    },
    async (error, _value, current) => {
      if (editing && error instanceof ApiError && error.status === 409) {
        const found = await refresh();
        if (current()) setLatest(found ? editableSource(found) : undefined);
      }
    },
  );
  const error = form.formState.errors;
  const disabled = mutation.isPending || (editing && !baseline);
  return (
    <section className="admin-panel" aria-labelledby="source-editor-heading">
      <h2 id="source-editor-heading">
        {editing ? "Edit Source" : "Create Source"}
      </h2>
      {editing && (
        <p className="filter-help">
          Source code and normalization policy are read-only. Record existence
          cannot be inferred from visible history.
        </p>
      )}
      <form
        className="scope-form admin-form"
        onSubmit={form.submit((v) => {
          setNotice("");
          mutation.mutate(v);
        })}
      >
        <fieldset disabled={!!disabled} className="admin-fields">
          <Field
            name="sourceCode"
            label="Source code"
            error={error.sourceCode?.message}
          >
            {(p) => (
              <Input
                {...p}
                {...form.register("sourceCode")}
                readOnly={editing}
              />
            )}
          </Field>
          <Field name="name" label="Source name" error={error.name?.message}>
            {(p) => <Input {...p} {...form.register("name")} />}
          </Field>
          <Field
            name="sourceType"
            label="Source type"
            error={error.sourceType?.message}
          >
            {(p) => (
              <select className="input" {...p} {...form.register("sourceType")}>
                <Options values={sourceTypes} />
              </select>
            )}
          </Field>
          <Field
            name="accessMethod"
            label="Access method"
            error={error.accessMethod?.message}
          >
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register("accessMethod")}
              >
                <Options values={accessMethods} />
              </select>
            )}
          </Field>
          <Field
            name="namespace"
            label="Namespace (optional)"
            error={error.namespace?.message}
          >
            {(p) => <Input {...p} {...form.register("namespace")} />}
          </Field>
          <Field
            name="baseUrl"
            label="Base URL (optional)"
            error={error.baseUrl?.message}
          >
            {(p) => <Input {...p} {...form.register("baseUrl")} />}
          </Field>
          <Field
            name="normalizationPolicy"
            label="Normalization policy"
            error={error.normalizationPolicy?.message}
          >
            {(p) =>
              editing ? (
                <Input
                  {...p}
                  {...form.register("normalizationPolicy")}
                  readOnly
                />
              ) : (
                <select
                  className="input"
                  {...p}
                  {...form.register("normalizationPolicy")}
                >
                  <Options values={policies} />
                </select>
              )
            }
          </Field>
          <label className="checkbox-field">
            <input type="checkbox" {...form.register("active")} />
            Active Source
          </label>
          {editing && (
            <p className="record-reference">
              Loaded version: {baseline?.version ?? "Unavailable"}
            </p>
          )}
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending
                ? "Saving Source…"
                : editing
                  ? "Save Source"
                  : "Create Source"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(baseline?.fields ?? sourceDefaults);
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Source draft
            </Button>
          </div>
        </fieldset>
      </form>
      <MutationFeedback
        error={mutation.error}
        noun={editing ? "Source update" : "Source creation"}
        success={notice}
        refresh={() => void refresh()}
        conflictTitle="The Source changed or conflicts with the current server state."
      />
      {editing &&
        mutation.error instanceof ApiError &&
        mutation.error.status === 409 && (
          <div className="notice" aria-label="Refreshed Source comparison">
            <h3>Refreshed server values</h3>
            {latest ? (
              <>
                <Facts
                  values={[
                    ["Name", latest.fields.name],
                    ["Version", latest.version],
                    ["Source type", latest.fields.sourceType],
                    ["Access method", latest.fields.accessMethod],
                    ["Namespace", latest.fields.namespace],
                    ["Base URL", latest.fields.baseUrl],
                    ["Active", latest.fields.active ? "Yes" : "No"],
                  ]}
                />
                <div className="scope-actions">
                  <Button
                    onClick={() => {
                      setBaseline(latest);
                      mutation.reset();
                      setNotice(
                        "Refreshed version loaded. Your draft is retained; review it before explicitly saving.",
                      );
                    }}
                  >
                    Use refreshed version, keep draft
                  </Button>
                  <Button
                    className="secondary"
                    onClick={() => {
                      setBaseline(latest);
                      form.reset(latest.fields);
                      mutation.reset();
                      setNotice(
                        "Server values loaded. No update has been submitted.",
                      );
                    }}
                  >
                    Replace draft with server values
                  </Button>
                </div>
              </>
            ) : (
              <p>
                This Source is not safely available in the refreshed loaded
                pages. Keep your draft and refresh the list before retrying.
              </p>
            )}
          </div>
        )}
      {ambiguous(mutation.error) && (
        <p className="filter-help">
          No automatic retry was made. Source creation has no idempotency key.
        </p>
      )}
      <Button className="secondary" onClick={close}>
        {editing ? "Cancel Source edit" : "Close Source create"}
      </Button>
    </section>
  );
}
