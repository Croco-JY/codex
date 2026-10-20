CREATE TABLE material_price (
 id uuid PRIMARY KEY,listing_id uuid NOT NULL,material_id uuid NOT NULL,material_variant_id uuid,
 data_source_id uuid NOT NULL REFERENCES data_source(id),amount numeric(19,4) NOT NULL CHECK(amount>0),
 currency varchar(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 price_unit varchar(10) NOT NULL CHECK(price_unit IN ('PCS','METER','YARD','KG','GRAM','MM','CM','M2','FT2','ROLL','HIDE','SET','PACK')),
 minimum_order_quantity numeric(19,4) CHECK(minimum_order_quantity>=0),valid_from timestamptz NOT NULL,valid_to timestamptz,
 observed_at timestamptz NOT NULL,version bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(listing_id,material_id) REFERENCES supplier_material_listing(id,material_id) MATCH SIMPLE,
 FOREIGN KEY(material_variant_id,material_id) REFERENCES material_variant(id,material_id) MATCH SIMPLE,
 CHECK(valid_to IS NULL OR valid_to>valid_from)
);
CREATE TABLE material_price_source (
 material_price_id uuid NOT NULL REFERENCES material_price(id),source_observation_id uuid NOT NULL REFERENCES data_source_observation(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(material_price_id,source_observation_id)
);
CREATE FUNCTION protect_material_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.listing_id,NEW.material_id,NEW.material_variant_id,NEW.data_source_id,NEW.amount,NEW.currency,NEW.price_unit,NEW.minimum_order_quantity,NEW.valid_from,NEW.observed_at,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.listing_id,OLD.material_id,OLD.material_variant_id,OLD.data_source_id,OLD.amount,OLD.currency,OLD.price_unit,OLD.minimum_order_quantity,OLD.valid_from,OLD.observed_at,OLD.created_at)
 THEN RAISE EXCEPTION 'Price identity and value are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL OR NEW.valid_to<=NEW.valid_from OR NEW.version<>OLD.version+1
 THEN RAISE EXCEPTION 'Price may only close once' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=transaction_timestamp();RETURN NEW;
END; $$;
CREATE TRIGGER material_price_close_only BEFORE UPDATE ON material_price FOR EACH ROW EXECUTE FUNCTION protect_material_price();
CREATE TRIGGER material_price_no_delete BEFORE DELETE ON material_price FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_price_no_truncate BEFORE TRUNCATE ON material_price FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE FUNCTION validate_material_price_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE provider uuid; observed_provider uuid;
BEGIN
 SELECT data_source_id INTO provider FROM material_price WHERE id=NEW.material_price_id;
 SELECT r.data_source_id INTO observed_provider FROM data_source_observation o JOIN data_source_record r ON r.id=o.source_record_id WHERE o.id=NEW.source_observation_id;
 IF provider IS NULL OR observed_provider IS NULL OR provider<>observed_provider THEN
  RAISE EXCEPTION 'Price evidence provider mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER material_price_source_provider BEFORE INSERT OR UPDATE ON material_price_source FOR EACH ROW EXECUTE FUNCTION validate_material_price_source();
CREATE TRIGGER material_price_source_immutable BEFORE UPDATE OR DELETE ON material_price_source FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER material_price_source_no_truncate BEFORE TRUNCATE ON material_price_source FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
CREATE INDEX material_price_resolver_idx ON material_price(listing_id,data_source_id,currency,price_unit,material_variant_id,minimum_order_quantity DESC NULLS LAST,valid_from DESC,observed_at DESC,created_at DESC,id DESC);
CREATE INDEX material_price_evidence_idx ON material_price_source(source_observation_id);
COMMENT ON TABLE material_price IS 'Historical provider-scoped listing prices. Only one NULL-to-valid_to closure is mutable. No global overlap exclusion.';
COMMENT ON TABLE material_price_source IS 'Fact Provenance: immutable observation supports a price and must originate from the same provider.';
