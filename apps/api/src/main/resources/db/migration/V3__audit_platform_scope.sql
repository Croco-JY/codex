ALTER TABLE audit_event ADD COLUMN scope varchar(20) NOT NULL DEFAULT 'ORGANIZATION';
ALTER TABLE audit_event ADD COLUMN entity_type varchar(80), ADD COLUMN entity_id uuid,
 ADD COLUMN before_state jsonb, ADD COLUMN after_state jsonb;
ALTER TABLE audit_event ADD CONSTRAINT audit_scope_check CHECK (
 (scope='ORGANIZATION' AND organization_id IS NOT NULL) OR
 (scope='PLATFORM' AND organization_id IS NULL));
ALTER TABLE audit_event ADD CONSTRAINT audit_entity_pair CHECK ((entity_type IS NULL) = (entity_id IS NULL));
ALTER TABLE audit_event ADD CONSTRAINT audit_platform_entity CHECK (scope<>'PLATFORM' OR entity_id IS NOT NULL);
ALTER TABLE audit_event ADD CONSTRAINT audit_state_objects CHECK (
 (before_state IS NULL OR jsonb_typeof(before_state)='object') AND
 (after_state IS NULL OR jsonb_typeof(after_state)='object'));
ALTER TABLE audit_event ALTER COLUMN organization_id DROP NOT NULL;
CREATE INDEX audit_platform_entity_idx ON audit_event(entity_type,entity_id,occurred_at) WHERE scope='PLATFORM';
COMMENT ON COLUMN audit_event.scope IS 'ORGANIZATION requires a tenant; PLATFORM records canonical/global changes without an artificial tenant.';
