import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { useWorkspace, useWorkspaceCommand } from "../app/workspace";
import { Button, Input, Skeleton, Stack, Surface } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import {
  consentsPath,
  consentPath,
  useConsents,
  useConsent,
  useReleaseScope,
} from "../features/patternrelease/data";
import {
  checkedConsent,
  consentDraft,
  type Consent,
} from "../features/patternrelease/model";
import {
  Reconcile,
  PageButtons,
  releaseMeaning,
} from "../features/patternrelease/Shared";

export default function ReleaseConsentsPage() {
  const w = useWorkspace();
  return (
    <Stack>
      <h1>Recipient release consents</h1>
      <p>{releaseMeaning}</p>
      <Link to={`/organizations/${w.organizationId}/received-pattern-releases`}>
        Received releases
      </Link>
      {w.writer ? (
        <ConsentWorkspace />
      ) : (
        <p>Only Organization Owners and Admins may administer consents.</p>
      )}
    </Stack>
  );
}
function ConsentWorkspace() {
  const { w, key } = useReleaseScope(),
    cache = useQueryClient(),
    [cursor, setCursor] = useState<string | null>(null),
    q = useConsents(cursor),
    [selected, setSelected] = useState<Consent | null>(null),
    [source, setSource] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<unknown>();
  const issue = useWorkspaceCommand(
    [...key, "issue-consent"],
    async (input: string, signal) => {
      const normalized = consentDraft.parse(input.trim());
      if (normalized === w.organizationId) throw new ApiError(400);
      const r = await api.POST(consentsPath, {
        signal,
        params: { path: { organizationId: w.organizationId } },
        body: { sourceOrganizationId: normalized },
      });
      const result = checkedConsent(
        requireData(r.data, r.response),
        w.organizationId,
      );
      if (
        result.sourceOrganizationId !== normalized ||
        result.state !== "ISSUED" ||
        result.latestEventNumber !== 1
      )
        throw new ApiError(502);
      return result;
    },
    (value) => {
      setSource("");
      setSelected(value);
      setError(undefined);
      setCursor(null);
      void cache.invalidateQueries({ queryKey: key });
    },
    (e) => {
      setError(e);
      setUncertain(true);
      void cache.invalidateQueries({ queryKey: key });
    },
  );
  return (
    <>
      <Surface>
        <h2>Issue a single-use consent</h2>
        <p>
          Exchange Organization UUIDs out of band. This does not search for or
          confirm that a source Organization exists. Redemption ends 15 minutes
          after issuance.
        </p>
        <p>
          Your recipient Organization UUID:{" "}
          <code className="pattern-id">{w.organizationId}</code>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!uncertain) issue.mutate(source);
          }}
        >
          <label>
            Intended source Organization UUID
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              required
              disabled={issue.isPending}
            />
          </label>
          <Button
            type="submit"
            disabled={
              issue.isPending ||
              uncertain ||
              !consentDraft.safeParse(source.trim()).success ||
              source.trim().toLowerCase() === w.organizationId
            }
          >
            Issue consent
          </Button>
        </form>
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
              issue.reset();
            }}
          />
        )}
      </Surface>
      <Surface>
        <h2>Consent history</h2>
        {q.isPending && <Skeleton />}
        {q.isError && (
          <ApiErrorState error={q.error} retry={() => void q.refetch()} />
        )}
        {q.data?.items.length === 0 && <p>No consents recorded.</p>}
        <ul>
          {q.data?.items.map((c) => (
            <li key={c.id}>
              <Button onClick={() => setSelected(c)}>
                {c.id} · {c.state}
              </Button>
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
        <ConsentDetail
          key={selected.id}
          expected={selected}
          close={() => setSelected(null)}
        />
      )}
    </>
  );
}
function ConsentDetail({
  expected,
  close,
}: {
  expected: Consent;
  close: () => void;
}) {
  const { w, key } = useReleaseScope(),
    q = useConsent(expected),
    cache = useQueryClient(),
    [confirm, setConfirm] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState<unknown>(),
    [copied, setCopied] = useState(false);
  const withdraw = useWorkspaceCommand(
    [...key, "withdraw", expected.id],
    async (_: void, signal) => {
      if (!q.data) throw new ApiError(502);
      const r = await api.POST(`${consentPath}/withdrawals`, {
        signal,
        params: {
          path: { organizationId: w.organizationId, consentId: expected.id },
        },
        body: { expectedLatestEventNumber: q.data.latestEventNumber },
      });
      const value = checkedConsent(
        requireData(r.data, r.response),
        w.organizationId,
        expected.id,
        expected,
      );
      if (value.state !== "WITHDRAWN") throw new ApiError(502);
      return value;
    },
    () => {
      setConfirm(false);
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
    <Surface aria-label="Exact consent">
      <h2>Exact consent</h2>
      <Button onClick={close}>Close consent</Button>
      {q.isPending && <Skeleton />}
      {q.isError && (
        <ApiErrorState error={q.error} retry={() => void q.refetch()} />
      )}
      {q.data && (
        <>
          <dl className="read-facts">
            <div>
              <dt>Consent ID</dt>
              <dd className="pattern-id">{q.data.id}</dd>
            </div>
            <div>
              <dt>Intended source UUID</dt>
              <dd className="pattern-id">{q.data.sourceOrganizationId}</dd>
            </div>
            <div>
              <dt>Recipient UUID</dt>
              <dd className="pattern-id">{q.data.recipientOrganizationId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{q.data.state}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{q.data.issuedAt}</dd>
            </div>
            <div>
              <dt>Redemption expires</dt>
              <dd>{q.data.expiresAt}</dd>
            </div>
          </dl>
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(expected.id).then(
                () => {
                  if (w.current()) setCopied(true);
                },
                (e) => {
                  if (w.current()) setError(e);
                },
              );
            }}
          >
            Copy consent ID
          </Button>
          {copied && (
            <p role="status">
              Consent ID copied. Share it with the intended source out of band.
            </p>
          )}
          {q.data.state !== "WITHDRAWN" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I understand withdrawal is permanent and also ends access after
                consumption.
              </label>
              <Button
                disabled={
                  !confirm ||
                  withdraw.isPending ||
                  uncertain ||
                  q.isFetching ||
                  q.isError
                }
                onClick={() => withdraw.mutate()}
              >
                Withdraw consent permanently
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
            withdraw.reset();
          }}
        />
      )}
    </Surface>
  );
}
