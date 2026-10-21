import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
export const commerceId = (n: number) =>
  `1c300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function provisionCommerce(request: APIRequestContext) {
  const response = await request.get("http://127.0.0.1:8080/api/identity", {
    headers: { "X-Dev-Subject": "commercial-fixture-check" },
  });
  expect(await response.json()).toEqual({
    issuer: "urn:source-os:local",
    subject: "commercial-fixture-check",
  });
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw new Error("Local SOURCE OS database required.");
  const id = commerceId;
  const sql = `BEGIN;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) VALUES
 ('${id(1)}','00000000-0000-4000-8000-000000000002','Demo catalog mill','demo catalog mill'),
 ('${id(2)}','00000000-0000-4000-8000-000000000001','Demo seller company','demo seller company') ON CONFLICT DO NOTHING;
INSERT INTO facility(id,supplier_id,facility_type,name,country_id) VALUES
 ('${id(10)}','${id(1)}','WAREHOUSE','Demo third-party warehouse','00000000-0000-4000-8000-000000000002'),
 ('${id(11)}','${id(1)}','WAREHOUSE','Demo secondary warehouse','00000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO material(id,catalog_supplier_id,catalog_article_number,material_type,display_name,normalized_name,description,origin_country_id,status) VALUES
 ('${id(100)}','${id(1)}','CAT-CT01','FABRIC','Commerce wool twill','commerce wool twill','Synthetic local sourcing data for commercial read validation.','00000000-0000-4000-8000-000000000002','ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO fabric_spec(material_id,construction,weave_type,gsm,width_mm,thickness_mm,finish) VALUES ('${id(100)}','WOVEN','Twill',280.0001,1500.0001,0.9999,'Soft finish') ON CONFLICT DO NOTHING;
INSERT INTO material_variant(id,material_id,variant_name,catalog_variant_sku,color_name,color_code) VALUES
 ('${id(201)}','${id(100)}','Midnight blue','CAT-BLUE','Blue','BL'),
 ('${id(202)}','${id(100)}','Warm sand','CAT-SAND','Sand','SD'),
 ('${id(203)}','${id(100)}','Undyed','CAT-RAW','Natural','NT') ON CONFLICT DO NOTHING;
INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id,seller_article_number,minimum_order_quantity,minimum_color_quantity,quantity_unit,standard_lead_time_days,reproduction_lead_time_days,status) VALUES
 ('${id(300)}','${id(100)}','${id(2)}','SELL-CT01',50,20,'METER',14,28,'ACTIVE'),
 ('${id(301)}','${id(100)}','${id(2)}','SELL-UNKNOWN',NULL,NULL,NULL,NULL,NULL,'ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO data_source(id,source_code,source_type,name,access_method) VALUES ('${id(400)}','commerce-local-fixture','MANUAL_ENTRY','Synthetic local provider','MANUAL') ON CONFLICT DO NOTHING;
INSERT INTO data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key) VALUES ('${id(401)}','${id(400)}','MATERIAL_LISTING','commerce-stock','commerce-stock') ON CONFLICT DO NOTHING;
INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at) VALUES ('${id(402)}','${id(401)}','commerce-observation','2026-02-01T00:00:00Z') ON CONFLICT DO NOTHING;
INSERT INTO material_price(id,listing_id,material_id,material_variant_id,data_source_id,amount,currency,price_unit,minimum_order_quantity,valid_from,valid_to,observed_at) VALUES
 ('${id(500)}','${id(300)}','${id(100)}',NULL,'${id(400)}',999999999999999.9999,'JPY','METER',NULL,'2026-01-01',NULL,'2026-01-01'),
 ('${id(501)}','${id(300)}','${id(100)}','${id(201)}','${id(400)}',58.1234,'JPY','METER',NULL,'2026-01-01',NULL,'2026-01-01'),
 ('${id(502)}','${id(300)}','${id(100)}','${id(201)}','${id(400)}',55.0001,'JPY','METER',100,'2026-01-01',NULL,'2026-01-01'),
 ('${id(503)}','${id(300)}','${id(100)}',NULL,'${id(400)}',40.1234,'JPY','METER',NULL,'2025-01-01','2026-01-01','2025-01-01') ON CONFLICT DO NOTHING;
INSERT INTO material_price(id,listing_id,material_id,data_source_id,amount,currency,price_unit,valid_from,valid_to,observed_at)
 SELECT ('1c300000-0000-4000-8000-'||lpad((520+n)::text,12,'0'))::uuid,'${id(300)}','${id(100)}','${id(400)}',30+n/10000.0,'JPY','METER','2020-01-01','2021-01-01','2020-01-01'
 FROM generate_series(1,25) n ON CONFLICT DO NOTHING;
INSERT INTO material_price_source(material_price_id,source_observation_id) SELECT id,'${id(402)}' FROM material_price WHERE listing_id='${id(300)}' ON CONFLICT DO NOTHING;
INSERT INTO material_inventory_snapshot(id,listing_id,material_id,material_variant_id,facility_id,quantity,unit,capture_mode,observed_at,source_observation_id,manual_idempotency_key,actor_issuer,actor_subject) VALUES
 ('${id(600)}','${id(300)}','${id(100)}','${id(201)}','${id(10)}',42,'METER','MANUAL','2026-01-01',NULL,'commerce-old-manual','fixture','operator'),
 ('${id(601)}','${id(300)}','${id(100)}','${id(201)}','${id(10)}',0,'METER','MANUAL','2026-02-01',NULL,'commerce-zero-manual','fixture','operator'),
 ('${id(602)}','${id(300)}','${id(100)}',NULL,'${id(11)}',999999999999999.9999,'KG','MANUAL','2026-02-01',NULL,'commerce-positive-manual','fixture','operator'),
 ('${id(603)}','${id(300)}','${id(100)}','${id(201)}','${id(10)}',12.1234,'METER','IMPORTED','2026-02-01','${id(402)}',NULL,NULL,NULL) ON CONFLICT DO NOTHING;
COMMIT;`;
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "source_os",
      "-d",
      database,
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
