import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
export const identityRevocable = "identity5e-revocable";
export const identityId = (n: number) =>
  `1c5e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function sql(input: string) {
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
      input,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
export function provisionIdentity() {
  sql(`INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES('${identityId(1000)}','urn:source-os:local','${identityRevocable}','PLATFORM_ADMIN','ACTIVE','fixture','operator') ON CONFLICT(id) DO UPDATE SET status='ACTIVE',revoked_at=NULL,revoked_by_issuer=NULL,revoked_by_subject=NULL,version=platform_role_assignment.version+1;
 INSERT INTO fiber_type(id,code,name_en,active) VALUES('${identityId(100)}','A_5E_HISTORICAL','Historical inactive textile Fiber',false) ON CONFLICT DO NOTHING;`);
}
export function revokeIdentity() {
  sql(
    `UPDATE platform_role_assignment SET status='REVOKED',revoked_at=now(),revoked_by_issuer='fixture',revoked_by_subject='operator',version=version+1 WHERE id='${identityId(1000)}';`,
  );
}
