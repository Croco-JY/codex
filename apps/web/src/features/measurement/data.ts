import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace } from "../../app/workspace";
import { checkedSpec, checkedPage, checkedRevision, type Spec } from "./model";
export const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/measurement-spec" as const;
export const revisionsPath = `${path}/revisions` as const;
export const revisionPath = `${revisionsPath}/{revisionId}` as const;
export function useMeasurementSpec(
  projectId: string,
  styleId: string,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.measurementSpec(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
    ),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        try {
          const r = await api.GET(path, {
            signal,
            params: {
              path: { organizationId: w.organizationId, projectId, styleId },
            },
          });
          return checkedSpec(requireData(r.data, r.response), styleId);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return null;
          throw e;
        }
      }),
  });
}
export function useMeasurementHistory(
  projectId: string,
  spec: Spec,
  max: number,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.measurementRevisions(
      w.scope,
      w.organizationId,
      projectId,
      spec.styleId,
      25,
      max,
    ),
    enabled,
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(revisionsPath, {
          signal,
          params: {
            path: {
              organizationId: w.organizationId,
              projectId,
              styleId: spec.styleId,
            },
            query: { limit: "25", maxRevisionNumber: String(max) },
          },
        });
        return checkedPage(
          requireData(r.data, r.response),
          spec.styleId,
          spec.id,
          25,
          max,
        );
      }),
  });
}
export function useMeasurementRevision(
  projectId: string,
  spec: Spec,
  id: string,
  enabled: boolean,
) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.measurementRevision(
      w.scope,
      w.organizationId,
      projectId,
      spec.styleId,
      id,
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
              styleId: spec.styleId,
              revisionId: id,
            },
          },
        });
        return checkedRevision(
          requireData(r.data, r.response),
          spec.styleId,
          spec.id,
          id,
        );
      }),
  });
}
