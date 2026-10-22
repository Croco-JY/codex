import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { queryKeys } from "../../api/queryKeys";
import { ApiError } from "../../api/errors";
import { useWorkspace } from "../../app/workspace";
import { checked, type Filter } from "./model";
export function useProject(id: string) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.project(w.scope, w.organizationId, id),
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(
          "/api/v1/organizations/{organizationId}/projects/{projectId}",
          {
            signal,
            params: {
              path: { organizationId: w.organizationId, projectId: id },
            },
          },
        );
        return checked(requireData(r.data, r.response), w.organizationId, id);
      }),
  });
}
export function useStyle(project: string, id: string) {
  const w = useWorkspace();
  return useQuery({
    queryKey: queryKeys.style(w.scope, w.organizationId, project, id),
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(
          "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}",
          {
            signal,
            params: {
              path: {
                organizationId: w.organizationId,
                projectId: project,
                styleId: id,
              },
            },
          },
        );
        return checked(requireData(r.data, r.response), project, id);
      }),
  });
}
export function useCollection(
  project: string | undefined,
  status: Filter,
  offset: number,
) {
  const w = useWorkspace(),
    filter = status === "ALL" ? undefined : status;
  return useQuery({
    queryKey: project
      ? queryKeys.styles(w.scope, w.organizationId, project, filter, 25, offset)
      : queryKeys.projects(w.scope, w.organizationId, filter, 25, offset),
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const query = {
          limit: "25",
          offset: String(offset),
          ...(filter ? { status: filter } : {}),
        };
        const r = project
          ? await api.GET(
              "/api/v1/organizations/{organizationId}/projects/{projectId}/styles",
              {
                signal,
                params: {
                  path: {
                    organizationId: w.organizationId,
                    projectId: project,
                  },
                  query,
                },
              },
            )
          : await api.GET("/api/v1/organizations/{organizationId}/projects", {
              signal,
              params: { path: { organizationId: w.organizationId }, query },
            });
        const page = requireData(r.data, r.response);
        if (
          !Array.isArray(page.items) ||
          typeof page.hasMore !== "boolean" ||
          page.limit !== 25 ||
          page.offset !== offset
        )
          throw new ApiError(502);
        page.items.forEach((item) =>
          checked(item, project ?? w.organizationId),
        );
        return page;
      }),
  });
}
