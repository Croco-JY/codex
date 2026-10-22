import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import {
  useWorkspace,
  useWorkspaceCommand,
  isCancelled,
} from "../../app/workspace";
import { Button, StatusBadge, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import {
  checked,
  draftOf,
  safeVersion,
  type Draft,
  type Entity,
} from "./model";
import {
  MetadataFields,
  Reset,
  ServerState,
  useMetadataForm,
  validated,
} from "./Forms";
export function Editor({
  entity,
  project,
  parentActive = true,
  available = true,
  refresh,
}: {
  entity: Entity;
  project?: string;
  parentActive?: boolean;
  available?: boolean;
  refresh: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    kind = project ? "Style" : "Project";
  const [baseline, setBaseline] = useState(entity),
    [conflict, setConflict] = useState(false),
    [lifecycleConflict, setLifecycleConflict] = useState(false),
    [notice, setNotice] = useState("");
  const form = useMetadataForm(draftOf(entity));
  const writable =
    available &&
    w.writer &&
    parentActive &&
    entity.status === "ACTIVE" &&
    safeVersion(entity.version);
  const prefix = project
    ? queryKeys.style(w.scope, w.organizationId, project, entity.id)
    : queryKeys.project(w.scope, w.organizationId, entity.id);
  const listPrefix = project
    ? [...queryKeys.project(w.scope, w.organizationId, project), "styles"]
    : [...queryKeys.workspace(w.scope, w.organizationId), "projects"];
  const put = async (
    input: { draft: Draft; version: number; status: "ACTIVE" | "ARCHIVED" },
    signal: AbortSignal,
  ) => {
    const body = {
      name: input.draft.name,
      description: input.draft.description || null,
      status: input.status,
      version: input.version,
    };
    const r = project
      ? await api.PUT(
          "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}",
          {
            signal,
            params: {
              path: {
                organizationId: w.organizationId,
                projectId: project,
                styleId: entity.id,
              },
            },
            body: { ...body, styleCode: input.draft.styleCode || null },
          },
        )
      : await api.PUT(
          "/api/v1/organizations/{organizationId}/projects/{projectId}",
          {
            signal,
            params: {
              path: { organizationId: w.organizationId, projectId: entity.id },
            },
            body,
          },
        );
    return checked(
      requireData(r.data, r.response),
      project ?? w.organizationId,
      entity.id,
    );
  };
  const success = async (value: Entity) => {
    if (!w.current()) return;
    setBaseline(value);
    form.reset(draftOf(value));
    setConflict(false);
    setLifecycleConflict(false);
    setNotice(`${kind} saved.`);
    await cache.invalidateQueries({ queryKey: listPrefix });
    if (!w.current()) return;
    await refresh();
  };
  const metadata = useWorkspaceCommand(
    [...prefix, "update"],
    put,
    success,
    async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        await refresh();
      }
    },
  );
  const lifecycle = useWorkspaceCommand(
    [...prefix, "lifecycle"],
    put,
    success,
    async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setLifecycleConflict(true);
        await refresh();
      }
    },
  );
  const reset = () => {
    if (!available) return;
    setBaseline(entity);
    form.reset(draftOf(entity));
    setConflict(false);
    metadata.reset();
    setNotice("");
  };
  return (
    <Surface aria-label={`${kind} profile`}>
      <h2>{kind} profile</h2>
      {!available && (
        <p role="alert">
          Current server context is unavailable. Your draft is retained; refresh
          before making changes.
        </p>
      )}
      <StatusBadge>{entity.status}</StatusBadge>
      {entity.status === "ARCHIVED" && (
        <p className="notice">
          This {kind.toLowerCase()} is archived. Metadata is read-only.
        </p>
      )}
      {!parentActive && (
        <p role="status" className="notice">
          The parent Project is archived. All Style changes are read-only.
        </p>
      )}
      {!w.writer && (
        <p className="notice">
          Your VIEWER membership provides read-only access.
        </p>
      )}
      <dl className="read-facts">
        <div>
          <dt>Version</dt>
          <dd>{entity.version}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{entity.createdAt}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{entity.updatedAt}</dd>
        </div>
      </dl>
      {w.writer ? (
        <form
          className="workspace-metadata"
          onSubmit={validated(form, (draft) => {
            if (writable && !conflict && safeVersion(baseline.version)) {
              setNotice("");
              metadata.mutate({
                draft,
                version: baseline.version,
                status: "ACTIVE",
              });
            }
          })}
        >
          <MetadataFields form={form} style={!!project} readOnly={!writable} />
          <div className="workspace-actions">
            {writable && (
              <Button
                type="submit"
                disabled={metadata.isPending || lifecycle.isPending || conflict}
              >
                Save {kind} metadata
              </Button>
            )}
            <Reset reset={reset} />
          </div>
        </form>
      ) : (
        <ServerState value={entity} label="Recorded metadata" />
      )}
      {metadata.isError && !isCancelled(metadata.error) && (
        <ApiErrorState
          error={metadata.error}
          title={
            conflict
              ? `The ${kind} changed or conflicts with the current server state.`
              : undefined
          }
        />
      )}
      {metadata.error instanceof ApiError && metadata.error.status === 0 && (
        <p role="alert">
          Update outcome unknown. Your draft is retained. Refresh and compare
          the server state before submitting again.
        </p>
      )}
      {conflict && (
        <section className="notice" aria-label="Metadata conflict" role="alert">
          <p>
            Your unsaved draft is retained above. Compare it with the current
            server values before choosing a baseline.
          </p>
          <ServerState value={entity} />
          <div className="workspace-actions">
            <Button disabled={!available} onClick={reset}>
              Use latest
            </Button>
            {writable && (
              <Button
                onClick={() => {
                  setBaseline(entity);
                  setConflict(false);
                  metadata.reset();
                }}
              >
                Reconcile draft with latest
              </Button>
            )}
            <Button className="secondary" onClick={() => void refresh()}>
              Refresh comparison
            </Button>
          </div>
          <p>
            Reconciliation does not submit. Save explicitly after reviewing your
            draft.
          </p>
        </section>
      )}
      {available && w.writer && parentActive && safeVersion(entity.version) && (
        <section
          className="workspace-lifecycle"
          aria-label={`${kind} lifecycle`}
        >
          <h3>Lifecycle</h3>
          <p>Lifecycle commands preserve the recorded metadata.</p>
          {form.formState.isDirty && (
            <p>Reset unsaved metadata changes before changing lifecycle.</p>
          )}
          <Button
            disabled={
              form.formState.isDirty ||
              metadata.isPending ||
              lifecycle.isPending
            }
            onClick={() => {
              setNotice("");
              setLifecycleConflict(false);
              lifecycle.mutate({
                draft: draftOf(entity),
                version: entity.version,
                status: entity.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
              });
            }}
          >
            {entity.status === "ACTIVE" ? "Archive" : "Reactivate"} {kind}
          </Button>
        </section>
      )}
      {lifecycle.isError && !isCancelled(lifecycle.error) && (
        <ApiErrorState error={lifecycle.error} />
      )}
      {lifecycleConflict && (
        <div role="alert" className="notice">
          <p>
            The lifecycle command conflicts with the current server state.
            Current status: {entity.status}; version: {entity.version}. Review
            the refreshed state and explicitly trigger an available action
            again.
          </p>
          <Button onClick={() => void refresh()}>
            Refresh lifecycle state
          </Button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}
