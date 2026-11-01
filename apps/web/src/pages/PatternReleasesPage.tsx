import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { useWorkspace, useWorkspaceCommand } from "../app/workspace";
import { useProject, useStyle } from "../features/workspace/data";
import { usePattern, usePatternRevision } from "../features/pattern/data";
import { checkedArtifact } from "../features/pattern/artifactModel";
import type { Revision } from "../features/pattern/model";
import { artifactPath } from "../features/pattern/PatternArtifacts";
import {
  sourcePath,
  sourceDetailPath,
  useReleaseScope,
  useSourceReleases,
  useSourceRelease,
  useReleaseEvents,
} from "../features/patternrelease/data";
import {
  checkedSource,
  sourceDraft,
  type SourceScope,
  type SourceSummary,
  type SourceView,
} from "../features/patternrelease/model";
import {
  Reconcile,
  PageButtons,
  releaseMeaning,
} from "../features/patternrelease/Shared";
import { Button, Input, Skeleton, Stack, Surface } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";

export default function PatternReleasesPage() {
  const { projectId = "" } = useParams(),
    p = useProject(projectId);
  if (p.isPending) return <Skeleton label="Loading release Project" />;
  if (!p.data)
    return <ApiErrorState error={p.error} retry={() => void p.refetch()} />;
  return (
    <StyleStep
      project={projectId}
      active={!p.isError && p.data.status === "ACTIVE"}
    />
  );
}
function StyleStep({ project, active }: { project: string; active: boolean }) {
  const { styleId = "" } = useParams(),
    s = useStyle(project, styleId);
  if (s.isPending) return <Skeleton label="Loading release Style" />;
  if (!s.data)
    return <ApiErrorState error={s.error} retry={() => void s.refetch()} />;
  return (
    <PatternStep
      project={project}
      style={styleId}
      active={active && !s.isError && s.data.status === "ACTIVE"}
    />
  );
}
function PatternStep({
  project,
  style,
  active,
}: {
  project: string;
  style: string;
  active: boolean;
}) {
  const { patternId = "" } = useParams(),
    p = usePattern(project, style, patternId);
  if (p.isPending) return <Skeleton label="Loading release Pattern" />;
  if (!p.data)
    return <ApiErrorState error={p.error} retry={() => void p.refetch()} />;
  return (
    <RevisionStep
      key={`${project}:${style}:${patternId}`}
      project={project}
      style={style}
      pattern={patternId}
      active={active && !p.isError && p.data.status === "ACTIVE"}
    />
  );
}
function RevisionStep({
  project,
  style,
  pattern,
  active,
}: {
  project: string;
  style: string;
  pattern: string;
  active: boolean;
}) {
  const { revisionId = "" } = useParams(),
    r = usePatternRevision(project, style, pattern, revisionId, true);
  if (r.isPending) return <Skeleton label="Loading exact released revision" />;
  if (!r.data)
    return <ApiErrorState error={r.error} retry={() => void r.refetch()} />;
  return (
    <SourceWorkspace
      key={revisionId}
      project={project}
      revision={r.data}
      active={active && !r.isError}
    />
  );
}
function SourceWorkspace({
  project,
  revision,
  active,
}: {
  project: string;
  revision: Revision;
  active: boolean;
}) {
  const w = useWorkspace(),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<SourceSummary | null>(null),
    [preparing, setPreparing] = useState(false);
  const scope: SourceScope = {
      organizationId: w.organizationId,
      projectId: project,
      styleId: revision.styleId,
      patternId: revision.patternId,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
    },
    q = useSourceReleases(scope, cursor);
  return (
    <Stack>
      <nav aria-label="Source release navigation">
        <Link
          to={`/organizations/${w.organizationId}/projects/${project}/styles/${revision.styleId}/patterns/${revision.patternId}`}
        >
          Back to Pattern
        </Link>
      </nav>
      <h1>Exact Pattern releases</h1>
      <p>{releaseMeaning}</p>
      <h2>Pattern revision {revision.revisionNumber}</h2>
      <p>
        {revision.name} · <code className="pattern-id">{revision.id}</code>
      </p>
      <p>
        Source Organization UUID:{" "}
        <code className="pattern-id">{w.organizationId}</code>
      </p>
      <p>
        Any covered parent metadata change can end access. Expiry, withdrawal
        and revocation require a new consent and release for renewed access.
      </p>
      {w.writer && active ? (
        <Button onClick={() => setPreparing(!preparing)}>
          {preparing ? "Close release form" : "Prepare exact release"}
        </Button>
      ) : (
        <p>
          Creating or revoking releases requires Owner/Admin access and active
          source parents.
        </p>
      )}
      {preparing && w.writer && active && (
        <PrepareRelease
          scope={scope}
          revision={revision}
          saved={(value) => {
            setSelected(value.release);
            setCursor(null);
          }}
        />
      )}
      <Surface>
        <h2>Release receipts for this revision</h2>
        {q.isPending && <Skeleton />}
        {q.isError && (
          <ApiErrorState error={q.error} retry={() => void q.refetch()} />
        )}
        {q.data?.items.length === 0 && <p>No releases for this revision.</p>}
        <ul>
          {q.data?.items.map((s) => (
            <li key={s.id}>
              <Button onClick={() => setSelected(s)}>
                {s.id} · Recipient {s.recipientOrganizationId}
              </Button>
              <p>
                Released {s.releasedAt} · Expires {s.expiresAt}
              </p>
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
      {selected && (
        <SourceDetail
          key={selected.id}
          scope={scope}
          selected={selected}
          writable={w.writer && active}
          close={() => setSelected(null)}
        />
      )}
    </Stack>
  );
}
function PrepareRelease({
  scope,
  revision,
  saved,
}: {
  scope: SourceScope;
  revision: Revision;
  saved: (v: SourceView) => void;
}) {
  const { w, key } = useReleaseScope(),
    cache = useQueryClient(),
    [consent, setConsent] = useState(""),
    [purpose, setPurpose] = useState(""),
    [seconds, setSeconds] = useState("86400"),
    [confirmed, setConfirmed] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<unknown>(),
    purposeId = useId();
  const artifact = useQuery({
    queryKey: [...key, "artifact", scope],
    retry: false,
    refetchOnMount: "always",
    select: (value) =>
      value === null
        ? null
        : checkedArtifact(
            value,
            scope.styleId,
            scope.patternId,
            scope.revisionId,
          ),
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        try {
          const r = await api.GET(artifactPath, {
            signal,
            params: { path: scope },
          });
          return checkedArtifact(
            requireData(r.data, r.response),
            scope.styleId,
            scope.patternId,
            scope.revisionId,
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      }),
  });
  const parsed = sourceDraft.safeParse({
    consentId: consent.trim(),
    purpose,
    accessDurationSeconds: Number(seconds),
    confirmed,
  });
  const create = useWorkspaceCommand(
    [...key, "create-release", scope],
    async (_: void, signal) => {
      const value = sourceDraft.parse({
        consentId: consent.trim(),
        purpose,
        accessDurationSeconds: Number(seconds),
        confirmed,
      });
      if (artifact.isError) throw new ApiError(502);
      if (!artifact.data || artifact.data.state !== "READY")
        throw new ApiError(409);
      const r = await api.POST(sourcePath, {
        signal,
        params: { path: scope },
        body: {
          consentId: value.consentId,
          expectedLatestConsentEventNumber: 1,
          purpose: value.purpose,
          accessDurationSeconds: value.accessDurationSeconds,
        },
      });
      const result = checkedSource(requireData(r.data, r.response), scope);
      if (
        result.release.consentId !== value.consentId ||
        result.release.artifactId !== artifact.data.id ||
        result.release.sizeBytes !== artifact.data.sizeBytes ||
        result.release.displayName !== artifact.data.displayName ||
        result.release.declaredFormat !== artifact.data.declaredFormat ||
        result.release.patternRevisionNumber !== revision.revisionNumber ||
        result.release.purpose !== value.purpose ||
        result.lifecycle !== "ACTIVATED" ||
        result.latestEventNumber !== 1
      )
        throw new ApiError(502);
      return result;
    },
    (value) => {
      setConsent("");
      setPurpose("");
      setConfirmed(false);
      setError(undefined);
      saved(value);
      void cache.invalidateQueries({ queryKey: key });
    },
    (e) => {
      setUncertain(true);
      setError(e);
      void cache.invalidateQueries({ queryKey: key });
    },
  );
  return (
    <Surface aria-label="Create exact release">
      <h2>Create exact release</h2>
      {artifact.isPending && <Skeleton label="Checking exact artifact" />}
      {artifact.isError && (
        <ApiErrorState
          error={artifact.error}
          retry={() => void artifact.refetch()}
        />
      )}
      {artifact.data?.state === "READY" ? (
        <>
          <p>
            {artifact.data.displayName} · {artifact.data.declaredFormat} ·{" "}
            {artifact.data.sizeBytes.toLocaleString()} bytes · READY
          </p>
          <p>
            Human QA is informational and is not a release prerequisite. The
            recipient is immutably named by the consent supplied out of band;
            this form does not look up foreign Organizations.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!uncertain && parsed.success) create.mutate();
            }}
          >
            <label>
              Recipient-issued consent ID
              <Input
                value={consent}
                onChange={(e) => setConsent(e.target.value)}
                required
                disabled={create.isPending}
              />
            </label>
            <label htmlFor={purposeId}>Purpose shared with recipient</label>
            <textarea
              id={purposeId}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              required
              disabled={create.isPending}
            />
            <label>
              Access duration in seconds (1–86400)
              <Input
                type="number"
                min={1}
                max={86400}
                step={1}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
                required
                disabled={create.isPending}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={create.isPending}
              />
              I verified this consent with the intended recipient out of band
              and accept irreversible sharing of this exact revision.
            </label>
            <Button
              type="submit"
              disabled={
                !parsed.success ||
                uncertain ||
                create.isPending ||
                artifact.isFetching ||
                artifact.isError
              }
            >
              Create release
            </Button>
          </form>
        </>
      ) : (
        !artifact.isPending &&
        !artifact.isError && (
          <p>
            An exact READY artifact is required. This revision cannot be
            released.
          </p>
        )
      )}
      {error !== undefined && <ApiErrorState error={error} />}
      {uncertain && (
        <Reconcile
          refresh={async () => {
            await cache.invalidateQueries({ queryKey: key });
            const result = await artifact.refetch();
            if (result.error) throw result.error;
          }}
          done={() => {
            setUncertain(false);
            setError(undefined);
            create.reset();
          }}
        />
      )}
    </Surface>
  );
}
function SourceDetail({
  scope,
  selected,
  writable,
  close,
}: {
  scope: SourceScope;
  selected: SourceSummary;
  writable: boolean;
  close: () => void;
}) {
  const { key } = useReleaseScope(),
    cache = useQueryClient(),
    q = useSourceRelease(scope, selected),
    [history, setHistory] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<unknown>();
  const revoke = useWorkspaceCommand(
    [...key, "revoke", scope, selected.id],
    async (_: void, signal) => {
      if (!q.data) throw new ApiError(502);
      const r = await api.POST(`${sourceDetailPath}/revocations`, {
        signal,
        params: { path: { ...scope, releaseId: selected.id } },
        body: { expectedLatestEventNumber: q.data.latestEventNumber },
      });
      const v = checkedSource(
        requireData(r.data, r.response),
        scope,
        selected.id,
        selected,
      );
      if (v.lifecycle !== "REVOKED") throw new ApiError(502);
      return v;
    },
    () => {
      setConfirmed(false);
      setError(undefined);
      void cache.invalidateQueries({ queryKey: key });
    },
    (e) => {
      setUncertain(true);
      setError(e);
      void cache.invalidateQueries({ queryKey: key });
    },
  );
  return (
    <Surface aria-label="Source release detail">
      <h2>Exact release receipt</h2>
      <Button onClick={close}>Close release receipt</Button>
      {q.isPending && <Skeleton />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          <dl className="read-facts">
            <div>
              <dt>Release ID</dt>
              <dd className="pattern-id">{selected.id}</dd>
            </div>
            <div>
              <dt>Recipient Organization UUID</dt>
              <dd className="pattern-id">{selected.recipientOrganizationId}</dd>
            </div>
            <div>
              <dt>Exact revision</dt>
              <dd className="pattern-id">
                {selected.patternRevisionNumber} · {selected.patternRevisionId}
              </dd>
            </div>
            <div>
              <dt>Artifact</dt>
              <dd>
                {selected.displayName} · {selected.sizeBytes} bytes
              </dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{selected.purpose}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{selected.releasedAt}</dd>
            </div>
            <div>
              <dt>Access expires</dt>
              <dd>{selected.expiresAt}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>{q.data.lifecycle}</dd>
            </div>
            <div>
              <dt>Effective access</dt>
              <dd>{q.data.effectiveState}</dd>
            </div>
          </dl>
          <Button onClick={() => setHistory(!history)}>
            {history ? "Close release events" : "Open release events"}
          </Button>
          {history && (
            <ReleaseHistory
              scope={scope}
              release={selected.id}
              head={q.data.latestEventNumber}
            />
          )}
          {writable && q.data.lifecycle !== "REVOKED" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I understand revocation is permanent and cannot recall delivered
                bytes.
              </label>
              <Button
                disabled={
                  !confirmed ||
                  revoke.isPending ||
                  uncertain ||
                  q.isFetching ||
                  q.isError
                }
                onClick={() => revoke.mutate()}
              >
                Revoke release permanently
              </Button>
            </>
          )}
        </>
      )}
      {error !== undefined && <ApiErrorState error={error} />}
      {uncertain && (
        <Reconcile
          refresh={async () => {
            const r = await q.refetch();
            if (r.error) throw r.error;
          }}
          done={() => {
            setUncertain(false);
            setError(undefined);
            revoke.reset();
          }}
        />
      )}
    </Surface>
  );
}
function ReleaseHistory({
  scope,
  release,
  head,
}: {
  scope: SourceScope;
  release: string;
  head: number;
}) {
  const [anchor] = useState(head),
    [bounds, setBounds] = useState([head]),
    max = bounds[bounds.length - 1],
    q = useReleaseEvents(scope, release, max);
  return (
    <section aria-label="Pinned release events">
      <h3>Release events through {anchor}</h3>
      {q.isPending && <Skeleton />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      <ol>
        {q.data?.items.map((e) => (
          <li key={e.id}>
            {e.eventNumber} · {e.kind} · {e.occurredAt}
          </li>
        ))}
      </ol>
      {q.data?.nextMaxEventNumber !== null &&
        q.data?.nextMaxEventNumber !== undefined && (
          <Button
            onClick={() => setBounds([...bounds, q.data!.nextMaxEventNumber!])}
          >
            Older release events
          </Button>
        )}
      {bounds.length > 1 && (
        <Button onClick={() => setBounds(bounds.slice(0, -1))}>
          Newer pinned events
        </Button>
      )}
    </section>
  );
}
