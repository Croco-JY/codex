export const queryKeys = {
  workspace: (scope: string, org: string) => ["workspace", scope, org] as const,
  projects: (
    scope: string,
    org: string,
    status: string | undefined,
    limit: number,
    offset: number,
  ) =>
    [
      "workspace",
      scope,
      org,
      "projects",
      status ?? null,
      limit,
      offset,
    ] as const,
  project: (scope: string, org: string, project: string) =>
    ["workspace", scope, org, "project", project] as const,
  styles: (
    scope: string,
    org: string,
    project: string,
    status: string | undefined,
    limit: number,
    offset: number,
  ) =>
    [
      "workspace",
      scope,
      org,
      "project",
      project,
      "styles",
      status ?? null,
      limit,
      offset,
    ] as const,
  style: (scope: string, org: string, project: string, style: string) =>
    ["workspace", scope, org, "project", project, "style", style] as const,
  selections: (
    scope: string,
    org: string,
    project: string,
    style: string,
    limit: number,
    offset: number,
  ) =>
    [
      "workspace",
      scope,
      org,
      "project",
      project,
      "style",
      style,
      "material-selections",
      limit,
      offset,
    ] as const,
  variant: (scope: string, id: string) =>
    ["supply", scope, "material-variant", id] as const,
  candidates: (
    scope: string,
    org: string,
    project: string,
    style: string,
    limit: number,
    offset: number,
  ) =>
    [
      "workspace",
      scope,
      org,
      "project",
      project,
      "style",
      style,
      "facility-candidates",
      limit,
      offset,
    ] as const,
  requirement: (scope: string, org: string, project: string, style: string) =>
    [
      "workspace",
      scope,
      org,
      "project",
      project,
      "style",
      style,
      "requirement",
    ] as const,
  admin: (scope: string) => ["admin", scope] as const,
  adminCitations: (
    scope: string,
    kind: "suppliers" | "facilities",
    id: string,
  ) => ["admin", scope, kind, id, "citations"] as const,
  adminAssignment: (scope: string, facility: string, capability: string) =>
    ["admin", scope, "facility", facility, "capability", capability] as const,
  adminSources: (scope: string) => ["admin", scope, "sources", 25] as const,
  adminObservations: (scope: string, record: string) =>
    ["admin", scope, "record", record, "observations", 25] as const,
  adminReviews: (scope: string, observation: string) =>
    ["admin", scope, "observation", observation, "reviews", 25] as const,
  health: ["health"] as const,
  identity: (scope: string) => ["session", scope, "identity"] as const,
  capabilities: (scope: string) => ["session", scope, "capabilities"] as const,
  organizations: (scope: string) =>
    ["session", scope, "organizations"] as const,
  supply: (scope: string, resource: string) =>
    ["supply", scope, resource] as const,
  materials: (scope: string, filters: Filters, limit: number) =>
    ["supply", scope, "materials", filters, limit] as const,
  material: (scope: string, id: string) =>
    ["supply", scope, "material", id] as const,
  facility: (scope: string, id: string) =>
    ["supply", scope, "facility", id] as const,
  commercial: (scope: string, id: string, kind: string, filters: unknown) =>
    ["supply", scope, "listing", id, kind, filters, 25] as const,
  listing: (scope: string, id: string) =>
    ["supply", scope, "listing", id] as const,
  materialChild: (scope: string, id: string, kind: string, context: unknown) =>
    ["supply", scope, "material", id, kind, context] as const,
  countries: (scope: string) => ["supply", scope, "countries"] as const,
  fibers: (scope: string) => ["supply", scope, "fibers"] as const,
  supplier: (scope: string, id: string) =>
    ["supply", scope, "supplier", id] as const,
  supplierSearch: (scope: string, q: string) =>
    ["supply", scope, "supplier-search", q, 20] as const,
};
import type { Filters } from "../features/materials/filters";
