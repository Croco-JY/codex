/** Test-only real-backend cumulative workspace fixture. */
import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { provisionWorkspace } from "./workspace-fixture";
import { selectionSql } from "./selection-fixture";
export async function provisionPhaseTwo(request: APIRequestContext) {
  const f = await provisionWorkspace(request),
    supplier = randomUUID(),
    material = randomUUID(),
    variant = randomUUID(),
    listing = randomUUID(),
    facility = randomUUID();
  selectionSql(`BEGIN;
 INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) SELECT '${supplier}',id,'Synthetic cumulative Supplier','synthetic' FROM country WHERE alpha2='KR';
 INSERT INTO material(id,catalog_supplier_id,material_type,display_name,normalized_name,status) VALUES('${material}','${supplier}','FABRIC','Synthetic cumulative Material','synthetic','ACTIVE');
 INSERT INTO material_variant(id,material_id,variant_name) VALUES('${variant}','${material}','Synthetic cumulative Variant');
 INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id,seller_article_number) VALUES('${listing}','${material}','${supplier}','Synthetic cumulative Listing');
 INSERT INTO facility(id,supplier_id,facility_type,name,country_id) SELECT '${facility}','${supplier}','FACTORY','Synthetic cumulative Facility',id FROM country WHERE alpha2='KR';
 COMMIT;`);
  const route = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`,
    base = `/api/v1${route}`,
    api = "http://127.0.0.1:8080";
  const requirement = await request.put(api + base + "/requirement", {
    headers: { ...f.headers, "If-None-Match": "*" },
    data: {
      productType: "Synthetic cumulative target",
      targetQuantity: "0.0000",
      quantityUnit: "PCS",
      version: 0,
    },
  });
  expect(requirement.status()).toBe(201);
  const selected = await request.post(api + base + "/material-selections", {
    headers: f.headers,
    data: { materialId: material, variantId: variant, listingId: listing },
  });
  expect(selected.status()).toBe(201);
  const selection = await selected.json();
  const considered = await request.post(api + base + "/facility-candidates", {
    headers: f.headers,
    data: { facilityId: facility },
  });
  expect(considered.status()).toBe(201);
  const candidate = await considered.json();
  const bytes = Buffer.from("Synthetic cumulative attachment\n"),
    name = `Cumulative READY ${randomUUID()}`;
  const uploaded = await request.post(api + base + "/development-references", {
    headers: f.headers,
    multipart: {
      displayName: name,
      file: { name: "untrusted.html", mimeType: "text/html", buffer: bytes },
    },
  });
  expect(uploaded.status()).toBe(201);
  const reference = await uploaded.json();
  for (const state of ["PENDING", "FAILED", "DETACHED"]) {
    const id = randomUUID();
    selectionSql(
      `INSERT INTO style_development_reference(id,style_id,storage_object_id,display_name,media_type,size_bytes,state) VALUES('${id}','${f.style.id}','${randomUUID()}','Synthetic ${state}','application/octet-stream',3,'PENDING');${state === "PENDING" ? "" : `UPDATE style_development_reference SET state='${state}',version=1,updated_at=clock_timestamp()+interval '1 microsecond' WHERE id='${id}';`}`,
    );
  }
  return {
    ...f,
    supplier,
    material,
    variant,
    listing,
    facility,
    selection,
    candidate,
    reference,
    bytes,
    name,
    route,
    base,
  };
}
