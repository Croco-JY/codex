import type { ReactNode } from "react";
import { ApiError } from "../../api/errors";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
export function Facts({
  values,
}: {
  values: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="read-facts">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value == null || value === "" ? "Not entered" : value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Pagination({
  hasNext,
  fetching,
  error,
  next,
  reload,
  noun,
}: {
  hasNext: boolean;
  fetching: boolean;
  error: unknown;
  next: () => void;
  reload: () => void;
  noun: string;
}) {
  return (
    <div className="read-pagination">
      {!!error &&
        (error instanceof ApiError && error.status === 400 ? (
          <div role="alert">
            <p>
              This results cursor is no longer usable. Your scope is preserved.
            </p>
            <Button onClick={reload}>Reload first results</Button>
          </div>
        ) : (
          <ApiErrorState error={error} retry={next} />
        ))}
      {hasNext && !error && (
        <Button disabled={fetching} onClick={next}>
          {fetching ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      )}
      {fetching && (
        <p role="status">Loading {noun}; loaded records remain visible.</p>
      )}
    </div>
  );
}
export const shown = (value: string | number | null | undefined) =>
  value == null || value === "" ? "Unknown" : value;
export function Reference({ label, value }: { label: string; value?: string }) {
  return (
    <span className="record-reference">
      {label}: {value || "Not recorded"}
    </span>
  );
}
