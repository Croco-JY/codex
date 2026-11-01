import { useState } from "react";
import { Button } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
export const releaseMeaning =
  "Private access to one exact artifact. This grants no ownership, manufacturing license, production approval or commercial acceptance. Delivered files cannot be recalled.";
export function Reconcile({
  refresh,
  done,
}: {
  refresh: () => Promise<unknown>;
  done: () => void;
}) {
  const [checked, setChecked] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <section aria-label="Reconcile uncertain outcome">
      <p role="alert">
        Outcome unconfirmed. Your draft is retained. Nothing is retried
        automatically. Inspect current authorized records before choosing
        another submission; matching values do not prove that the previous
        request succeeded.
      </p>
      {error !== undefined && <ApiErrorState error={error} />}
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          setChecked(false);
          void refresh()
            .then(() => {
              setChecked(true);
              setError(undefined);
            }, setError)
            .finally(() => setPending(false));
        }}
      >
        Refresh authoritative state
      </Button>
      {checked && (
        <Button onClick={done}>
          I reviewed the records; allow a new submission
        </Button>
      )}
    </section>
  );
}
export function PageButtons({
  cursor,
  next,
  older,
  reset,
}: {
  cursor: string | null;
  next: string | null;
  older: () => void;
  reset: () => void;
}) {
  return (
    <nav aria-label="Release pagination">
      <Button disabled={!next} onClick={older}>
        Older records
      </Button>
      {cursor && <Button onClick={reset}>Return to newest records</Button>}
    </nav>
  );
}
