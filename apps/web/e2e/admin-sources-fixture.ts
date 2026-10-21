import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
export const adminActor = "curation-e2e-admin",
  secondAdmin = "curation-e2e-admin-b",
  revocableAdmin = "curation-e2e-revocable",
  buyerActor = "curation-e2e-buyer",
  ownerActor = "curation-e2e-owner";
export const evidenceId = (n: number) =>
  `1c5a0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const activeSourceName = "Evidence fixture active Source",
  inactiveSourceName = "Evidence fixture inactive Source";
function fixtureSql(sql: string) {
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
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
export async function provisionAdminEvidence(request: APIRequestContext) {
  const check = await request.get("http://127.0.0.1:8080/api/identity", {
    headers: { "X-Dev-Subject": "curation-fixture-check" },
  });
  expect(await check.json()).toEqual({
    issuer: "urn:source-os:local",
    subject: "curation-fixture-check",
  });
  fixtureSql(`BEGIN;
INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES
('${evidenceId(1)}','urn:source-os:local','${adminActor}','PLATFORM_ADMIN','ACTIVE','fixture','operator'),
('${evidenceId(2)}','urn:source-os:local','${secondAdmin}','PLATFORM_ADMIN','ACTIVE','fixture','operator'),
('${evidenceId(3)}','urn:source-os:local','${revocableAdmin}','PLATFORM_ADMIN','ACTIVE','fixture','operator')
ON CONFLICT(id) DO UPDATE SET status='ACTIVE',revoked_at=NULL,revoked_by_issuer=NULL,revoked_by_subject=NULL,version=platform_role_assignment.version+1;
INSERT INTO organization(id,name) VALUES('${evidenceId(4)}','Synthetic curation authority prerequisite') ON CONFLICT DO NOTHING;
INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES('${evidenceId(5)}','${evidenceId(4)}','urn:source-os:local','${ownerActor}','ORG_OWNER') ON CONFLICT DO NOTHING;
INSERT INTO data_source(id,source_code,source_type,name,namespace,base_url,access_method,normalization_policy,active) VALUES
('${evidenceId(10)}','000-1c5a-base-active','PUBLIC_DIRECTORY','${activeSourceName}','Synthetic prerequisite namespace','https://example.com/Source/Path?kind=Fixture','MANUAL','TRIM',true),
('${evidenceId(11)}','000-1c5a-base-inactive','MANUAL_ENTRY','${inactiveSourceName}',NULL,NULL,'MANUAL','PRESERVE',false) ON CONFLICT DO NOTHING;
INSERT INTO data_source(id,source_code,source_type,name,access_method,normalization_policy,active)
 SELECT ('1c5a0000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'000-1c5a-filler-'||lpad(n::text,2,'0'),'MANUAL_ENTRY','Evidence fixture offset row '||n,'MANUAL','PRESERVE',true FROM generate_series(1,27)n ON CONFLICT DO NOTHING;
INSERT INTO data_source_record(id,data_source_id,record_kind,external_record_key,normalized_external_record_key,first_seen_at,last_seen_at) VALUES('${evidenceId(20)}','${evidenceId(10)}','SUPPLIER','  Fixture-KEY  ','Fixture-KEY','2026-10-01','2026-10-01') ON CONFLICT DO NOTHING;
INSERT INTO data_source_observation(id,source_record_id,observation_key,observed_at,content_hash,hash_algorithm) VALUES('${evidenceId(21)}','${evidenceId(20)}','Fixture prerequisite Observation','2026-10-01','${"a".repeat(64)}','SHA-256') ON CONFLICT DO NOTHING;
INSERT INTO data_source_observation_review(id,observation_id,review_status,license_status,reviewed_by_issuer,reviewed_by_subject,notes) VALUES('${evidenceId(22)}','${evidenceId(21)}','NEEDS_REVIEW','UNKNOWN','fixture','operator','Synthetic prerequisite Review') ON CONFLICT DO NOTHING;
COMMIT;`);
}
export function revokeFixtureAdmin() {
  fixtureSql(
    `UPDATE platform_role_assignment SET status='REVOKED',revoked_at=now(),revoked_by_issuer='fixture',revoked_by_subject='operator',version=version+1 WHERE id='${evidenceId(3)}';`,
  );
}
