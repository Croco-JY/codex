import {
  Component,
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Link, Route, Routes } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api, failure, setLocalSubject } from "./api/client";
import type { components } from "./api/schema";
import {
  Button,
  Input,
  StatusBadge,
  Surface,
  PageLayout,
  Stack,
  Skeleton,
  EmptyState,
  ErrorState,
} from "./ui";
type Organization = components["schemas"]["OrganizationView"];
const OrganizationContext = createContext<{
  selected: Organization | null;
  select: (org: Organization | null) => void;
}>({ selected: null, select: () => {} });
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <ErrorState message="The application could not render. Reload to retry." />
    ) : (
      this.props.children
    );
  }
}
function Health() {
  const query = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/health");
      if (!data) throw failure(response);
      return data;
    },
    refetchInterval: 30000,
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
        <ErrorState
          message="The API is unavailable."
          retry={() => void query.refetch()}
        />
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
function Overview() {
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
const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter an organization name.")
  .max(160, "Use 160 characters or fewer.");
function OrganizationPage() {
  const cache = useQueryClient();
  const { selected, select } = useContext(OrganizationContext);
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  const [formError, setFormError] = useState("");
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/organizations");
      if (!data) throw failure(response);
      return data;
    },
    retry: false,
  });
  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, response } = await api.POST("/api/organizations", {
        body: { name },
      });
      if (!data) throw failure(response);
      return data;
    },
    onSuccess: (org) => {
      select(org);
      form.reset();
      void cache.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  const rename = useMutation({
    mutationFn: async (name: string) => {
      if (!selected?.id) throw new Error("Select an organization.");
      const { data, response } = await api.PATCH("/api/organizations/{id}", {
        params: { path: { id: selected.id } },
        body: { name, version: selected.version ?? 0 },
      });
      if (!data) throw failure(response);
      return data;
    },
    onSuccess: (org) => {
      select(org);
      void cache.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  const [renameName, setRenameName] = useState("");
  return (
    <Stack>
      <header>
        <p className="eyebrow">ORGANIZATION</p>
        <h1>Your working context.</h1>
        <p className="lead">
          Membership controls access. Choose the organization you are working
          with.
        </p>
      </header>
      <Surface>
        <h2>Organizations</h2>
        {organizations.isPending ? (
          <Skeleton />
        ) : organizations.isError ? (
          <ErrorState
            message="Sign in to view your organizations, or retry if your session has expired."
            retry={() => void organizations.refetch()}
          />
        ) : organizations.data.length === 0 ? (
          <EmptyState title="No organizations yet">
            Create your organization to establish a workspace.
          </EmptyState>
        ) : (
          <ul className="org-list">
            {organizations.data.map((org) => (
              <li key={org.id}>
                <Button
                  aria-pressed={selected?.id === org.id}
                  onClick={() => {
                    select(org);
                    setRenameName(org.name ?? "");
                  }}
                >
                  {org.name}
                </Button>
                <StatusBadge>{org.role}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      <Surface>
        <h2>Create organization</h2>
        <form
          onSubmit={form.handleSubmit((values) => {
            const parsed = nameSchema.safeParse(values.name);
            if (!parsed.success) {
              setFormError(parsed.error.issues[0]?.message ?? "Invalid name");
              return;
            }
            setFormError("");
            create.mutate(parsed.data);
          })}
        >
          <label htmlFor="organization-name">Organization name</label>
          <Input
            id="organization-name"
            autoComplete="organization"
            {...form.register("name")}
          />
          {formError && <p role="alert">{formError}</p>}
          <Button disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create organization"}
          </Button>
          {create.isError && <ErrorState message={create.error.message} />}
        </form>
      </Surface>
      {selected && (
        <Surface>
          <div className="section-heading">
            <h2>{selected.name}</h2>
            <StatusBadge tone="success">{selected.role}</StatusBadge>
          </div>
          <p className="muted">Organization ID: {selected.id}</p>
          {(selected.role === "ORG_OWNER" || selected.role === "ORG_ADMIN") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = nameSchema.safeParse(renameName);
                if (parsed.success) rename.mutate(parsed.data);
              }}
            >
              <label htmlFor="rename">New organization name</label>
              <Input
                id="rename"
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
              />
              <Button disabled={rename.isPending}>Save name</Button>
              {rename.isError && <ErrorState message={rename.error.message} />}
            </form>
          )}
        </Surface>
      )}
    </Stack>
  );
}
function Authentication() {
  const cache = useQueryClient();
  const { select } = useContext(OrganizationContext);
  const [subject, setSubject] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const identity = useQuery({
    queryKey: ["identity"],
    queryFn: async () => {
      const { data } = await api.GET("/api/identity");
      return data ?? null;
    },
    retry: false,
  });
  return (
    <div className="authentication">
      {identity.data ? (
        <StatusBadge>{identity.data.subject}</StatusBadge>
      ) : (
        <span className="muted">Not signed in</span>
      )}
      {import.meta.env.DEV && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^[A-Za-z0-9._@-]{1,255}$/.test(subject)) return;
            setLocalSubject(signedIn ? undefined : subject);
            setSignedIn(!signedIn);
            select(null);
            cache.clear();
          }}
        >
          <label htmlFor="dev-subject">Local development identity</label>
          <Input
            id="dev-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={signedIn}
            required
          />
          <Button>
            {signedIn ? "End local session" : "Use local identity"}
          </Button>
        </form>
      )}
    </div>
  );
}
export default function App() {
  const [selected, select] = useState<Organization | null>(null);
  return (
    <OrganizationContext.Provider value={{ selected, select }}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="app-shell">
        <aside>
          <Link className="brand" to="/">
            SOURCE<span>OS</span>
          </Link>
          <div className="edition">PRODUCT & MANUFACTURING</div>
          <nav aria-label="Main navigation">
            <Link to="/">Overview</Link>
            <Link to="/organization">Organization</Link>
          </nav>
          <div className="sidebar-footer">
            <span className="eyebrow">FOUNDATION / 00</span>
            <p>
              One source of truth.
              <br />
              From idea to production.
            </p>
          </div>
        </aside>
        <div className="workspace">
          <div className="topbar">
            <span>{selected?.name ?? "Select an organization"}</span>
            <StatusBadge>PHASE 0</StatusBadge>
          </div>
          <PageLayout>
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/organization" element={<OrganizationPage />} />
                <Route
                  path="*"
                  element={
                    <EmptyState title="Page not found">
                      <Link to="/">Return to overview</Link>
                    </EmptyState>
                  }
                />
              </Routes>
              <Authentication />
            </ErrorBoundary>
          </PageLayout>
          <footer>
            SOURCE OS · Secure foundations for global manufacturing
          </footer>
        </div>
      </div>
    </OrganizationContext.Provider>
  );
}
