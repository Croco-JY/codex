import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { Button, Input } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { supplierOptions } from "./materialQueries";
export function SupplierLabel({ id }: { id?: string }) {
  const { scope } = useSession();
  const supplier = useQuery(supplierOptions(scope, id ?? ""));
  if (!id) return <>Catalog supplier not entered</>;
  if (supplier.isPending)
    return <span className="muted">Loading supplier label…</span>;
  if (supplier.isError || !supplier.data.displayName)
    return <span className="muted">Supplier label unavailable</span>;
  return <>{supplier.data.displayName}</>;
}
export function SupplierPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const { scope } = useSession();
  const [text, setText] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const results = useQuery({
    queryKey: queryKeys.supplierSearch(scope, search ?? ""),
    enabled: search !== null,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/v1/suppliers", {
        signal,
        params: { query: { q: search || undefined, limit: 20 } },
      });
      return requireData(data, response);
    },
  });
  return (
    <fieldset className="supplier-picker">
      <legend>{label}</legend>
      {value && (
        <p className="selected-supplier">
          Selected: <SupplierLabel id={value} />{" "}
          <Button
            className="secondary small"
            onClick={() => onChange("")}
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            Clear
          </Button>
        </p>
      )}
      <label htmlFor={id}>Search {label.toLowerCase()} by name</label>
      <div className="supplier-search">
        <Input
          id={id}
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setSearch(text.trim());
            }
          }}
        />
        <Button className="secondary" onClick={() => setSearch(text.trim())}>
          Find {label.toLowerCase()}
        </Button>
      </div>
      {search !== null && (
        <div aria-live="polite">
          {results.isPending ? (
            <p role="status">Searching suppliers…</p>
          ) : results.isError ? (
            <ApiErrorState
              error={results.error}
              retry={() => void results.refetch()}
            />
          ) : (
            <>
              <ul
                className="supplier-options"
                aria-label={`${label} search results`}
              >
                {results.data.items?.map(
                  (supplier) =>
                    supplier.id && (
                      <li key={supplier.id}>
                        <Button
                          className="secondary"
                          aria-pressed={value === supplier.id}
                          onClick={() => {
                            onChange(supplier.id!);
                            setSearch(null);
                            setText("");
                          }}
                        >
                          {supplier.displayName ?? "Supplier name unavailable"}
                          {supplier.country ? ` · ${supplier.country}` : ""}
                        </Button>
                      </li>
                    ),
                )}
              </ul>
              {!results.data.items?.length && (
                <p>No suppliers match this name.</p>
              )}
              {results.data.nextCursor && (
                <p className="muted">
                  First 20 matches. Refine the name to narrow the choices.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
