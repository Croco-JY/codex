CREATE TABLE style_requirement (
 style_id uuid PRIMARY KEY REFERENCES style(id),
 product_type varchar(160) CHECK (product_type IS NULL OR product_type ~ '[^[:space:]]'),
 target_quantity numeric(19,4) CHECK (target_quantity IS NULL OR target_quantity BETWEEN 0 AND 999999999999999.9999),
 quantity_unit varchar(3) CHECK (quantity_unit IS NULL OR quantity_unit IN ('PCS','SET')),
 target_cost numeric(19,4) CHECK (target_cost IS NULL OR target_cost BETWEEN 0 AND 999999999999999.9999),
 currency varchar(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 target_delivery_date date,
 notes varchar(4000) CHECK (notes IS NULL OR notes ~ '[^[:space:]]'),
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((target_cost IS NULL) = (currency IS NULL)),
 CHECK (target_quantity IS NULL OR quantity_unit IS NOT NULL),
 CHECK (target_cost IS NULL OR quantity_unit IS NOT NULL)
);

CREATE FUNCTION protect_style_requirement_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.style_id,NEW.created_at) IS DISTINCT FROM (OLD.style_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Requirement identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER style_requirement_identity BEFORE UPDATE ON style_requirement FOR EACH ROW EXECUTE FUNCTION protect_style_requirement_identity();
CREATE TRIGGER style_requirement_no_delete BEFORE DELETE ON style_requirement FOR EACH ROW EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER style_requirement_no_truncate BEFORE TRUNCATE ON style_requirement FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
