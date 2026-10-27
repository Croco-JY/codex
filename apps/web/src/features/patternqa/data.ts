import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace } from "../../app/workspace";
import { revisionPath } from "../pattern/data";
import { checkedArtifact } from "../pattern/artifactModel";
import type { Revision } from "../pattern/model";
import {
  checkedQa,
  checkedHistory,
  checkedHistorical,
  type Summary,
} from "./model";
export const qaPath = `${revisionPath}/qa` as const;
export const historyPath = `${qaPath}/assessments` as const;
export const assessmentPath = `${historyPath}/{assessmentId}` as const;
export function useQaScope(projectId: string, revision: Revision) {
  const w = useWorkspace();
  return {
    w,
    params: {
      organizationId: w.organizationId,
      projectId,
      styleId: revision.styleId,
      patternId: revision.patternId,
      revisionId: revision.id,
    },
    key: queryKeys.patternQa(
      w.scope,
      w.organizationId,
      projectId,
      revision.styleId,
      revision.patternId,
      revision.id,
    ),
  };
}
export function useQa(projectId: string, revision: Revision) {
  const { w, params, key } = useQaScope(projectId, revision);
  return useQuery({
    queryKey: key,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(qaPath, { signal, params: { path: params } });
        return checkedQa(requireData(r.data, r.response), revision);
      }),
  });
}
export function useQaHistory(
  projectId: string,
  revision: Revision,
  max: number,
) {
  const { w, params, key } = useQaScope(projectId, revision);
  return useQuery({
    queryKey: [...key, "assessments", 25, max],
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(historyPath, {
          signal,
          params: {
            path: params,
            query: { limit: "25", maxAssessmentNumber: String(max) },
          },
        });
        return checkedHistory(requireData(r.data, r.response), revision, max);
      }),
  });
}
export function useAssessment(
  projectId: string,
  revision: Revision,
  expected: Summary,
) {
  const { w, params, key } = useQaScope(projectId, revision);
  return useQuery({
    queryKey: [...key, "assessment", expected.id],
    retry: false,
    select: (data) => checkedHistorical(data, revision, expected),
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(assessmentPath, {
          signal,
          params: { path: { ...params, assessmentId: expected.id } },
        });
        return checkedHistorical(
          requireData(r.data, r.response),
          revision,
          expected,
        );
      }),
  });
}
export function useQaArtifact(projectId: string, revision: Revision) {
  const { w, params } = useQaScope(projectId, revision);
  return useQuery({
    queryKey: queryKeys.patternArtifact(
      w.scope,
      w.organizationId,
      projectId,
      revision.styleId,
      revision.patternId,
      revision.id,
    ),
    retry: false,
    refetchOnMount: "always",
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        try {
          const r = await api.GET(`${revisionPath}/artifact`, {
            signal,
            params: { path: params },
          });
          return checkedArtifact(
            requireData(r.data, r.response),
            revision.styleId,
            revision.patternId,
            revision.id,
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      }),
  });
}
