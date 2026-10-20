CREATE TABLE material_inventory_snapshot (
 id uuid PRIMARY KEY,listing_id uuid NOT NULL,material_id uuid NOT NULL,material_variant_id uuid,
 facility_id uuid REFERENCES facility(id),quantity numeric(19,4) NOT NULL CHECK(quantity>=0),
 unit varchar(10) NOT NULL CHECK(unit IN ('PCS','METER','YARD','KG','GRAM','MM','CM','M2','FT2','ROLL','HIDE','SET','PACK')),
 capture_mode varchar(10) NOT NULL CHECK(capture_mode IN ('IMPORTED','MANUAL')),
 observed_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 source_observation_id uuid REFERENCES data_source_observation(id),manual_idempotency_key varchar(200),
 actor_issuer varchar(500),actor_subject varchar(255),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(listing_id,material_id) REFERENCES supplier_material_listing(id,material_id) MATCH SIMPLE,
 FOREIGN KEY(material_variant_id,material_id) REFERENCES material_variant(id,material_id) MATCH SIMPLE,
 CHECK((actor_issuer IS NULL AND actor_subject IS NULL) OR (actor_issuer IS NOT NULL AND length(trim(actor_issuer))>0 AND actor_subject IS NOT NULL AND length(trim(actor_subject))>0)),
 CHECK((capture_mode='IMPORTED' AND source_observation_id IS NOT NULL AND manual_idempotency_key IS NULL) OR
 (capture_mode='MANUAL' AND source_observation_id IS NULL AND manual_idempotency_key IS NOT NULL AND length(trim(manual_idempotency_key))>0 AND actor_issuer IS NOT NULL AND actor_subject IS NOT NULL))
);
CREATE UNIQUE INDEX inventory_import_identity_idx ON material_inventory_snapshot(listing_id,material_variant_id,facility_id,source_observation_id) NULLS NOT DISTINCT WHERE capture_mode='IMPORTED';
CREATE UNIQUE INDEX inventory_manual_identity_idx ON material_inventory_snapshot(listing_id,manual_idempotency_key) WHERE capture_mode='MANUAL';
CREATE TRIGGER inventory_immutable BEFORE UPDATE OR DELETE ON material_inventory_snapshot FOR EACH ROW EXECUTE FUNCTION reject_source_fact_mutation();
CREATE TRIGGER inventory_no_truncate BEFORE TRUNCATE ON material_inventory_snapshot FOR EACH STATEMENT EXECUTE FUNCTION reject_source_fact_mutation();
COMMENT ON TABLE material_inventory_snapshot IS 'Immutable stock knowledge; zero is known zero, absence is unknown. Facility may be a third-party location. Not reservation or ATP.';
