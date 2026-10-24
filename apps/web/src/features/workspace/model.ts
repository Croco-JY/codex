import { z } from "zod";
import { ApiError } from "../../api/errors";
import type { components } from "../../api/schema";
export type Project = components["schemas"]["ProjectView"];
export type Style = components["schemas"]["StyleView"];
export type Entity = Project | Style;
export type Filter = "ACTIVE" | "ARCHIVED" | "ALL";
export const metadataSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(160),
  description: z.string().trim().max(4000),
  styleCode: z.string().trim().max(100),
});
export type Draft = z.infer<typeof metadataSchema>;
export const draftOf = (v: Entity): Draft => ({
  name: v.name,
  description: v.description ?? "",
  styleCode: "styleCode" in v ? (v.styleCode ?? "") : "",
});
export function safeVersion(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
const nullableText = (v: unknown) => v === null || typeof v === "string";
const timestampSchema = z.iso.datetime({ offset: true });
const timestamp = (v: unknown) => timestampSchema.safeParse(v).success;
export function entityValid(v: Entity, parent: string, id?: string): boolean {
  return (
    !!v &&
    typeof v.id === "string" &&
    !!v.id &&
    (!id || v.id === id) &&
    typeof v.name === "string" &&
    !!v.name.trim() &&
    nullableText(v.description) &&
    ["ACTIVE", "ARCHIVED"].includes(v.status) &&
    safeVersion(v.version) &&
    timestamp(v.createdAt) &&
    timestamp(v.updatedAt) &&
    ("organizationId" in v
      ? v.organizationId === parent
      : v.projectId === parent && nullableText(v.styleCode))
  );
}
export function checked<T extends Entity>(
  v: T,
  parent: string,
  id?: string,
): T {
  if (!entityValid(v, parent, id)) throw new ApiError(502);
  return v;
}
export const collectionPath = (org: string) => `/organizations/${org}/projects`;
export const projectPath = (org: string, project: string) =>
  `${collectionPath(org)}/${project}`;
export const stylePath = (org: string, project: string, style: string) =>
  `${projectPath(org, project)}/styles/${style}`;
