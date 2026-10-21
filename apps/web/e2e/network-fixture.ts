import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
export const networkId = (n: number) =>
  `1c400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const supplierA =
  "Network Kyoto Textiles and Advanced Materials International Supply Company";
export async function provisionNetwork(request: APIRequestContext) {
  const identity = await request.get("http://127.0.0.1:8080/api/identity", {
    headers: { "X-Dev-Subject": "network-fixture-check" },
  });
  expect(await identity.json()).toEqual({
    issuer: "urn:source-os:local",
    subject: "network-fixture-check",
  });
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw Error("Local SOURCE OS database required.");
  const id = networkId,
    jp = "00000000-0000-4000-8000-000000000002",
    kr = "00000000-0000-4000-8000-000000000001",
    cn = "00000000-0000-4000-8000-000000000003";
  const sql = `BEGIN;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name,legal_name,native_name,english_name,website_url,description,verification_status) VALUES
('${id(1)}','${jp}','${supplierA}','${supplierA.toLowerCase()}','Network Kyoto Textiles Ltd','京都ネットワーク織物','Network Kyoto Textiles','https://example.com/kyoto','Synthetic local sourcing Supplier A.','AUDITED'),
('${id(2)}','${kr}','Network Seoul Manufacturing','network seoul manufacturing',NULL,NULL,NULL,NULL,'Synthetic local Seller B.','VERIFIED'),
('${id(3)}','${cn}','Network Jiangsu Processing','network jiangsu processing',NULL,NULL,NULL,NULL,NULL,'DISCOVERED') ON CONFLICT DO NOTHING;
INSERT INTO supplier_role(supplier_id,role) VALUES ('${id(1)}','MILL'),('${id(1)}','MATERIAL_SUPPLIER'),('${id(2)}','FACTORY'),('${id(3)}','PROCESSOR') ON CONFLICT DO NOTHING;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name)
 SELECT ('1c400000-0000-4000-8000-'||lpad((700+n)::text,12,'0'))::uuid,'${jp}','Network auxiliary supplier '||n,'network auxiliary supplier '||n FROM generate_series(1,25)n ON CONFLICT DO NOTHING;
INSERT INTO supplier_alias(id,supplier_id,alias,normalized_alias,language_code,alias_type) VALUES
('${id(40)}','${id(1)}','Kyoto network textiles commercial and technical fabric sourcing division','kyoto network textiles commercial and technical fabric sourcing division','en','COMMERCIAL'),
('${id(41)}','${id(1)}','京都ネットワーク織物工業','京都ネットワーク織物工業','ja','ORIGINAL') ON CONFLICT DO NOTHING;
INSERT INTO supplier_verification_event(id,supplier_id,previous_status,new_status,reason,actor_issuer,actor_subject,occurred_at) VALUES
('${id(50)}','${id(1)}','DISCOVERED','VERIFIED','Synthetic evidence review','fixture','network-operator','2026-01-01'),
('${id(51)}','${id(1)}','VERIFIED','AUDITED','Synthetic audit reviewed','fixture','network-operator','2026-02-01') ON CONFLICT DO NOTHING;
INSERT INTO region(id,country_id,code,name_en,name_native,region_type) VALUES
('${id(20)}','${jp}','NETWORK_KYOTO','Network Kyoto Prefecture','京都府テスト','PREFECTURE'),
('${id(21)}','${cn}','NETWORK_JIANGSU','Network Jiangsu Province','江苏省测试','PROVINCE') ON CONFLICT DO NOTHING;
INSERT INTO industrial_cluster(id,country_id,region_id,slug,name_en,name_native) VALUES
('${id(30)}','${jp}','${id(20)}','network-kyoto-textiles','Network Kyoto textile district','京都織物産業地区'),
('${id(31)}','${cn}','${id(21)}','network-jiangsu-processing','Network Jiangsu processing district','江苏加工产业区') ON CONFLICT DO NOTHING;
INSERT INTO facility(id,supplier_id,facility_type,name,country_id,region_id,industrial_cluster_id,address_line_1,address_line_2,postal_code,latitude,longitude,phone,email) VALUES
('${id(10)}','${id(1)}','MILL','Network Kyoto weaving mill','${jp}','${id(20)}','${id(30)}','123 Synthetic Textile Research and Manufacturing Avenue','Industrial Building 5, Production Wing A','600-0000',35.123456,135.999999,'+81 75 000 0000','site@example.com'),
('${id(11)}','${id(1)}','WAREHOUSE','Network cross-country warehouse','${cn}','${id(21)}','${id(31)}','456 Synthetic Warehouse Road',NULL,NULL,NULL,NULL,NULL,NULL),
('${id(12)}','${id(2)}','FACTORY','Network Seoul factory','${kr}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('${id(13)}','${id(3)}','PROCESSING_PLANT','Network Jiangsu processing plant','${cn}','${id(21)}','${id(31)}',NULL,NULL,NULL,NULL,NULL,NULL,NULL) ON CONFLICT DO NOTHING;
INSERT INTO capability(id,code,category,name_en,name_local) VALUES
('${id(400)}','NETWORK_WEAVING','PROCESS','Network precision weaving and advanced textile construction','精密織物・特殊テキスタイル加工'),
('${id(401)}','NETWORK_DYEING','PROCESS','Network dyeing',NULL),
('${id(402)}','NETWORK_WAREHOUSING','MATERIAL_HANDLING','Network warehousing',NULL) ON CONFLICT DO NOTHING;
INSERT INTO facility_capability(facility_id,capability_id,proficiency_level,minimum_order_quantity,maximum_order_quantity,quantity_unit,verification_status) VALUES
('${id(10)}','${id(400)}','SPECIALIST',0,999999999999999.9999,'METER','AUDITED'),
('${id(10)}','${id(401)}','EXPERIENCED',100.0001,1000.9999,'METER','DOCUMENTED'),
('${id(11)}','${id(402)}','SUPPORTED',NULL,NULL,NULL,'UNVERIFIED'),
('${id(13)}','${id(401)}','SUPPORTED',0,1000,'KG','UNVERIFIED') ON CONFLICT DO NOTHING;
INSERT INTO material(id,catalog_supplier_id,catalog_article_number,material_type,display_name,normalized_name,status) VALUES
('${id(100)}','${id(1)}','NETWORK-CAT-A','LINING','Network catalog cloth A','network catalog cloth a','ACTIVE'),
('${id(101)}','${id(2)}','NETWORK-CAT-B','LINING','Network catalog cloth B','network catalog cloth b','ACTIVE') ON CONFLICT DO NOTHING;
INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id,seller_article_number,minimum_order_quantity,minimum_color_quantity,quantity_unit,standard_lead_time_days,status) VALUES
('${id(300)}','${id(100)}','${id(2)}','NETWORK-SELL-B',50.0001,0,'METER',14,'ACTIVE'),
('${id(301)}','${id(101)}','${id(1)}','NETWORK-SELL-A',0,NULL,'METER',0,'ACTIVE') ON CONFLICT DO NOTHING;
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
