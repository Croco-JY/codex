import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, requireData } from "../api/client";
import { ApiError, canRefreshRead } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import {
  beforeSessionReset,
  getSession,
  identityEstablished,
  renewSession,
  subscribeSession,
} from "../api/session";
import type { components } from "../api/schema";

type Actor = Required<components["schemas"]["Actor"]>;
type Organization = components["schemas"]["OrganizationView"];
type IdentityState = "pending" | "authenticated" | "unauthenticated" | "error";
type CapabilityState = "PENDING" | "ADMIN" | "NON_ADMIN" | "ERROR";
type Session = {
  scope: string;
  identity: Actor | undefined;
  status: IdentityState;
  identityError: unknown;
  retryIdentity: () => void;
  capability: CapabilityState;
  capabilityError: unknown;
  retryCapability: () => void;
  selected: Organization | null;
  select: (org: Organization | null) => void;
  local: boolean;
};
const Context = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Session provider required");
  return session;
}
export function SessionProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const snapshot = useSyncExternalStore(subscribeSession, getSession);
  useLayoutEffect(
    () =>
      beforeSessionReset(() => {
        void cache.cancelQueries();
        cache.clear();
      }),
    [cache],
  );
  // Remount all actor-owned UI state, drafts and selected organization as well as query scopes.
  return (
    <SessionScope key={snapshot.key} snapshot={snapshot}>
      {children}
    </SessionScope>
  );
}
function SessionScope({
  children,
  snapshot,
}: {
  children: ReactNode;
  snapshot: ReturnType<typeof getSession>;
}) {
  const cache = useQueryClient();
  const { pathname } = useLocation();
  const [selected, select] = useState<Organization | null>(null);
  const previousActor = useRef<Actor | undefined>(undefined);
  const identity = useQuery({
    queryKey: queryKeys.identity(snapshot.key),
    enabled: !snapshot.ended,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/identity", { signal });
      const actor = requireData(data, response);
      if (!actor.issuer || !actor.subject) throw new ApiError(502);
      return { issuer: actor.issuer, subject: actor.subject };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });
  const changed = Boolean(
    identity.data &&
      previousActor.current &&
      (previousActor.current.issuer !== identity.data.issuer ||
        previousActor.current.subject !== identity.data.subject),
  );
  useLayoutEffect(() => {
    if (changed) {
      renewSession();
      return;
    }
    if (identity.data) {
      previousActor.current = identity.data;
      identityEstablished(snapshot.key);
    }
  }, [changed, identity.data, snapshot.key]);
  const status: IdentityState =
    snapshot.ended ||
    (identity.error instanceof ApiError && identity.error.status === 401)
      ? "unauthenticated"
      : changed || identity.isPending
        ? "pending"
        : identity.isError
          ? "error"
          : "authenticated";
  const capabilities = useQuery({
    queryKey: queryKeys.capabilities(snapshot.key),
    enabled: status === "authenticated",
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/identity/capabilities", {
        signal,
      });
      const result = requireData(data, response);
      if (typeof result.platformAdmin !== "boolean") throw new ApiError(502);
      return result.platformAdmin;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: (query) => canRefreshRead(query.state.error),
    refetchInterval: (query) =>
      status === "authenticated" && canRefreshRead(query.state.error)
        ? 30_000
        : false,
  });
  useLayoutEffect(() => {
    if (pathname === "/admin" && status === "authenticated")
      void cache.invalidateQueries({
        queryKey: queryKeys.capabilities(snapshot.key),
      });
  }, [pathname, status, cache, snapshot.key]);
  const capability: CapabilityState =
    capabilities.isFetching || capabilities.isPending
      ? "PENDING"
      : capabilities.isError
        ? "ERROR"
        : capabilities.data === true
          ? "ADMIN"
          : "NON_ADMIN";
  return (
    <Context.Provider
      value={{
        scope: snapshot.key,
        identity: status === "authenticated" ? identity.data : undefined,
        status,
        identityError: snapshot.ended
          ? new ApiError(401, snapshot.requestId)
          : identity.error,
        retryIdentity: () => {
          void identity.refetch();
        },
        capability,
        capabilityError: capabilities.error,
        retryCapability: () => {
          void capabilities.refetch();
        },
        selected,
        select,
        local: snapshot.local,
      }}
    >
      {children}
    </Context.Provider>
  );
}
