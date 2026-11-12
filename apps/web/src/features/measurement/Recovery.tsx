import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button, Input } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { ApiError } from "../../api/errors";
import {
  useMeasurementSpec,
  useMeasurementHistory,
  useMeasurementRevision,
  type MeasurementAuthority,
} from "./data";
import {
  measurementRecoveryPageSize,
  type MeasurementRecovery,
  type MeasurementRecoveryRequest,
} from "./measurementTrust";

type Props = {
  authority: MeasurementAuthority;
  visibleChannels: ReadonlySet<string>;
  refreshSpec: () => Promise<unknown>;
};
function label(d: MeasurementRecovery) {
  const request = d.request;
  if (request?.kind === "history")
    return `failed history window through revision ${request.max} (${request.limit} per page)`;
  if (request?.kind === "revision")
    return `failed exact revision ${request.revisionId}`;
  if (request?.kind === "spec")
    return d.channel === "mutation"
      ? "authoritative measurements after the uncertain submission"
      : "failed Measurement Spec";
  const history = /^history:(\d+):(\d+)$/.exec(d.channel);
  if (history)
    return `failed history window through revision ${history[1]} (${history[2]} per page)`;
  return "unavailable Measurement request";
}
export function MeasurementRecoveryPanel({
  authority,
  visibleChannels,
  refreshSpec,
}: Props) {
  const [offset, setOffset] = useState(0),
    [completed, setCompleted] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  // Reserve one observer for the independently chosen ordinary read, rather
  // than exceed the existing eight-observer recovery budget.
  const page = authority.recoveries(
    offset,
    requestOpen ? measurementRecoveryPageSize - 1 : measurementRecoveryPageSize,
  );
  const previous = useRef<readonly MeasurementRecovery[]>([]);
  useLayoutEffect(() => {
    // Bounded presentation history only. Authority and failure ownership remain
    // in the registry even when a successful read unmounts its recovery row.
    const recovered = previous.current.filter(
      (d) => authority.recoveryState(d) === "recovered",
    );
    previous.current = page.items;
    if (recovered.length) setCompleted(recovered.map(label).join(", "));
  });
  if (page.unavailable)
    return (
      <p role="status">
        Measurement recovery requires a current authenticated workspace.
      </p>
    );
  if (!page.total && !completed) return null;
  return (
    <section aria-label="Measurement recovery">
      <h3>Measurement recovery</h3>
      <p role="status">
        {page.total
          ? `${page.total} blocking request${page.total === 1 ? "" : "s"} require recovery. Editing and submission remain blocked.`
          : "All blocking read requests are recovered. Review the draft baseline before submitting explicitly."}
      </p>
      {completed && (
        <p role="status">
          {completed} recovered.{" "}
          {page.total
            ? "Other blocking requests remain."
            : "Read recovery did not submit or rebase your draft."}
        </p>
      )}
      <ul>
        {page.items.map((d) => (
          <li key={d.channel}>
            <p>{label(d)}</p>
            {!d.request ? (
              <p role="status">{d.blockedReason}</p>
            ) : visibleChannels.has(d.channel) ? (
              <p>
                Use the retry in the{" "}
                {d.request.kind === "history"
                  ? "Measurement revision history"
                  : d.request.kind === "revision"
                    ? "selected revision"
                    : "Measurement Spec"}{" "}
                section.
              </p>
            ) : (
              <RecoveryObserver
                authority={authority}
                descriptor={d}
                request={d.request}
              />
            )}
          </li>
        ))}
      </ul>
      {page.items.some((d) => !d.request) && (
        <div>
          <Button onClick={() => void refreshSpec()}>
            Refresh authoritative Measurement Spec
          </Button>
          <Button onClick={() => setRequestOpen(true)}>
            Request authoritative history
          </Button>
          <p>
            Choose history bounds from the authenticated Spec. A cached key is
            not request authorization or trusted history.
          </p>
        </div>
      )}
      {requestOpen && page.total > 0 && (
        <HistoryRequest authority={authority} />
      )}
      {page.total > page.pageSize && (
        <nav aria-label="Recovery requests">
          <Button
            disabled={page.offset === 0}
            onClick={() => setOffset(Math.max(0, page.offset - page.pageSize))}
          >
            Previous recovery requests
          </Button>
          <Button
            disabled={page.offset + page.items.length >= page.total}
            onClick={() => setOffset(page.offset + page.pageSize)}
          >
            More recovery requests
          </Button>
        </nav>
      )}
    </section>
  );
}
type ObserverProps = {
  authority: MeasurementAuthority;
  descriptor: MeasurementRecovery;
};
function RecoveryObserver(
  p: ObserverProps & { request: MeasurementRecoveryRequest },
) {
  switch (p.request.kind) {
    case "spec":
      return <SpecRecovery {...p} />;
    case "history":
      return <HistoryRecovery {...p} request={p.request} />;
    case "revision":
      return <RevisionRecovery {...p} request={p.request} />;
  }
}
function SpecRecovery(p: ObserverProps) {
  const c = p.authority.context;
  const query = useMeasurementSpec(
    c.projectId,
    c.styleId,
    false,
    false,
    p.descriptor,
  );
  return <RecoveryAction {...p} query={query} />;
}
function HistoryRecovery(
  p: ObserverProps & {
    request: Extract<MeasurementRecoveryRequest, { kind: "history" }>;
  },
) {
  const c = p.authority.context,
    q = p.request;
  const query = useMeasurementHistory(
    c.projectId,
    { id: q.specId, styleId: c.styleId },
    q.max,
    false,
    false,
    q.limit,
    p.descriptor,
  );
  return <RecoveryAction {...p} query={query} />;
}
function RevisionRecovery(
  p: ObserverProps & {
    request: Extract<MeasurementRecoveryRequest, { kind: "revision" }>;
  },
) {
  const c = p.authority.context,
    q = p.request;
  const query = useMeasurementRevision(
    c.projectId,
    { id: q.specId, styleId: c.styleId },
    q.revisionId,
    false,
    p.descriptor,
  );
  return <RecoveryAction {...p} query={query} />;
}
function RecoveryAction({
  authority,
  descriptor,
  query,
}: ObserverProps & {
  query: {
    isFetching: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
  };
}) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Presentation lifetime only; immutable facts and request authority remain in
  // the original registry. A retired row cannot announce into its replacement.
  const owner = useRef<{ active: boolean } | null>(null);
  useLayoutEffect(() => {
    const token = { active: true };
    owner.current = token;
    return () => {
      token.active = false;
    };
  }, []);
  async function retry() {
    const token = owner.current;
    if (!token?.active) return;
    if (busy) return;
    setFailed(false);
    setBusy(true);
    try {
      authority.requireRecovery(descriptor);
      await query.refetch();
      if (!token.active) return;
      const state = authority.recoveryState(descriptor);
      if (state === "pending") setFailed(true);
    } catch {
      if (token.active && authority.recoveryState(descriptor) === "pending")
        setFailed(true);
    } finally {
      if (token.active) setBusy(false);
    }
  }
  return (
    <div>
      {busy && (
        <p role="status">Recovery in progress for {label(descriptor)}.</p>
      )}
      {failed && (
        <ApiErrorState
          error={query.error ?? new ApiError(502)}
          title="Measurement recovery failed"
        />
      )}
      <Button disabled={busy} onClick={() => void retry()}>
        Reload {label(descriptor)}
      </Button>
    </div>
  );
}

// An ordinary, explicit application read is the prerequisite for a cache-only
// unknown window. Its target is chosen by the user and validated against trusted
// Spec authority, not minted from a cached key or a recovery descriptor.
function HistoryRequest({ authority }: { authority: MeasurementAuthority }) {
  const id = useId();
  const [maximum, setMaximum] = useState(String(authority.recoveries().head));
  const [limit, setLimit] = useState("25");
  const [target, setTarget] = useState<Readonly<{
    specId: string;
    max: number;
    limit: number;
  }> | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <section aria-label="Authoritative history request">
      <h4>Choose an authoritative history request</h4>
      <form
        aria-label="Choose history bounds"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (!/^[1-9]\d*$/.test(maximum) || !/^[1-9]\d*$/.test(limit))
              throw new ApiError(400);
            setTarget(authority.historyTarget(Number(maximum), Number(limit)));
            setInvalid(false);
          } catch {
            setInvalid(true);
            setTarget(null);
          }
        }}
      >
        <label htmlFor={id + "-max"}>Historical maximum</label>
        <Input
          id={id + "-max"}
          inputMode="numeric"
          value={maximum}
          onChange={(e) => setMaximum(e.target.value)}
        />
        <label htmlFor={id + "-limit"}>History page limit</label>
        <Input
          id={id + "-limit"}
          inputMode="numeric"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
        <Button type="submit">Choose history request</Button>
        {invalid && (
          <p role="alert">
            Choose a positive maximum no greater than the authenticated Spec
            head, and a page limit between 1 and 100. Refresh the Spec if its
            head is unavailable or outdated.
          </p>
        )}
      </form>
      {target && (
        <HistoryRequestAction
          key={JSON.stringify(target)}
          authority={authority}
          target={target}
        />
      )}
    </section>
  );
}
function HistoryRequestAction({
  authority,
  target,
}: {
  authority: MeasurementAuthority;
  target: Readonly<{ specId: string; max: number; limit: number }>;
}) {
  const c = authority.context;
  const query = useMeasurementHistory(
    c.projectId,
    { id: target.specId, styleId: c.styleId },
    target.max,
    false,
    false,
    target.limit,
    undefined,
    true,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [complete, setComplete] = useState(false);
  const owner = useRef<{ active: boolean } | null>(null);
  useLayoutEffect(() => {
    const token = { active: true };
    owner.current = token;
    return () => {
      token.active = false;
    };
  }, []);
  async function read() {
    const token = owner.current;
    if (!token?.active || busy) return;
    setBusy(true);
    setError(undefined);
    setComplete(false);
    try {
      await query.refetch({ throwOnError: true });
      if (token.active && c.current()) setComplete(true);
    } catch (failure) {
      if (token.active && c.current()) setError(failure);
    } finally {
      if (token.active) setBusy(false);
    }
  }
  return (
    <div>
      <p>
        Selected history maximum {target.max}, limit {target.limit}. Choosing
        bounds has not authenticated any history.
      </p>
      {busy && <p role="status">Authoritative history request in progress.</p>}
      {error !== undefined && (
        <ApiErrorState
          error={error}
          title="Authoritative history request failed"
        />
      )}
      {complete && (
        <p role="status">
          The selected history response was authenticated and validated. Other
          outstanding channels and draft reconciliation remain independent.
        </p>
      )}
      <Button disabled={busy} onClick={() => void read()}>
        Load selected history window
      </Button>
    </div>
  );
}
