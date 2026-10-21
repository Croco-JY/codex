import { useEffect, useLayoutEffect, useRef } from "react";
import { infiniteQueryOptions, useMutation } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { queryKeys } from "../../api/queryKeys";
import { getSession } from "../../api/session";
import { useSession } from "../../app/session";
import type { Source } from "./model";
export const nextOffset = (
  page: unknown[],
  _pages: unknown[][],
  offset: number,
) =>
  page.length === 25 && offset + page.length <= 100000
    ? offset + page.length
    : undefined;
export const sourceOptions = (scope: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.adminSources(scope),
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET("/api/v1/admin/sources", {
        signal,
        params: { query: { limit: 25, offset: pageParam } },
      });
      return requireData(data, response);
    },
    getNextPageParam: nextOffset,
  });
export const observationOptions = (scope: string, record: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.adminObservations(scope, record),
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/admin/source-records/{id}/observations",
        {
          signal,
          params: {
            path: { id: record },
            query: { limit: 25, offset: pageParam },
          },
        },
      );
      return requireData(data, response);
    },
    getNextPageParam: nextOffset,
  });
export const reviewOptions = (scope: string, observation: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.adminReviews(scope, observation),
    initialPageParam: 0,
    queryFn: async ({ signal, pageParam }) => {
      const { data, response } = await api.GET(
        "/api/v1/admin/source-observations/{id}/reviews",
        {
          signal,
          params: {
            path: { id: observation },
            query: { limit: 25, offset: pageParam },
          },
        },
      );
      return requireData(data, response);
    },
    getNextPageParam: nextOffset,
  });
export function uniqueRows<T extends { id?: string }>(
  pages: T[][] | undefined,
): T[] {
  const seen = new Set<string>();
  return (pages ?? []).flat().filter((row) => {
    if (!row.id) return true;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
export type SourcePages = { pages: Source[][]; pageParams: number[] };
export const isAbort = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  "name" in error &&
  error.name === "AbortError";
export const ambiguous = (error: unknown) =>
  error instanceof ApiError && error.status === 0;
export function useAdminReadError(error: unknown) {
  const { scope, retryCapability } = useSession();
  useEffect(() => {
    if (
      error instanceof ApiError &&
      error.status === 403 &&
      scope === getSession().key
    )
      retryCapability();
  }, [error, scope]);
}
/** Abort child commands on unmount/revocation as well as guarding the opaque Actor scope. */
export function useAdminMutation<V, T>(
  command: string,
  send: (value: V, signal: AbortSignal) => Promise<T>,
  success: (data: T, value: V, current: () => boolean) => void | Promise<void>,
  failure?: (
    error: unknown,
    value: V,
    current: () => boolean,
  ) => void | Promise<void>,
) {
  const session = useSession();
  const controller = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  const current = () =>
    !!controller.current &&
    !controller.current.signal.aborted &&
    session.scope === getSession().key;
  return useMutation({
    mutationKey: [...queryKeys.admin(session.scope), "command", command],
    retry: false,
    mutationFn: async (value: V) => {
      if (!current()) throw new DOMException("Request cancelled", "AbortError");
      const result = await send(value, controller.current!.signal);
      if (!current()) throw new DOMException("Request cancelled", "AbortError");
      return result;
    },
    onSuccess: async (data, value) => {
      if (current()) await success(data, value, current);
    },
    onError: async (error, value) => {
      if (!current() || isAbort(error)) return;
      if (error instanceof ApiError && error.status === 403)
        session.retryCapability();
      await failure?.(error, value, current);
    },
  });
}
