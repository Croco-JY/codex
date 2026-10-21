import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useSession } from "../../app/session";
import { Button } from "../../ui";
import { Facts } from "../commercial/ReadUI";
import {
  ambiguous,
  reviewOptions,
  uniqueRows,
  useAdminMutation,
  useAdminReadError,
} from "./data";
import {
  Field,
  HistoryStatus,
  MutationFeedback,
  Options,
  useCheckedForm,
} from "./FormUI";
import {
  isUuid,
  permissions,
  reviewBody,
  reviewDefaults,
  reviewFields,
  reviewStatuses,
  text,
  type Observation,
  type ReviewFields,
} from "./model";
export function Reviews({
  observation,
}: {
  observation: Observation & { id: string };
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const { scope, capability } = useSession(),
    cache = useQueryClient();
  const options = reviewOptions(scope, observation.id);
  const history = useInfiniteQuery({
    ...options,
    enabled: capability === "ADMIN",
  });
  useAdminReadError(history.error);
  const rows = uniqueRows(history.data?.pages);
  const [notice, setNotice] = useState("");
  const form = useCheckedForm(reviewFields, reviewDefaults);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: options.queryKey, exact: true });
  const mutation = useAdminMutation(
    "review",
    async (fields: ReviewFields, signal) => {
      const { data, response } = await api.POST(
        "/api/v1/admin/source-observations/{id}/reviews",
        {
          signal,
          params: { path: { id: observation.id } },
          body: reviewBody(fields),
        },
      );
      const id = requireData(data, response);
      if (!isUuid(id)) throw new ApiError(502);
      return id;
    },
    async (id, fields, current) => {
      form.reset(fields);
      setNotice(
        `Review appended. Reference: ${id}. Another explicit submission may append another Review.`,
      );
      await cache.resetQueries({ queryKey: options.queryKey, exact: true });
      if (!current()) return;
    },
    async (error) => {
      if (ambiguous(error)) await refresh();
    },
  );
  return (
    <section className="admin-context" aria-labelledby="reviews-title">
      <h2 id="reviews-title" ref={heading} tabIndex={-1}>
        Observation Reviews
      </h2>
      <p className="admin-wrap">
        Observation: {text(observation.observationKey)}
      </p>
      <p className="record-reference">
        Observation reference: {observation.id}
      </p>
      <p>
        Reviews append an evaluation; they do not edit the Observation. ACCEPTED
        does not currently gate canonical provenance commands.
      </p>
      <form
        className="admin-form"
        onSubmit={form.submit((fields) => {
          setNotice("");
          mutation.mutate(fields);
        })}
      >
        <fieldset className="admin-fields" disabled={mutation.isPending}>
          <Field
            label="Review status"
            name="reviewStatus"
            error={form.formState.errors.reviewStatus?.message}
          >
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register("reviewStatus")}
              >
                <Options values={reviewStatuses} />
              </select>
            )}
          </Field>
          <Field
            label="License status (optional)"
            name="licenseStatus"
            error={form.formState.errors.licenseStatus?.message}
          >
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register("licenseStatus")}
              >
                <Options values={permissions} empty="Not selected" />
              </select>
            )}
          </Field>
          <Field
            label="Terms status (optional)"
            name="termsStatus"
            error={form.formState.errors.termsStatus?.message}
          >
            {(p) => (
              <select
                className="input"
                {...p}
                {...form.register("termsStatus")}
              >
                <Options values={permissions} empty="Not selected" />
              </select>
            )}
          </Field>
          <Field
            label="Review notes (optional)"
            name="notes"
            error={form.formState.errors.notes?.message}
          >
            {(p) => (
              <textarea
                className="input"
                rows={4}
                {...p}
                {...form.register("notes")}
              />
            )}
          </Field>
          <p className="filter-help">
            Reviewer identity is supplied by the authenticated server Actor.
            Review append has no deduplication or idempotency key.
          </p>
          <div className="scope-actions">
            <Button type="submit">
              {mutation.isPending ? "Appending review…" : "Append review"}
            </Button>
            <Button
              className="secondary"
              onClick={() => {
                form.reset(reviewDefaults);
                mutation.reset();
                setNotice("");
              }}
            >
              Reset Review draft
            </Button>
          </div>
        </fieldset>
      </form>
      <MutationFeedback
        error={mutation.error}
        noun="Review append"
        success={notice}
        refresh={() => void refresh()}
        conflictTitle="Review conflicts with the current integrity constraints."
      />
      <div className="section-heading">
        <h3>Review history</h3>
        <Button className="secondary small" onClick={() => void refresh()}>
          Refresh Reviews
        </Button>
      </div>
      <HistoryStatus
        query={history}
        count={rows.length}
        noun="reviews"
        empty="No reviews recorded for this Observation."
      />
      <ul className="read-list">
        {rows.map((review, i) => (
          <li key={review.id ?? i}>
            <h3>{text(review.reviewStatus)}</h3>
            <Facts
              values={[
                ["License", review.licenseStatus],
                ["Terms", review.termsStatus],
                ["Reviewed at", review.reviewedAt],
                ["Notes", review.notes],
              ]}
            />
            <details className="read-disclosure">
              <summary>Protected review audit reference</summary>
              <p className="record-reference">Review: {text(review.id)}</p>
              <p className="admin-wrap">
                Reviewer issuer: {text(review.reviewedByIssuer)}
                <br />
                Reviewer subject: {text(review.reviewedBySubject)}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
