-- Phase 3D: independent Style-owned deterministic grading snapshots.
-- This exact boundary set is shared with GradingText, independent of locale.
CREATE FUNCTION grade_text_is_canonical(value text, maximum integer) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT length(value) BETWEEN 1 AND maximum AND value = btrim(value,
        U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE TABLE grade_rule_set (
    id uuid PRIMARY KEY,
    style_id uuid NOT NULL REFERENCES style(id),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(id,style_id)
);
CREATE INDEX grade_rule_set_style_page_idx ON grade_rule_set(style_id,created_at DESC,id DESC);
CREATE INDEX grade_rule_set_style_status_page_idx ON grade_rule_set(style_id,status,created_at DESC,id DESC);

CREATE TABLE grade_rule_set_revision (
    id uuid PRIMARY KEY,
    grade_rule_set_id uuid NOT NULL,
    style_id uuid NOT NULL,
    revision_number bigint NOT NULL CHECK (revision_number BETWEEN 1 AND 9007199254740991),
    name varchar(160) NOT NULL CHECK (grade_text_is_canonical(name,160)),
    base_size_code varchar(40) NOT NULL CHECK (base_size_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    unit_system varchar(2) NOT NULL CHECK (unit_system IN ('MM','CM','IN')),
    notes varchar(1000) CHECK (notes IS NULL OR grade_text_is_canonical(notes,1000)),
    created_by_issuer varchar(500) NOT NULL,
    created_by_subject varchar(255) NOT NULL,
    sealed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(grade_rule_set_id,style_id) REFERENCES grade_rule_set(id,style_id),
    UNIQUE(grade_rule_set_id,revision_number),
    UNIQUE(id,style_id)
);
-- The unique revision-number index supports descending latest/history scans.
CREATE TABLE grade_size (
    revision_id uuid NOT NULL REFERENCES grade_rule_set_revision(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 29),
    code varchar(40) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$'),
    label varchar(80) NOT NULL CHECK (grade_text_is_canonical(label,80)),
    PRIMARY KEY(revision_id,code),
    UNIQUE(revision_id,position)
);
ALTER TABLE grade_rule_set_revision ADD CONSTRAINT grade_revision_base_size_fk
    FOREIGN KEY(id,base_size_code) REFERENCES grade_size(revision_id,code)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE grade_rule (
    revision_id uuid NOT NULL REFERENCES grade_rule_set_revision(id),
    position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
    code varchar(80) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,79}$'),
    label varchar(160) NOT NULL CHECK (grade_text_is_canonical(label,160)),
    notes varchar(1000) CHECK (notes IS NULL OR grade_text_is_canonical(notes,1000)),
    PRIMARY KEY(revision_id,code),
    UNIQUE(revision_id,position)
);
CREATE TABLE grade_rule_value (
    revision_id uuid NOT NULL,
    rule_code varchar(80) NOT NULL,
    size_code varchar(40) NOT NULL,
    delta numeric(19,4) NOT NULL CHECK (
        delta <> 'NaN'::numeric AND delta BETWEEN -999999999999999.9999 AND 999999999999999.9999),
    PRIMARY KEY(revision_id,rule_code,size_code),
    FOREIGN KEY(revision_id,rule_code) REFERENCES grade_rule(revision_id,code),
    FOREIGN KEY(revision_id,size_code) REFERENCES grade_size(revision_id,code)
);

CREATE FUNCTION guard_grade_rule_set_initial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'ACTIVE' OR NEW.version <> 0 THEN
        RAISE EXCEPTION 'Invalid initial grading lifecycle';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER grade_rule_set_initial BEFORE INSERT ON grade_rule_set
    FOR EACH ROW EXECUTE FUNCTION guard_grade_rule_set_initial();
CREATE FUNCTION guard_grade_rule_set_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.style_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.style_id,OLD.created_at)
        OR NEW.status=OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'Invalid grading lifecycle transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER grade_rule_set_lifecycle BEFORE UPDATE ON grade_rule_set
    FOR EACH ROW EXECUTE FUNCTION guard_grade_rule_set_lifecycle();

CREATE FUNCTION guard_grade_revision_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status varchar; latest bigint;
BEGIN
    SELECT status INTO current_status FROM grade_rule_set WHERE id=NEW.grade_rule_set_id FOR UPDATE;
    IF NOT FOUND OR current_status<>'ACTIVE' THEN RAISE EXCEPTION 'Active grading aggregate required'; END IF;
    SELECT coalesce(max(revision_number),0) INTO latest FROM grade_rule_set_revision
        WHERE grade_rule_set_id=NEW.grade_rule_set_id;
    IF NEW.sealed OR NEW.revision_number<>latest+1 THEN RAISE EXCEPTION 'Invalid grading revision sequence'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER grade_revision_sequence BEFORE INSERT ON grade_rule_set_revision
    FOR EACH ROW EXECUTE FUNCTION guard_grade_revision_sequence();
CREATE FUNCTION guard_grade_child_construction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE construction boolean;
BEGIN
    SELECT NOT sealed INTO construction FROM grade_rule_set_revision WHERE id=NEW.revision_id FOR UPDATE;
    IF construction IS DISTINCT FROM true THEN RAISE EXCEPTION 'Grading revision is not under construction'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER grade_size_construction BEFORE INSERT ON grade_size
    FOR EACH ROW EXECUTE FUNCTION guard_grade_child_construction();
CREATE TRIGGER grade_rule_construction BEFORE INSERT ON grade_rule
    FOR EACH ROW EXECUTE FUNCTION guard_grade_child_construction();
CREATE TRIGGER grade_value_construction BEFORE INSERT ON grade_rule_value
    FOR EACH ROW EXECUTE FUNCTION guard_grade_child_construction();
CREATE FUNCTION guard_grade_revision_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.sealed OR NOT NEW.sealed OR
        ROW(NEW.id,NEW.grade_rule_set_id,NEW.style_id,NEW.revision_number,NEW.name,NEW.base_size_code,
            NEW.unit_system,NEW.notes,NEW.created_by_issuer,NEW.created_by_subject,NEW.created_at)
        IS DISTINCT FROM
        ROW(OLD.id,OLD.grade_rule_set_id,OLD.style_id,OLD.revision_number,OLD.name,OLD.base_size_code,
            OLD.unit_system,OLD.notes,OLD.created_by_issuer,OLD.created_by_subject,OLD.created_at) THEN
        RAISE EXCEPTION 'Grading revision is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER grade_revision_seal BEFORE UPDATE ON grade_rule_set_revision
    FOR EACH ROW EXECUTE FUNCTION guard_grade_revision_seal();
CREATE FUNCTION require_grade_revision_one() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM grade_rule_set_revision WHERE grade_rule_set_id=NEW.id
        AND revision_number=1 AND sealed) THEN RAISE EXCEPTION 'Grading revision one required'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER grade_rule_set_complete AFTER INSERT ON grade_rule_set
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_grade_revision_one();
CREATE FUNCTION require_grade_revision_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint; r bigint; v bigint; invalid_base bigint; lo integer; hi integer; base varchar; complete boolean;
BEGIN
    SELECT sealed,base_size_code INTO complete,base FROM grade_rule_set_revision WHERE id=NEW.id;
    IF complete IS DISTINCT FROM true THEN RAISE EXCEPTION 'Unsealed grading revision'; END IF;
    SELECT count(*),min(position),max(position) INTO s,lo,hi FROM grade_size WHERE revision_id=NEW.id;
    IF s NOT BETWEEN 2 AND 30 OR lo<>0 OR hi<>s-1 THEN RAISE EXCEPTION 'Incomplete grading sizes'; END IF;
    SELECT count(*),min(position),max(position) INTO r,lo,hi FROM grade_rule WHERE revision_id=NEW.id;
    IF r NOT BETWEEN 1 AND 100 OR lo<>0 OR hi<>r-1 THEN RAISE EXCEPTION 'Incomplete grading rules'; END IF;
    SELECT count(*),count(*) FILTER (WHERE size_code=base AND delta<>0)
        INTO v,invalid_base FROM grade_rule_value WHERE revision_id=NEW.id;
    IF v<>s*r OR NOT EXISTS (SELECT 1 FROM grade_size WHERE revision_id=NEW.id AND code=base)
        OR invalid_base<>0 THEN
        RAISE EXCEPTION 'Incomplete grading matrix or invalid base delta';
    END IF;
    RETURN NULL;
END;
$$;
-- Exactly one deferred completeness event per new revision, never per matrix cell.
CREATE CONSTRAINT TRIGGER grade_revision_complete AFTER INSERT ON grade_rule_set_revision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_grade_revision_complete();

CREATE TRIGGER grade_rule_set_no_delete BEFORE DELETE ON grade_rule_set FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_rule_set_no_truncate BEFORE TRUNCATE ON grade_rule_set FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_revision_no_delete BEFORE DELETE ON grade_rule_set_revision FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_revision_no_truncate BEFORE TRUNCATE ON grade_rule_set_revision FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_size_no_update BEFORE UPDATE ON grade_size FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_size_no_delete BEFORE DELETE ON grade_size FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_size_no_truncate BEFORE TRUNCATE ON grade_size FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_rule_no_update BEFORE UPDATE ON grade_rule FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_rule_no_delete BEFORE DELETE ON grade_rule FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_rule_no_truncate BEFORE TRUNCATE ON grade_rule FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_value_no_update BEFORE UPDATE ON grade_rule_value FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_value_no_delete BEFORE DELETE ON grade_rule_value FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER grade_value_no_truncate BEFORE TRUNCATE ON grade_rule_value FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
