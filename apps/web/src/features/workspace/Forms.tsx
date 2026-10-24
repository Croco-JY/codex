import { useId } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Button, Input } from "../../ui";
import { metadataSchema, type Draft, type Entity } from "./model";
export function useMetadataForm(initial: Draft) {
  return useForm<Draft>({ defaultValues: initial });
}
export function MetadataFields({
  form,
  style,
  readOnly = false,
}: {
  form: UseFormReturn<Draft>;
  style: boolean;
  readOnly?: boolean;
}) {
  const prefix = useId();
  return (
    <>
      {(
        [
          ...(style ? ["styleCode" as const] : []),
          "name",
          "description",
        ] as const
      ).map((field) => {
        const label =
          field === "styleCode"
            ? "Style code (optional)"
            : field === "name"
              ? "Name"
              : "Description (optional)";
        const id = `${prefix}-${field}`,
          error = form.formState.errors[field];
        return (
          <div className="filter-field" key={field}>
            <label htmlFor={id}>{label}</label>
            {field === "description" ? (
              <textarea
                className="input"
                id={id}
                rows={4}
                readOnly={readOnly}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                {...form.register(field)}
              />
            ) : (
              <Input
                id={id}
                readOnly={readOnly}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                {...form.register(field)}
              />
            )}
            {error && (
              <p role="alert" className="field-error" id={`${id}-error`}>
                {error.message}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
export function validated(
  form: UseFormReturn<Draft>,
  submit: (draft: Draft) => void,
) {
  return form.handleSubmit((values) => {
    form.clearErrors();
    const parsed = metadataSchema.safeParse(values);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) =>
        form.setError(issue.path[0] as keyof Draft, { message: issue.message }),
      );
      return;
    }
    submit(parsed.data);
  });
}
export function ServerState({
  value,
  label = "Current server state",
}: {
  value: Entity;
  label?: string;
}) {
  return (
    <div className="workspace-comparison">
      <h3>{label}</h3>
      <dl className="read-facts">
        <div>
          <dt>Name</dt>
          <dd>{value.name}</dd>
        </div>
        {"styleCode" in value && (
          <div>
            <dt>Style code</dt>
            <dd>{value.styleCode ?? "Not recorded"}</dd>
          </div>
        )}
        <div>
          <dt>Description</dt>
          <dd>{value.description ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Status / version</dt>
          <dd>
            {value.status} / {value.version}
          </dd>
        </div>
      </dl>
    </div>
  );
}
export function Reset({ reset }: { reset: () => void }) {
  return (
    <Button className="secondary" onClick={reset}>
      Reset draft
    </Button>
  );
}
