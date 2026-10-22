import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import {
  useWorkspace,
  useWorkspaceCommand,
  isCancelled,
} from "../../app/workspace";
import { queryKeys } from "../../api/queryKeys";
import { Button, EmptyState, Skeleton, StatusBadge, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import {
  checked,
  projectPath,
  stylePath,
  type Filter,
  type Entity,
  type Draft,
} from "./model";
import { useCollection } from "./data";
import { MetadataFields, Reset, useMetadataForm, validated } from "./Forms";
export function Collection({
  project,
  writable = true,
}: {
  project?: string;
  writable?: boolean;
}) {
  const w = useWorkspace(),
    cache = useQueryClient();
  const [status, setStatus] = useState<Filter>(project ? "ALL" : "ACTIVE"),
    [offset, setOffset] = useState(0);
  const rows = useCollection(project, status, offset),
    kind = project ? "Style" : "Project";
  const form = useMetadataForm({ name: "", description: "", styleCode: "" });
  const [created, setCreated] = useState<Entity>();
  const prefix = project
    ? [...queryKeys.project(w.scope, w.organizationId, project), "styles"]
    : [...queryKeys.workspace(w.scope, w.organizationId), "projects"];
  const create = useWorkspaceCommand(
    [...prefix, "create"],
    async (draft: Draft, signal) => {
      const body = {
        name: draft.name,
        ...(draft.description ? { description: draft.description } : {}),
      };
      const r = project
        ? await api.POST(
            "/api/v1/organizations/{organizationId}/projects/{projectId}/styles",
            {
              signal,
              params: {
                path: { organizationId: w.organizationId, projectId: project },
              },
              body: {
                ...body,
                ...(draft.styleCode ? { styleCode: draft.styleCode } : {}),
              },
            },
          )
        : await api.POST("/api/v1/organizations/{organizationId}/projects", {
            signal,
            params: { path: { organizationId: w.organizationId } },
            body,
          });
      return checked(
        requireData(r.data, r.response),
        project ?? w.organizationId,
      );
    },
    async (value) => {
      if (!w.current()) return;
      form.reset();
      setCreated(value);
      setOffset(0);
      await cache.invalidateQueries({ queryKey: prefix });
    },
  );
  const url = (id: string) =>
    project
      ? stylePath(w.organizationId, project, id)
      : projectPath(w.organizationId, id);
  return (
    <Surface aria-label={`${kind}s`}>
      <h2>{kind}s</h2>
      <div className="filter-field workspace-filter">
        <label htmlFor={`${kind}-status`}>{kind} status</label>
        <select
          className="input"
          id={`${kind}-status`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Filter);
            setOffset(0);
          }}
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="ARCHIVED">ARCHIVED</option>
          <option value="ALL">ALL</option>
        </select>
      </div>
      {rows.isPending ? (
        <Skeleton label={`Loading ${kind.toLowerCase()}s`} />
      ) : rows.isError ? (
        <ApiErrorState error={rows.error} retry={() => void rows.refetch()} />
      ) : (
        <>
          {rows.data.items.length === 0 ? (
            <EmptyState title={`No ${kind.toLowerCase()}s yet`}>
              {w.writer && writable
                ? `Create a ${kind.toLowerCase()} to begin.`
                : "This workspace is read-only."}
            </EmptyState>
          ) : (
            <ul className="read-list">
              {rows.data.items.map((row) => (
                <li key={row.id}>
                  <h3>
                    <Link to={url(row.id)}>{row.name}</Link>
                  </h3>
                  {"styleCode" in row && row.styleCode && (
                    <p>{row.styleCode}</p>
                  )}
                  <StatusBadge>{row.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
          <p className="result-status">
            {rows.data.items.length} {kind.toLowerCase()}s loaded in this page.
            Offset pages can change as records are added.
          </p>
          <div className="workspace-actions">
            <Button
              disabled={offset === 0 || rows.isFetching}
              onClick={() => setOffset((n) => Math.max(0, n - 25))}
            >
              Previous {kind.toLowerCase()}s
            </Button>
            <Button
              disabled={
                !rows.data.hasMore || rows.isFetching || offset + 25 > 100000
              }
              onClick={() => setOffset((n) => n + 25)}
            >
              Next {kind.toLowerCase()}s
            </Button>
          </div>
        </>
      )}
      {w.writer && writable && (
        <section className="workspace-create" aria-label={`Create ${kind}`}>
          <h3>Create {kind}</h3>
          <form onSubmit={validated(form, (draft) => create.mutate(draft))}>
            <MetadataFields form={form} style={!!project} />
            <div className="workspace-actions">
              <Button type="submit" disabled={create.isPending}>
                Create {kind}
              </Button>
              <Reset
                reset={() => {
                  form.reset();
                  create.reset();
                  setCreated(undefined);
                }}
              />
            </div>
          </form>
          {create.isError && !isCancelled(create.error) && (
            <>
              <ApiErrorState error={create.error} />
              {create.error instanceof ApiError &&
                create.error.status === 0 && (
                  <p role="alert">
                    Creation outcome unknown. Inspect the collection before
                    resubmitting; absence from a bounded or filtered page does
                    not prove failure.
                  </p>
                )}
            </>
          )}
          {created && (
            <p role="status">
              {kind} created.{" "}
              <Link to={url(created.id)}>Open created {kind}</Link>
            </p>
          )}
        </section>
      )}
    </Surface>
  );
}
