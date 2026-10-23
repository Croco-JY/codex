import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { provisionWorkspace } from "./workspace-fixture";
import { selectionSql } from "./selection-fixture";
export const candidateSql = selectionSql;
export async function provisionCandidate(request: APIRequestContext) {
  const f = await provisionWorkspace(request);
  const facility = randomUUID(),
    supplier = randomUUID();
  const name = `Candidate Facility ${facility}`;
  candidateSql(`BEGIN;
INSERT INTO supplier_profile(id,country_id,display_name,normalized_name) SELECT '${supplier}',id,'Candidate Supplier ${supplier}','candidate-${supplier}' FROM country WHERE alpha2='KR';
INSERT INTO facility(id,supplier_id,facility_type,name,country_id) SELECT '${facility}','${supplier}','FACTORY','${name}',id FROM country WHERE alpha2='KR';
COMMIT;`);
  const route = `/organizations/${f.a.id}/projects/${f.project.id}/styles/${f.style.id}`;
  return {
    ...f,
    facility,
    supplier,
    name,
    route,
    endpoint: `/api/v1${route}/facility-candidates`,
    input: { facilityId: facility },
  };
}
