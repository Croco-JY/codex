import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
import {
  provisionCuration,
  curationAdmin,
  curationId,
} from "./curation-fixture";
export const commercialCurationId = (n: number) =>
  `1c5d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const commercialRevocable = "curation5d-revocable";
export const commercialOther = "curation5d-other-admin";
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
export async function provisionCommercialCuration(request: APIRequestContext) {
  await provisionCuration(request);
  const id = commercialCurationId;
  sql(`BEGIN;
INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES
('${id(1000)}','urn:source-os:local','${commercialRevocable}','PLATFORM_ADMIN','ACTIVE','fixture','operator'),
('${id(1001)}','urn:source-os:local','${commercialOther}','PLATFORM_ADMIN','ACTIVE','fixture','operator') ON CONFLICT(id) DO UPDATE SET status='ACTIVE',revoked_at=NULL,revoked_by_issuer=NULL,revoked_by_subject=NULL,version=platform_role_assignment.version+1;
INSERT INTO data_source(id,source_code,source_type,name,access_method,normalization_policy,active) VALUES
('${id(100)}','000-000-000-5d-provider','MANUAL_ENTRY','Commercial curation historical textile evidence provider with a long protected name','MANUAL','PRESERVE',true),
('${id(200)}','000-000-000-5d-other','MANUAL_ENTRY','Commercial curation different provider','MANUAL','PRESERVE',true),
('${id(300)}','000-000-000-5d-inactive','MANUAL_ENTRY','Commercial curation inactive historical provider','MANUAL','PRESERVE',false) ON CONFLICT DO NOTHING;
INSERT INTO data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key) VALUES
('${id(101)}','${id(100)}','MATERIAL_LISTING','commercial-main','commercial-main'),
('${id(201)}','${id(200)}','MATERIAL_LISTING','commercial-other','commercial-other') ON CONFLICT DO NOTHING;
INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at) VALUES
('${id(102)}','${id(101)}','commercial-prerequisite','2026-10-21T00:00:00.123456Z'),
('${id(103)}','${id(101)}','commercial-additional','2026-10-21T00:00:01.123456Z'),
('${id(202)}','${id(201)}','commercial-other','2026-10-21T00:00:00.123456Z') ON CONFLICT DO NOTHING;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name,status) VALUES('${id(1)}','00000000-0000-4000-8000-000000000002','Commercial third-party archived Supplier','commercial third-party archived supplier','ARCHIVED') ON CONFLICT DO NOTHING;
INSERT INTO facility(id,supplier_id,facility_type,name,country_id,status) VALUES('${id(10)}','${id(1)}','WAREHOUSE','Commercial archived third-party Warehouse','00000000-0000-4000-8000-000000000002','ARCHIVED') ON CONFLICT DO NOTHING;
COMMIT;`);
}
export async function commercialListing(
  request: APIRequestContext,
  status = "ACTIVE",
) {
  const headers = { "X-Dev-Subject": curationAdmin },
    id = commercialCurationId;
  const m = await request.post("http://127.0.0.1:8080/api/v1/admin/materials", {
    headers,
    data: {
      catalogSupplierId: curationId(1),
      materialType: "FABRIC",
      displayName: `Commercial curation Material ${Date.now()}`,
      compositionCompleteness: "UNKNOWN",
      composition: [],
      status: "ACTIVE",
      observationId: id(102),
      version: 0,
    },
  });
  expect(m.ok()).toBe(true);
  const material = await m.json();
  const v = await request.post(
    `http://127.0.0.1:8080/api/v1/admin/materials/${material.id}/variants`,
    {
      headers,
      data: {
        materialId: material.id,
        variantName: "Archived midnight blue commercial Variant",
        status: "ARCHIVED",
        observationId: id(102),
        version: 0,
      },
    },
  );
  expect(v.ok()).toBe(true);
  const variant = await v.json();
  const l = await request.post(
    "http://127.0.0.1:8080/api/v1/admin/material-listings",
    {
      headers,
      data: {
        materialId: material.id,
        sellerSupplierId: curationId(1),
        sellerArticleNumber: `5D-${Date.now()}`,
        status,
        observationId: id(102),
        version: 0,
      },
    },
  );
  expect(l.ok()).toBe(true);
  return { listing: await l.json(), variant };
}
export function revokeCommercialAdmin() {
  sql(
    `UPDATE platform_role_assignment SET status='REVOKED',revoked_at=now(),revoked_by_issuer='fixture',revoked_by_subject='operator',version=version+1 WHERE id='${commercialCurationId(1000)}';`,
  );
}
