import { lazy, Suspense, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router";
import { ApiError } from "../api/errors";
import { Skeleton } from "../ui";
import { ApiErrorState } from "../ui/ApiErrorState";
import { WorkspaceGate } from "./workspace";
import { useSession } from "./session";
const Projects = lazy(() => import("../pages/ProjectsPage"));
const ProjectDetail = lazy(() => import("../pages/ProjectDetailPage"));
const StyleDetail = lazy(() => import("../pages/StyleDetailPage"));
const Overview = lazy(() => import("../pages/OverviewPage"));
const Organization = lazy(() => import("../pages/OrganizationPage"));
const Admin = lazy(() => import("../pages/AdminLandingPage"));
const AdminSources = lazy(() => import("../pages/AdminSourcesPage"));
const AdminSuppliers = lazy(() => import("../pages/AdminSuppliersPage"));
const AdminSupplierDetail = lazy(
  () => import("../pages/AdminSupplierDetailPage"),
);
const AdminFacilities = lazy(() => import("../pages/AdminFacilitiesPage"));
const AdminFacilityDetail = lazy(
  () => import("../pages/AdminFacilityDetailPage"),
);
const AdminMaterials = lazy(() => import("../pages/AdminMaterialsPage"));
const AdminMaterialDetail = lazy(
  () => import("../pages/AdminMaterialDetailPage"),
);
const AdminListings = lazy(() => import("../pages/AdminListingsPage"));
const AdminListingDetail = lazy(
  () => import("../pages/AdminListingDetailPage"),
);
const Materials = lazy(() => import("../pages/MaterialsPage"));
const MaterialDetail = lazy(() => import("../pages/MaterialDetailPage"));
const MaterialListing = lazy(() => import("../pages/MaterialListingPage"));
const Suppliers = lazy(() => import("../pages/SuppliersPage"));
const SupplierDetail = lazy(() => import("../pages/SupplierDetailPage"));
const Facilities = lazy(() => import("../pages/FacilitiesPage"));
const FacilityDetail = lazy(() => import("../pages/FacilityDetailPage"));
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
function AdminGate({ children }: { children: ReactNode }) {
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
  return children;
}
export function AppRoutes() {
  return (
    <Suspense fallback={<Skeleton label="Loading page" />}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route
          path="/organizations/:organizationId/projects"
          element={
            <Authenticated>
              <WorkspaceGate>
                <Projects />
              </WorkspaceGate>
            </Authenticated>
          }
        />
        <Route
          path="/organizations/:organizationId/projects/:projectId"
          element={
            <Authenticated>
              <WorkspaceGate>
                <ProjectDetail />
              </WorkspaceGate>
            </Authenticated>
          }
        />
        <Route
          path="/organizations/:organizationId/projects/:projectId/styles/:styleId"
          element={
            <Authenticated>
              <WorkspaceGate>
                <StyleDetail />
              </WorkspaceGate>
            </Authenticated>
          }
        />
        <Route
          path="/facilities/:id"
          element={
            <Authenticated>
              <FacilityDetail />
            </Authenticated>
          }
        />
        <Route
          path="/facilities"
          element={
            <Authenticated>
              <Facilities />
            </Authenticated>
          }
        />
        <Route
          path="/suppliers/:id"
          element={
            <Authenticated>
              <SupplierDetail />
            </Authenticated>
          }
        />
        <Route
          path="/suppliers"
          element={
            <Authenticated>
              <Suppliers />
            </Authenticated>
          }
        />
        <Route
          path="/materials"
          element={
            <Authenticated>
              <Materials />
            </Authenticated>
          }
        />
        <Route
          path="/materials/:id"
          element={
            <Authenticated>
              <MaterialDetail />
            </Authenticated>
          }
        />
        <Route
          path="/material-listings/:id"
          element={
            <Authenticated>
              <MaterialListing />
            </Authenticated>
          }
        />
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
              <AdminGate>
                <Admin />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/sources"
          element={
            <Authenticated>
              <AdminGate>
                <AdminSources />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/suppliers"
          element={
            <Authenticated>
              <AdminGate>
                <AdminSuppliers />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/suppliers/:id"
          element={
            <Authenticated>
              <AdminGate>
                <AdminSupplierDetail />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/facilities"
          element={
            <Authenticated>
              <AdminGate>
                <AdminFacilities />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/facilities/:id"
          element={
            <Authenticated>
              <AdminGate>
                <AdminFacilityDetail />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/materials"
          element={
            <Authenticated>
              <AdminGate>
                <AdminMaterials />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/materials/:id"
          element={
            <Authenticated>
              <AdminGate>
                <AdminMaterialDetail />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/listings"
          element={
            <Authenticated>
              <AdminGate>
                <AdminListings />
              </AdminGate>
            </Authenticated>
          }
        />
        <Route
          path="/admin/listings/:id"
          element={
            <Authenticated>
              <AdminGate>
                <AdminListingDetail />
              </AdminGate>
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
