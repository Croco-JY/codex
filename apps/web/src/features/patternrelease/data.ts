import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { api, requireData } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useWorkspace } from "../../app/workspace";
import { queryKeys } from "../../api/queryKeys";
import { revisionPath } from "../pattern/data";
import {
  checkedConsent,
  checkedConsentPage,
  checkedEvents,
  checkedReceived,
  checkedReceivedPage,
  checkedSource,
  checkedSourcePage,
  type Consent,
  type Received,
  type SourceScope,
  type SourceSummary,
  type SourceView,
} from "./model";

export const consentsPath =
  "/api/v1/organizations/{organizationId}/release-consents" as const;
export const consentPath = `${consentsPath}/{consentId}` as const;
export const receivedPath =
  "/api/v1/organizations/{organizationId}/received-pattern-releases" as const;
export const receivedDetailPath = `${receivedPath}/{releaseId}` as const;
export const sourcePath = `${revisionPath}/releases` as const;
export const sourceDetailPath = `${sourcePath}/{releaseId}` as const;
export function useReleaseScope() {
  const w = useWorkspace();
  return {
    w,
    key: [
      ...queryKeys.workspace(w.scope, w.organizationId),
      "generation",
      w.generation,
      "pattern-release",
    ] as const,
  };
}
export function useConsents(cursor: string | null) {
  const { w, key } = useReleaseScope();
  return useQuery({
    queryKey: [...key, "consents", 25, cursor],
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(consentsPath, {
          signal,
          params: {
            path: { organizationId: w.organizationId },
            query: { limit: 25, ...(cursor ? { cursor } : {}) },
          },
        });
        return checkedConsentPage(
          requireData(r.data, r.response),
          w.organizationId,
        );
      }),
  });
}
export function useConsent(expected: Consent) {
  const { w, key } = useReleaseScope();
  const anchor = useRef(expected);
  const check = (value: unknown) => {
    const result = checkedConsent(
      value,
      w.organizationId,
      expected.id,
      anchor.current,
    );
    anchor.current = result;
    return result;
  };
  return useQuery({
    queryKey: [...key, "consent", expected.id],
    retry: false,
    select: check,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(consentPath, {
          signal,
          params: {
            path: { organizationId: w.organizationId, consentId: expected.id },
          },
        });
        return check(requireData(r.data, r.response));
      }),
  });
}
export function useReceived(cursor: string | null) {
  const { w, key } = useReleaseScope();
  return useQuery({
    queryKey: [...key, "inbox", 25, cursor],
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(receivedPath, {
          signal,
          params: {
            path: { organizationId: w.organizationId },
            query: { limit: 25, ...(cursor ? { cursor } : {}) },
          },
        });
        return checkedReceivedPage(
          requireData(r.data, r.response),
          w.organizationId,
        );
      }),
  });
}
export function useReceivedDetail(id: string, expected?: Received) {
  const { w, key } = useReleaseScope();
  const anchor = useRef(expected);
  const check = (value: unknown) => {
    const result = checkedReceived(value, w.organizationId, id, anchor.current);
    anchor.current = result;
    return result;
  };
  return useQuery({
    queryKey: [...key, "received", id],
    retry: false,
    select: check,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(receivedDetailPath, {
          signal,
          params: { path: { organizationId: w.organizationId, releaseId: id } },
        });
        return check(requireData(r.data, r.response));
      }),
  });
}
export function useSourceReleases(scope: SourceScope, cursor: string | null) {
  const { w, key } = useReleaseScope();
  return useQuery({
    queryKey: [...key, "source", scope, 25, cursor],
    retry: false,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(sourcePath, {
          signal,
          params: {
            path: scope,
            query: { limit: 25, ...(cursor ? { cursor } : {}) },
          },
        });
        return checkedSourcePage(requireData(r.data, r.response), scope);
      }),
  });
}
export function useSourceRelease(scope: SourceScope, expected: SourceSummary) {
  const { w, key } = useReleaseScope();
  const last = useRef<SourceView | undefined>(undefined);
  const check = (value: unknown) => {
    const result = checkedSource(value, scope, expected.id, expected);
    if (
      last.current &&
      result.latestEventNumber < last.current.latestEventNumber
    )
      throw new ApiError(502);
    last.current = result;
    return result;
  };
  return useQuery({
    queryKey: [...key, "source", scope, "release", expected.id],
    retry: false,
    select: check,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(sourceDetailPath, {
          signal,
          params: { path: { ...scope, releaseId: expected.id } },
        });
        return check(requireData(r.data, r.response));
      }),
  });
}
export function useReleaseEvents(
  scope: SourceScope,
  id: string,
  max: number,
  limit = 25,
) {
  const { w, key } = useReleaseScope();
  return useQuery({
    queryKey: [...key, "source", scope, "release", id, "events", limit, max],
    retry: false,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      w.run(signal, async () => {
        const r = await api.GET(`${sourceDetailPath}/events`, {
          signal,
          params: {
            path: { ...scope, releaseId: id },
            query: { limit, maxEventNumber: max },
          },
        });
        return checkedEvents(requireData(r.data, r.response), id, max, limit);
      }),
  });
}
