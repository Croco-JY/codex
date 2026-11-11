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
  measurementRecoveries,
  measurementRecoveryState,
  requireMeasurementRecovery,
  beginMeasurementRecoveryRead,
  type MeasurementRecovery,
  requireMeasurementWrite,
  type MeasurementContext,
} from "./measurementTrust";
// Preserve TanStack's tracked observer reads. Spreading the result eagerly reads
// every property and changes its notification behavior. This proxy adds only a
// view signal; it never mutates a Query, cached data or registry authority.
function withRecovery<T extends object>(
  query: T,
  requiresRecovery: boolean,
  beforeRefetch?: () => void,
) {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === "refetch" && beforeRefetch)
        return (...args: unknown[]) => {
          beforeRefetch();
          const refetch: unknown = Reflect.get(target, property, receiver);
          if (typeof refetch !== "function") throw new ApiError(502);
          return Reflect.apply(refetch, undefined, args);
        };
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
    recoveries: (offset = 0) => measurementRecoveries(client, context, offset),
    recoveryState: (descriptor: MeasurementRecovery) =>
      measurementRecoveryState(client, context, descriptor),
    requireRecovery: (descriptor: MeasurementRecovery) =>
      requireMeasurementRecovery(client, context, descriptor),
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
  recovery?: MeasurementRecovery,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, styleId);
  const key = queryKeys.measurementSpec(
    w.scope,
    w.organizationId,
    projectId,
    styleId,
  );
  const query = useQuery({
    queryKey: recovery ? [...key, "explicit-recovery", recovery.channel] : key,
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
      const request = { kind: "spec" as const };
      const receipt = recovery
        ? beginMeasurementRecoveryRead(
            client,
            context,
            recovery,
            request,
            signal,
          )
        : beginMeasurementRead(client, context, request, signal);
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
        const accepted = acceptMeasurementSpec(receipt, value);
        // Publish only an already authenticated/accepted response. Cache writes
        // never recover network failures; the receipt commit above does that.
        if (recovery) client.setQueryData(key, accepted);
        return accepted;
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
    recovery
      ? () => {
          requireMeasurementRecovery(client, context, recovery);
        }
      : undefined,
  );
}
export function useMeasurementHistory(
  projectId: string,
  spec: Pick<Spec, "id" | "styleId">,
  max: number,
  enabled: boolean,
  freshOnMount = false,
  limit = 25,
  recovery?: MeasurementRecovery,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, spec.styleId);
  const key = queryKeys.measurementRevisions(
    w.scope,
    w.organizationId,
    projectId,
    spec.styleId,
    limit,
    max,
  );
  const query = useQuery({
    queryKey: recovery ? [...key, "explicit-recovery", recovery.channel] : key,
    enabled,
    retry: false,
    structuralSharing: false,
    refetchOnMount: (query) =>
      freshOnMount ||
      !hasMeasurementProvenance(
        client,
        context,
        { kind: "history", max, limit },
        query.state.data,
      )
        ? "always"
        : true,
    select: (value: Page) =>
      selectMeasurementHistory(client, context, value, max, limit),
    queryFn: async ({ signal }) => {
      const request = { kind: "history" as const, specId: spec.id, max, limit };
      const receipt = recovery
        ? beginMeasurementRecoveryRead(
            client,
            context,
            recovery,
            request,
            signal,
          )
        : beginMeasurementRead(client, context, request, signal);
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
              query: { limit: String(limit), maxRevisionNumber: String(max) },
            },
          });
          return requireData(r.data, r.response);
        });
        if (!w.current() || signal.aborted)
          throw new DOMException("Workspace request cancelled", "AbortError");
        const accepted = acceptMeasurementHistory(receipt, value);
        if (recovery) client.setQueryData(key, accepted);
        return accepted;
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
      limit,
    }),
    recovery
      ? () => {
          requireMeasurementRecovery(client, context, recovery);
        }
      : undefined,
  );
}
export function useMeasurementRevision(
  projectId: string,
  spec: Pick<Spec, "id" | "styleId">,
  id: string,
  enabled: boolean,
  recovery?: MeasurementRecovery,
) {
  const w = useWorkspace(),
    { client, context } = useMeasurementAuthority(projectId, spec.styleId);
  const key = queryKeys.measurementRevision(
    w.scope,
    w.organizationId,
    projectId,
    spec.styleId,
    id,
  );
  const query = useQuery({
    queryKey: recovery ? [...key, "explicit-recovery", recovery.channel] : key,
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
      const request = {
        kind: "revision" as const,
        specId: spec.id,
        revisionId: id,
      };
      const receipt = recovery
        ? beginMeasurementRecoveryRead(
            client,
            context,
            recovery,
            request,
            signal,
          )
        : beginMeasurementRead(client, context, request, signal);
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
        const accepted = acceptMeasurementRevision(receipt, value);
        if (recovery) client.setQueryData(key, accepted);
        return accepted;
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
    recovery
      ? () => {
          requireMeasurementRecovery(client, context, recovery);
        }
      : undefined,
  );
}
