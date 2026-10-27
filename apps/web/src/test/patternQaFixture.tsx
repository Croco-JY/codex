/** QA test-only transport; no production imports or behavior switches. */
import { vi } from "vitest";
import {
  fixture as patternFixture,
  A,
  B,
  P,
  S,
  T,
  PID,
  id,
  time,
  root,
  response,
  pattern,
  revision,
} from "./patternFixture";
import {
  trimNotes,
  type Qa,
  type Assessment,
  type Summary,
} from "../features/patternqa/model";
export { A, B, P, S, T, PID, id, time, root, response, pattern, revision };
export const route = (org = A, n = 1) =>
  root(org).replace("/api/v1", "") +
  `/patterns/${PID}/revisions/${revision(n, org).id}/qa`;
export const qaRoot = (org = A, n = 1) => "/api/v1" + route(org, n);
export const assessment = (n = 1, org = A): Assessment => ({
  id: id(700 + n + (org === B ? 1000 : 0)),
  patternRevisionId: revision(1, org).id,
  styleId: org === A ? S : T,
  assessmentNumber: n,
  outcome: "OBSERVED",
  evidenceBasis: "METADATA_ONLY",
  artifactId: null,
  reviewedAt: time,
  notes: "Synthetic human notes",
});
export const summary = (a: Assessment): Summary => {
  const { notes: _notes, ...s } = a;
  return s;
};
export const qa = (n = 0, org = A): Qa => ({
  patternId: PID,
  patternRevisionId: revision(1, org).id,
  styleId: org === A ? S : T,
  patternRevisionNumber: 1,
  state: n ? "OBSERVED" : "UNREVIEWED",
  latestAssessment: n ? assessment(n, org) : null,
});
export function fixture() {
  const h = patternFixture(),
    original = globalThis.fetch;
  h.patterns.set(A, [pattern()]);
  h.patterns.set(B, [pattern(1, B)]);
  h.history.set(revision().id, revision());
  h.history.set(revision(1, B).id, revision(1, B));
  const current = new Map<string, Qa>([
      [A, qa()],
      [B, qa(0, B)],
    ]),
    rows = new Map<string, Assessment>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (r: Request) => {
      const u = new URL(r.url),
        p = u.pathname;
      if (!p.includes("/qa") && !p.endsWith("/artifact")) return original(r);
      h.calls.push(r);
      const override = h.overrides.get(`${r.method} ${p}`);
      if (override) return override(r);
      if (p.endsWith("/artifact")) return response({}, 404);
      const org = p.includes(B) ? B : A,
        base = qaRoot(org),
        q = current.get(org)!;
      if (p === base) return response(q);
      if (p === base + "/assessments" && r.method === "POST") {
        const b = await r.clone().json(),
          head = q.latestAssessment?.assessmentNumber ?? 0;
        if (b.expectedLatestAssessmentNumber !== head) return response({}, 409);
        const a = {
          ...assessment(head + 1, org),
          outcome: b.outcome,
          evidenceBasis: b.evidenceBasis,
          artifactId: b.artifactId,
          notes: trimNotes(b.notes),
        };
        rows.set(a.id, a);
        current.set(org, { ...q, state: a.outcome, latestAssessment: a });
        return response(a, 201);
      }
      if (p === base + "/assessments") {
        const max = Number(u.searchParams.get("maxAssessmentNumber"));
        const all = [
          ...new Map(
            [
              ...rows.values(),
              ...(q.latestAssessment ? [q.latestAssessment] : []),
            ]
              .filter(
                (a) =>
                  a.patternRevisionId === q.patternRevisionId &&
                  a.assessmentNumber <= max,
              )
              .map((a) => [a.id, a]),
          ).values(),
        ].sort((a, b) => b.assessmentNumber - a.assessmentNumber);
        return response({
          items: all.slice(0, 25).map(summary),
          limit: 25,
          nextMaxAssessmentNumber: all[25]?.assessmentNumber ?? null,
        });
      }
      const a = rows.get(p.split("/").at(-1)!);
      return response(a ?? {}, a ? 200 : 404);
    }),
  );
  return Object.assign(h, { current, rows });
}
