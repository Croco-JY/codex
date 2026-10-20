CREATE TABLE supplier_profile (
 id uuid PRIMARY KEY,country_id uuid NOT NULL REFERENCES country(id),display_name varchar(160) NOT NULL CHECK(length(trim(display_name))>0),
 normalized_name varchar(320) NOT NULL,legal_name varchar(160),native_name varchar(160),english_name varchar(160),
 business_registration_number varchar(100),website_url varchar(2000),description varchar(4000),
 verification_status varchar(30) NOT NULL DEFAULT 'DISCOVERED' CHECK(verification_status IN ('DISCOVERED','CLAIMED','VERIFIED','AUDITED','TRANSACTED','PROVEN')),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_country_list_idx ON supplier_profile(country_id,created_at DESC,id DESC) WHERE status='ACTIVE';
CREATE INDEX supplier_verification_idx ON supplier_profile(verification_status) WHERE status='ACTIVE';
CREATE INDEX supplier_list_idx ON supplier_profile(created_at DESC,id DESC) WHERE status='ACTIVE';
CREATE TABLE supplier_organization_link (
 id uuid PRIMARY KEY,supplier_profile_id uuid NOT NULL REFERENCES supplier_profile(id),organization_id uuid NOT NULL REFERENCES organization(id),
 status varchar(20) NOT NULL CHECK(status IN ('ACTIVE','REVOKED')),linked_at timestamptz NOT NULL DEFAULT now(),
 linked_by_issuer varchar(500) NOT NULL CHECK(length(trim(linked_by_issuer))>0),linked_by_subject varchar(255) NOT NULL CHECK(length(trim(linked_by_subject))>0),
 revoked_at timestamptz,revoked_by_issuer varchar(500),revoked_by_subject varchar(255),reason varchar(1000),
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='ACTIVE' AND revoked_at IS NULL AND revoked_by_issuer IS NULL AND revoked_by_subject IS NULL) OR
 (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_at>=linked_at AND revoked_by_issuer IS NOT NULL AND length(trim(revoked_by_issuer))>0 AND revoked_by_subject IS NOT NULL AND length(trim(revoked_by_subject))>0))
);
CREATE UNIQUE INDEX supplier_one_active_account_idx ON supplier_organization_link(supplier_profile_id) WHERE status='ACTIVE';
CREATE INDEX supplier_link_org_idx ON supplier_organization_link(organization_id);
CREATE TABLE supplier_external_record (
 source_record_id uuid PRIMARY KEY,supplier_id uuid NOT NULL REFERENCES supplier_profile(id),
 record_kind varchar(30) NOT NULL DEFAULT 'SUPPLIER' CHECK(record_kind='SUPPLIER'),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(source_record_id,record_kind) REFERENCES data_source_record(id,record_kind)
);
CREATE INDEX supplier_external_canonical_idx ON supplier_external_record(supplier_id);
CREATE TABLE supplier_role (
 supplier_id uuid NOT NULL REFERENCES supplier_profile(id),role varchar(30) NOT NULL CHECK(role IN ('MILL','CONVERTER','MATERIAL_SUPPLIER','TRIM_SUPPLIER','FACTORY','PROCESSOR','QC_COMPANY','LOGISTICS_COMPANY','OTHER')),
 PRIMARY KEY(supplier_id,role)
);
CREATE INDEX supplier_role_lookup_idx ON supplier_role(role,supplier_id);
CREATE TABLE supplier_alias (
 id uuid PRIMARY KEY,supplier_id uuid NOT NULL REFERENCES supplier_profile(id),alias varchar(160) NOT NULL CHECK(length(trim(alias))>0),normalized_alias varchar(320) NOT NULL,
 language_code varchar(35),alias_type varchar(20) NOT NULL CHECK(alias_type IN ('ORIGINAL','ENGLISH','ROMANIZED','COMMERCIAL','OTHER')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(supplier_id,normalized_alias)
);
CREATE TABLE supplier_verification_event (
 id uuid PRIMARY KEY,supplier_id uuid NOT NULL REFERENCES supplier_profile(id),previous_status varchar(30),new_status varchar(30) NOT NULL,
 reason varchar(1000) NOT NULL CHECK(length(trim(reason))>0),actor_issuer varchar(500) NOT NULL CHECK(length(trim(actor_issuer))>0),actor_subject varchar(255) NOT NULL CHECK(length(trim(actor_subject))>0),
 source_observation_id uuid REFERENCES data_source_observation(id),occurred_at timestamptz NOT NULL DEFAULT now(),
 CHECK(previous_status IS NULL OR previous_status IN ('DISCOVERED','CLAIMED','VERIFIED','AUDITED','TRANSACTED','PROVEN')),
 CHECK(new_status IN ('DISCOVERED','CLAIMED','VERIFIED','AUDITED','TRANSACTED','PROVEN'))
);
CREATE INDEX supplier_verification_history_idx ON supplier_verification_event(supplier_id,occurred_at DESC,id DESC);
CREATE TABLE supplier_source (
 supplier_id uuid NOT NULL REFERENCES supplier_profile(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 field_name varchar(30) NOT NULL CHECK(field_name IN ('RECORD','DISPLAY_NAME','LEGAL_NAME','NATIVE_NAME','ENGLISH_NAME','COUNTRY','WEBSITE_URL','DESCRIPTION','ROLE','ALIAS','VERIFICATION')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(supplier_id,source_observation_id,field_name)
);
CREATE INDEX supplier_source_observation_idx ON supplier_source(source_observation_id);
CREATE TRIGGER supplier_binding_immutable BEFORE UPDATE OR DELETE ON supplier_external_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_binding_no_truncate BEFORE TRUNCATE ON supplier_external_record FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_verification_immutable BEFORE UPDATE OR DELETE ON supplier_verification_event FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_verification_no_truncate BEFORE TRUNCATE ON supplier_verification_event FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
COMMENT ON TABLE supplier_external_record IS 'Identity Resolution: persistent external record identifies one canonical SupplierProfile. Not fact provenance.';
COMMENT ON TABLE supplier_source IS 'Fact Provenance: actual immutable observation supports a supplier fact. Not identity resolution.';
COMMENT ON TABLE supplier_organization_link IS 'Historical account relationship only. ACTIVE/REVOKED, not a claim workflow, and never a canonical write authority.';
