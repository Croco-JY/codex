ALTER TABLE public.data_source_record DROP CONSTRAINT data_source_record_kind_check;
ALTER TABLE public.data_source_record ADD CONSTRAINT data_source_record_kind_check
 CHECK(record_kind IN ('SUPPLIER','FACILITY','MATERIAL','MATERIAL_VARIANT','MATERIAL_LISTING')) NOT VALID;
ALTER TABLE public.data_source_record VALIDATE CONSTRAINT data_source_record_kind_check;

CREATE TABLE material (
 id uuid PRIMARY KEY, catalog_supplier_id uuid NOT NULL REFERENCES supplier_profile(id), catalog_article_number varchar(160),
 material_type varchar(30) NOT NULL CHECK(material_type IN ('FABRIC','LEATHER','LINING','INTERLINING','ZIPPER','BUTTON','SNAP','BUCKLE','THREAD','TAPE','LABEL','ELASTIC','FILLING','PACKAGING','OTHER')),
 display_name varchar(160) NOT NULL CHECK(length(trim(display_name))>0), normalized_name varchar(320) NOT NULL,
 description varchar(4000), origin_country_id uuid REFERENCES country(id),
 composition_completeness varchar(20) NOT NULL DEFAULT 'UNKNOWN' CHECK(composition_completeness IN ('UNKNOWN','PARTIAL','COMPLETE')),
 status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')),
 version bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT material_id_type_uq UNIQUE(id,material_type)
);
CREATE TABLE material_variant (
 id uuid PRIMARY KEY, material_id uuid NOT NULL REFERENCES material(id), catalog_variant_sku varchar(160),
 variant_name varchar(160) NOT NULL CHECK(length(trim(variant_name))>0), color_name varchar(160),color_code varchar(80),batch_number varchar(100),
 attributes jsonb CHECK(attributes IS NULL OR (jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=8192)),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT material_variant_id_material_uq UNIQUE(id,material_id)
);
CREATE TABLE fabric_spec (
 material_id uuid PRIMARY KEY, material_type varchar(30) NOT NULL DEFAULT 'FABRIC' CHECK(material_type='FABRIC'),
 construction varchar(20) CHECK(construction IN ('WOVEN','KNIT','NONWOVEN','OTHER')),weave_type varchar(80),knit_type varchar(80),
 gsm numeric(10,4) CHECK(gsm>0),width_mm numeric(12,4) CHECK(width_mm>0),thickness_mm numeric(10,4) CHECK(thickness_mm>0),
 stretch_warp_percentage numeric(9,4) CHECK(stretch_warp_percentage>=0),stretch_weft_percentage numeric(9,4) CHECK(stretch_weft_percentage>=0),
 shrinkage_warp_percentage numeric(7,4) CHECK(shrinkage_warp_percentage BETWEEN -100 AND 100),shrinkage_weft_percentage numeric(7,4) CHECK(shrinkage_weft_percentage BETWEEN -100 AND 100),
 finish varchar(300),surface varchar(300),handfeel varchar(300),drape varchar(300),luster varchar(300),
 attributes jsonb CHECK(attributes IS NULL OR (jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=8192)),
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(material_id,material_type) REFERENCES material(id,material_type),
 CHECK(weave_type IS NULL OR construction IS NOT DISTINCT FROM 'WOVEN'),CHECK(knit_type IS NULL OR construction IS NOT DISTINCT FROM 'KNIT')
);
CREATE TABLE leather_spec (
 material_id uuid PRIMARY KEY,material_type varchar(30) NOT NULL DEFAULT 'LEATHER' CHECK(material_type='LEATHER'),
 hide_type varchar(20) CHECK(hide_type IN ('BOVINE','OVINE','CAPRINE','PORCINE','OTHER')),
 tanning_method varchar(20) CHECK(tanning_method IN ('CHROME','VEGETABLE','COMBINATION','OTHER')),
 thickness_min_mm numeric(10,4) CHECK(thickness_min_mm>0),thickness_max_mm numeric(10,4) CHECK(thickness_max_mm>0),
 average_hide_area_m2 numeric(12,4) CHECK(average_hide_area_m2>0),finish varchar(300),surface varchar(300),handfeel varchar(300),luster varchar(300),
 attributes jsonb CHECK(attributes IS NULL OR (jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=8192)),
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(material_id,material_type) REFERENCES material(id,material_type),CHECK(thickness_min_mm<=thickness_max_mm)
);
CREATE TABLE fiber_type (
 id uuid PRIMARY KEY,code varchar(40) NOT NULL UNIQUE CHECK(code ~ '^[A-Z][A-Z0-9_]*$'),
 name_en varchar(160) NOT NULL CHECK(length(trim(name_en))>0),name_local varchar(160),active boolean NOT NULL DEFAULT true,
 version bigint NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE material_composition (
 material_id uuid NOT NULL REFERENCES material(id),fiber_type_id uuid NOT NULL REFERENCES fiber_type(id),
 percentage numeric(7,4) NOT NULL CHECK(percentage>0 AND percentage<=100),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(material_id,fiber_type_id)
);
CREATE TABLE supplier_material_listing (
 id uuid PRIMARY KEY,material_id uuid NOT NULL REFERENCES material(id),seller_supplier_id uuid NOT NULL REFERENCES supplier_profile(id),seller_article_number varchar(160),
 minimum_order_quantity numeric(19,4) CHECK(minimum_order_quantity>=0),minimum_color_quantity numeric(19,4) CHECK(minimum_color_quantity>=0),
 quantity_unit varchar(10) CHECK(quantity_unit IN ('PCS','METER','YARD','KG','GRAM','MM','CM','M2','FT2','ROLL','HIDE','SET','PACK')),
 standard_lead_time_days integer CHECK(standard_lead_time_days>=0),reproduction_lead_time_days integer CHECK(reproduction_lead_time_days>=0),
 status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),version bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT listing_id_material_uq UNIQUE(id,material_id),
 CHECK((minimum_order_quantity IS NULL AND minimum_color_quantity IS NULL) OR quantity_unit IS NOT NULL)
);
CREATE TABLE material_external_record (
 source_record_id uuid PRIMARY KEY,material_id uuid NOT NULL REFERENCES material(id),
 record_kind varchar(30) NOT NULL DEFAULT 'MATERIAL' CHECK(record_kind='MATERIAL'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_record_id,record_kind) REFERENCES data_source_record(id,record_kind)
);
COMMENT ON TABLE material_external_record IS 'Identity Resolution: persistent typed external record, not observation evidence. No rebinding or physical destruction.';
CREATE TABLE material_variant_external_record (
 source_record_id uuid PRIMARY KEY,material_variant_id uuid NOT NULL REFERENCES material_variant(id),
 record_kind varchar(30) NOT NULL DEFAULT 'MATERIAL_VARIANT' CHECK(record_kind='MATERIAL_VARIANT'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_record_id,record_kind) REFERENCES data_source_record(id,record_kind)
);
COMMENT ON TABLE material_variant_external_record IS 'Identity Resolution: persistent typed external record, not observation evidence. No rebinding or physical destruction.';
CREATE TABLE supplier_material_listing_external_record (
 source_record_id uuid PRIMARY KEY,listing_id uuid NOT NULL REFERENCES supplier_material_listing(id),
 record_kind varchar(30) NOT NULL DEFAULT 'MATERIAL_LISTING' CHECK(record_kind='MATERIAL_LISTING'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_record_id,record_kind) REFERENCES data_source_record(id,record_kind)
);
COMMENT ON TABLE supplier_material_listing_external_record IS 'Identity Resolution: persistent typed external record, not observation evidence. No rebinding or physical destruction.';
CREATE TABLE material_source (
 material_id uuid NOT NULL REFERENCES material(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 field_name varchar(30) NOT NULL CHECK(field_name IN ('RECORD','CATALOG_ARTICLE_NUMBER','NAME','DESCRIPTION','ORIGIN','COMPOSITION','FABRIC_SPEC','LEATHER_SPEC')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(material_id,source_observation_id,field_name)
);
COMMENT ON TABLE material_source IS 'Fact Provenance: actual immutable observation supports a controlled canonical fact; not an identity binding.';
CREATE TABLE material_variant_source (
 material_variant_id uuid NOT NULL REFERENCES material_variant(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 field_name varchar(30) NOT NULL CHECK(field_name IN ('RECORD','CATALOG_VARIANT_SKU','NAME','COLOR','BATCH','ATTRIBUTES')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(material_variant_id,source_observation_id,field_name)
);
COMMENT ON TABLE material_variant_source IS 'Fact Provenance: actual immutable observation supports a controlled canonical fact; not an identity binding.';
CREATE TABLE supplier_material_listing_source (
 listing_id uuid NOT NULL REFERENCES supplier_material_listing(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 field_name varchar(30) NOT NULL CHECK(field_name IN ('RECORD','SELLER_ARTICLE_NUMBER','MOQ','MCQ','UNIT','STANDARD_LEAD_TIME','REPRODUCTION_LEAD_TIME')),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(listing_id,source_observation_id,field_name)
);
COMMENT ON TABLE supplier_material_listing_source IS 'Fact Provenance: actual immutable observation supports a controlled canonical fact; not an identity binding.';
CREATE FUNCTION protect_material_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.catalog_supplier_id,NEW.material_type,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.catalog_supplier_id,OLD.material_type,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER material_identity BEFORE UPDATE ON material FOR EACH ROW EXECUTE FUNCTION protect_material_identity();
CREATE FUNCTION protect_material_variant_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.material_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.material_id,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER material_variant_identity BEFORE UPDATE ON material_variant FOR EACH ROW EXECUTE FUNCTION protect_material_variant_identity();
CREATE FUNCTION protect_supplier_material_listing_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.material_id,NEW.seller_supplier_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.material_id,OLD.seller_supplier_id,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER supplier_material_listing_identity BEFORE UPDATE ON supplier_material_listing FOR EACH ROW EXECUTE FUNCTION protect_supplier_material_listing_identity();
CREATE FUNCTION protect_fabric_spec_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.material_id,NEW.material_type,NEW.created_at) IS DISTINCT FROM (OLD.material_id,OLD.material_type,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fabric_spec_identity BEFORE UPDATE ON fabric_spec FOR EACH ROW EXECUTE FUNCTION protect_fabric_spec_identity();
CREATE FUNCTION protect_leather_spec_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.material_id,NEW.material_type,NEW.created_at) IS DISTINCT FROM (OLD.material_id,OLD.material_type,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER leather_spec_identity BEFORE UPDATE ON leather_spec FOR EACH ROW EXECUTE FUNCTION protect_leather_spec_identity();
CREATE FUNCTION protect_fiber_type_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.code,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.code,OLD.created_at) THEN RAISE EXCEPTION 'Catalog identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fiber_type_identity BEFORE UPDATE ON fiber_type FOR EACH ROW EXECUTE FUNCTION protect_fiber_type_identity();
CREATE TRIGGER material_no_delete BEFORE DELETE ON material FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_no_truncate BEFORE TRUNCATE ON material FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_no_delete BEFORE DELETE ON material_variant FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_no_truncate BEFORE TRUNCATE ON material_variant FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_no_delete BEFORE DELETE ON supplier_material_listing FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_no_truncate BEFORE TRUNCATE ON supplier_material_listing FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_external_record_immutable BEFORE UPDATE OR DELETE ON material_external_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_external_record_no_truncate BEFORE TRUNCATE ON material_external_record FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_external_record_immutable BEFORE UPDATE OR DELETE ON material_variant_external_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_external_record_no_truncate BEFORE TRUNCATE ON material_variant_external_record FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_external_record_immutable BEFORE UPDATE OR DELETE ON supplier_material_listing_external_record FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_external_record_no_truncate BEFORE TRUNCATE ON supplier_material_listing_external_record FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_source_immutable BEFORE UPDATE OR DELETE ON material_source FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_source_no_truncate BEFORE TRUNCATE ON material_source FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_source_immutable BEFORE UPDATE OR DELETE ON material_variant_source FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_variant_source_no_truncate BEFORE TRUNCATE ON material_variant_source FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_source_immutable BEFORE UPDATE OR DELETE ON supplier_material_listing_source FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER supplier_material_listing_source_no_truncate BEFORE TRUNCATE ON supplier_material_listing_source FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE FUNCTION lock_composition_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.material_id IS DISTINCT FROM OLD.material_id THEN
  RAISE EXCEPTION 'Composition parent is immutable' USING ERRCODE='23514';
 END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.material_id ELSE NEW.material_id END;
 PERFORM id FROM material WHERE id=target FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER composition_parent_lock BEFORE INSERT OR UPDATE OR DELETE ON material_composition FOR EACH ROW EXECUTE FUNCTION lock_composition_material();
CREATE FUNCTION validate_material_composition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; completeness text; total numeric; components bigint;
BEGIN
 IF TG_TABLE_NAME='material' THEN target:=NEW.id;
 ELSIF TG_OP='DELETE' THEN target:=OLD.material_id;
 ELSE target:=NEW.material_id; END IF;
 SELECT composition_completeness INTO completeness FROM material WHERE id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(*),COALESCE(sum(percentage),0) INTO components,total FROM material_composition WHERE material_id=target;
 IF (completeness='UNKNOWN' AND components<>0)
 OR (completeness='PARTIAL' AND (components=0 OR total<=0 OR total>100))
 OR (completeness='COMPLETE' AND (components=0 OR total<>100)) THEN
  RAISE EXCEPTION 'Material composition completeness mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER composition_total AFTER INSERT OR UPDATE OR DELETE ON material_composition
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_material_composition();
CREATE CONSTRAINT TRIGGER material_completeness AFTER INSERT OR UPDATE OF composition_completeness ON material
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_material_composition();
INSERT INTO fiber_type(id,code,name_en) VALUES('70bce48e-3ec8-5c0c-92ee-474bf2eb7613','WOOL','Wool');
INSERT INTO fiber_type(id,code,name_en) VALUES('0e135ab1-c052-59e1-9b35-908309904b16','CASHMERE','Cashmere');
INSERT INTO fiber_type(id,code,name_en) VALUES('9996a3ee-4e6e-5ce5-ae50-f6e0cdf89c1f','COTTON','Cotton');
INSERT INTO fiber_type(id,code,name_en) VALUES('6baa9113-2943-5d6e-a9f6-6e418c68b822','LINEN','Linen');
INSERT INTO fiber_type(id,code,name_en) VALUES('c013245e-775c-594a-9f4f-abe07d1b14b0','SILK','Silk');
INSERT INTO fiber_type(id,code,name_en) VALUES('2696ea7d-cae1-57b7-9d5b-f96a2353ac65','POLYESTER','Polyester');
INSERT INTO fiber_type(id,code,name_en) VALUES('32aa2a10-ec70-5d0a-9eb3-2063cfaf690e','NYLON','Nylon');
INSERT INTO fiber_type(id,code,name_en) VALUES('5e758f14-2d4c-5246-8646-d56bb873241e','ACRYLIC','Acrylic');
INSERT INTO fiber_type(id,code,name_en) VALUES('14b4098c-b388-5518-9ac3-8c66a07189a5','RAYON','Rayon');
INSERT INTO fiber_type(id,code,name_en) VALUES('f822a0c7-1406-596d-af81-d1561de81f08','VISCOSE','Viscose');
INSERT INTO fiber_type(id,code,name_en) VALUES('456f0d03-5599-5a7a-a55f-5aefc5198c0a','LYOCELL','Lyocell');
INSERT INTO fiber_type(id,code,name_en) VALUES('d953a9e1-4ddd-5113-bd59-8635add304a5','ELASTANE','Elastane');
INSERT INTO fiber_type(id,code,name_en) VALUES('c1800734-b628-5116-9e23-820f7cced025','OTHER','Other');
