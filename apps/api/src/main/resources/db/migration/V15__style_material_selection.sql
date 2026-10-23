CREATE TABLE style_material_selection (
 id uuid PRIMARY KEY,
 style_id uuid NOT NULL REFERENCES style(id),
 material_id uuid NOT NULL REFERENCES material(id),
 variant_id uuid,
 listing_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT selection_variant_material_fk FOREIGN KEY (variant_id,material_id) REFERENCES material_variant(id,material_id),
 CONSTRAINT selection_listing_material_fk FOREIGN KEY (listing_id,material_id) REFERENCES supplier_material_listing(id,material_id),
 CONSTRAINT style_material_selection_scope_uq UNIQUE NULLS NOT DISTINCT (style_id,material_id,variant_id,listing_id)
);
CREATE INDEX style_material_selection_page_idx ON style_material_selection(style_id,created_at DESC,id DESC);
CREATE INDEX style_material_selection_material_idx ON style_material_selection(material_id);
CREATE INDEX style_material_selection_variant_idx ON style_material_selection(variant_id);
CREATE INDEX style_material_selection_listing_idx ON style_material_selection(listing_id);
CREATE FUNCTION protect_style_material_selection_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.style_id,NEW.material_id,NEW.variant_id,NEW.listing_id,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.style_id,OLD.material_id,OLD.variant_id,OLD.listing_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Selection identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER style_material_selection_identity BEFORE UPDATE ON style_material_selection FOR EACH ROW EXECUTE FUNCTION protect_style_material_selection_identity();
CREATE TRIGGER style_material_selection_no_truncate BEFORE TRUNCATE ON style_material_selection FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
