export const queryKeys = {
  health: ["health"] as const,
  identity: (scope: string) => ["session", scope, "identity"] as const,
  capabilities: (scope: string) => ["session", scope, "capabilities"] as const,
  organizations: (scope: string) =>
    ["session", scope, "organizations"] as const,
  supply: (scope: string, resource: string) =>
    ["supply", scope, resource] as const,
};
