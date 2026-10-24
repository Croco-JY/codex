CREATE TABLE measurement_spec (
    id uuid PRIMARY KEY,
    style_id uuid NOT NULL UNIQUE REFERENCES style(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT measurement_spec_id_style_uq UNIQUE (id, style_id)
);
CREATE TABLE measurement_revision (
    id uuid PRIMARY KEY,
    measurement_spec_id uuid NOT NULL,
    style_id uuid NOT NULL,
    revision_number bigint NOT NULL CHECK (revision_number BETWEEN 1 AND 9007199254740991),
    base_size varchar(40) NOT NULL CHECK (
        length(base_size) BETWEEN 1 AND 40 AND base_size !~ '^[[:space:]]' AND base_size !~ '[[:space:]]$'),
    unit_system varchar(2) NOT NULL CHECK (unit_system IN ('MM','CM','IN')),
    created_by_issuer varchar(500) NOT NULL,
    created_by_subject varchar(255) NOT NULL,
    sealed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (measurement_spec_id, style_id) REFERENCES measurement_spec(id, style_id),
    CONSTRAINT measurement_revision_number_uq UNIQUE (measurement_spec_id, revision_number),
    CONSTRAINT measurement_revision_id_style_uq UNIQUE (id, style_id)
);
CREATE TABLE measurement_point (
    measurement_revision_id uuid NOT NULL REFERENCES measurement_revision(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 499),
    code varchar(80) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,79}$'),
    label varchar(160) NOT NULL CHECK (
        length(label) BETWEEN 1 AND 160 AND label !~ '^[[:space:]]' AND label !~ '[[:space:]]$'),
    value numeric(19,4) NOT NULL CHECK (value BETWEEN 0 AND 999999999999999.9999),
    tolerance_plus numeric(19,4) CHECK (tolerance_plus BETWEEN 0 AND 999999999999999.9999),
    tolerance_minus numeric(19,4) CHECK (tolerance_minus BETWEEN 0 AND 999999999999999.9999),
    notes varchar(1000) CHECK (notes IS NULL OR (
        length(notes) BETWEEN 1 AND 1000 AND notes !~ '^[[:space:]]' AND notes !~ '[[:space:]]$')),
    PRIMARY KEY (measurement_revision_id, code),
    UNIQUE (measurement_revision_id, position)
);
CREATE INDEX measurement_revision_history_idx ON measurement_revision(measurement_spec_id, revision_number DESC);

CREATE FUNCTION guard_measurement_revision_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest bigint;
BEGIN
    -- Reacquire only the owning aggregate; never lock Style/Project after this row.
    PERFORM 1 FROM measurement_spec WHERE id=NEW.measurement_spec_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Measurement aggregate missing'; END IF;
    SELECT COALESCE(max(revision_number),0) INTO latest FROM measurement_revision
        WHERE measurement_spec_id=NEW.measurement_spec_id;
    IF NEW.revision_number <> latest+1 THEN RAISE EXCEPTION 'Invalid measurement revision sequence'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER measurement_revision_sequence BEFORE INSERT ON measurement_revision
    FOR EACH ROW EXECUTE FUNCTION guard_measurement_revision_sequence();

CREATE FUNCTION guard_measurement_point_construction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE construction boolean;
BEGIN
    SELECT NOT sealed INTO construction FROM measurement_revision WHERE id=NEW.measurement_revision_id FOR UPDATE;
    IF construction IS DISTINCT FROM true THEN RAISE EXCEPTION 'Measurement revision is not under construction'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER measurement_point_construction BEFORE INSERT ON measurement_point
    FOR EACH ROW EXECUTE FUNCTION guard_measurement_point_construction();

CREATE FUNCTION guard_measurement_revision_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.sealed OR NOT NEW.sealed OR
        ROW(NEW.id,NEW.measurement_spec_id,NEW.style_id,NEW.revision_number,NEW.base_size,NEW.unit_system,
            NEW.created_by_issuer,NEW.created_by_subject,NEW.created_at)
        IS DISTINCT FROM
        ROW(OLD.id,OLD.measurement_spec_id,OLD.style_id,OLD.revision_number,OLD.base_size,OLD.unit_system,
            OLD.created_by_issuer,OLD.created_by_subject,OLD.created_at) THEN
        RAISE EXCEPTION 'Measurement revision is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER measurement_revision_seal BEFORE UPDATE ON measurement_revision
    FOR EACH ROW EXECUTE FUNCTION guard_measurement_revision_seal();

CREATE FUNCTION require_measurement_spec_revision_one() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM measurement_revision WHERE measurement_spec_id=NEW.id
        AND revision_number=1 AND sealed) THEN RAISE EXCEPTION 'Measurement revision one required'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER measurement_spec_complete AFTER INSERT ON measurement_spec
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_measurement_spec_revision_one();

CREATE FUNCTION require_measurement_revision_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; lo integer; hi integer; distinct_positions bigint; is_sealed boolean;
BEGIN
    SELECT sealed INTO is_sealed FROM measurement_revision WHERE id=NEW.id;
    SELECT count(*),min(position),max(position),count(DISTINCT position)
        INTO n,lo,hi,distinct_positions FROM measurement_point WHERE measurement_revision_id=NEW.id;
    IF is_sealed IS DISTINCT FROM true OR n NOT BETWEEN 1 AND 500 OR lo<>0 OR hi<>n-1 OR distinct_positions<>n THEN
        RAISE EXCEPTION 'Incomplete measurement revision';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER measurement_revision_complete AFTER INSERT ON measurement_revision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_measurement_revision_complete();

CREATE TRIGGER measurement_spec_no_update BEFORE UPDATE ON measurement_spec
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_spec_no_delete BEFORE DELETE ON measurement_spec
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_spec_no_truncate BEFORE TRUNCATE ON measurement_spec
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_revision_no_delete BEFORE DELETE ON measurement_revision
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_revision_no_truncate BEFORE TRUNCATE ON measurement_revision
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_point_no_update BEFORE UPDATE ON measurement_point
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_point_no_delete BEFORE DELETE ON measurement_point
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER measurement_point_no_truncate BEFORE TRUNCATE ON measurement_point
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
