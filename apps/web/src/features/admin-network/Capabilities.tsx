import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  useIsMutating,
} from "@tanstack/react-query";
import { api } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button, Surface } from "../../ui";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Facts } from "../commercial/ReadUI";
import { referenceOptions, referenceName } from "../network/references";
import { useCheckedForm, Field } from "../admin-sources/FormUI";
import {
  ambiguous,
  useAdminMutation,
  useAdminReadError,
} from "../admin-sources/data";
import { isUuid } from "../admin-sources/model";
import {
  assignmentOptions,
  summaryOptions,
  refreshFacility,
  invalidateFacility,
} from "./data";
import {
  assignmentBaseline,
  assignmentFields,
  assignmentDefaults,
  assignmentBody,
  capabilityUnits,
  capabilityVerifications,
  proficiencies,
  type AssignmentBaseline,
  type AssignmentFields,
  type FacilityBaseline,
} from "./model";
import {
  SelectField,
  TextField,
  EvidenceField,
  ServerComparison,
  CommandFeedback,
} from "./Fields";

type Target =
  | { state: "EXISTS"; baseline: AssignmentBaseline }
  | { state: "ABSENT" }
  | { state: "UNAVAILABLE" };
type Initial = Exclude<Target, { state: "UNAVAILABLE" }>;
function AssignmentEditor({
  initial,
  read,
  facility,
  capability,
  parentConfirmed,
}: {
  initial: Initial;
  read: () => Promise<Target>;
  facility: FacilityBaseline;
  capability: string;
  parentConfirmed: boolean;
}) {
  const { scope } = useSession(),
    cache = useQueryClient();
  const [mode, setMode] = useState<"create" | "edit">(
      initial.state === "EXISTS" ? "edit" : "create",
    ),
    [baseline, setBaseline] = useState(
      initial.state === "EXISTS" ? initial.baseline : undefined,
    ),
    [latest, setLatest] = useState<Target>(),
    [blocked, block] = useState(false),
    [notice, setNotice] = useState("");
  const form = useCheckedForm(
    assignmentFields,
    baseline?.fields ?? assignmentDefaults,
  );
  async function compare(current: () => boolean = () => true) {
    const target = await read();
    if (current()) setLatest(target);
    return target;
  }
  const mutation = useAdminMutation(
    "facility-capability",
    async (v: AssignmentFields, signal) => {
      if (!parentConfirmed) throw new ApiError(404);
      if (mode === "edit" && !baseline) throw new ApiError(400);
      // This endpoint has an empty 200 response. Never requireData or infer the new version.
      await api.PUT("/api/v1/admin/facilities/{id}/capabilities/{capability}", {
        signal,
        params: {
          path: { id: facility.id, capability },
          ...(mode === "create" ? { header: { "If-None-Match": "*" } } : {}),
        },
        body: assignmentBody(v, mode === "create" ? 0 : baseline!.version),
      });
    },
    async (_empty, _v, current) => {
      const target = await compare(current);
      if (!current()) return;
      if (target.state === "EXISTS") {
        setBaseline(target.baseline);
        setMode("edit");
        block(false);
        form.reset(target.baseline.fields);
        setLatest(undefined);
        setNotice(
          `Capability assignment saved. Current server version: ${target.baseline.version}.`,
        );
      } else {
        block(true);
        setNotice(
          "The write was confirmed, but the current assignment could not be loaded safely. Refresh and review server state before another change.",
        );
      }
      await invalidateFacility(
        cache,
        scope,
        facility.fields.supplierId,
        facility.id,
      );
    },
    async (error, _v, current) => {
      if (
        ambiguous(error) ||
        (error instanceof ApiError && [404, 409, 412].includes(error.status))
      ) {
        block(true);
        await compare(current);
      }
    },
  );
  const createFailure =
    mutation.error instanceof ApiError && mutation.error.status === 412;
  const values = latest?.state === "EXISTS" ? latest.baseline : undefined;
  return (
    <section className="admin-panel" aria-label="Capability assignment form">
      <h3>
        {mode === "create"
          ? "Create Capability assignment"
          : "Edit Capability assignment"}
      </h3>
      {mode === "create" ? (
        <p>
          No assignment is currently recorded for this Capability. Creating one
          will not replace an existing assignment.
        </p>
      ) : (
        <p className="record-reference">
          Protected assignment version: {baseline?.version ?? "Unavailable"}.
          Facility profile version is independent.
        </p>
      )}
      <form
        className="admin-form"
        onSubmit={form.submit((v) => {
          if (!blocked) {
            setNotice("");
            mutation.mutate(v);
          }
        })}
      >
        <fieldset
          className="admin-fields"
          disabled={mutation.isPending || blocked || !parentConfirmed}
        >
          <SelectField
            form={form}
            name="proficiencyLevel"
            label="Capability proficiency (optional)"
            values={proficiencies}
            optional
          />
          <SelectField
            form={form}
            name="verificationStatus"
            label="Capability verification"
            values={capabilityVerifications}
          />
          <TextField
            form={form}
            name="minimumOrderQuantity"
            label="Minimum order quantity (optional)"
          />
          <TextField
            form={form}
            name="maximumOrderQuantity"
            label="Maximum order quantity (optional)"
          />
          <SelectField
            form={form}
            name="quantityUnit"
            label="Quantity unit (optional without quantities)"
            values={capabilityUnits}
            optional
          />
          <TextField
            form={form}
            name="notes"
            label="Protected Capability notes (optional)"
            multiline
          />
          <EvidenceField form={form} />
          <p className="filter-help">
            Quantities are exact strings, with up to 15 integer and 4 fractional
            digits. Known zero remains zero. These order quantities are not
            monthly capacity.
          </p>
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending
                ? "Saving assignment…"
                : mode === "create"
                  ? "Create assignment"
                  : "Save assignment"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(baseline?.fields ?? assignmentDefaults);
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Capability draft
            </Button>
          </div>
        </fieldset>
      </form>
      {createFailure ? (
        <div className="error" role="alert">
          <h3>Create-only precondition failed (412)</h3>
          <p>
            The assignment already exists or another first writer won. Your
            draft is preserved. It has not been submitted as an update.
          </p>
          {mutation.error instanceof ApiError && mutation.error.requestId && (
            <p className="record-reference">
              Request reference: {mutation.error.requestId}
            </p>
          )}
        </div>
      ) : (
        <CommandFeedback
          error={mutation.error}
          success={notice}
          noun="Capability write"
          conflict="The Capability assignment changed or conflicts with the current server state."
          refresh={() => void compare()}
        />
      )}
      {blocked && (
        <p className="notice" role="status">
          No automatic create/update fallback or retry occurs. Inspect server
          state and explicitly choose how to continue.
        </p>
      )}
      {blocked && values && (
        <ServerComparison
          title="Current protected assignment server state"
          values={[
            ["Proficiency", values.fields.proficiencyLevel],
            ["Minimum order quantity", values.fields.minimumOrderQuantity],
            ["Maximum order quantity", values.fields.maximumOrderQuantity],
            ["Unit", values.fields.quantityUnit],
            ["Protected notes", values.fields.notes],
            ["Capability verification", values.fields.verificationStatus],
            ["Assignment version", values.version],
          ]}
          label={
            mode === "create"
              ? "Switch to edit mode"
              : "Use refreshed assignment version, keep draft"
          }
          adopt={() => {
            setMode("edit");
            setBaseline(values);
            block(false);
            mutation.reset();
            setLatest(undefined);
            setNotice(
              "Protected server baseline adopted. Your draft remains unchanged; review it before an explicit update.",
            );
          }}
        />
      )}
      {blocked && latest?.state === "ABSENT" && (
        <section className="notice">
          <p>
            The parent Facility was reloaded successfully and the targeted
            assignment read returned 404. No assignment is currently recorded
            for this Capability.
          </p>
          <Button
            className="secondary"
            onClick={() => {
              setMode("create");
              setBaseline(undefined);
              block(false);
              mutation.reset();
              setLatest(undefined);
              setNotice(
                "Create-only mode explicitly selected after confirmed absence. Draft retained.",
              );
            }}
          >
            Switch to create mode
          </Button>
        </section>
      )}
      {blocked && (!latest || latest.state === "UNAVAILABLE") && (
        <p>A safe assignment or parent state could not be confirmed.</p>
      )}
      {blocked && (
        <Button className="secondary" onClick={() => void compare()}>
          Reload targeted assignment and parent context
        </Button>
      )}
    </section>
  );
}
function TargetedAssignment({
  facility,
  capability,
  parentConfirmed,
}: {
  facility: FacilityBaseline;
  capability: string;
  parentConfirmed: boolean;
}) {
  const { scope } = useSession(),
    cache = useQueryClient(),
    query = useQuery(assignmentOptions(scope, facility.id, capability));
  useAdminReadError(query.error);
  const [initial, setInitial] = useState<Initial>();
  const safe =
    query.data && assignmentBaseline(query.data, facility.id, capability);
  useEffect(() => {
    if (initial) return;
    if (query.isSuccess && safe)
      setInitial({ state: "EXISTS", baseline: safe });
    else if (
      query.error instanceof ApiError &&
      query.error.status === 404 &&
      parentConfirmed
    )
      setInitial({ state: "ABSENT" });
  }, [query.isSuccess, query.data, query.error, parentConfirmed, initial]);
  async function read(): Promise<Target> {
    const result = await query.refetch();
    if (result.isSuccess) {
      const baseline = assignmentBaseline(result.data, facility.id, capability);
      return baseline
        ? { state: "EXISTS", baseline }
        : { state: "UNAVAILABLE" };
    }
    if (result.error instanceof ApiError && result.error.status === 404) {
      const parent = await refreshFacility(cache, scope, facility.id);
      return parent ? { state: "ABSENT" } : { state: "UNAVAILABLE" };
    }
    return { state: "UNAVAILABLE" };
  }
  if (initial)
    return (
      <AssignmentEditor
        initial={initial}
        read={read}
        facility={facility}
        capability={capability}
        parentConfirmed={parentConfirmed}
      />
    );
  if (query.isPending)
    return <p role="status">Loading protected assignment and notes…</p>;
  if (query.isSuccess)
    return (
      <p className="notice">
        Protected assignment state is incomplete or unsafe. Editing is blocked.
      </p>
    );
  return (
    <ApiErrorState error={query.error} retry={() => void query.refetch()} />
  );
}
export function Capabilities({
  facility,
  parentConfirmed,
}: {
  facility: FacilityBaseline;
  parentConfirmed: boolean;
}) {
  const { scope } = useSession(),
    writing =
      useIsMutating({
        mutationKey: ["admin", scope, "command", "facility-capability"],
      }) > 0,
    refs = useInfiniteQuery(referenceOptions(scope, "capabilities")),
    summary = useQuery(summaryOptions(scope, facility.id));
  const [selected, select] = useState(""),
    [pending, setPending] = useState<string>();
  const choices = refs.data?.pages.flat() ?? [];
  return (
    <Surface aria-label="Capability assignments">
      <h2>Capability assignments</h2>
      <p>
        Proficiency and Capability verification describe this assignment,
        independently of Supplier verification.
      </p>
      <h3>Public summary</h3>
      <p className="filter-help">
        Up to 100 assignments are shown, without protected notes. Select a
        Capability below to inspect its current assignment and notes.
      </p>
      {summary.isPending ? (
        <p role="status">Loading public summary…</p>
      ) : summary.error ? (
        <ApiErrorState
          error={summary.error}
          retry={() => void summary.refetch()}
        />
      ) : (
        <>
          <ul className="read-list">
            {summary.data?.map((a, i) => (
              <li key={a.capabilityId ?? i}>
                <h4>
                  {choices.find((c) => c.id === a.capabilityId)
                    ? referenceName(
                        choices.find((c) => c.id === a.capabilityId)!,
                      )
                    : "Capability label unavailable"}
                </h4>
                <Facts
                  values={[
                    ["Capability reference", a.capabilityId],
                    ["Proficiency", a.proficiencyLevel],
                    ["Capability verification", a.verificationStatus],
                    ["Minimum order quantity", a.minimumOrderQuantity],
                    ["Maximum order quantity", a.maximumOrderQuantity],
                    ["Unit", a.quantityUnit],
                  ]}
                />
              </li>
            ))}
          </ul>
          {summary.data?.length === 0 && (
            <p>No capability assignments are shown in the public summary.</p>
          )}
          {summary.data?.length === 100 && (
            <p>
              The public summary is capped at 100 and may omit other
              assignments.
            </p>
          )}
        </>
      )}
      <Field name="capability" label="Capability to inspect / curate">
        {(p) => (
          <select
            className="input"
            {...p}
            value={selected}
            disabled={writing}
            onChange={(e) => {
              if (selected) setPending(e.target.value);
              else select(e.target.value);
            }}
          >
            <option value="">Select a Capability</option>
            {choices
              .filter((c) => isUuid(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {referenceName(c)}
                  {c.active === false ? " · Inactive reference" : ""}
                </option>
              ))}
          </select>
        )}
      </Field>
      {refs.error && (
        <ApiErrorState error={refs.error} retry={() => void refs.refetch()} />
      )}{" "}
      {refs.hasNextPage && (
        <Button
          className="secondary"
          disabled={refs.isFetching}
          onClick={() => void refs.fetchNextPage()}
        >
          Load more Capability references
        </Button>
      )}
      {selected && (
        <p className="record-reference">
          Selected Capability reference: {selected}
        </p>
      )}
      {pending !== undefined && (
        <div role="alert" className="notice">
          <p>
            Changing Capability discards the current assignment draft and mode.
          </p>
          <Button
            disabled={writing}
            onClick={() => {
              select(pending);
              setPending(undefined);
            }}
          >
            Change Capability and discard draft
          </Button>
          <Button className="secondary" onClick={() => setPending(undefined)}>
            Keep Capability draft
          </Button>
        </div>
      )}
      {selected && (
        <>
          <TargetedAssignment
            key={selected}
            facility={facility}
            capability={selected}
            parentConfirmed={parentConfirmed}
          />
          <Button
            className="secondary"
            disabled={writing}
            onClick={() => setPending("")}
          >
            Close Capability context
          </Button>
        </>
      )}
    </Surface>
  );
}
