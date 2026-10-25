import { useState } from "react";
import { Button, Skeleton } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { useMeasurementSpec, useMeasurementHistory } from "../measurement/data";
import type { Spec } from "../measurement/model";
export function MeasurementPicker({
  projectId,
  styleId,
  choose,
  close,
}: {
  projectId: string;
  styleId: string;
  choose: (id: string) => void;
  close: () => void;
}) {
  const q = useMeasurementSpec(projectId, styleId, true, true);
  return (
    <section aria-label="Measurement revision selector">
      <h4>Choose an exact Measurement revision</h4>
      <Button onClick={close}>Close measurement selector</Button>
      {q.isFetching && <Skeleton label="Loading Measurements for pin" />}
      {q.isError && <ApiErrorState error={q.error} />}
      {q.data === null && !q.isFetching && (
        <p>No Measurement Spec exists for this Style.</p>
      )}
      {q.data && !q.isError && !q.isFetching && (
        <MeasurementChoices
          projectId={projectId}
          spec={q.data}
          choose={choose}
        />
      )}
    </section>
  );
}
function MeasurementChoices({
  projectId,
  spec,
  choose,
}: {
  projectId: string;
  spec: Spec;
  choose: (id: string) => void;
}) {
  const [cursors, setCursors] = useState<number[]>([]),
    q = useMeasurementHistory(
      projectId,
      spec,
      cursors.at(-1) ?? spec.latestRevision.revisionNumber,
      true,
      true,
    );
  return (
    <>
      {q.isPending && <Skeleton label="Loading Measurement revision choices" />}
      {q.isError && <ApiErrorState error={q.error} />}
      {q.data && (
        <>
          <ul>
            {q.data.items.map((r) => (
              <li key={r.id}>
                <Button
                  disabled={q.isError || q.isFetching}
                  onClick={() => choose(r.id)}
                >
                  Use Measurement revision {r.revisionNumber}
                </Button>
                <span>
                  {" "}
                  {r.baseSize} · {r.unitSystem}
                </span>
              </li>
            ))}
          </ul>
          <Button
            disabled={!cursors.length || q.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Newer Measurement choices
          </Button>
          <Button
            disabled={
              q.data.nextMaxRevisionNumber === null || q.isFetching || q.isError
            }
            onClick={() => {
              if (q.data?.nextMaxRevisionNumber)
                setCursors([...cursors, q.data.nextMaxRevisionNumber]);
            }}
          >
            Older Measurement choices
          </Button>
        </>
      )}
    </>
  );
}
