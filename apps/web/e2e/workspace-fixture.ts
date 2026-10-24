import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
const api = "http://127.0.0.1:8080";
export async function provisionWorkspace(request: APIRequestContext) {
  const suffix = randomUUID(),
    writer = `workspace2b-writer-${suffix}`,
    viewer = `workspace2b-viewer-${suffix}`,
    admin = `workspace2b-admin-${suffix}`;
  const headers = { "X-Dev-Subject": writer };
  const create = async (path: string, data: unknown) => {
    const r = await request.post(api + path, { headers, data });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const a = await create("/api/organizations", {
    name: `Workspace A ${suffix}`,
  });
  const b = await create("/api/organizations", {
    name: `Workspace B ${suffix}`,
  });
  const base = `/api/v1/organizations/${a.id}/projects`;
  const project = await create(base, { name: `Private A Project ${suffix}` });
  const style = await create(`${base}/${project.id}/styles`, {
    name: `Private A Style ${suffix}`,
    styleCode: "Case-preserved",
  });
  const pb = await create(`/api/v1/organizations/${b.id}/projects`, {
    name: `Private B Project ${suffix}`,
  });
  const sb = await create(
    `/api/v1/organizations/${b.id}/projects/${pb.id}/styles`,
    { name: `Private B Style ${suffix}` },
  );
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw Error("Local synthetic database required");
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
      stdio: ["pipe", "pipe", "pipe"],
      input: `BEGIN;
INSERT INTO membership(id,organization_id,issuer,subject,role) VALUES('${randomUUID()}','${a.id}','urn:source-os:local','${viewer}','VIEWER');
INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject) VALUES('${randomUUID()}','urn:source-os:local','${admin}','PLATFORM_ADMIN','ACTIVE','synthetic-fixture','operator');
COMMIT;`,
    },
  );
  return { a, b, project, style, pb, sb, writer, viewer, admin, headers };
}
