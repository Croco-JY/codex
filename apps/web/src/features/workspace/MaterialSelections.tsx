import { useId, useState } from "react";
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
import { Button, Input, Skeleton, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import {
  catalogReferenceOptions,
  materialOptions,
  variantOptions,
  listingListOptions,
} from "../materials/materialQueries";
import type { components } from "../../api/schema";
import type { Project, Style } from "./model";
import {
  checkedSelection,
  checkedSelections,
  liveLabel,
  pageReferences,
  sameScope,
  selectionSchema,
  uuid,
  type Selection,
  type SelectionInput,
} from "./materialSelectionModel";
const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/material-selections" as const;
const removePath =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/material-selections/{selectionId}" as const;
function useLive(rows: Selection[]) {
  const w = useWorkspace(),
    refs = pageReferences(rows);
  const results = useQueries({
    queries: refs.map((ref) =>
      catalogReferenceOptions(w.scope, ref.kind, ref.id),
    ),
  });
  return new Map(
    refs.map((ref, n) => [
      `${ref.kind}:${ref.id}`,
      results[n].isError ? undefined : results[n].data,
    ]),
  );
}
export function MaterialSelections({
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
    "material-selections",
  ];
  const query = useQuery({
    queryKey: queryKeys.selections(
      w.scope,
      w.organizationId,
      project.id,
      style.id,
      25,
      offset,
    ),
    retry: false,
    enabled: available,
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
        return checkedSelections(
          requireData(r.data, r.response),
          style.id,
          offset,
        );
      }),
  });
  const rows = query.data?.items ?? [],
    live = useLive(rows);
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
    <Surface aria-label="Material Selections">
      <h2>Material Selections</h2>
      <p>
        Canonical catalog references under consideration. No price, quantity or
        commercial terms are copied.
      </p>
      {!w.writer && (
        <p>Material Selections are read-only for your membership.</p>
      )}
      {(project.status !== "ACTIVE" || style.status !== "ACTIVE") && (
        <p role="status">
          Material Selections are read-only while Project or Style is archived.
        </p>
      )}
      {query.isPending && <Skeleton label="Loading Material Selections" />}
      {query.isError && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && (
        <>
          <p>{rows.length} selections loaded in this page.</p>
          {rows.length === 0 && <p>No materials selected for this Style.</p>}
          <ul className="read-list">
            {rows.map((row) => (
              <li key={row.id}>
                <h3>
                  {liveLabel(
                    live.get(`material:${row.materialId}`),
                    "material",
                    row.materialId,
                    row.materialId,
                  )}
                </h3>
                <dl className="read-facts">
                  <div>
                    <dt>Material ID</dt>
                    <dd>
                      <Link to={`/materials/${row.materialId}`}>
                        {row.materialId}
                      </Link>
                    </dd>
                  </div>
                  {row.variantId && (
                    <div>
                      <dt>Variant ID</dt>
                      <dd>
                        {row.variantId}
                        <br />
                        {liveLabel(
                          live.get(`variant:${row.variantId}`),
                          "variant",
                          row.variantId,
                          row.materialId,
                        )}
                      </dd>
                    </div>
                  )}
                  {row.listingId && (
                    <div>
                      <dt>Listing ID</dt>
                      <dd>
                        <Link to={`/material-listings/${row.listingId}`}>
                          {row.listingId}
                        </Link>
                        <br />
                        {liveLabel(
                          live.get(`listing:${row.listingId}`),
                          "listing",
                          row.listingId,
                          row.materialId,
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Selection ID</dt>
                    <dd>{row.id}</dd>
                  </div>
                  <div>
                    <dt>Selected at</dt>
                    <dd>{row.createdAt}</dd>
                  </div>
                </dl>
                {w.writer && (
                  <RemoveSelection
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
              Previous selections
            </Button>
            <Button
              disabled={
                !query.data.hasMore || offset >= 100000 || query.isFetching
              }
              onClick={() => setOffset(offset + 25)}
            >
              Next selections
            </Button>
          </div>
        </>
      )}
      {writable && !open && (
        <Button onClick={() => setOpen(true)}>Choose catalog Material</Button>
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
            if (w.current()) setNotice("Material selection added.");
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
  rows: Selection[];
  refresh: () => Promise<unknown>;
  refreshParents: () => Promise<unknown>;
  saved: () => void;
  close: () => void;
}) {
  const w = useWorkspace(),
    cache = useQueryClient(),
    id = useId();
  const form = useForm<{ keyword: string }>({ defaultValues: { keyword: "" } });
  const [search, setSearch] = useState<string | null>(null),
    [chosen, setChosen] = useState<
      components["schemas"]["MaterialView"] | null
    >(null),
    [variant, setVariant] = useState(""),
    [listing, setListing] = useState(""),
    [blocked, setBlocked] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const found = useInfiniteQuery({
    ...materialOptions(w.scope, search ? { q: search } : {}),
    enabled: search !== null,
  });
  const variants = useInfiniteQuery(variantOptions(w.scope, chosen?.id ?? "")),
    listings = useInfiniteQuery(listingListOptions(w.scope, chosen?.id ?? ""));
  const vRows = variants.data?.pages.flat() ?? [],
    lRows = listings.data?.pages.flat() ?? [];
  const input: SelectionInput = {
    materialId: chosen?.id ?? "",
    variantId: variant || null,
    listingId: listing || null,
  };
  const refs = pageReferences(
    chosen && uuid(chosen.id)
      ? [
          {
            id: chosen.id,
            styleId,
            materialId: chosen.id,
            variantId: variant || null,
            listingId: listing || null,
            createdAt: "",
          },
        ]
      : [],
  );
  const exact = useQueries({
    queries: refs.map((r) => catalogReferenceOptions(w.scope, r.kind, r.id)),
  });
  const coherent =
    !!chosen &&
    uuid(chosen.id) &&
    chosen.status === "ACTIVE" &&
    (!variant ||
      vRows.some(
        (v) =>
          v.id === variant &&
          v.materialId === chosen.id &&
          v.status === "ACTIVE",
      )) &&
    (!listing ||
      lRows.some(
        (l) =>
          l.id === listing &&
          l.materialId === chosen.id &&
          l.status === "ACTIVE",
      ));
  const currentlyActive = exact.every(
    (r) => r.data?.status === "ACTIVE" && !r.isError,
  );
  const duplicate = rows.some((row) => sameScope(row, input));
  const command = useWorkspaceCommand(
    [
      ...queryKeys.style(w.scope, w.organizationId, projectId, styleId),
      "material-selections",
      "add",
    ],
    async (body: SelectionInput, signal) => {
      const r = await api.POST(path, {
        signal,
        params: {
          path: { organizationId: w.organizationId, projectId, styleId },
        },
        body,
      });
      return checkedSelection(requireData(r.data, r.response), styleId);
    },
    async () => {
      await refresh();
      if (!w.current()) return;
      setChosen(null);
      setVariant("");
      setListing("");
      setBlocked(false);
      setFailure(null);
      saved();
    },
    async (error) => {
      setFailure(error);
      setBlocked(true);
      await Promise.all([
        refresh(),
        ...(error instanceof ApiError && error.status === 409
          ? [refreshParents()]
          : []),
        ...refs.map((r) =>
          cache.refetchQueries({
            queryKey: catalogReferenceOptions(w.scope, r.kind, r.id).queryKey,
            exact: true,
          }),
        ),
      ]);
    },
  );
  return (
    <section aria-label="Add Material Selection">
      <h3>Add Material Selection</h3>
      <form
        onSubmit={form.handleSubmit((d) => {
          if (writable) setSearch(d.keyword.trim());
        })}
      >
        <label htmlFor={id}>Catalog Material keyword</label>
        <Input id={id} {...form.register("keyword")} readOnly={!writable} />
        <Button type="submit" disabled={!writable}>
          Search active Materials
        </Button>
      </form>
      {found.isError && <ApiErrorState error={found.error} />}
      <ul className="read-list">
        {found.data?.pages
          .flatMap((p) => p.items ?? [])
          .filter((m) => uuid(m.id) && m.status === "ACTIVE")
          .map((m) => (
            <li key={m.id}>
              <Button
                disabled={!writable}
                onClick={() => {
                  setChosen(m);
                  setVariant("");
                  setListing("");
                  setBlocked(false);
                  setFailure(null);
                }}
              >
                Choose {m.displayName ?? "Catalog Material"}
              </Button>
              <p className="record-reference">{m.id}</p>
            </li>
          ))}
      </ul>
      {found.hasNextPage && (
        <Button
          disabled={found.isFetching || !writable}
          onClick={() => void found.fetchNextPage({ cancelRefetch: false })}
        >
          Load more Materials
        </Button>
      )}
      {chosen && (
        <>
          <p>Chosen Material: {chosen.displayName ?? chosen.id}</p>
          <p className="record-reference">Material ID: {chosen.id}</p>
          <label htmlFor={`${id}-variant`}>Optional Variant</label>
          <select
            className="input"
            id={`${id}-variant`}
            value={variant}
            disabled={!writable || variants.isError}
            onChange={(e) => {
              setVariant(e.target.value);
              setBlocked(false);
            }}
          >
            <option value="">No Variant</option>
            {vRows
              .filter((v) => uuid(v.id) && v.materialId === chosen.id)
              .map((v) => (
                <option
                  key={v.id}
                  value={v.id}
                  disabled={v.status !== "ACTIVE"}
                >
                  {v.variantName ?? v.id} · {v.status ?? "Unavailable"}
                </option>
              ))}
          </select>
          {variants.isError && <ApiErrorState error={variants.error} />}{" "}
          {variants.hasNextPage && (
            <Button
              disabled={variants.isFetching || !writable}
              onClick={() =>
                void variants.fetchNextPage({ cancelRefetch: false })
              }
            >
              Load more Variants
            </Button>
          )}
          <label htmlFor={`${id}-listing`}>Optional Listing</label>
          <select
            className="input"
            id={`${id}-listing`}
            value={listing}
            disabled={!writable || listings.isError}
            onChange={(e) => {
              setListing(e.target.value);
              setBlocked(false);
            }}
          >
            <option value="">No Listing</option>
            {lRows
              .filter((l) => uuid(l.id) && l.materialId === chosen.id)
              .map((l) => (
                <option
                  key={l.id}
                  value={l.id}
                  disabled={l.status !== "ACTIVE"}
                >
                  {l.sellerArticleNumber ?? "Listing"} ·{" "}
                  {l.status ?? "Unavailable"}
                </option>
              ))}
          </select>
          {listings.isError && <ApiErrorState error={listings.error} />}{" "}
          {listings.hasNextPage && (
            <Button
              disabled={listings.isFetching || !writable}
              onClick={() =>
                void listings.fetchNextPage({ cancelRefetch: false })
              }
            >
              Load more Listings
            </Button>
          )}
          <p>
            Scope: Material{variant ? " + Variant" : ""}
            {listing ? " + Listing" : ""}
          </p>
          <ul>
            {refs.map((ref, n) => (
              <li key={ref.kind}>
                {ref.kind}:{" "}
                {liveLabel(
                  exact[n].isError ? undefined : exact[n].data,
                  ref.kind,
                  ref.id,
                  chosen.id!,
                )}
              </li>
            ))}
          </ul>
          <Button
            disabled={
              !writable ||
              !coherent ||
              !currentlyActive ||
              blocked ||
              command.isPending
            }
            onClick={() => {
              const parsed = selectionSchema.safeParse(input);
              if (parsed.success) {
                setFailure(null);
                command.mutate(parsed.data);
              }
            }}
          >
            Add Material Selection
          </Button>
        </>
      )}
      {failure != null && !isCancelled(failure) && (
        <ApiErrorState error={failure} />
      )}
      {blocked && (
        <div role="alert">
          <p>
            Your selection draft is retained. Review the refreshed parent,
            references and first page before an explicit new submission.
          </p>
          {duplicate ? (
            <p>
              This material scope is already selected. A matching Selection
              exists; this does not identify which request created it.
            </p>
          ) : failure instanceof ApiError &&
            (failure.status === 0 || failure.status >= 500) ? (
            <p>
              The outcome may remain uncertain: absence from this bounded page
              does not prove the edge was not created.
            </p>
          ) : (
            <p>
              The request was rejected. Review the refreshed workspace and
              catalog references before submitting again.
            </p>
          )}
          <Button
            disabled={
              !writable ||
              !coherent ||
              !currentlyActive ||
              duplicate ||
              command.isPending
            }
            onClick={() => {
              setBlocked(false);
              setFailure(null);
            }}
          >
            Review retained selection draft
          </Button>
        </div>
      )}
      <Button
        className="secondary"
        disabled={command.isPending}
        onClick={close}
      >
        Cancel selection draft
      </Button>
    </section>
  );
}
function RemoveSelection({
  row,
  projectId,
  writable,
  refresh,
  refreshParents,
  report,
}: {
  row: Selection;
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
      "material-selections",
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
            selectionId: row.id,
          },
        },
      });
    },
    async () => {
      await refresh();
      if (w.current()) report("Material selection removed.");
    },
    async (error) => {
      setFailure(error);
      report(
        error instanceof ApiError && error.status === 404
          ? "Selection is no longer present."
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
        <Button onClick={() => setConfirm(true)}>Remove selection</Button>
      )}
      {confirm && (
        <div role="group" aria-label="Confirm Selection removal">
          <p>
            Remove only this private selection? Canonical Material, Variant and
            Listing are retained.
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
              ? "Selection is no longer present."
              : "Removal was not confirmed. Review the bounded refreshed list; absence on one page does not prove global absence. Explicit action is required."}
          </p>
        </>
      )}
    </>
  );
}
