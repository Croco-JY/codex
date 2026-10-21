import type { ReactNode } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useSession } from "../../app/session";
import { Button, Input } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Field, Options, MutationFeedback } from "../admin-sources/FormUI";
import { ambiguous, isAbort } from "../admin-sources/data";
import { countryOptions, referenceName } from "../network/references";
import { geographyOptions } from "./data";
import { Facts } from "../commercial/ReadUI";

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  multiline = false,
  readOnly = false,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  multiline?: boolean;
  readOnly?: boolean;
}) {
  const error = form.getFieldState(name, form.formState).error?.message;
  return (
    <Field name={name} label={label} error={error}>
      {(p) =>
        multiline ? (
          <textarea
            className="input"
            rows={3}
            {...p}
            {...form.register(name)}
            readOnly={readOnly}
          />
        ) : (
          <Input {...p} {...form.register(name)} readOnly={readOnly} />
        )
      }
    </Field>
  );
}
export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  values,
  optional = false,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  values: readonly string[];
  optional?: boolean;
}) {
  return (
    <Field
      name={name}
      label={label}
      error={form.getFieldState(name, form.formState).error?.message}
    >
      {(p) => (
        <select className="input" {...p} {...form.register(name)}>
          <Options
            values={values}
            empty={optional ? "Not entered" : undefined}
          />
        </select>
      )}
    </Field>
  );
}
export function EvidenceField<T extends FieldValues>({
  form,
}: {
  form: UseFormReturn<T>;
}) {
  return (
    <div className="evidence-field">
      <TextField
        form={form}
        name={"observationId" as Path<T>}
        label="Observation UUID"
      />
      <p className="filter-help">
        Required fact evidence.{" "}
        <a
          className="text-link"
          href="/admin/sources"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Sources &amp; Evidence
        </a>{" "}
        in another tab to keep this draft here. An Observation supports a fact;
        it does not bind external identity.
      </p>
    </div>
  );
}
export function CountryField<T extends FieldValues>({
  form,
  onChange,
}: {
  form: UseFormReturn<T>;
  onChange?: (id: string) => void;
}) {
  const { scope } = useSession(),
    query = useQuery(countryOptions(scope)),
    name = "countryId" as Path<T>,
    value = form.watch(name);
  return (
    <div>
      <Field
        name="countryId"
        label="Country"
        error={form.getFieldState(name, form.formState).error?.message}
      >
        {(p) => (
          <select
            className="input"
            {...p}
            {...form.register(name, {
              onChange: (e) => onChange?.(e.target.value),
            })}
            value={value ?? ""}
          >
            <option value="">Select Country</option>
            {(query.data ?? [])
              .filter((c) => c.id && (c.active !== false || c.id === value))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {referenceName(c)}
                  {c.alpha2 ? ` · ${c.alpha2}` : ""}
                </option>
              ))}
            {value && !query.data?.some((c) => c.id === value) && (
              <option value={value}>Country label unavailable · {value}</option>
            )}
          </select>
        )}
      </Field>
      {query.error && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}
    </div>
  );
}
export function GeographyField<T extends FieldValues>({
  form,
  kind,
  country,
}: {
  form: UseFormReturn<T>;
  kind: "regions" | "industrial-clusters";
  country: string;
}) {
  const { scope } = useSession(),
    query = useInfiniteQuery(geographyOptions(scope, kind, country)),
    name = (kind === "regions" ? "regionId" : "industrialClusterId") as Path<T>,
    value = form.watch(name),
    rows = query.data?.pages.flat() ?? [];
  return (
    <div>
      <Field
        name={name}
        label={
          kind === "regions"
            ? "Region (optional)"
            : "Industrial Cluster (optional)"
        }
        error={form.getFieldState(name, form.formState).error?.message}
      >
        {(p) => (
          <select
            className="input"
            {...p}
            {...form.register(name)}
            disabled={!country}
            value={value ?? ""}
          >
            <option value="">Not recorded</option>
            {rows
              .filter((r) => r.id && (r.active !== false || r.id === value))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {referenceName(r)}
                </option>
              ))}
            {value && !rows.some((r) => r.id === value) && (
              <option value={value}>Label unavailable · {value}</option>
            )}
          </select>
        )}
      </Field>
      {query.isFetching && <p role="status">Loading geography…</p>}
      {query.error && (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      )}{" "}
      {query.hasNextPage && (
        <Button
          className="secondary small"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          Load more {kind === "regions" ? "Regions" : "Industrial Clusters"}
        </Button>
      )}
    </div>
  );
}
export function CurationHeader({
  title,
  kind,
  children,
}: {
  title: string;
  kind: "suppliers" | "facilities";
  children?: ReactNode;
}) {
  return (
    <header>
      <Link className="text-link" to={`/admin/${kind}`}>
        Return to {kind} curation
      </Link>
      <p className="eyebrow">PROTECTED CURATION</p>
      <h1>{title}</h1>
      {children}
    </header>
  );
}
export function ServerComparison({
  title,
  values,
  adopt,
  label,
}: {
  title: string;
  values: readonly (readonly [string, ReactNode])[];
  adopt: () => void;
  label: string;
}) {
  return (
    <section className="notice" aria-label={title}>
      <h3>{title}</h3>
      <Facts values={values.map((v) => [v[0], v[1]])} />
      <Button className="secondary" onClick={adopt}>
        {label}
      </Button>
      <p>
        No write is submitted by this action. Review the retained draft before
        saving.
      </p>
    </section>
  );
}
export function ArchivedNotice() {
  return (
    <p className="notice" role="status">
      This record is archived and may no longer appear in active directories.
    </p>
  );
}
export function CommandFeedback({
  error,
  success,
  noun,
  conflict,
  refresh,
}: {
  error: unknown;
  success: string;
  noun: string;
  conflict: string;
  refresh?: () => void;
}) {
  if (isAbort(error)) return null;
  if (ambiguous(error))
    return (
      <div className="notice" role="alert">
        <h3>{noun} outcome unknown</h3>
        <p>
          Your draft is preserved. Inspect refreshed server state before
          deciding whether to submit again. Absence from an active directory or
          a bounded history does not prove failure. No automatic retry occurs.
        </p>
        {refresh && (
          <Button className="secondary" onClick={refresh}>
            Refresh server state for comparison
          </Button>
        )}
      </div>
    );
  return (
    <MutationFeedback
      error={error}
      success={success}
      noun={noun}
      conflictTitle={conflict}
    />
  );
}
