import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace } from "../../app/workspace";
import {
  checkedGrading,
  checkedPage,
  checkedHistory,
  checkedHistoricalRevision,
  type Filter,
  type Summary,
} from "./model";
export const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/grade-rule-sets" as const;
export const detailPath = `${path}/{gradeRuleSetId}` as const;
export const historyPath = `${detailPath}/revisions` as const;
export const revisionPath = `${historyPath}/{revisionId}` as const;
export function useGradings(
  projectId: string,
  styleId: string,
  status: Filter,
  cursor: string | null,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.gradings(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      status,
      25,
      cursor,
    ),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(path, {
          signal,
          params: {
            path: { organizationId: w.organizationId, projectId, styleId },
            query: { status, limit: "25", ...(cursor ? { cursor } : {}) },
          },
        });
        return checkedPage(requireData(r.data, r.response), styleId, status);
      }),
  });
}
export function useGrading(
  projectId: string,
  styleId: string,
  gradeRuleSetId: string,
  enabled = true,
) {
  const w = useWorkspace();
  return useQuery({
    enabled,
    queryKey: queryKeys.grading(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      gradeRuleSetId,
    ),
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(detailPath, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId,
              styleId,
              gradeRuleSetId,
            },
          },
        });
        return checkedGrading(
          requireData(r.data, r.response),
          styleId,
          gradeRuleSetId,
        );
      }),
  });
}
export function useGradingHistory(
  projectId: string,
  styleId: string,
  gradeRuleSetId: string,
  max: number,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.gradingHistory(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      gradeRuleSetId,
      25,
      max,
    ),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(historyPath, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId,
              styleId,
              gradeRuleSetId,
            },
            query: { limit: "25", maxRevisionNumber: String(max) },
          },
        });
        return checkedHistory(
          requireData(r.data, r.response),
          styleId,
          gradeRuleSetId,
          max,
        );
      }),
  });
}
export function useGradingRevision(
  projectId: string,
  styleId: string,
  gradeRuleSetId: string,
  expected: Summary,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.gradingRevision(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      gradeRuleSetId,
      expected.id,
    ),
    enabled,
    retry: false,
    // Also validate cached data against this selection, even without a refetch.
    select: (data) =>
      checkedHistoricalRevision(data, styleId, gradeRuleSetId, expected),
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(revisionPath, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId,
              styleId,
              gradeRuleSetId,
              revisionId: expected.id,
            },
          },
        });
        return checkedHistoricalRevision(
          requireData(r.data, r.response),
          styleId,
          gradeRuleSetId,
          expected,
        );
      }),
  });
}
