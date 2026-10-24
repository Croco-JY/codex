import type { components } from "../../api/schema";
import { ApiError } from "../../api/errors";
import { facilityTypes, validUuid } from "../network/filters";
import { z } from "zod";
export type Candidate = components["schemas"]["StyleFacilityCandidateView"];
export type CandidatePage = components["schemas"]["StyleFacilityCandidatePage"];
export type CandidateInput =
  components["schemas"]["StyleFacilityCandidateInput"];
type FacilityView = components["schemas"]["FacilityView"];
export type Facility = FacilityView &
  Required<
    Pick<FacilityView, "id" | "supplierId" | "status" | "name" | "facilityType">
  >;
const uuid = (v: unknown): v is string => typeof v === "string" && validUuid(v);
export const candidateSchema = z.object({
  facilityId: z.string().refine(uuid),
});
export function checkedCandidate(v: Candidate, style: string): Candidate {
  if (
    !v ||
    !uuid(v.id) ||
    !uuid(v.styleId) ||
    v.styleId !== style ||
    !uuid(v.facilityId) ||
    typeof v.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(v.createdAt) ||
    !Number.isFinite(Date.parse(v.createdAt))
  )
    throw new ApiError(502);
  return v;
}
export function checkedCandidates(
  v: CandidatePage,
  style: string,
  offset: number,
): CandidatePage {
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 25 ||
    v.limit !== 25 ||
    v.offset !== offset ||
    typeof v.hasMore !== "boolean"
  )
    throw new ApiError(502);
  v.items.forEach((row) => checkedCandidate(row, style));
  return v;
}
export function supportedFacility(v: unknown, id: string): v is Facility {
  return (
    !!v &&
    typeof v === "object" &&
    "id" in v &&
    v.id === id &&
    uuid(v.id) &&
    "supplierId" in v &&
    uuid(v.supplierId) &&
    "status" in v &&
    (v.status === "ACTIVE" || v.status === "ARCHIVED") &&
    "name" in v &&
    typeof v.name === "string" &&
    !!v.name.trim() &&
    v.name.length <= 160 &&
    "facilityType" in v &&
    facilityTypes.some((t) => t === v.facilityType)
  );
}
export function supplierLabel(v: unknown, id: string): string {
  if (
    !v ||
    typeof v !== "object" ||
    !("id" in v) ||
    v.id !== id ||
    !("displayName" in v) ||
    typeof v.displayName !== "string" ||
    !v.displayName.trim() ||
    !("status" in v) ||
    (v.status !== "ACTIVE" && v.status !== "ARCHIVED") ||
    !("verificationStatus" in v) ||
    typeof v.verificationStatus !== "string" ||
    ![
      "DISCOVERED",
      "CLAIMED",
      "VERIFIED",
      "AUDITED",
      "TRANSACTED",
      "PROVEN",
    ].includes(v.verificationStatus)
  )
    return "Supplier label/status unavailable";
  return `${v.displayName} · ${v.status} · ${v.verificationStatus}`;
}
