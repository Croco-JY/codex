export const queryKeys = {
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
