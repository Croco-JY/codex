import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { APIRequestContext } from "@playwright/test";
import { provisionWorkspace } from "./workspace-fixture";
export function selectionSql(sql: string) {
  const database = process.env.SOURCE_OS_E2E_DATABASE ?? "source_os";
  if (!/^source_os(?:_[a-zA-Z0-9_]+)?$/.test(database))
    throw Error("Synthetic database required");
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
export async function provisionSelection(request: APIRequestContext) {
  const f = await provisionWorkspace(request);
  const material = randomUUID(),
    variant = randomUUID(),
    listing = randomUUID(),
    supplier = randomUUID(),
    seller = randomUUID();
  const name = `Selection fabric ${material}`;
  selectionSql(`BEGIN;
 INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) SELECT '${supplier}',id,'Synthetic catalog supplier','synthetic' FROM country WHERE alpha2='KR';
 INSERT INTO supplier_profile(id,country_id,display_name,normalized_name,status) SELECT '${seller}',id,'Synthetic independent seller','synthetic','ARCHIVED' FROM country WHERE alpha2='KR';
 INSERT INTO material(id,catalog_supplier_id,material_type,display_name,normalized_name,status) VALUES('${material}','${supplier}','FABRIC','${name}','${name.toLowerCase()}','ACTIVE');
 INSERT INTO material_variant(id,material_id,variant_name) VALUES('${variant}','${material}','Selection variant');
 INSERT INTO supplier_material_listing(id,material_id,seller_supplier_id,seller_article_number) VALUES('${listing}','${material}','${seller}','Selection seller scope');
 COMMIT;`);
  const route = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return {
    ...f,
    material,
    variant,
    listing,
    name,
    route,
    endpoint: `/api/v1${route}/material-selections`,
    input: { materialId: material, variantId: variant, listingId: listing },
  };
}
