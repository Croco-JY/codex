# Operator-only platform administrator provisioning
No application HTTP bootstrap endpoint or automatic production seed exists. Never enable the local profile in production. Only local/test fixtures may create synthetic platform administrators.

An authorized operator must verify the target identity in the production IdP and record their own verified issuer/subject. Use a trusted operational database session with short-lived least-privilege access. Supply the following non-secret identifiers as psql variables through your operational process: actor_issuer, actor_subject, target_issuer, target_subject, request_id. Do not place tokens/passwords or real production principal values in Git or command logs.

Execute the following parameterized SQL in the intended environment. psql's quoted variable syntax escapes identifiers as SQL string literals. Existing active grants are a no-op. The INSERT and PLATFORM audit either both commit or both roll back.

```sql
BEGIN;
WITH grant_row AS (
 INSERT INTO platform_role_assignment(id,issuer,subject,role,status,granted_by_issuer,granted_by_subject)
 VALUES(gen_random_uuid(), :'target_issuer', :'target_subject', 'PLATFORM_ADMIN','ACTIVE', :'actor_issuer', :'actor_subject')
 ON CONFLICT(issuer,subject,role) WHERE status='ACTIVE' DO NOTHING
 RETURNING id
)
INSERT INTO audit_event(id,actor_issuer,actor_subject,scope,action,entity_type,entity_id,request_id)
 SELECT gen_random_uuid(), :'actor_issuer', :'actor_subject', 'PLATFORM','platform.role.granted','PlatformRoleAssignment',id, :'request_id' FROM grant_row;
COMMIT;
```

Read back the target active assignment and its audit, verify admin access and denial for an ordinary ORG_OWNER, then close temporary operational access. An incorrect assignment is revoked with the operator Actor, timestamp and incremented version plus a PLATFORM audit in the same transaction; never delete evidence. Local fixture grants belong only in isolated development/test databases and are not migrations.
