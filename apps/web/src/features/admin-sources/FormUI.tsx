import { useId, type ReactNode } from "react";
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../api/errors";
import { Button, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { ambiguous, isAbort } from "./data";
export function useCheckedForm<T extends FieldValues>(
  schema: z.ZodType<T>,
  defaults: T,
) {
  const form = useForm<T>({ defaultValues: defaults as DefaultValues<T> });
  return {
    ...form,
    submit: (save: (fields: T) => void) =>
      form.handleSubmit((raw) => {
        form.clearErrors();
        const result = schema.safeParse(raw);
        if (result.success) save(result.data);
        else {
          for (const issue of result.error.issues)
            form.setError(issue.path.join(".") as Path<T>, {
              message: issue.message,
            });
          const first = result.error.issues[0]?.path.join(".");
          if (typeof first === "string") form.setFocus(first as Path<T>);
        }
      }),
  };
}
export function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const prefix = useId(),
    id = `${prefix}-${name}`;
  return (
    <div className="filter-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-invalid": !!error,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <p className="field-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
export function Options({
  values,
  empty,
}: {
  values: readonly string[];
  empty?: string;
}) {
  return (
    <>
      {empty && <option value="">{empty}</option>}
      {values.map((value) => (
        <option key={value} value={value}>
          {value.replaceAll("_", " ")}
        </option>
      ))}
    </>
  );
}
export function MutationFeedback({
  error,
  noun,
  refresh,
  success,
  conflictTitle,
  conflictDetail,
}: {
  error: unknown;
  noun: string;
  refresh?: () => void;
  success?: string;
  conflictTitle?: string;
  conflictDetail?: string;
}) {
  if (isAbort(error)) return null;
  if (ambiguous(error))
    return (
      <div className="notice" role="alert">
        <h3>{noun} outcome unknown</h3>
        <p>
          The connection ended before confirmation. Your draft is preserved.
          Inspect the latest history or Source list before explicitly
          resubmitting. A bounded list cannot prove that the command did not
          succeed.
        </p>
        {refresh && (
          <Button className="secondary" onClick={refresh}>
            Refresh for comparison
          </Button>
        )}
      </div>
    );
  if (error instanceof ApiError && error.status === 409 && conflictTitle)
    return (
      <div className="error" role="alert">
        <h3>{conflictTitle}</h3>
        {conflictDetail && <p>{conflictDetail}</p>}
        {error.requestId && (
          <p className="record-reference">
            Request reference: <code>{error.requestId}</code>
          </p>
        )}
      </div>
    );
  if (error) return <ApiErrorState error={error} />;
  return success ? (
    <p role="status" className="notice">
      {success}
    </p>
  ) : null;
}
export function HistoryStatus({
  query,
  count,
  noun,
  empty,
}: {
  query: {
    isPending: boolean;
    error: unknown;
    isFetching: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
    refetch: () => unknown;
  };
  count: number;
  noun: string;
  empty: string;
}) {
  return (
    <>
      <p role="status" className="result-status">
        {count} {noun} loaded{query.isFetching ? " · refreshing…" : ""}
      </p>
      {query.isPending ? (
        <Skeleton label={`Loading ${noun}`} />
      ) : query.error ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !count ? (
        <p>{empty}</p>
      ) : null}
      {query.hasNextPage && !query.error && (
        <Button
          className="secondary"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? `Loading ${noun}…` : `Load more ${noun}`}
        </Button>
      )}
    </>
  );
}
