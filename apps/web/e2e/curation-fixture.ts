import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
export const curationId = (n: number) =>
  `1c5b0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const curationAdmin = "curation5b-admin",
  curationBuyer = "curation5b-buyer",
  curationOwner = "curation5b-owner",
  curationRevocable = "curation5b-revocable";
export const evidenceSourceName = "Curation 5B synthetic evidence Source";
export const countryJP = "00000000-0000-4000-8000-000000000002";
export const capabilityName =
    "Curation precision weaving and specialist textile construction",
  raceCapabilityName = "Curation independent first-write Capability";
function sql(text: string) {
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw Error("A local SOURCE OS test database is required.");
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
      input: text,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
export async function provisionCuration(request: APIRequestContext) {
  const check = await request.get("http://127.0.0.1:8080/api/identity", {
    headers: { "X-Dev-Subject": "curation5b-fixture-check" },
  });
  expect(await check.json()).toEqual({
    issuer: "urn:source-os:local",
    subject: "curation5b-fixture-check",
  });
  const id = curationId,
    raceFacilityId = randomUUID();
  sql(`BEGIN;
INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES
('${id(1000)}','urn:source-os:local','${curationAdmin}','PLATFORM_ADMIN','ACTIVE','fixture','operator'),
('${id(1001)}','urn:source-os:local','${curationRevocable}','PLATFORM_ADMIN','ACTIVE','fixture','operator') ON CONFLICT(id) DO UPDATE SET status='ACTIVE',revoked_at=NULL,revoked_by_issuer=NULL,revoked_by_subject=NULL,version=platform_role_assignment.version+1;
INSERT INTO organization(id,name) VALUES('${id(1002)}','Synthetic 5B authority prerequisite') ON CONFLICT DO NOTHING;
INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES('${id(1003)}','${id(1002)}','urn:source-os:local','${curationOwner}','ORG_OWNER') ON CONFLICT DO NOTHING;
INSERT INTO data_source(id,source_code,source_type,name,access_method,normalization_policy,active) VALUES('${id(100)}','000-000-curation5b-evidence','MANUAL_ENTRY','${evidenceSourceName}','MANUAL','PRESERVE',true) ON CONFLICT DO NOTHING;
INSERT INTO data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key) VALUES('${id(101)}','${id(100)}','SUPPLIER','Curation prerequisite identity','Curation prerequisite identity') ON CONFLICT DO NOTHING;
INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at) VALUES('${id(102)}','${id(101)}','Curation prerequisite Observation','2026-10-21T12:00:00Z') ON CONFLICT DO NOTHING;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name,verification_status) VALUES('${id(1)}','${countryJP}','Curation prerequisite Supplier','curation prerequisite supplier','AUDITED') ON CONFLICT DO NOTHING;
INSERT INTO supplier_role(supplier_id,role) VALUES('${id(1)}','MILL') ON CONFLICT DO NOTHING;
INSERT INTO region(id,country_id,code,name_en,name_native,region_type) VALUES('${id(200)}','${countryJP}','CURATION5B_KYOTO','Curation Kyoto Region','キュレーション京都府','PREFECTURE') ON CONFLICT DO NOTHING;
INSERT INTO industrial_cluster(id,country_id,region_id,slug,name_en,name_native) VALUES('${id(201)}','${countryJP}','${id(200)}','curation5b-textiles','Curation Textile Industrial Cluster','キュレーション織物産業地区') ON CONFLICT DO NOTHING;
INSERT INTO capability(id,code,category,name_en) VALUES('${id(300)}','CURATION5B_WEAVING','PROCESS','${capabilityName}'),('${id(301)}','CURATION5B_RACE','PROCESS','${raceCapabilityName}') ON CONFLICT DO NOTHING;
INSERT INTO facility(id,supplier_id,facility_type,name,country_id) VALUES('${id(10)}','${id(1)}','MILL','Curation prerequisite Facility','${countryJP}'),('${raceFacilityId}','${id(1)}','WAREHOUSE','Curation first-write race Facility','${countryJP}') ON CONFLICT DO NOTHING;
INSERT INTO facility_capability(facility_id,capability_id,proficiency_level,quantity_unit,notes,verification_status) VALUES('${id(10)}','${id(300)}','EXPERIENCED','METER','Protected curation prerequisite notes','DOCUMENTED') ON CONFLICT DO NOTHING;
COMMIT;`);
  return { raceFacilityId };
}
export function revokeCurationAdmin() {
  sql(
    `UPDATE platform_role_assignment SET status='REVOKED',revoked_at=now(),revoked_by_issuer='fixture',revoked_by_subject='operator',version=version+1 WHERE id='${curationId(1001)}';`,
  );
}
