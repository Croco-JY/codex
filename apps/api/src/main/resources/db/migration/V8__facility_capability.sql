CREATE TABLE facility (
 id uuid PRIMARY KEY,supplier_id uuid NOT NULL REFERENCES supplier_profile(id),facility_type varchar(30) NOT NULL CHECK(facility_type IN ('OFFICE','MILL','FACTORY','WAREHOUSE','SHOWROOM','PROCESSING_PLANT','QC_SITE','OTHER')),
 name varchar(160) NOT NULL CHECK(length(trim(name))>0),country_id uuid NOT NULL REFERENCES country(id),region_id uuid,industrial_cluster_id uuid,
 address_line_1 varchar(300),address_line_2 varchar(300),postal_code varchar(30),latitude NUMERIC(9,6),longitude NUMERIC(10,6),phone varchar(80),email varchar(254),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(region_id,country_id) REFERENCES region(id,country_id),FOREIGN KEY(industrial_cluster_id,country_id) REFERENCES industrial_cluster(id,country_id),
 CHECK((latitude IS NULL)=(longitude IS NULL)),CHECK(latitude BETWEEN -90 AND 90),CHECK(longitude BETWEEN -180 AND 180)
);
CREATE INDEX facility_supplier_idx ON facility(supplier_id,created_at DESC,id DESC);
CREATE INDEX facility_country_list_idx ON facility(country_id,created_at DESC,id DESC) WHERE status='ACTIVE';
CREATE INDEX facility_region_idx ON facility(region_id);CREATE INDEX facility_cluster_idx ON facility(industrial_cluster_id);
CREATE INDEX facility_list_idx ON facility(created_at DESC,id DESC) WHERE status='ACTIVE';
CREATE TABLE facility_external_record (
 source_record_id uuid PRIMARY KEY,facility_id uuid NOT NULL REFERENCES facility(id),record_kind varchar(30) NOT NULL DEFAULT 'FACILITY' CHECK(record_kind='FACILITY'),
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(source_record_id,record_kind) REFERENCES data_source_record(id,record_kind)
);
CREATE INDEX facility_external_canonical_idx ON facility_external_record(facility_id);
CREATE TABLE facility_source (
 facility_id uuid NOT NULL REFERENCES facility(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 field_name varchar(30) NOT NULL CHECK(field_name IN ('RECORD','NAME','TYPE','COUNTRY','REGION','CLUSTER','ADDRESS','COORDINATES','PHONE','EMAIL')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(facility_id,source_observation_id,field_name)
);
CREATE INDEX facility_source_observation_idx ON facility_source(source_observation_id);
CREATE TABLE capability (
 id uuid PRIMARY KEY,code varchar(80) NOT NULL UNIQUE CHECK(code ~ '^[A-Z][A-Z0-9_]*$'),parent_id uuid,
 category varchar(30) NOT NULL CHECK(category IN ('PRODUCT','MATERIAL_HANDLING','PROCESS')),
 name_en varchar(160) NOT NULL CHECK(length(trim(name_en))>0),name_local varchar(160),description varchar(4000),active boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,category),CHECK(id IS DISTINCT FROM parent_id),FOREIGN KEY(parent_id,category) REFERENCES capability(id,category)
);
CREATE INDEX capability_parent_idx ON capability(parent_id);
CREATE TABLE facility_capability (
 facility_id uuid NOT NULL REFERENCES facility(id),capability_id uuid NOT NULL REFERENCES capability(id),
 proficiency_level varchar(20) CHECK(proficiency_level IN ('SUPPORTED','EXPERIENCED','SPECIALIST')),
 minimum_order_quantity NUMERIC(19,4),maximum_order_quantity NUMERIC(19,4),quantity_unit varchar(10),notes varchar(1000),
 verification_status varchar(20) NOT NULL CHECK(verification_status IN ('UNVERIFIED','DOCUMENTED','AUDITED')),
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(facility_id,capability_id),
 CHECK(minimum_order_quantity>=0),CHECK(maximum_order_quantity>=0),CHECK(minimum_order_quantity<=maximum_order_quantity),
 CHECK(quantity_unit IS NULL OR quantity_unit IN ('PCS','METER','YARD','KG','GRAM','MM','CM','M2')),
 CHECK((minimum_order_quantity IS NULL AND maximum_order_quantity IS NULL) OR quantity_unit IS NOT NULL)
);
CREATE INDEX capability_facility_lookup_idx ON facility_capability(capability_id,facility_id);
CREATE TABLE facility_capability_source (
 facility_id uuid NOT NULL,capability_id uuid NOT NULL,source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(facility_id,capability_id,source_observation_id),
 FOREIGN KEY(facility_id,capability_id) REFERENCES facility_capability(facility_id,capability_id)
);
CREATE INDEX facility_capability_observation_idx ON facility_capability_source(source_observation_id);
CREATE FUNCTION lock_capability_tree() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(91102);RETURN NULL;END; $$;
CREATE TRIGGER capability_tree_lock BEFORE INSERT OR UPDATE OR DELETE ON capability FOR EACH STATEMENT EXECUTE FUNCTION lock_capability_tree();
CREATE FUNCTION reject_capability_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(WITH RECURSIVE ancestors AS (
 SELECT id,parent_id FROM capability WHERE id=NEW.parent_id UNION SELECT c.id,c.parent_id FROM capability c JOIN ancestors a ON c.id=a.parent_id)
 SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Capability cycle' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER capability_no_cycle AFTER INSERT OR UPDATE ON capability FOR EACH ROW EXECUTE FUNCTION reject_capability_cycle();
CREATE TRIGGER facility_geography_lock BEFORE INSERT OR UPDATE ON facility FOR EACH STATEMENT EXECUTE FUNCTION lock_geography();
CREATE FUNCTION validate_facility_geography() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM facility f JOIN industrial_cluster c ON c.id=f.industrial_cluster_id
 WHERE c.region_id IS NOT NULL AND (f.region_id IS NULL OR NOT EXISTS(
 WITH RECURSIVE ancestors AS (SELECT id,parent_region_id FROM region WHERE id=f.region_id
 UNION SELECT r.id,r.parent_region_id FROM region r JOIN ancestors a ON r.id=a.parent_region_id)
 SELECT 1 FROM ancestors WHERE id=c.region_id)))
 THEN RAISE EXCEPTION 'Facility cluster region mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END; $$;
CREATE TRIGGER facility_geography AFTER INSERT OR UPDATE ON facility FOR EACH STATEMENT EXECUTE FUNCTION validate_facility_geography();
CREATE TRIGGER region_facility_geography AFTER UPDATE ON region FOR EACH STATEMENT EXECUTE FUNCTION validate_facility_geography();
CREATE TRIGGER cluster_facility_geography AFTER UPDATE ON industrial_cluster FOR EACH STATEMENT EXECUTE FUNCTION validate_facility_geography();
CREATE TRIGGER facility_binding_immutable BEFORE UPDATE OR DELETE ON facility_external_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
COMMENT ON TABLE facility_external_record IS 'Identity Resolution: FACILITY external record identifies exactly one canonical Facility. Not fact evidence.';
COMMENT ON TABLE facility_source IS 'Fact Provenance: an immutable observation supports a facility fact; not an external identity binding.';
COMMENT ON TABLE facility_capability_source IS 'Typed observation provenance for a facility-capability assertion.';
