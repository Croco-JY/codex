import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui";
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
  return "unavailable Measurement request";
}
export function MeasurementRecoveryPanel({
  authority,
  visibleChannels,
}: Props) {
  const [offset, setOffset] = useState(0),
    [completed, setCompleted] = useState("");
  const page = authority.recoveries(offset);
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
      {page.total > measurementRecoveryPageSize && (
        <nav aria-label="Recovery requests">
          <Button
            disabled={page.offset === 0}
            onClick={() =>
              setOffset(Math.max(0, page.offset - measurementRecoveryPageSize))
            }
          >
            Previous recovery requests
          </Button>
          <Button
            disabled={page.offset + page.items.length >= page.total}
            onClick={() => setOffset(page.offset + measurementRecoveryPageSize)}
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
