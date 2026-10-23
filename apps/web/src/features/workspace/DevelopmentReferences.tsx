import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import {
  useWorkspace,
  useWorkspaceCommand,
  isCancelled,
} from "../../app/workspace";
import { Button, Surface, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import type { Project, Style } from "./model";
import {
  checkedReference,
  checkedReferences,
  referenceNameSchema,
  referenceFormData,
  referenceStates,
  MAX_REFERENCE_BYTES,
  type Reference,
  type ReferenceState,
  type UploadDraft,
} from "./developmentReferenceModel";
const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references" as const;
const detail =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references/{referenceId}" as const;
const labels = {
  PENDING: "Upload not confirmed",
  READY: "Available to download",
  FAILED: "Upload failed",
  DETACHED: "Detached",
};

export function DevelopmentReferences({
  project,
  style,
  available,
  refreshParents,
}: {
  project: Project;
  style: Style;
  available: boolean;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    cache = useQueryClient();
  const [state, setState] = useState<ReferenceState | undefined>(),
    [offset, setOffset] = useState(0),
    [notice, setNotice] = useState("");
  const params = {
    organizationId: w.organizationId,
    projectId: project.id,
    styleId: style.id,
  };
  const prefix = [
    ...queryKeys.style(w.scope, w.organizationId, project.id, style.id),
    "development-references",
  ];
  const query = useQuery({
    queryKey: queryKeys.references(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
      state,
      25,
      offset,
    ),
    enabled: available,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(path, {
          signal,
          params: { path: params, query: { state, limit: 25, offset } },
        });
        return checkedReferences(
          requireData(r.data, r.response),
          style.id,
          offset,
        );
      }),
  });
  const writable =
    available &&
    !query.isError &&
    !!query.data &&
    w.writer &&
    project.status === "ACTIVE" &&
    style.status === "ACTIVE";
  const refresh = async () => {
    await cache.cancelQueries({ queryKey: prefix });
    if (!w.current()) return;
    await cache.invalidateQueries({ queryKey: prefix, refetchType: "none" });
    if (!w.current()) return;
    setState(undefined);
    setOffset(0);
    await cache.refetchQueries(
      { queryKey: [...prefix, null, 25, 0], exact: true, type: "all" },
      { cancelRefetch: false },
    );
  };
  return (
    <Surface aria-label="Development References">
      <h2>Development References</h2>
      <p>
        Generic private attachments. Upload state does not indicate product
        approval. Incomplete and detached metadata and bytes are retained.
      </p>
      {!w.writer && (
        <p>
          Development References are read-only for your membership. READY files
          may be downloaded.
        </p>
      )}
      {(project.status !== "ACTIVE" || style.status !== "ACTIVE") && (
        <p role="status">
          Project or Style is archived. Upload and detach are unavailable; READY
          downloads remain available.
        </p>
      )}
      <label>
        Reference state{" "}
        <select
          aria-label="Reference state"
          value={state ?? ""}
          onChange={(e) => {
            const next = referenceStates.find((s) => s === e.target.value);
            setState(next);
            setOffset(0);
          }}
        >
          <option value="">All</option>
          {referenceStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {query.isPending && <Skeleton label="Loading Development References" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          {query.data.items.length === 0 && (
            <p>No Development References in this view.</p>
          )}
          <ul className="read-list">
            {query.data.items.map((row) => (
              <li key={row.id}>
                <ReferenceRow
                  row={row}
                  projectId={project.id}
                  available={available && !query.isError}
                  writable={writable}
                  refresh={refresh}
                  refreshParents={refreshParents}
                  report={setNotice}
                />
              </li>
            ))}
          </ul>
          <div className="workspace-actions">
            <Button
              disabled={offset === 0 || query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Previous references
            </Button>
            <Button
              disabled={
                !query.data.hasMore || offset >= 100000 || query.isFetching
              }
              onClick={() => setOffset(offset + 25)}
            >
              Next references
            </Button>
          </div>
        </>
      )}
      {w.writer && (
        <Upload
          projectId={project.id}
          styleId={style.id}
          writable={writable}
          refresh={refresh}
          refreshParents={refreshParents}
          report={setNotice}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}

function Upload({
  projectId,
  styleId,
  writable,
  refresh,
  refreshParents,
  report,
}: {
  projectId: string;
  styleId: string;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  report: (s: string) => void;
}) {
  const w = useWorkspace(),
    input = useRef<HTMLInputElement>(null),
    form = useForm<{ displayName: string }>({
      defaultValues: { displayName: "" },
    });
  const [file, setFile] = useState<File>(),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [validation, setValidation] = useState("");
  const command = useWorkspaceCommand(
    [
      ...queryKeys.style(w.scope, w.organizationId, projectId, styleId),
      "development-references",
      "upload",
    ],
    async (draft: UploadDraft, signal) => {
      // Generated binary strings describe the wire schema. This local serializer sends the actual File through the authenticated client.
      const r = await api.POST(path, {
        signal,
        params: {
          path: { organizationId: w.organizationId, projectId, styleId },
        },
        body: { displayName: draft.displayName, file: "" },
        bodySerializer: () => referenceFormData(draft),
      });
      const view = checkedReference(requireData(r.data, r.response), styleId);
      if (
        r.response.status !== 201 ||
        view.state !== "READY" ||
        view.version !== 1
      )
        throw new ApiError(502);
      return view;
    },
    async () => {
      await refresh();
      if (!w.current()) return;
      form.reset({ displayName: "" });
      setFile(undefined);
      if (input.current) input.current.value = "";
      setFailure(null);
      setBlocked(false);
      report("Reference uploaded · READY.");
    },
    async (error) => {
      setFailure(error);
      const uncertain =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500;
      if (uncertain) {
        setBlocked(true);
        report(
          "Upload outcome is uncertain. Review the authoritative References list before starting another upload.",
        );
      }
      await Promise.allSettled([
        refresh(),
        ...(error instanceof ApiError && error.status === 409
          ? [refreshParents()]
          : []),
      ]);
    },
  );
  return (
    <form
      className="reference-upload"
      aria-label="Upload Development Reference"
      onSubmit={form.handleSubmit((values) => {
        if (!writable || blocked || command.isPending) return;
        const name = referenceNameSchema.safeParse(values);
        if (!name.success) {
          setValidation(name.error.issues[0].message);
          return;
        }
        if (!file || file.size < 1 || file.size > MAX_REFERENCE_BYTES) {
          setValidation("Choose a file of 1 byte through 10 MiB.");
          return;
        }
        setValidation("");
        setFailure(null);
        command.mutate({ displayName: name.data.displayName, file });
      })}
    >
      <h3>Upload reference</h3>
      <fieldset disabled={!writable || command.isPending || blocked}>
        <legend>Private file · maximum 10 MiB</legend>
        <label>
          Reference file{" "}
          <input
            ref={input}
            className="input"
            type="file"
            onChange={(e) => {
              const next = e.target.files?.[0];
              setFile(next);
              if (next) form.setValue("displayName", next.name);
              setValidation("");
            }}
          />
        </label>
        <label>
          Display name{" "}
          <input
            className="input"
            {...form.register("displayName")}
            maxLength={255}
          />
        </label>
        <Button type="submit">Upload reference</Button>
      </fieldset>
      {validation && <p role="alert">{validation}</p>}
      {failure != null && !isCancelled(failure) && (
        <ApiErrorState error={failure} />
      )}
      {blocked && (
        <div role="alert">
          <p>
            The file and display-name draft are retained in this workspace.
            Matching names or sizes do not identify a prior upload.
          </p>
          <Button
            disabled={!writable || command.isPending}
            onClick={() => {
              setBlocked(false);
              setFailure(null);
              report(
                "A new upload will create new identities. Submit only after reviewing retained References.",
              );
            }}
          >
            Start a new upload after review
          </Button>
        </div>
      )}
    </form>
  );
}
function ReferenceRow({
  row,
  projectId,
  writable,
  available,
  refresh,
  refreshParents,
  report,
}: {
  row: Reference;
  projectId: string;
  writable: boolean;
  available: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  report: (s: string) => void;
}) {
  const w = useWorkspace(),
    cache = useQueryClient();
  const [confirm, setConfirm] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [latest, setLatest] = useState<Reference | null>(null),
    [review, setReview] = useState(false);
  const params = {
    organizationId: w.organizationId,
    projectId,
    styleId: row.styleId,
    referenceId: row.id,
  };
  const base = queryKeys.reference(
    w.scope,
    w.organizationId,
    projectId,
    row.styleId,
    row.id,
  );
  const recover = async () => {
    const result = await cache.fetchQuery({
      queryKey: base,
      staleTime: 0,
      retry: false,
      queryFn: ({ signal }) =>
        w.run(signal, async () => {
          const r = await api.GET(detail, { signal, params: { path: params } });
          return checkedReference(requireData(r.data, r.response), row.styleId);
        }),
    });
    if (w.current()) setLatest(result);
  };
  const detach = useWorkspaceCommand(
    [...base, "detach"],
    async (version: number, signal) => {
      const r = await api.POST(
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references/{referenceId}/detach",
        { signal, params: { path: params }, body: { version } },
      );
      const v = checkedReference(requireData(r.data, r.response), row.styleId);
      if (v.state !== "DETACHED") throw new ApiError(502);
      return v;
    },
    async () => {
      await refresh();
      if (w.current()) {
        setConfirm(false);
        setReview(false);
        setLatest(null);
        setFailure(null);
        report("Reference detached. Metadata and any bytes remain retained.");
      }
    },
    async (error) => {
      setConfirm(false);
      setReview(true);
      setLatest(null);
      setFailure(error);
      report(
        "Detach outcome requires review. Inspect the latest state and explicitly confirm any new detach.",
      );
      await Promise.allSettled([
        refresh(),
        recover(),
        ...(error instanceof ApiError && error.status === 409
          ? [refreshParents()]
          : []),
      ]);
    },
  );
  const download = useWorkspaceCommand(
    [...base, "download"],
    async (_: void, signal) => {
      const r = await api.GET(
        "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/development-references/{referenceId}/content",
        { signal, params: { path: params }, parseAs: "blob" },
      );
      const bytes = requireData(r.data, r.response);
      if (bytes.size !== row.sizeBytes) throw new ApiError(502);
      if (!w.current() || signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = row.displayName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    () => {},
    (error) => {
      setFailure(error);
    },
  );
  const v = latest ?? row;
  return (
    <>
      <h3>{row.displayName}</h3>
      <p>
        {v.state} · {labels[v.state]}
      </p>
      <dl className="read-facts">
        <div>
          <dt>Size</dt>
          <dd>{row.sizeBytes.toLocaleString()} bytes</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{v.version}</dd>
        </div>
        <div>
          <dt>Reference ID</dt>
          <dd>{row.id}</dd>
        </div>
        <div>
          <dt>Created at</dt>
          <dd>{row.createdAt}</dd>
        </div>
        <div>
          <dt>Updated at</dt>
          <dd>{v.updatedAt}</dd>
        </div>
      </dl>
      {v.state === "READY" && (
        <Button
          disabled={!available || download.isPending}
          onClick={() => download.mutate()}
        >
          Download reference
        </Button>
      )}
      {writable && v.state !== "DETACHED" && !confirm && (
        <Button
          disabled={detach.isPending || (review && !latest)}
          onClick={() => {
            setConfirm(true);
            if (review) setFailure(null);
          }}
        >
          {" "}
          {review ? "Review latest detach" : "Detach reference"}
        </Button>
      )}
      {confirm && (
        <div role="group" aria-label="Confirm reference detach">
          <p>
            Detach this reference at version {v.version}? Metadata and any bytes
            are retained. Content will no longer be downloadable.
          </p>
          <Button
            disabled={!writable || detach.isPending}
            onClick={() => {
              setFailure(null);
              detach.mutate(v.version);
            }}
          >
            Confirm detach
          </Button>
          <Button
            disabled={detach.isPending || (review && !latest)}
            onClick={() => setConfirm(false)}
          >
            Cancel detach
          </Button>
        </div>
      )}
      {review && latest && (
        <p role="status">
          Authoritative state: {latest.state} · version {latest.version}.{" "}
          {latest.state === "DETACHED"
            ? "Detachment is confirmed."
            : "No automatic retry was made. A new explicit confirmation is required."}
        </p>
      )}
      {failure != null && !isCancelled(failure) && (
        <ApiErrorState error={failure} />
      )}
    </>
  );
}
