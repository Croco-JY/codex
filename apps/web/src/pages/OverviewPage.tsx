import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, requireData } from "../api/client";
import { canRefreshRead } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { StatusBadge, Surface, Stack, Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
function Health() {
  const query = useQuery({
    queryKey: queryKeys.health,
    queryFn: async ({ signal }) => {
      const { data, response } = await api.GET("/api/health", { signal });
      return requireData(data, response);
    },
    refetchInterval: (query) =>
      canRefreshRead(query.state.error) ? 30_000 : false,
  });
  return (
    <Surface>
      <div className="section-heading">
        <h2>System connection</h2>
        <span className="eyebrow">LIVE API</span>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ApiErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="health">
          <StatusBadge tone="success">API {query.data.status}</StatusBadge>
          <p>
            Connected to {query.data.application}. The foundation is ready for
            organization work.
          </p>
        </div>
      )}
    </Surface>
  );
}
export default function OverviewPage() {
  return (
    <Stack>
      <header>
        <p className="eyebrow">WORKSPACE / FOUNDATION</p>
        <h1>A clear starting point.</h1>
        <p className="lead">
          Your organization, people and permissions — built on one secure
          foundation.
        </p>
      </header>
      <Health />
      <Surface>
        <h2>Built for what comes next</h2>
        <p className="muted">
          This workspace currently supports organization setup. Product
          development and manufacturing workflows will become available in later
          phases.
        </p>
        <Link to="/organization" className="text-link">
          Manage your organization →
        </Link>
      </Surface>
    </Stack>
  );
}
