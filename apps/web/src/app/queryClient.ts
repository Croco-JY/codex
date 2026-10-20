import { QueryClient } from "@tanstack/react-query";
import { canRefreshRead, retryRead } from "../api/errors";
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryRead,
        refetchOnWindowFocus: (query) => canRefreshRead(query.state.error),
        refetchOnReconnect: (query) => canRefreshRead(query.state.error),
        retryDelay: 300,
        staleTime: 30_000,
        gcTime: 300_000,
      },
      mutations: { retry: false },
    },
  });
}
