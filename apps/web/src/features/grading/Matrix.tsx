import { memo, useId } from "react";
import type { Draft, Revision } from "./model";
import { signed } from "./model";
import { Button } from "../../ui";

export const Matrix = memo(function Matrix({
  value,
  title,
}: {
  value: Revision;
  title: string;
}) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <p>
        {value.name} · {value.unitSystem} · Base size {value.baseSizeCode}
      </p>
      {value.notes && <p>{value.notes}</p>}
      <p className="grading-id">Revision ID: {value.id}</p>
      <div
        className="grading-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title} matrix`}
      >
        <table className="grading-matrix">
          <caption>
            {title}: base-relative deltas ({value.unitSystem})
          </caption>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              {value.sizes.map((s) => (
                <th key={s.code} scope="col">
                  {s.code} · {s.label}
                  {s.code === value.baseSizeCode ? " (base)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {value.rules.map((r) => (
              <tr key={r.code}>
                <th scope="row">
                  {r.code} · {r.label}
                  {r.notes && <p>{r.notes}</p>}
                </th>
                {r.values.map((v) => (
                  <td key={v.sizeCode}>{signed(v.delta)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
export function MatrixEditor({
  draft,
  change,
  disabled,
}: {
  draft: Draft;
  change: (d: Draft) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="grading-editor">
      <Fields draft={draft} change={change} />
    </fieldset>
  );
}
// Native fieldset disabling does not require rebuilding 3,000 controlled cells.
const Fields = memo(function Fields({
  draft,
  change,
}: {
  draft: Draft;
  change: (d: Draft) => void;
}) {
  const prefix = useId();
  function edit(fn: (d: Draft) => void) {
    const next = structuredClone(draft);
    fn(next);
    change(next);
  }
  function move<T>(list: T[], index: number, offset: number) {
    [list[index], list[index + offset]] = [list[index + offset], list[index]];
  }
  const input = (
    label: string,
    value: string,
    set: (v: string) => void,
    multiline = false,
  ) => {
    const id = prefix + label;
    return (
      <label htmlFor={id}>
        {label}
        {multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input id={id} value={value} onChange={(e) => set(e.target.value)} />
        )}
      </label>
    );
  };
  return (
    <>
      <legend>Full grading snapshot</legend>
      {input("Grading name", draft.name, (v) =>
        edit((d) => {
          d.name = v;
        }),
      )}
      {input(
        "Grading notes",
        draft.notes,
        (v) =>
          edit((d) => {
            d.notes = v;
          }),
        true,
      )}
      <label htmlFor={prefix + "unit"}>Grading unit</label>
      <select
        id={prefix + "unit"}
        value={draft.unitSystem}
        onChange={(e) =>
          edit((d) => {
            d.unitSystem = e.target.value;
          })
        }
      >
        <option value="">Choose a unit</option>
        <option>MM</option>
        <option>CM</option>
        <option>IN</option>
      </select>
      <label htmlFor={prefix + "base"}>Base size</label>
      <select
        id={prefix + "base"}
        value={draft.baseSizeCode}
        onChange={(e) =>
          edit((d) => {
            d.baseSizeCode = e.target.value;
          })
        }
      >
        <option value="">Choose an existing size</option>
        {!draft.sizes.some((s) => s.code === draft.baseSizeCode) &&
          draft.baseSizeCode && (
            <option value={draft.baseSizeCode}>
              {draft.baseSizeCode} (missing; reselect)
            </option>
          )}
        {draft.sizes.map((s, i) => (
          <option key={i} value={s.code} disabled={!s.code}>
            {s.code || `Unnamed size ${i + 1}`}
          </option>
        ))}
      </select>
      <p>
        Delta is relative to the base size. Enter every value explicitly.
        Changing the base size does not rebase deltas.
      </p>
      <div
        className="grading-scroll"
        tabIndex={0}
        role="region"
        aria-label="Editable grading matrix"
      >
        <table className="grading-matrix">
          <caption>
            Full base-relative delta matrix (
            {draft.unitSystem || "unit required"})
          </caption>
          <thead>
            <tr>
              <th scope="col">Ordered rules and sizes</th>
              {draft.sizes.map((s, i) => (
                <th key={i} scope="col">
                  {input(`Size ${i + 1} code`, s.code, (v) =>
                    edit((d) => {
                      d.sizes[i].code = v;
                      d.rules.forEach((r) => {
                        r.values[i].sizeCode = v;
                      });
                    }),
                  )}
                  {input(`Size ${i + 1} label`, s.label, (v) =>
                    edit((d) => {
                      d.sizes[i].label = v;
                    }),
                  )}
                  {s.code && s.code === draft.baseSizeCode && <p>Base size</p>}
                  <Button
                    type="button"
                    disabled={i === 0}
                    aria-label={`Move size ${i + 1} up`}
                    onClick={() =>
                      edit((d) => {
                        move(d.sizes, i, -1);
                        d.rules.forEach((r) => move(r.values, i, -1));
                      })
                    }
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    disabled={i === draft.sizes.length - 1}
                    aria-label={`Move size ${i + 1} down`}
                    onClick={() =>
                      edit((d) => {
                        move(d.sizes, i, 1);
                        d.rules.forEach((r) => move(r.values, i, 1));
                      })
                    }
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    disabled={draft.sizes.length <= 2}
                    aria-label={`Remove size ${i + 1}`}
                    onClick={() =>
                      edit((d) => {
                        d.sizes.splice(i, 1);
                        d.rules.forEach((r) => r.values.splice(i, 1));
                      })
                    }
                  >
                    Remove
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rules.map((r, i) => (
              <tr key={i}>
                <th scope="row">
                  {input(`Rule ${i + 1} code`, r.code, (v) =>
                    edit((d) => {
                      d.rules[i].code = v;
                    }),
                  )}
                  {input(`Rule ${i + 1} label`, r.label, (v) =>
                    edit((d) => {
                      d.rules[i].label = v;
                    }),
                  )}
                  {input(
                    `Rule ${i + 1} notes`,
                    r.notes,
                    (v) =>
                      edit((d) => {
                        d.rules[i].notes = v;
                      }),
                    true,
                  )}
                  <Button
                    type="button"
                    disabled={i === 0}
                    aria-label={`Move rule ${i + 1} up`}
                    onClick={() => edit((d) => move(d.rules, i, -1))}
                  >
                    Move up
                  </Button>
                  <Button
                    type="button"
                    disabled={i === draft.rules.length - 1}
                    aria-label={`Move rule ${i + 1} down`}
                    onClick={() => edit((d) => move(d.rules, i, 1))}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    disabled={draft.rules.length <= 1}
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() =>
                      edit((d) => {
                        d.rules.splice(i, 1);
                      })
                    }
                  >
                    Remove
                  </Button>
                </th>
                {r.values.map((v, j) => (
                  <td key={j}>
                    {input(
                      `Delta rule ${i + 1} size ${j + 1}`,
                      v.delta,
                      (text) =>
                        edit((d) => {
                          d.rules[i].values[j].delta = text;
                        }),
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        disabled={draft.sizes.length >= 30}
        onClick={() =>
          edit((d) => {
            d.sizes.push({ code: "", label: "" });
            d.rules.forEach((r) => r.values.push({ sizeCode: "", delta: "" }));
          })
        }
      >
        Add size
      </Button>
      <Button
        type="button"
        disabled={draft.rules.length >= 100}
        onClick={() =>
          edit((d) => {
            d.rules.push({
              code: "",
              label: "",
              notes: "",
              values: d.sizes.map((s) => ({ sizeCode: s.code, delta: "" })),
            });
          })
        }
      >
        Add rule
      </Button>
    </>
  );
});
