import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, requireData } from "../../api/client";
import { useSession } from "../../app/session";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Button } from "../../ui";

import { lifecycle, materialTypes } from "./model";
export function MaterialDiscovery({
  select,
}: {
  select?: (id: string) => void;
}) {
  const cache = useQueryClient();
  const { scope } = useSession(),
    [search, setSearch] = useSearchParams();
  const validStatus =
    lifecycle.find((s) => s === search.get("status")) ?? "DRAFT";
  const [draft, setDraft] = useState({
    q: search.get("q") ?? "",
    status: validStatus,
    materialType: search.get("materialType") ?? "",
  });
  useEffect(
    () =>
      setDraft({
        q: search.get("q") ?? "",
        status: validStatus,
        materialType: search.get("materialType") ?? "",
      }),
    [search.toString()],
  );
  const qText = search.get("q")?.slice(0, 200) || undefined,
    type = materialTypes.find((t) => t === search.get("materialType"));
  const q = useInfiniteQuery({
    queryKey: [
      "admin",
      scope,
      "material-search",
      { q: qText, status: validStatus, materialType: type },
      25,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) => {
      const r = await api.GET("/api/v1/materials", {
        signal,
        params: {
          query: {
            q: qText,
            status: validStatus,
            materialType: type,
            limit: 25,
            ...(pageParam ? { cursor: pageParam } : {}),
          },
        },
      });
      return requireData(r.data, r.response);
    },
    getNextPageParam: (p) => p.nextCursor || undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  return (
    <section className="admin-panel">
      <h2>{select ? "Choose Material" : "Material directory"}</h2>
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams();
          p.set("status", draft.status);
          if (draft.q) p.set("q", draft.q);
          if (materialTypes.some((t) => t === draft.materialType))
            p.set("materialType", draft.materialType);
          setSearch(p);
        }}
      >
        <div className="admin-fields">
          <label>
            Material keyword
            <input
              className="input"
              value={draft.q}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            />
          </label>
          <label>
            Discovery status
            <select
              className="input"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as typeof validStatus,
                })
              }
            >
              {lifecycle.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Material type filter
            <select
              className="input"
              value={draft.materialType}
              onChange={(e) =>
                setDraft({ ...draft, materialType: e.target.value })
              }
            >
              <option value="">Any type</option>
              {materialTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit">Apply Material filters</Button>
        <Button
          className="secondary"
          onClick={() => {
            setDraft({ q: "", status: "DRAFT", materialType: "" });
            setSearch({ status: "DRAFT" });
          }}
        >
          Clear Material filters
        </Button>
      </form>
      <p role="status" aria-live="polite">
        {q.isPending
          ? "Loading materials…"
          : `${rows.length} materials loaded · ${validStatus}`}
      </p>
      {q.error && (
        <div role="alert">
          <ApiErrorState error={q.error} />{" "}
          <Button
            onClick={() =>
              void cache.resetQueries({
                queryKey: [
                  "admin",
                  scope,
                  "material-search",
                  { q: qText, status: validStatus, materialType: type },
                  25,
                ],
                exact: true,
              })
            }
          >
            Reload first results
          </Button>
        </div>
      )}
      <ul className="read-list">
        {rows.map((m) => (
          <li key={m.id}>
            <strong>{m.displayName ?? "Material name unavailable"}</strong>
            <p>{m.materialType}</p>
            {m.id &&
              (select ? (
                <Button className="secondary" onClick={() => select(m.id!)}>
                  Select Material · {m.displayName}
                </Button>
              ) : (
                <Link to={`/admin/materials/${m.id}`}>
                  Open Material · {m.displayName}
                </Link>
              ))}
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button
          disabled={q.isFetching || q.isFetchNextPageError}
          onClick={() => void q.fetchNextPage()}
        >
          Load more Materials
        </Button>
      )}
    </section>
  );
}
