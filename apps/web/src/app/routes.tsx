import { lazy, Suspense, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router";
import { ApiError } from "../api/errors";
import { Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { useSession } from "./session";
const Overview = lazy(() => import("../pages/OverviewPage"));
const Organization = lazy(() => import("../pages/OrganizationPage"));
const Admin = lazy(() => import("../pages/AdminLandingPage"));
function Authenticated({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.status === "pending")
    return <Skeleton label="Checking your session" />;
  if (session.status === "unauthenticated")
    return (
      <ApiErrorState error={session.identityError ?? new ApiError(401)} page />
    );
  if (session.status === "error")
    return (
      <ApiErrorState
        error={session.identityError}
        retry={session.retryIdentity}
        page
      />
    );
  return children;
}
function AdminGate() {
  const session = useSession();
  if (session.capability === "PENDING")
    return <Skeleton label="Checking curation access" />;
  if (session.capability === "ERROR")
    return (
      <ApiErrorState
        error={session.capabilityError}
        title="Curation access unavailable"
        retry={session.retryCapability}
        page
      />
    );
  if (session.capability === "NON_ADMIN")
    return <ApiErrorState error={new ApiError(403)} page />;
  // Only this successful branch mounts the lazy admin bundle. No admin data is prefetched.
  return <Admin />;
}
export function AppRoutes() {
  return (
    <Suspense fallback={<Skeleton label="Loading page" />}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route
          path="/organization"
          element={
            <Authenticated>
              <Organization />
            </Authenticated>
          }
        />
        <Route
          path="/admin"
          element={
            <Authenticated>
              <AdminGate />
            </Authenticated>
          }
        />
        <Route
          path="*"
          element={
            <>
              <h1>Page not found</h1>
              <Link to="/">Return to overview</Link>
            </>
          }
        />
      </Routes>
    </Suspense>
  );
}
