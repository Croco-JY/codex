CREATE TABLE style_facility_candidate (
 id uuid PRIMARY KEY,
 style_id uuid NOT NULL REFERENCES style(id),
 facility_id uuid NOT NULL REFERENCES facility(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT style_facility_candidate_scope_uq UNIQUE(style_id,facility_id)
);
CREATE INDEX style_facility_candidate_page_idx ON style_facility_candidate(style_id,created_at DESC,id DESC);
CREATE INDEX style_facility_candidate_facility_idx ON style_facility_candidate(facility_id);
CREATE FUNCTION protect_style_facility_candidate_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.style_id,NEW.facility_id,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.style_id,OLD.facility_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Candidate identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER style_facility_candidate_identity BEFORE UPDATE ON style_facility_candidate FOR EACH ROW EXECUTE FUNCTION protect_style_facility_candidate_identity();
CREATE TRIGGER style_facility_candidate_no_truncate BEFORE TRUNCATE ON style_facility_candidate FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
