-- Read-model indexes for deterministic catalog discovery, correlated listing matches,
-- physical ranges, resolver history and per-scope inventory knowledge. No new tables.
CREATE INDEX material_created_idx ON material(created_at DESC,id DESC);
CREATE INDEX material_catalog_page_idx ON material(catalog_supplier_id,created_at DESC,id DESC);
CREATE INDEX material_type_status_page_idx ON material(material_type,status,created_at DESC,id DESC);
CREATE INDEX material_origin_page_idx ON material(origin_country_id,created_at DESC,id DESC);
CREATE INDEX composition_fiber_range_idx ON material_composition(fiber_type_id,percentage,material_id);
CREATE INDEX fabric_gsm_range_idx ON fabric_spec(gsm,material_id);
CREATE INDEX fabric_width_range_idx ON fabric_spec(width_mm,material_id);
CREATE INDEX variant_material_color_idx ON material_variant(material_id,lower(color_name),lower(color_code));
CREATE INDEX listing_material_terms_idx ON supplier_material_listing(material_id,seller_supplier_id,status,quantity_unit,minimum_order_quantity) INCLUDE(minimum_color_quantity,standard_lead_time_days);
CREATE INDEX listing_seller_page_idx ON supplier_material_listing(seller_supplier_id,created_at DESC,id DESC);
CREATE INDEX listing_material_page_idx ON supplier_material_listing(material_id,created_at DESC,id DESC);
CREATE INDEX price_history_page_idx ON material_price(listing_id,created_at DESC,id DESC);
CREATE INDEX inventory_latest_scope_idx ON material_inventory_snapshot(listing_id,material_variant_id,facility_id,unit,observed_at DESC,recorded_at DESC,created_at DESC,id DESC);
-- V10 already supplies the provider/currency/unit/variant/tier resolver index.
-- Substring name search at this scale uses bound strpos predicates; no measured
-- need for pg_trgm or similarity identity indexes, so no extension is enabled.
