import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api, requireData } from "../api/client";
import { ApiError } from "../api/errors";
import { beforeSessionReset, getSession } from "../api/session";
import { queryKeys } from "../api/queryKeys";
import type { components } from "../api/schema";
import { ApiErrorState } from "../ui/ApiErrorState";
import { Skeleton } from "../ui";
import { useSession } from "./session";

type Organization = components["schemas"]["OrganizationView"];
export function validOrganization(org: Organization): org is Organization & {
  id: string;
  name: string;
  role: "VIEWER" | "ORG_ADMIN" | "ORG_OWNER";
} {
  return (
    !!org &&
    typeof org.id === "string" &&
    !!org.id &&
    typeof org.name === "string" &&
    org.status === "ACTIVE" &&
    ["VIEWER", "ORG_ADMIN", "ORG_OWNER"].includes(org.role ?? "")
  );
}
export function organizationsOptions(scope: string) {
  return {
    queryKey: queryKeys.organizations(scope),
    staleTime: 0,
    refetchOnMount: "always" as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const r = await api.GET("/api/organizations", { signal });
      const data = requireData(r.data, r.response);
      if (!Array.isArray(data)) throw new ApiError(502);
      return data;
    },
  };
}
export type WorkspaceToken = {
  scope: string;
  organizationId: string;
  generation: number;
};
const cancellation = () =>
  new DOMException("Workspace request cancelled", "AbortError");
export const isCancelled = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";
type Boundary = {
  active?: Organization;
  generation: number;
  resolved?: string;
  denied?: { id: string; error: ApiError };
};
type BoundaryContext = Boundary & {
  enter: (org: Organization) => void;
  choose: (org: Organization) => void;
  resolve: (id?: string) => void;
  deny: (id: string, error: ApiError) => void;
  current: (token: WorkspaceToken) => boolean;
  register: (token: WorkspaceToken, controller: AbortController) => () => void;
};
const Context = createContext<BoundaryContext | null>(null);
export function useWorkspaceBoundary() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace boundary required");
  return value;
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const session = useSession(),
    cache = useQueryClient(),
    navigate = useNavigate();
  const { pathname } = useLocation();
  const routeOrg = /^\/organizations\/([^/]+)\/projects(?:\/|$)/.exec(
    pathname,
  )?.[1];
  const route = useRef(routeOrg);
  route.current = routeOrg;
  const [state, setState] = useState<Boundary>({ generation: 0 });
  const live = useRef(state);
  const controllers = useRef(new Map<AbortController, WorkspaceToken>());
  const cleanup = (old: Boundary) => {
    controllers.current.forEach((_token, controller) => controller.abort());
    controllers.current.clear();
    if (!old.active?.id) return;
    const key = queryKeys.workspace(session.scope, old.active.id);
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
    const mutations = cache.getMutationCache();
    mutations.findAll({ mutationKey: key }).forEach((m) => mutations.remove(m));
  };
  const enter = (org: Organization) => {
    if (!validOrganization(org) || getSession().key !== session.scope) return;
    const old = live.current;
    if (old.active?.id === org.id && !old.denied) {
      // Only freshly resolved membership supplies role/lifecycle authority.
      if (old.active !== org) {
        const next = { ...old, active: org };
        live.current = next;
        setState(next);
      }
      session.select(org);
      return;
    }
    // Invalidate the synchronous guard before abort callbacks can settle.
    live.current = { generation: old.generation + 1 };
    cleanup(old);
    const next = {
      active: org,
      generation: old.generation + 1,
      resolved: org.id,
    };
    live.current = next;
    setState(next);
    session.select(org);
  };
  const deny = (id: string, error: ApiError) => {
    const old = live.current;
    if (old.denied?.id === id) return;
    if (old.active?.id && old.active.id !== id) return;
    live.current = { generation: old.generation + 1 };
    cleanup(old);
    const next = { generation: old.generation + 1, denied: { id, error } };
    live.current = next;
    setState(next);
    if (session.selected?.id === id) session.select(null);
  };
  const current = (token: WorkspaceToken) =>
    getSession().key === token.scope &&
    token.scope === session.scope &&
    live.current.active?.id === token.organizationId &&
    live.current.generation === token.generation &&
    live.current.resolved === token.organizationId &&
    route.current === token.organizationId;
  useLayoutEffect(() => {
    const stop = () => {
      const old = live.current;
      live.current = { generation: old.generation + 1 };
      cleanup(old);
    };
    const unregister = beforeSessionReset(stop);
    return () => {
      unregister();
      stop();
    };
  }, [session.scope, cache]);
  return (
    <Context.Provider
      value={{
        ...state,
        enter,
        choose: (org) => {
          if (!validOrganization(org)) return;
          enter(org);
          navigate(`/organizations/${org.id}/projects`);
        },
        resolve: (id) => {
          if (live.current.resolved === id) return;
          const next = { ...live.current, resolved: id };
          live.current = next;
          setState(next);
        },
        deny,
        current,
        register: (token, controller) => {
          if (!current(token)) {
            controller.abort();
            throw cancellation();
          }
          controllers.current.set(controller, token);
          return () => {
            controllers.current.delete(controller);
          };
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { organizationId = "" } = useParams();
  return (
    <MembershipGate key={organizationId} id={organizationId}>
      {children}
    </MembershipGate>
  );
}
function MembershipGate({ id, children }: { id: string; children: ReactNode }) {
  const session = useSession(),
    boundary = useWorkspaceBoundary();
  const memberships = useQuery(organizationsOptions(session.scope));
  const ready = memberships.isFetchedAfterMount && memberships.isSuccess;
  const org = ready
    ? memberships.data.find((org) => validOrganization(org) && org.id === id)
    : undefined;
  const denied = boundary.denied?.id === id ? boundary.denied.error : undefined;
  useLayoutEffect(() => {
    if (denied) return;
    if (!ready || !org) {
      boundary.resolve();
      if (
        memberships.isFetchedAfterMount &&
        !memberships.isError &&
        !org &&
        boundary.active?.id === id
      )
        boundary.deny(id, new ApiError(403));
      return;
    }
    boundary.enter(org);
    boundary.resolve(id);
  }, [
    ready,
    org,
    denied,
    memberships.isError,
    memberships.isFetchedAfterMount,
    id,
  ]);
  if (denied)
    return (
      <>
        <ApiErrorState error={denied} page />
        <Link to="/organization">Choose an organization</Link>
      </>
    );
  if (memberships.isError)
    return (
      <>
        <ApiErrorState
          error={memberships.error}
          page
          retry={() => void memberships.refetch()}
        />
        <Link to="/organization">Choose an organization</Link>
      </>
    );
  if (!ready) return <Skeleton label="Resolving organization membership" />;
  if (!org)
    return (
      <>
        <ApiErrorState error={new ApiError(403)} page />
        <Link to="/organization">Choose an organization</Link>
      </>
    );
  if (boundary.active?.id !== id || boundary.resolved !== id)
    return <Skeleton label="Opening organization workspace" />;
  return (
    <div
      key={`${session.scope}:${boundary.generation}`}
      className="product-workspace"
    >
      {children}
    </div>
  );
}
export function useWorkspace() {
  const boundary = useWorkspaceBoundary(),
    session = useSession();
  const { organizationId = "" } = useParams();
  if (
    !boundary.active ||
    boundary.active.id !== organizationId ||
    boundary.resolved !== organizationId
  )
    throw new Error("Resolved workspace required");
  const token: WorkspaceToken = {
    scope: session.scope,
    organizationId,
    generation: boundary.generation,
  };
  const current = () => boundary.current(token);
  const run = async <T,>(
    signal: AbortSignal,
    request: () => Promise<T>,
  ): Promise<T> => {
    if (!current() || signal.aborted) throw cancellation();
    try {
      const value = await request();
      if (!current() || signal.aborted) throw cancellation();
      return value;
    } catch (error) {
      if (!current() || signal.aborted) throw cancellation();
      if (error instanceof ApiError && error.status === 403)
        boundary.deny(organizationId, error);
      throw error;
    }
  };
  return {
    ...token,
    token,
    organization: boundary.active,
    writer:
      boundary.active.role === "ORG_OWNER" ||
      boundary.active.role === "ORG_ADMIN",
    current,
    run,
    register: boundary.register,
  };
}
export function useWorkspaceCommand<I, O>(
  key: QueryKey,
  command: (input: I, signal: AbortSignal) => Promise<O>,
  success: (value: O) => void | Promise<void>,
  failure?: (error: unknown) => void | Promise<void>,
) {
  const workspace = useWorkspace();
  const owned = useRef(new Set<AbortController>());
  useLayoutEffect(
    () => () => {
      owned.current.forEach((c) => c.abort());
      owned.current.clear();
    },
    [],
  );
  return useMutation({
    mutationKey: key,
    retry: false,
    mutationFn: async (input: I) => {
      const controller = new AbortController();
      owned.current.add(controller);
      const release = workspace.register(workspace.token, controller);
      try {
        return await workspace.run(controller.signal, () =>
          command(input, controller.signal),
        );
      } finally {
        release();
        owned.current.delete(controller);
      }
    },
    onSuccess: (value) => {
      if (workspace.current()) return success(value);
    },
    onError: (error) => {
      if (workspace.current() && !isCancelled(error)) return failure?.(error);
    },
  });
}
