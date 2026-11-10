import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { useWorkspace } from "../../app/workspace";
import { type Spec, type Page, type Revision } from "./model";
import {
  retainMeasurementTrust,
  subscribeMeasurementTrust,
  measurementTrustVersion,
  beginMeasurementRead,
  rejectMeasurementRead,
  acceptMeasurementSpec,
  acceptMeasurementHistory,
  acceptMeasurementRevision,
  selectMeasurementSpec,
  selectMeasurementHistory,
  selectMeasurementRevision,
  hasMeasurementProvenance,
  retainedMeasurementSpec,
  measurementEditingAllowed,
  measurementRecoveryRequired,
  requireMeasurementWrite,
  type MeasurementContext,
} from "./measurementTrust";
// Preserve TanStack's tracked observer reads. Spreading the result eagerly reads
// every property and changes its notification behavior. This proxy adds only a
// view signal; it never mutates a Query, cached data or registry authority.
function withRecovery<T extends object>(query: T, requiresRecovery: boolean) {
  return new Proxy(query, {
    get(target, property, receiver) {
      return property === "requiresRecovery"
        ? requiresRecovery
        : Reflect.get(target, property, receiver);
    },
  }) as T & { requiresRecovery: boolean };
}
export const path =
  "/api/v1/organizations/{organizationId}/projects/{projectId}/styles/{styleId}/measurement-spec" as const;
export const revisionsPath = `${path}/revisions` as const;
export const revisionPath = `${revisionsPath}/{revisionId}` as const;

export function useMeasurementAuthority(projectId: string, styleId: string) {
  const w = useWorkspace(),
    client = useQueryClient();
  const context = useMemo<MeasurementContext>(
    () => ({
      scope: w.scope,
      organizationId: w.organizationId,
      generation: w.generation,
      projectId,
      styleId,
      current: w.current,
    }),
    [client, w.scope, w.organizationId, w.generation, projectId, styleId],
  );
  const owner = useMemo(() => ({}), [client, context]);
  useLayoutEffect(
    () => retainMeasurementTrust(client, context, owner),
    [client, context, owner],
  );
  useSyncExternalStore(
    useCallback(
      (listener) => subscribeMeasurementTrust(client, context, listener),
      [client, context],
    ),
    useCallback(
      () => measurementTrustVersion(client, context),
      [client, context],
    ),
    () => 0,
  );
  return {
    client,
    context,
    retained: (value: Spec | null) =>
      retainedMeasurementSpec(client, context, value),
    recoveryRequired: () => measurementRecoveryRequired(client, context),
    editingAllowed: (value: Spec | null | undefined) =>
      measurementEditingAllowed(client, context, value),
    requireWrite: (
      value: Spec | null,
      mode: string | null,
      baseline: number | null,
    ) => requireMeasurementWrite(client, context, value, mode, baseline),
  };
}
export type MeasurementAuthority = ReturnType<typeof useMeasurementAuthority>;
export function useMeasurementSpec(
  projectId: string,
  styleId: string,
  enabled: boolean,
  freshOnMount = false,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, styleId);
  const query = useQuery({
    queryKey: queryKeys.measurementSpec(
      w.scope,
      w.organizationId,
      projectId,
      styleId,
    ),
    enabled,
    retry: false,
    structuralSharing: false,
    refetchOnMount: (query) =>
      freshOnMount ||
      !hasMeasurementProvenance(
        client,
        context,
        { kind: "spec" },
        query.state.data,
      )
        ? "always"
        : true,
    select: (value: Spec | null) =>
      selectMeasurementSpec(client, context, value),
    queryFn: async ({ signal }) => {
      const receipt = beginMeasurementRead(
        client,
        context,
        { kind: "spec" },
        signal,
      );
      try {
        const value = await w.run(signal, async () => {
          try {
            const r = await api.GET(path, {
              signal,
              params: {
                path: { organizationId: w.organizationId, projectId, styleId },
              },
            });
            return requireData(r.data, r.response);
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return null;
            throw error;
          }
        });
        if (!w.current() || signal.aborted)
          throw new DOMException("Workspace request cancelled", "AbortError");
        return acceptMeasurementSpec(receipt, value);
      } catch (error) {
        rejectMeasurementRead(receipt);
        throw error;
      }
    },
  });
  return withRecovery(
    query,
    measurementRecoveryRequired(client, context, {
      kind: "spec",
    }),
  );
}
export function useMeasurementHistory(
  projectId: string,
  spec: Spec,
  max: number,
  enabled: boolean,
  freshOnMount = false,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, spec.styleId);
  const query = useQuery({
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
    structuralSharing: false,
    refetchOnMount: (query) =>
      freshOnMount ||
      !hasMeasurementProvenance(
        client,
        context,
        { kind: "history", max, limit: 25 },
        query.state.data,
      )
        ? "always"
        : true,
    select: (value: Page) =>
      selectMeasurementHistory(client, context, value, max, 25),
    queryFn: async ({ signal }) => {
      const receipt = beginMeasurementRead(
        client,
        context,
        { kind: "history", specId: spec.id, max, limit: 25 },
        signal,
      );
      try {
        const value = await w.run(signal, async () => {
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
          return requireData(r.data, r.response);
        });
        if (!w.current() || signal.aborted)
          throw new DOMException("Workspace request cancelled", "AbortError");
        return acceptMeasurementHistory(receipt, value);
      } catch (error) {
        rejectMeasurementRead(receipt);
        throw error;
      }
    },
  });
  return withRecovery(
    query,
    measurementRecoveryRequired(client, context, {
      kind: "history",
      max,
      limit: 25,
    }),
  );
}
export function useMeasurementRevision(
  projectId: string,
  spec: Spec,
  id: string,
  enabled: boolean,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, spec.styleId);
  const query = useQuery({
    queryKey: queryKeys.measurementRevision(
      w.scope,
      w.organizationId,
      projectId,
      spec.styleId,
      id,
    ),
    enabled,
    retry: false,
    structuralSharing: false,
    refetchOnMount: (query) =>
      !hasMeasurementProvenance(
        client,
        context,
        { kind: "revision", revisionId: id },
        query.state.data,
      )
        ? "always"
        : true,
    select: (value: Revision) =>
      selectMeasurementRevision(client, context, value, id),
    queryFn: async ({ signal }) => {
      const receipt = beginMeasurementRead(
        client,
        context,
        { kind: "revision", specId: spec.id, revisionId: id },
        signal,
      );
      try {
        const value = await w.run(signal, async () => {
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
          return requireData(r.data, r.response);
        });
        if (!w.current() || signal.aborted)
          throw new DOMException("Workspace request cancelled", "AbortError");
        return acceptMeasurementRevision(receipt, value);
      } catch (error) {
        rejectMeasurementRead(receipt);
        throw error;
      }
    },
  });
  return withRecovery(
    query,
    measurementRecoveryRequired(client, context, {
      kind: "revision",
      revisionId: id,
    }),
  );
}
