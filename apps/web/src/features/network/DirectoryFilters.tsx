import { useId, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import {
  roles,
  verifications,
  facilityTypes,
  parseDirectory,
  type NetworkFilters as Filters,
  type DirectoryKind,
} from "./filters";
import { referenceName, type NetworkReferences } from "./references";
import { SupplierPicker } from "../materials/SupplierPicker";
import { titleCase } from "../materials/MaterialSummary";
export function DirectoryFilters({
  applied,
  refs,
  apply,
  kind = "suppliers",
}: {
  applied: Filters;
  refs: NetworkReferences;
  apply: (filters: Filters) => void;
  kind?: DirectoryKind;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState(applied);
  const [expanded, setExpanded] = useState(() => window.innerWidth >= 900);
  const summary = useRef<HTMLElement>(null);
  const select = (key: keyof Filters, label: string, options: ReactNode) => (
    <div key={key}>
      <label htmlFor={`${prefix}-${key}`}>{label}</label>
      <select
        className="input"
        id={`${prefix}-${key}`}
        value={draft[key] ?? ""}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      >
        <option value="">Any</option>
        {options}
      </select>
    </div>
  );
  const countries = refs.countries.data
    ?.filter(
      (c) =>
        c.active ||
        c.alpha2 === draft.country ||
        c.alpha2 === draft.facilityCountry,
    )
    .map((c) => (
      <option key={c.id} value={c.alpha2}>
        {referenceName(c)} · {c.alpha2}
      </option>
    ));
  return (
    <section
      className="surface"
      aria-label={
        kind === "suppliers" ? "Supplier filters" : "Facility filters"
      }
    >
      <h2>Filter {kind}</h2>
      <details
        className="network-filter-disclosure"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary ref={summary}>
          Search filters
          {Object.values(applied).filter(Boolean).length > 0 && (
            <span className="badge">
              {Object.values(applied).filter(Boolean).length} applied
            </span>
          )}
        </summary>
        <form
          className="scope-form network-filters"
          onSubmit={(e) => {
            e.preventDefault();
            const query = new URLSearchParams();
            Object.entries(draft).forEach(([k, v]) => v && query.set(k, v));
            apply(parseDirectory(kind, query.toString()).filters);
            if (window.innerWidth < 900) {
              setExpanded(false);
              summary.current?.focus();
            }
          }}
        >
          {kind === "suppliers" && (
            <div>
              <label htmlFor={`${prefix}-q`}>Keyword</label>
              <Input
                id={`${prefix}-q`}
                value={draft.q ?? ""}
                maxLength={160}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </div>
          )}
          {select(
            "country",
            kind === "suppliers" ? "Supplier country" : "Country",
            countries,
          )}
          {kind === "suppliers" &&
            select(
              "role",
              "Supplier role",
              roles.map((v) => (
                <option value={v} key={v}>
                  {titleCase(v)}
                </option>
              )),
            )}
          {kind === "suppliers" &&
            select(
              "verificationStatus",
              "Supplier verification",
              verifications.map((v) => (
                <option value={v} key={v}>
                  {titleCase(v)}
                </option>
              )),
            )}
          {kind === "suppliers" &&
            select("facilityCountry", "Facility country", countries)}
          {kind === "facilities" &&
            select(
              "type",
              "Facility type",
              facilityTypes.map((v) => (
                <option value={v} key={v}>
                  {titleCase(v)}
                </option>
              )),
            )}
          {kind === "facilities" && (
            <div className="scope-wide">
              <SupplierPicker
                label="Supplier"
                value={draft.supplier ?? ""}
                onChange={(supplier) => setDraft({ ...draft, supplier })}
              />
            </div>
          )}
          {(["regions", "clusters", "capabilities"] as const).map((kind) => {
            const key =
                kind === "regions"
                  ? "region"
                  : kind === "clusters"
                    ? "cluster"
                    : "capability",
              query = refs[kind],
              label =
                kind === "regions"
                  ? "Region"
                  : kind === "clusters"
                    ? "Industrial Cluster"
                    : "Capability";
            const items = query.data?.pages.flat() ?? [];
            return (
              <div key={key}>
                {select(
                  key,
                  label,
                  <>
                    {draft[key] && !items.some((v) => v.id === draft[key]) && (
                      <option value={draft[key]}>
                        Selected {label.toLowerCase()} · label unavailable
                      </option>
                    )}
                    {items
                      .filter((v) => v.active || v.id === draft[key])
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {referenceName(v)}
                        </option>
                      ))}
                  </>,
                )}
                {query.isPending && (
                  <p role="status">Loading {label.toLowerCase()} choices…</p>
                )}
                {query.isError && (
                  <ApiErrorState
                    error={query.error}
                    retry={() => void query.refetch()}
                  />
                )}
                {query.hasNextPage && (
                  <Button
                    className="secondary small"
                    disabled={query.isFetching}
                    onClick={() =>
                      void query.fetchNextPage({ cancelRefetch: false })
                    }
                  >
                    Load more {label.toLowerCase()} choices
                  </Button>
                )}
              </div>
            );
          })}
          {refs.countries.isError && (
            <div className="scope-wide">
              <ApiErrorState
                error={refs.countries.error}
                retry={() => void refs.countries.refetch()}
              />
            </div>
          )}
          <div className="scope-actions scope-wide">
            <Button type="submit">Apply</Button>
            <Button
              className="secondary"
              onClick={() => {
                setDraft({});
                apply({});
              }}
            >
              Clear
            </Button>
          </div>
        </form>
      </details>
      <p className="muted">
        Draft changes apply only when you select Apply. Facility geography
        describes a Supplier’s recorded sites.
      </p>
    </section>
  );
}
