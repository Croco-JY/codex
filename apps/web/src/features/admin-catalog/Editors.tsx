import { useRef } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { useReferences } from "../materials/materialQueries";
import { ApiErrorState } from "../../ui/ApiErrorState";
import { Button } from "../../ui";
import { Field } from "../admin-sources/FormUI";
import {
  attributeKeys,
  completeness,
  type AttributeRow,
  type CompositionFields,
} from "./model";
import { SelectField } from "../admin-network/Fields";
export function CompositionEditor({
  form,
  preserved = [],
}: {
  form: UseFormReturn<CompositionFields>;
  preserved?: readonly string[];
}) {
  const rows = useFieldArray({ control: form.control, name: "parts" }),
    refs = useReferences();
  const originals = useRef(new Map<string, string>());
  for (const row of rows.fields) {
    if (!originals.current.has(row.id))
      originals.current.set(
        row.id,
        preserved.includes(row.fiberTypeId) ? row.fiberTypeId : "",
      );
  }
  const error = form.formState.errors.parts?.message;
  return (
    <fieldset>
      <legend>Composition parts</legend>
      <SelectField
        form={form}
        name="completeness"
        label="Composition completeness"
        values={completeness}
      />
      <p>
        Completeness is explicit. PARTIAL may total exactly 100; UNKNOWN
        requires no parts.
      </p>
      {error && <p role="alert">{String(error)}</p>}
      {refs.fibers.error && (
        <ApiErrorState
          error={refs.fibers.error}
          retry={() => void refs.fibers.refetch()}
        />
      )}
      {refs.fibers.isPending && <p role="status">Loading Fiber references…</p>}
      {rows.fields.map((row, i) => (
        <fieldset key={row.id}>
          <legend>Fiber part {i + 1}</legend>
          <Field
            name={`parts.${i}.fiberTypeId`}
            label="Fiber"
            error={form.formState.errors.parts?.[i]?.fiberTypeId?.message}
          >
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register(`parts.${i}.fiberTypeId`)}
                value={form.watch(`parts.${i}.fiberTypeId`)}
              >
                <option value="">Choose Fiber</option>
                {refs.fiberList
                  .filter(
                    (f) =>
                      f.id &&
                      (f.active === true ||
                        f.id === originals.current.get(row.id)),
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nameEn || f.nameLocal || f.code} · {f.code}
                      {f.active === false ? " · inactive" : ""}
                    </option>
                  ))}
                {originals.current.get(row.id) &&
                  !refs.fiberList.some(
                    (f) => f.id === originals.current.get(row.id),
                  ) && (
                    <option value={originals.current.get(row.id)}>
                      Fiber label unavailable · {row.fiberTypeId}
                    </option>
                  )}
              </select>
            )}
          </Field>
          {refs.fiberList.some(
            (f) =>
              f.id === form.watch(`parts.${i}.fiberTypeId`) &&
              f.active === false,
          ) && (
            <p className="record-reference">
              Inactive Fiber retained from this row:{" "}
              {refs.fiberList.find(
                (f) => f.id === form.watch(`parts.${i}.fiberTypeId`),
              )?.nameEn || row.fiberTypeId}
              . This reference can be preserved; new rows offer active Fibers
              only.
            </p>
          )}
          <Field
            name={`parts.${i}.percentage`}
            label="Percentage"
            error={form.formState.errors.parts?.[i]?.percentage?.message}
          >
            {(p) => (
              <input
                className="input"
                {...p}
                {...form.register(`parts.${i}.percentage`)}
              />
            )}
          </Field>
          <Button className="secondary" onClick={() => rows.remove(i)}>
            Remove Fiber part {i + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        className="secondary"
        onClick={() => rows.append({ fiberTypeId: "", percentage: "" })}
      >
        Add Fiber part
      </Button>
      {refs.fibers.hasNextPage && (
        <Button
          className="secondary"
          onClick={() => void refs.fibers.fetchNextPage()}
        >
          Load more Fibers
        </Button>
      )}
    </fieldset>
  );
}
// Separate editor controller keeps stable RHF IDs, independent of attribute business keys.
export function AttributesEditor({
  form,
}: {
  form: UseFormReturn<{ attributes: AttributeRow[] }>;
}) {
  const rows = useFieldArray({ control: form.control, name: "attributes" });
  return (
    <fieldset>
      <legend>Physical attributes</legend>
      <p>
        Use String for decimal-like values. Only safe whole-number Integer
        values are allowed.
      </p>
      {form.formState.errors.attributes?.message && (
        <p role="alert">{String(form.formState.errors.attributes.message)}</p>
      )}
      {rows.fields.map((row, i) => (
        <fieldset key={row.id}>
          <legend>Attribute {i + 1}</legend>
          <Field name={`attributes.${i}.key`} label="Attribute key">
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register(`attributes.${i}.key`)}
              >
                {attributeKeys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            )}
          </Field>
          <Field name={`attributes.${i}.type`} label="Value type">
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register(`attributes.${i}.type`)}
              >
                <option>String</option>
                <option>Boolean</option>
                <option>Integer</option>
              </select>
            )}
          </Field>
          <Field name={`attributes.${i}.value`} label="Attribute value">
            {(p) =>
              form.watch(`attributes.${i}.type`) === "Boolean" ? (
                <select
                  className="input"
                  {...p}
                  {...form.register(`attributes.${i}.value`)}
                >
                  <option value="">Choose Boolean</option>
                  <option>true</option>
                  <option>false</option>
                </select>
              ) : (
                <input
                  className="input"
                  {...p}
                  {...form.register(`attributes.${i}.value`)}
                />
              )
            }
          </Field>
          <Button className="secondary" onClick={() => rows.remove(i)}>
            Remove attribute {i + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        className="secondary"
        onClick={() => rows.append({ key: "size", type: "String", value: "" })}
      >
        Add attribute
      </Button>
    </fieldset>
  );
}
