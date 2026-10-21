import { api, requireData } from "../../api/client";
import type { components } from "../../api/schema";
import type { CreateBodies, IdentityType } from "./model";
type S = components["schemas"];
export async function bindIdentity(
  type: IdentityType,
  id: string,
  sourceRecordId: string,
  signal: AbortSignal,
) {
  const body: S["MaterialBinding"] = { sourceRecordId };
  const options = { signal, params: { path: { id } }, body };
  const r =
    type === "supplier"
      ? await api.POST("/api/v1/admin/suppliers/{id}/external-records", options)
      : type === "facility"
        ? await api.POST(
            "/api/v1/admin/facilities/{id}/external-records",
            options,
          )
        : type === "material"
          ? await api.POST(
              "/api/v1/admin/materials/{id}/external-records",
              options,
            )
          : type === "variant"
            ? await api.POST(
                "/api/v1/admin/material-variants/{id}/external-records",
                options,
              )
            : await api.POST(
                "/api/v1/admin/material-listings/{id}/external-records",
                options,
              );
  if (!r.response.ok) requireData(r.data, r.response);
}
export async function resolveIdentity<K extends IdentityType>(
  type: K,
  sourceRecordId: string,
  body: CreateBodies[K],
  signal: AbortSignal,
) {
  // Each branch uses its generated nested request, including Variant's own parent.
  const r =
    type === "supplier"
      ? await api.POST("/api/v1/admin/supplier-identities", {
          signal,
          body: {
            sourceRecordId,
            supplier: body as CreateBodies["supplier"],
          } satisfies S["SupplierIdentityInput"],
        })
      : type === "facility"
        ? await api.POST("/api/v1/admin/facility-identities", {
            signal,
            body: {
              sourceRecordId,
              facility: body as CreateBodies["facility"],
            } satisfies S["FacilityIdentityInput"],
          })
        : type === "material"
          ? await api.POST("/api/v1/admin/material-identities", {
              signal,
              body: {
                sourceRecordId,
                material: body as CreateBodies["material"],
              } satisfies S["MaterialIdentityInput"],
            })
          : type === "variant"
            ? await api.POST("/api/v1/admin/material-variant-identities", {
                signal,
                body: {
                  sourceRecordId,
                  variant: body as CreateBodies["variant"],
                } satisfies S["MaterialVariantIdentityInput"],
              })
            : await api.POST("/api/v1/admin/material-listing-identities", {
                signal,
                body: {
                  sourceRecordId,
                  listing: body as CreateBodies["listing"],
                } satisfies S["ListingIdentityInput"],
              });
  return requireData(r.data, r.response);
}
