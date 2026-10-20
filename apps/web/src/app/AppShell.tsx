import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { endSession } from "../api/session";
import { Button, PageLayout, StatusBadge } from "../ui";
import { AppRoutes } from "./routes";
import { useSession } from "./session";
const LocalControls = import.meta.env.DEV
  ? lazy(() => import("./LocalSessionControls"))
  : undefined;
export default function AppShell() {
  const session = useSession();
  const { pathname } = useLocation();
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    content.current?.focus();
  }, [pathname]);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app-shell">
        <aside>
          <Link className="brand" to="/">
            SOURCE<span>OS</span>
          </Link>
          <div className="edition">PRODUCT &amp; MANUFACTURING</div>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              Overview
            </NavLink>
            <NavLink to="/organization">Organization</NavLink>
            {session.status === "authenticated" &&
              session.capability === "ADMIN" && (
                <NavLink to="/admin">Curation</NavLink>
              )}
          </nav>
          <div className="sidebar-footer">
            <p>
              One source of truth.
              <br />
              From idea to production.
            </p>
          </div>
        </aside>
        <div className="workspace">
          <div className="topbar">
            <span>{session.selected?.name ?? "Select an organization"}</span>
            <StatusBadge>
              {session.status === "authenticated"
                ? "Authenticated"
                : "Workspace"}
            </StatusBadge>
          </div>
          <PageLayout>
            <div ref={content} tabIndex={-1} className="route-content">
              <AppRoutes />
            </div>
            <section className="authentication" aria-label="Session">
              <p role="status">
                {session.status === "pending"
                  ? "Checking your session…"
                  : session.status === "authenticated"
                    ? "Session active"
                    : session.status === "error"
                      ? "Session unavailable"
                      : "Authentication required"}
              </p>
              {session.status === "error" && (
                <Button onClick={session.retryIdentity}>Retry session</Button>
              )}
              {session.status === "authenticated" &&
                session.capability === "ERROR" &&
                pathname !== "/admin" && (
                  <p role="status">
                    Curation access unavailable.{" "}
                    <Button onClick={session.retryCapability}>
                      Retry access check
                    </Button>
                  </p>
                )}
              {(session.status === "authenticated" || session.local) && (
                <Button onClick={() => endSession()}>
                  {session.local ? "End local session" : "End session"}
                </Button>
              )}
              {LocalControls && (
                <Suspense
                  fallback={
                    <p role="status">Loading local session controls…</p>
                  }
                >
                  <LocalControls />
                </Suspense>
              )}
            </section>
          </PageLayout>
          <footer>
            SOURCE OS · Secure foundations for global manufacturing
          </footer>
        </div>
      </div>
    </>
  );
}
