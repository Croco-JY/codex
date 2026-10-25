import { useId, useRef, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace, useWorkspaceCommand } from "../../app/workspace";
import { Button, Input, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { checkedRevision, draftOf, type Revision, type Pattern } from "./model";
import { revisionPath } from "./data";
import { MeasurementPicker } from "./MeasurementPicker";
import {
  artifactBody,
  artifactDraftSchema,
  artifactFormData,
  checkedArtifact,
  checkedArtifactResult,
  formats,
  MAX_ARTIFACT_BYTES,
  type ArtifactDraft,
  type Artifact,
  type ArtifactResult,
} from "./artifactModel";
export const artifactPath = `${revisionPath}/artifact` as const;
export const artifactContentPath = `${artifactPath}/content` as const;
export const artifactUploadPath =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns/{patternId}/artifact-revisions" as const;
export function ArtifactInspector({
  projectId,
  revision,
  available,
}: {
  projectId: string;
  revision: Revision;
  available: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label={`Artifact for Pattern revision ${revision.revisionNumber}`}
    >
      <Button disabled={!available} onClick={() => setOpen(!open)}>
        {open ? "Close artifact inspector" : "Inspect artifact"}
      </Button>
      {open && (
        <Inspector
          key={revision.id}
          projectId={projectId}
          revision={revision}
          available={available}
        />
      )}
    </section>
  );
}
function Inspector({
  projectId,
  revision,
  available,
}: {
  projectId: string;
  revision: Revision;
  available: boolean;
}) {
  const w = useWorkspace(),
    params = {
      organizationId: w.organizationId,
      projectId,
      styleId: revision.styleId,
      patternId: revision.patternId,
      revisionId: revision.id,
    };
  const q = useQuery({
    queryKey: queryKeys.patternArtifact(
      w.scope,
      w.organizationId,
      projectId,
      revision.styleId,
      revision.patternId,
      revision.id,
    ),
    enabled: available,
    retry: false,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        try {
          const r = await api.GET(artifactPath, {
            signal,
            params: { path: params },
          });
          return checkedArtifact(
            requireData(r.data, r.response),
            revision.styleId,
            revision.patternId,
            revision.id,
          );
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          const check = await api.GET(revisionPath, {
            signal,
            params: { path: params },
          });
          checkedRevision(
            requireData(check.data, check.response),
            revision.styleId,
            revision.patternId,
            revision.id,
          );
          return null;
        }
      }),
  });
  return (
    <section aria-label="Pattern artifact inspector">
      <h4>Pattern artifact</h4>
      {q.isPending && <Skeleton label="Loading Pattern artifact" />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data === null && !q.isFetching && (
        <p>This revision has no artifact.</p>
      )}
      {q.data && (
        <ArtifactFacts
          key={q.data.id}
          value={q.data}
          params={params}
          available={available && !q.isError && !q.isFetching}
        />
      )}
    </section>
  );
}
function ArtifactFacts({
  value,
  params,
  available,
}: {
  value: Artifact;
  params: {
    organizationId: string;
    projectId: string;
    styleId: string;
    patternId: string;
    revisionId: string;
  };
  available: boolean;
}) {
  const w = useWorkspace(),
    [failure, setFailure] = useState<unknown>(null);
  const download = useWorkspaceCommand(
    [
      ...queryKeys.patternArtifact(
        w.scope,
        w.organizationId,
        params.projectId,
        params.styleId,
        params.patternId,
        params.revisionId,
      ),
      "download",
    ],
    async (_v: void, signal) => {
      const r = await api.GET(artifactContentPath, {
        signal,
        params: { path: params },
        parseAs: "blob",
      });
      const b = requireData(r.data, r.response);
      if (b.size !== value.sizeBytes) throw new ApiError(502);
      if (!w.current() || signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([b], { type: "application/octet-stream" }),
      );
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = value.displayName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    () => setFailure(null),
    (e) => setFailure(e),
  );
  return (
    <>
      <p>Artifact state: {value.state}</p>
      <dl className="read-facts">
        <div>
          <dt>Declared format</dt>
          <dd>{value.declaredFormat.replace("_", "-")}</dd>
        </div>
        <div>
          <dt>Display name</dt>
          <dd>{value.displayName}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{value.sizeBytes.toLocaleString()} bytes</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{value.createdAt}</dd>
        </div>
      </dl>
      {value.state === "PENDING" && (
        <p>
          Upload not confirmed. The reserved revision and artifact are retained.
          No automatic retry or overwrite is performed.
        </p>
      )}
      {value.state === "FAILED" && (
        <p>
          Upload failed ({value.failureCode}). The revision and artifact remain
          retained. Create a new Pattern revision for another upload.
        </p>
      )}
      {value.state === "READY" && (
        <>
          <p>
            Stored artifact only. READY does not indicate geometry validation,
            malware scanning, QA approval, or production approval.
          </p>
          <Button
            disabled={!available || download.isPending}
            onClick={() => download.mutate()}
          >
            Download Pattern artifact
          </Button>
        </>
      )}
      {failure != null && <ApiErrorState error={failure} />}
    </>
  );
}
export function ArtifactImport({
  projectId,
  value,
  writable,
  refresh,
  refreshParents,
}: {
  projectId: string;
  value: Pattern;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
}) {
  const w = useWorkspace(),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  return (
    <section aria-label="Pattern artifact import">
      {w.writer && writable && !open && (
        <Button
          onClick={() => {
            setOpen(true);
            setNotice("");
          }}
        >
          Import artifact as new revision
        </Button>
      )}
      {open && w.writer && (
        <ImportEditor
          projectId={projectId}
          value={value}
          writable={writable}
          refresh={refresh}
          refreshParents={refreshParents}
          saved={() => {
            setOpen(false);
            setNotice("Artifact revision created · READY.");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
function ImportEditor({
  projectId,
  value,
  writable,
  refresh,
  refreshParents,
  saved,
}: {
  projectId: string;
  value: Pattern;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  saved: () => void;
}) {
  const w = useWorkspace(),
    prefix = useId(),
    input = useRef<HTMLInputElement>(null),
    [baseline, setBaseline] = useState(value.latestRevision.revisionNumber),
    [file, setFile] = useState<File | null>(null),
    [picker, setPicker] = useState(false),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const form = useForm<ArtifactDraft>({
    defaultValues: {
      ...draftOf(value.latestRevision),
      declaredFormat: "",
      displayName: "",
    },
  });
  const command = useWorkspaceCommand(
    [
      ...queryKeys.pattern(
        w.scope,
        w.organizationId,
        projectId,
        value.styleId,
        value.id,
      ),
      "artifact-upload",
    ],
    async (d: ArtifactDraft, signal) => {
      if (!file) throw new ApiError(400);
      const r = await api.POST(artifactUploadPath, {
        signal,
        params: {
          path: {
            organizationId: w.organizationId,
            projectId,
            styleId: value.styleId,
            patternId: value.id,
          },
        },
        body: { metadata: artifactBody(d, baseline), file: "" },
        bodySerializer: () => artifactFormData(d, baseline, file),
      });
      if (r.response.status !== 201) throw new ApiError(502);
      return checkedArtifactResult(
        requireData(r.data, r.response) as ArtifactResult,
        value.styleId,
        value.id,
        baseline,
        file.size,
      );
    },
    async () => {
      await refresh();
      if (!w.current()) return;
      form.reset({ ...draftOf(), declaredFormat: "", displayName: "" });
      setFile(null);
      if (input.current) input.current.value = "";
      setFailure(null);
      setNotice("Artifact revision created · READY.");
      saved();
    },
    async (e) => {
      setFailure(e);
      setBlocked(true);
      if (e instanceof ApiError && e.status === 409) await refreshParents();
      if (w.current()) await refresh();
    },
  );
  return (
    <form
      aria-label="Pattern artifact draft"
      onSubmit={form.handleSubmit((d) => {
        const p = artifactDraftSchema.safeParse(d);
        if (!p.success) {
          for (const issue of p.error.issues)
            form.setError(issue.path.join(".") as Path<ArtifactDraft>, {
              type: "validate",
              message: issue.message,
            });
          return;
        }
        if (!file || file.size < 1 || file.size > MAX_ARTIFACT_BYTES) {
          setFailure(
            new ApiError(file && file.size > MAX_ARTIFACT_BYTES ? 413 : 400),
          );
          return;
        }
        if (writable && !blocked && !command.isPending) command.mutate(d);
      })}
    >
      <h3>Import artifact as new revision</h3>
      <p>
        This creates a new Pattern revision. Existing revisions and artifacts
        remain unchanged.
      </p>
      <p>
        Draft baseline revision: {baseline}. Current latest:{" "}
        {value.latestRevision.revisionNumber}.
      </p>
      <fieldset disabled={!writable || command.isPending}>
        <legend>Artifact revision snapshot</legend>
        {(["name", "purpose", "displayName"] as const).map((f) => (
          <div key={f}>
            <label htmlFor={`${prefix}-${f}`}>
              {f === "name"
                ? "Artifact revision name"
                : f === "purpose"
                  ? "Artifact revision purpose"
                  : "Artifact display name"}
            </label>
            <Input
              id={`${prefix}-${f}`}
              {...form.register(f)}
              aria-invalid={!!form.formState.errors[f]}
              aria-describedby={`${prefix}-${f}-error`}
            />
            <p id={`${prefix}-${f}-error`} role="alert">
              {form.formState.errors[f]?.message}
            </p>
          </div>
        ))}
        <label htmlFor={`${prefix}-format`}>Declared artifact format</label>
        <select
          id={`${prefix}-format`}
          {...form.register("declaredFormat")}
          aria-invalid={!!form.formState.errors.declaredFormat}
          aria-describedby={`${prefix}-format-error`}
        >
          <option value="">Choose declared format</option>
          {formats.map((f) => (
            <option value={f} key={f}>
              {f.replace("_", "-")}
            </option>
          ))}
        </select>
        <p id={`${prefix}-format-error`} role="alert">
          {form.formState.errors.declaredFormat?.message}
        </p>
        <label htmlFor={`${prefix}-file`}>
          Artifact file (1 byte through 10 MiB)
        </label>
        <Input
          id={`${prefix}-file`}
          type="file"
          ref={input}
          onChange={(e) => {
            const next = e.currentTarget.files?.[0] ?? null;
            setFile(next);
            setFailure(null);
            if (next && !form.getValues("displayName"))
              form.setValue("displayName", next.name);
          }}
        />
        {file && (
          <p className="pattern-id">
            Selected file: {file.name} · {file.size.toLocaleString()} bytes
          </p>
        )}
        <p className="pattern-id">
          Measurement pin:{" "}
          {form.watch("measurementRevisionId") || "No Measurement pin"}
        </p>
        <Button onClick={() => setPicker(true)}>
          Pin measurement revision
        </Button>
        <Button onClick={() => form.setValue("measurementRevisionId", "")}>
          No Measurement pin
        </Button>
        {picker && (
          <MeasurementPicker
            projectId={projectId}
            styleId={value.styleId}
            choose={(id) => {
              form.setValue("measurementRevisionId", id);
              setPicker(false);
            }}
            close={() => setPicker(false)}
          />
        )}
        <p>
          AAMA/ASTM are declarations. The server checks a bounded structural
          envelope only, not conformance, geometry or malware.
        </p>
      </fieldset>
      {failure != null && <ApiErrorState error={failure} />}
      {blocked && (
        <section role="alert" aria-label="Artifact upload reconciliation">
          <p>
            Your file and metadata draft are retained. Outcome may include a
            committed reservation or stored bytes. Review authoritative
            Pattern/history. Matching metadata is not proof this command
            succeeded. No automatic resend.
          </p>
          <Button
            disabled={!writable || command.isPending}
            onClick={() => {
              setBaseline(value.latestRevision.revisionNumber);
              setBlocked(false);
              setFailure(null);
              setNotice(
                "Baseline reconciled. Review the retained file and submit explicitly.",
              );
            }}
          >
            Reconcile artifact draft
          </Button>
          <p>Reconciliation does not submit or change the selected file.</p>
        </section>
      )}
      {writable && (
        <Button type="submit" disabled={blocked || command.isPending}>
          Upload new artifact revision
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
