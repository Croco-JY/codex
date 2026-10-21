import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";

export const fixtureId = (n: number) =>
  `1c200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic local/test fixture only. No public endpoint, admin grant, or production seed. */
export async function provisionMaterials(request: APIRequestContext) {
  const identity = await request.get("http://127.0.0.1:8080/api/identity", {
    headers: { "X-Dev-Subject": "material-fixture-check" },
  });
  expect(identity.ok()).toBe(true);
  expect(await identity.json()).toEqual({
    issuer: "urn:source-os:local",
    subject: "material-fixture-check",
  });
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw new Error("A local SOURCE OS test database is required.");
  const sql = `BEGIN;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name,description) VALUES
 ('${fixtureId(1)}','00000000-0000-4000-8000-000000000002','Review Kyoto Textiles','review kyoto textiles','Synthetic local review catalog supplier'),
 ('${fixtureId(2)}','00000000-0000-4000-8000-000000000001','Review Seoul Sourcing','review seoul sourcing','Synthetic local review seller') ON CONFLICT DO NOTHING;
INSERT INTO fiber_type(id,code,name_en,name_local) VALUES ('${fixtureId(3)}','WOOL','Wool',NULL),('${fixtureId(4)}','COTTON','Cotton',NULL) ON CONFLICT DO NOTHING;
INSERT INTO material(id,catalog_supplier_id,catalog_article_number,material_type,display_name,normalized_name,description,origin_country_id,composition_completeness,status) VALUES
 ('${fixtureId(101)}','${fixtureId(1)}','KY-W001','FABRIC','Review wool gabardine','review wool gabardine','A synthetic wool blend for tailored jackets. Catalog identity and composition are independent of seller terms.','00000000-0000-4000-8000-000000000002','COMPLETE','ACTIVE'),
 ('${fixtureId(102)}','${fixtureId(1)}','KY-W002','FABRIC','Review wool herringbone','review wool herringbone','A synthetic partial-composition fabric for review.','00000000-0000-4000-8000-000000000002','PARTIAL','ACTIVE'),
 ('${fixtureId(103)}','${fixtureId(1)}','KY-C003','FABRIC','Review cotton poplin','review cotton poplin','A synthetic everyday shirting fabric.',NULL,'COMPLETE','ACTIVE'),
 ('${fixtureId(104)}','${fixtureId(1)}',NULL,'LEATHER','Review vegetable-tanned leather','review vegetable-tanned leather',NULL,'00000000-0000-4000-8000-000000000002','UNKNOWN','ACTIVE'),
 ('${fixtureId(199)}','${fixtureId(1)}',NULL,'FABRIC','Review unreleased draft','review unreleased draft',NULL,NULL,'UNKNOWN','DRAFT') ON CONFLICT DO NOTHING;
INSERT INTO material(id,catalog_supplier_id,catalog_article_number,material_type,display_name,normalized_name,status)
 SELECT ('1c200000-0000-4000-8000-' || lpad((200+n)::text,12,'0'))::uuid,'${fixtureId(1)}','KY-L'||lpad(n::text,3,'0'),'LINING','Review lining study '||lpad(n::text,2,'0'),'review lining study '||lpad(n::text,2,'0'),'ACTIVE'
 FROM generate_series(1,24) n ON CONFLICT DO NOTHING;
INSERT INTO material_composition(material_id,fiber_type_id,percentage)
 SELECT '${fixtureId(101)}',id,90 FROM fiber_type WHERE code='WOOL' ON CONFLICT DO NOTHING;
INSERT INTO material_composition(material_id,fiber_type_id,percentage)
 SELECT '${fixtureId(101)}',id,10 FROM fiber_type WHERE code='COTTON' ON CONFLICT DO NOTHING;
INSERT INTO material_composition(material_id,fiber_type_id,percentage)
 SELECT '${fixtureId(102)}',id,60 FROM fiber_type WHERE code='WOOL' ON CONFLICT DO NOTHING;
INSERT INTO material_composition(material_id,fiber_type_id,percentage)
 SELECT '${fixtureId(103)}',id,100 FROM fiber_type WHERE code='COTTON' ON CONFLICT DO NOTHING;
INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id,minimum_order_quantity,minimum_color_quantity,quantity_unit,standard_lead_time_days,status) VALUES
 ('${fixtureId(301)}','${fixtureId(101)}','${fixtureId(2)}',50,20,'METER',14,'ACTIVE'),
 ('${fixtureId(302)}','${fixtureId(102)}','${fixtureId(2)}',200,100,'METER',28,'ACTIVE') ON CONFLICT DO NOTHING;
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
