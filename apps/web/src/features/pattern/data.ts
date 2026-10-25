import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace } from "../../app/workspace";
import {
  checkedPattern,
  checkedPage,
  checkedHistory,
  checkedRevision,
  type Filter,
} from "./model";
export const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/patterns" as const;
export const detailPath = `${path}/{patternId}` as const;
export const historyPath = `${detailPath}/revisions` as const;
export const revisionPath = `${historyPath}/{revisionId}` as const;
export function usePatterns(
  projectId: string,
  styleId: string,
  status: Filter,
  cursor: string | null,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.patterns(
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
export function usePattern(
  projectId: string,
  styleId: string,
  patternId: string,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.pattern(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      patternId,
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
              patternId,
            },
          },
        });
        return checkedPattern(
          requireData(r.data, r.response),
          styleId,
          patternId,
        );
      }),
  });
}
export function usePatternHistory(
  projectId: string,
  styleId: string,
  patternId: string,
  max: number,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.patternHistory(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      patternId,
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
              patternId,
            },
            query: { limit: "25", maxRevisionNumber: String(max) },
          },
        });
        return checkedHistory(
          requireData(r.data, r.response),
          styleId,
          patternId,
          max,
        );
      }),
  });
}
export function usePatternRevision(
  projectId: string,
  styleId: string,
  patternId: string,
  revisionId: string,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.patternRevision(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
      patternId,
      revisionId,
    ),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(revisionPath, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId,
              styleId,
              patternId,
              revisionId,
            },
          },
        });
        return checkedRevision(
          requireData(r.data, r.response),
          styleId,
          patternId,
          revisionId,
        );
      }),
  });
}
