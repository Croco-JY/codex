import { useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { useWorkspace, useWorkspaceCommand } from "../app/workspace";
import { Button, Skeleton, Stack, Surface } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import {
  receivedDetailPath,
  useReceived,
  useReceivedDetail,
  useReleaseScope,
} from "../features/patternrelease/data";
import {
  checkedReceived,
  type Received,
} from "../features/patternrelease/model";
import { PageButtons, releaseMeaning } from "../features/patternrelease/Shared";

export default function ReceivedReleasesPage() {
  const { w, key } = useReleaseScope(),
    { releaseId } = useParams(),
    cache = useQueryClient();
  let expected: Received | undefined;
  try {
    const selected = cache.getQueryData([
      ...key,
      "selected-received",
      releaseId,
    ]);
    if (releaseId && selected !== undefined)
      expected = checkedReceived(selected, w.organizationId, releaseId);
  } catch (error) {
    return <ApiErrorState error={error} page />;
  }
  return (
    <Stack>
      <h1>Received Pattern releases</h1>
      <p>{releaseMeaning}</p>
      <p>
        Recipient Organization UUID:{" "}
        <code className="pattern-id">{w.organizationId}</code>
      </p>
      <nav aria-label="Recipient release navigation">
        {w.writer && (
          <Link to={`/organizations/${w.organizationId}/release-consents`}>
            Manage release consents
          </Link>
        )}
        {releaseId && (
          <>
            {" "}
            ·{" "}
            <Link
              to={`/organizations/${w.organizationId}/received-pattern-releases`}
            >
              Back to inbox
            </Link>
          </>
        )}
      </nav>
      {releaseId ? (
        <ReceivedDetail key={releaseId} id={releaseId} expected={expected} />
      ) : (
        <Inbox />
      )}
    </Stack>
  );
}
function Inbox() {
  const { w, key } = useReleaseScope(),
    cache = useQueryClient(),
    [cursor, setCursor] = useState<string | null>(null),
    q = useReceived(cursor);
  return (
    <Surface>
      <h2>Recipient inbox</h2>
      {q.isPending && <Skeleton />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data?.items.length === 0 && <p>No releases received.</p>}
      <ul>
        {q.data?.items.map((r) => (
          <li key={r.releaseId}>
            <Link
              to={`/organizations/${w.organizationId}/received-pattern-releases/${r.releaseId}`}
              onClick={() =>
                cache.setQueryData(
                  [...key, "selected-received", r.releaseId],
                  r,
                )
              }
            >
              {r.effectiveState === "ACTIVE" ? r.displayName : r.releaseId} ·{" "}
              {r.effectiveState}
            </Link>
            <p>Expires {r.expiresAt}</p>
          </li>
        ))}
      </ul>
      <PageButtons
        cursor={cursor}
        next={q.data?.nextCursor ?? null}
        older={() => setCursor(q.data?.nextCursor ?? null)}
        reset={() => setCursor(null)}
      />
    </Surface>
  );
}
function ReceivedDetail({ id, expected }: { id: string; expected?: Received }) {
  const q = useReceivedDetail(id, expected);
  return (
    <Surface aria-label="Received release detail">
      <h2>Exact received release</h2>
      {q.isPending && <Skeleton />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          <dl className="read-facts">
            <div>
              <dt>Release ID</dt>
              <dd className="pattern-id">{q.data.releaseId}</dd>
            </div>
            <div>
              <dt>Source Organization UUID</dt>
              <dd className="pattern-id">{q.data.sourceOrganizationId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{q.data.effectiveState}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{q.data.releasedAt}</dd>
            </div>
            <div>
              <dt>Access expires</dt>
              <dd>{q.data.expiresAt}</dd>
            </div>
          </dl>
          {q.data.effectiveState === "ACTIVE" ? (
            <>
              <h3>{q.data.displayName}</h3>
              <p>
                Exact Pattern revision {q.data.patternRevisionNumber}:{" "}
                <code className="pattern-id">{q.data.patternRevisionId}</code>
              </p>
              <p>
                {q.data.declaredFormat} · {q.data.sizeBytes.toLocaleString()}{" "}
                bytes
              </p>
              <p>{q.data.purpose}</p>
              <Download
                key={q.data.releaseId}
                value={q.data}
                available={!q.isError && !q.isFetching}
                refresh={() => q.refetch()}
              />
            </>
          ) : (
            <p>
              Content and source details are unavailable. Ask the source to
              arrange a fresh consent and release.
            </p>
          )}
        </>
      )}
    </Surface>
  );
}
function Download({
  value,
  available,
  refresh,
}: {
  value: Extract<Received, { effectiveState: "ACTIVE" }>;
  available: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { w, key } = useReleaseScope(),
    controller = useRef<AbortController | null>(null),
    url = useRef<string | null>(null),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  useLayoutEffect(
    () => () => {
      controller.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    },
    [],
  );
  const download = useWorkspaceCommand(
    [...key, "download", value.releaseId],
    async (_: void, signal) => {
      const owned = new AbortController();
      controller.current = owned;
      const abort = () => owned.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const r = await api.GET(`${receivedDetailPath}/content`, {
          signal: owned.signal,
          params: {
            path: {
              organizationId: w.organizationId,
              releaseId: value.releaseId,
            },
          },
          parseAs: "blob",
        });
        const bytes = requireData(r.data, r.response);
        if (
          r.response.status !== 200 ||
          r.response.headers
            .get("Content-Type")
            ?.split(";")[0]
            .toLowerCase() !== "application/octet-stream" ||
          bytes.size !== value.sizeBytes ||
          bytes.size > 10485760
        )
          throw new ApiError(502);
        if (!w.current() || signal.aborted || owned.signal.aborted)
          throw new DOMException("Download cancelled", "AbortError");
        url.current = URL.createObjectURL(
          new Blob([bytes], { type: "application/octet-stream" }),
        );
        try {
          if (!w.current() || signal.aborted || owned.signal.aborted)
            throw new DOMException("Download cancelled", "AbortError");
          const a = document.createElement("a");
          a.href = url.current;
          a.download = value.displayName;
          document.body.appendChild(a);
          try {
            a.click();
          } finally {
            a.remove();
          }
        } finally {
          URL.revokeObjectURL(url.current);
          url.current = null;
        }
      } finally {
        signal.removeEventListener("abort", abort);
        if (controller.current === owned) controller.current = null;
      }
    },
    () => {
      setError(undefined);
      setNotice(
        "Download started. This exact file remains subject to the stated sharing limits.",
      );
    },
    (e) => {
      setError(e);
      void refresh();
    },
  );
  return (
    <>
      <Button
        disabled={!available || download.isPending}
        onClick={() => {
          setNotice("");
          download.mutate();
        }}
      >
        Download exact artifact
      </Button>
      {download.isPending && (
        <Button
          onClick={() => {
            controller.current?.abort();
            setNotice("Download cancelled.");
          }}
        >
          Cancel download
        </Button>
      )}
      {error !== undefined && <ApiErrorState error={error} />}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
