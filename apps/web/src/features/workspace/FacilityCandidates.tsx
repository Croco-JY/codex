import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import {
  isCancelled,
  useWorkspace,
  useWorkspaceCommand,
} from "../../app/workspace";
import { Button, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { supplierOptions } from "../materials/materialQueries";
import {
  facilityDirectoryOptions,
  facilityOptions,
} from "../network/facilityQueries";
import { DirectoryFilters } from "../network/DirectoryFilters";
import { useNetworkReferences } from "../network/references";
import { validUuid, type FacilityFilters } from "../network/filters";
import type { Project, Style } from "./model";
import {
  candidateSchema,
  checkedCandidate,
  checkedCandidates,
  supportedFacility,
  supplierLabel,
  type Candidate,
  type CandidateInput,
} from "./facilityCandidateModel";

const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/facility-candidates" as const;
const removePath =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/facility-candidates/{candidateId}" as const;

/** Only successful, supported Facility results may introduce dependent Supplier queries. */
function useLive(ids: string[]) {
  const w = useWorkspace(),
    unique = [...new Set(ids)];
  const fQueries = useQueries({
    queries: unique.map((id) => facilityOptions(w.scope, id)),
  });
  const facilities = new Map(
    unique.flatMap((id, n) => {
      const q = fQueries[n];
      return q.isSuccess && !q.isError && supportedFacility(q.data, id)
        ? [[id, q.data] as const]
        : [];
    }),
  );
  const suppliers = [
    ...new Set([...facilities.values()].map((f) => f.supplierId)),
  ];
  const sQueries = useQueries({
    queries: suppliers.map((id) => ({
      ...supplierOptions(w.scope, id),
      retry: false,
    })),
  });
  return {
    facilities,
    suppliers: new Map(
      suppliers.map((id, n) => [
        id,
        sQueries[n].isError ? undefined : sQueries[n].data,
      ]),
    ),
  };
}

function LiveFacility({
  id,
  live,
}: {
  id: string;
  live: ReturnType<typeof useLive>;
}) {
  const f = live.facilities.get(id);
  return (
    <>
      <h3>
        {f
          ? `${f.name} · ${f.facilityType} · ${f.status}`
          : "Facility label unavailable"}
      </h3>
      <dl className="read-facts">
        <div>
          <dt>Facility ID</dt>
          <dd>
            <Link to={`/facilities/${id}`}>{id}</Link>
          </dd>
        </div>
        {f && (
          <div>
            <dt>Parent Supplier · contextual only</dt>
            <dd>
              <Link to={`/suppliers/${f.supplierId}`}>{f.supplierId}</Link>
              <br />
              <span>
                {supplierLabel(live.suppliers.get(f.supplierId), f.supplierId)}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </>
  );
}

export function FacilityCandidates({
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
  const [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const prefix = [
    ...queryKeys.style(w.scope, w.organizationId, project.id, style.id),
    "facility-candidates",
  ];
  const query = useQuery({
    queryKey: queryKeys.candidates(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
      25,
      offset,
    ),
    enabled: available,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(path, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId: project.id,
              styleId: style.id,
            },
            query: { limit: 25, offset },
          },
        });
        return checkedCandidates(
          requireData(r.data, r.response),
          style.id,
          offset,
        );
      }),
  });
  const rows = query.data?.items ?? [],
    live = useLive(rows.map((row) => row.facilityId));
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
    setOffset(0);
    await cache.refetchQueries(
      { queryKey: [...prefix, 25, 0], exact: true, type: "all" },
      { cancelRefetch: false },
    );
  };
  return (
    <Surface aria-label="Facility Candidates">
      <h2>Facility Candidates</h2>
      <p>
        Facilities under consideration only. No nomination, award, capability
        approval or production commitment is recorded.
      </p>
      {!w.writer && (
        <p>Facility Candidates are read-only for your membership.</p>
      )}
      {(project.status !== "ACTIVE" || style.status !== "ACTIVE") && (
        <p role="status">
          Facility Candidates are read-only while Project or Style is archived.
        </p>
      )}
      {query.isPending && <Skeleton label="Loading Facility Candidates" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <p>{rows.length} candidates loaded in this page.</p>
          {rows.length === 0 && (
            <p>No Facility candidates have been added for this Style.</p>
          )}
          <ul className="read-list">
            {rows.map((row) => (
              <li key={row.id}>
                <LiveFacility id={row.facilityId} live={live} />
                <dl className="read-facts">
                  <div>
                    <dt>Candidate ID</dt>
                    <dd>{row.id}</dd>
                  </div>
                  <div>
                    <dt>Added at</dt>
                    <dd>{row.createdAt}</dd>
                  </div>
                </dl>
                {w.writer && (
                  <RemoveCandidate
                    row={row}
                    projectId={project.id}
                    writable={writable}
                    refresh={refresh}
                    refreshParents={refreshParents}
                    report={setNotice}
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="workspace-actions">
            <Button
              disabled={offset === 0 || query.isFetching}
              onClick={() => setOffset(Math.max(0, offset - 25))}
            >
              Previous candidates
            </Button>
            <Button
              disabled={
                !query.data.hasMore || offset >= 100000 || query.isFetching
              }
              onClick={() => setOffset(offset + 25)}
            >
              Next candidates
            </Button>
          </div>
        </>
      )}
      {writable && !open && (
        <Button onClick={() => setOpen(true)}>Choose Facility</Button>
      )}
      {w.writer && open && (
        <Picker
          projectId={project.id}
          styleId={style.id}
          writable={writable}
          rows={rows}
          refresh={refresh}
          refreshParents={refreshParents}
          saved={() => {
            if (w.current()) setNotice("Facility candidate added.");
          }}
          close={() => setOpen(false)}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </Surface>
  );
}

function Picker({
  projectId,
  styleId,
  writable,
  rows,
  refresh,
  refreshParents,
  saved,
  close,
}: {
  projectId: string;
  styleId: string;
  writable: boolean;
  rows: Candidate[];
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  saved: () => void;
  close: () => void;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    refs = useNetworkReferences();
  const form = useForm<CandidateInput>({ defaultValues: { facilityId: "" } }),
    chosen = form.watch("facilityId");
  const [filters, setFilters] = useState<FacilityFilters>({}),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const results = useInfiniteQuery(facilityDirectoryOptions(w.scope, filters));
  const live = useLive(chosen && validUuid(chosen) ? [chosen] : []),
    facility = live.facilities.get(chosen);
  const duplicate = rows.some((row) => row.facilityId === chosen);
  const refreshChosen = async () => {
    if (!chosen || !w.current()) return;
    await cache.refetchQueries({
      queryKey: queryKeys.facility(w.scope, chosen),
      exact: true,
    });
    if (!w.current()) return;
    const state = cache.getQueryState(queryKeys.facility(w.scope, chosen)),
      data = cache.getQueryData(queryKeys.facility(w.scope, chosen));
    if (state?.status === "success" && supportedFacility(data, chosen))
      await cache.fetchQuery({
        ...supplierOptions(w.scope, data.supplierId),
        staleTime: 0,
        retry: false,
      });
  };
  const command = useWorkspaceCommand(
    [
      ...queryKeys.style(w.scope, w.organizationId, projectId, styleId),
      "facility-candidates",
      "add",
    ],
    async (body: CandidateInput, signal) => {
      const r = await api.POST(path, {
        signal,
        params: {
          path: { organizationId: w.organizationId, projectId, styleId },
        },
        body,
      });
      return checkedCandidate(requireData(r.data, r.response), styleId);
    },
    async () => {
      await refresh();
      if (!w.current()) return;
      form.reset({ facilityId: "" });
      setBlocked(false);
      setFailure(null);
      saved();
    },
    async (error) => {
      setFailure(error);
      setBlocked(true);
      await Promise.allSettled([
        refresh(),
        refreshChosen(),
        ...(error instanceof ApiError && error.status === 409
          ? [refreshParents()]
          : []),
      ]);
    },
  );
  return (
    <section aria-label="Add Facility Candidate">
      <h3>Add Facility Candidate</h3>
      <p>
        Browse the bounded global directory. Directory visibility and current
        Facility registration eligibility can differ; Supplier status is
        contextual only.
      </p>
      <fieldset disabled={!writable || command.isPending}>
        <legend>Facility discovery</legend>
        <DirectoryFilters
          kind="facilities"
          applied={filters}
          refs={refs}
          apply={setFilters}
        />
        {results.isPending && <Skeleton label="Loading Facility choices" />}
        {results.isError && <ApiErrorState error={results.error} />}
        <ul className="read-list">
          {results.data?.pages
            .flatMap((p) => p.items ?? [])
            .filter((f) => typeof f.id === "string" && validUuid(f.id))
            .map((f) => (
              <li key={f.id}>
                <Button
                  onClick={() => {
                    form.setValue("facilityId", f.id!);
                    setBlocked(false);
                    setFailure(null);
                  }}
                >
                  Choose {typeof f.name === "string" ? f.name : "Facility"}
                </Button>
                <p className="record-reference">Facility ID: {f.id}</p>
                <p>
                  {f.facilityType} · {f.country}
                </p>
              </li>
            ))}
        </ul>
        {results.hasNextPage && (
          <Button
            disabled={results.isFetching}
            onClick={() => void results.fetchNextPage({ cancelRefetch: false })}
          >
            Load more Facility choices
          </Button>
        )}
      </fieldset>
      {chosen && (
        <>
          <p className="record-reference">Chosen Facility: {chosen}</p>
          <LiveFacility id={chosen} live={live} />
          {!facility && (
            <p role="status">
              A supported current Facility response is required before adding.
              No Supplier identity is inferred.
            </p>
          )}
          <Button
            disabled={!writable || command.isPending}
            onClick={() => void refreshChosen().catch(() => {})}
          >
            Refresh chosen Facility
          </Button>
          <form
            onSubmit={form.handleSubmit((body) => {
              const parsed = candidateSchema.safeParse(body);
              if (
                writable &&
                facility?.status === "ACTIVE" &&
                !blocked &&
                !duplicate &&
                parsed.success
              ) {
                setFailure(null);
                command.mutate(parsed.data);
              }
            })}
          >
            <input type="hidden" {...form.register("facilityId")} />
            <Button
              type="submit"
              disabled={
                !writable ||
                facility?.status !== "ACTIVE" ||
                blocked ||
                duplicate ||
                command.isPending
              }
            >
              Add Facility Candidate
            </Button>
          </form>
        </>
      )}
      {duplicate && (
        <p role="status">
          This Facility is already a candidate. A matching Candidate exists;
          this does not identify which request created it.
        </p>
      )}
      {failure != null && !isCancelled(failure) && (
        <ApiErrorState error={failure} />
      )}
      {blocked && (
        <div role="alert">
          <p>
            Your Facility draft is retained. Review the refreshed workspace,
            Facility and first Candidate page before an explicit new submission.
          </p>
          {failure instanceof ApiError &&
            (failure.status === 0 || failure.status >= 500) &&
            !duplicate && (
              <p>
                The outcome remains uncertain. Absence from a bounded page does
                not prove the Candidate was not created.
              </p>
            )}
          <Button
            disabled={
              !writable ||
              facility?.status !== "ACTIVE" ||
              duplicate ||
              command.isPending
            }
            onClick={() => {
              setBlocked(false);
              setFailure(null);
            }}
          >
            Review retained Facility draft
          </Button>
        </div>
      )}
      <Button
        className="secondary"
        disabled={command.isPending}
        onClick={close}
      >
        Cancel Facility draft
      </Button>
    </section>
  );
}
function RemoveCandidate({
  row,
  projectId,
  writable,
  refresh,
  refreshParents,
  report,
}: {
  row: Candidate;
  projectId: string;
  writable: boolean;
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  report: (message: string) => void;
}) {
  const w = useWorkspace();
  const [confirm, setConfirm] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const command = useWorkspaceCommand<void, void>(
    [
      ...queryKeys.style(w.scope, w.organizationId, projectId, row.styleId),
      "facility-candidates",
      row.id,
      "remove",
    ],
    async (_: void, signal) => {
      await api.DELETE(removePath, {
        signal,
        params: {
          path: {
            organizationId: w.organizationId,
            projectId,
            styleId: row.styleId,
            candidateId: row.id,
          },
        },
      });
    },
    async () => {
      await refresh();
      if (w.current()) report("Facility candidate removed.");
    },
    async (error) => {
      setFailure(error);
      report(
        error instanceof ApiError && error.status === 404
          ? "Candidate is no longer present."
          : "Removal outcome requires review. Absence from a bounded page does not prove global absence.",
      );
      await Promise.all([
        refresh(),
        ...(error instanceof ApiError && error.status === 409
          ? [refreshParents()]
          : []),
      ]);
    },
  );
  return (
    <>
      {writable && !confirm && (
        <Button onClick={() => setConfirm(true)}>Remove candidate</Button>
      )}
      {confirm && (
        <div role="group" aria-label="Confirm Candidate removal">
          <p>
            Remove only this private candidate? The Facility and Supplier remain
            unchanged.
          </p>
          <Button
            disabled={!writable || command.isPending}
            onClick={() => command.mutate()}
          >
            Confirm remove
          </Button>
          <Button
            className="secondary"
            disabled={command.isPending}
            onClick={() => {
              setConfirm(false);
              setFailure(null);
            }}
          >
            Cancel remove
          </Button>
        </div>
      )}
      {failure != null && !isCancelled(failure) && (
        <>
          <ApiErrorState error={failure} />
          <p role="status">
            {failure instanceof ApiError && failure.status === 404
              ? "Candidate is no longer present."
              : "Removal was not confirmed. Review the bounded refreshed list; absence on one page does not prove global absence. Explicit action is required."}
          </p>
        </>
      )}
    </>
  );
}
