CREATE TABLE pattern (
    id uuid PRIMARY KEY,
    style_id uuid NOT NULL REFERENCES style(id),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
    version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, style_id)
);
CREATE INDEX pattern_style_page_idx ON pattern(style_id,created_at DESC,id DESC);
CREATE INDEX pattern_style_status_page_idx ON pattern(style_id,status,created_at DESC,id DESC);
CREATE TABLE pattern_revision (
    id uuid PRIMARY KEY,
    pattern_id uuid NOT NULL,
    style_id uuid NOT NULL,
    revision_number bigint NOT NULL CHECK (revision_number BETWEEN 1 AND 9007199254740991),
    name varchar(160) NOT NULL CHECK (
        length(name) BETWEEN 1 AND 160 AND name !~ '^[[:space:]]' AND name !~ '[[:space:]]$'),
    purpose varchar(160) CHECK (purpose IS NULL OR (
        length(purpose) BETWEEN 1 AND 160 AND purpose !~ '^[[:space:]]' AND purpose !~ '[[:space:]]$')),
    measurement_revision_id uuid,
    created_by_issuer varchar(500) NOT NULL,
    created_by_subject varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (pattern_id,style_id) REFERENCES pattern(id,style_id),
    FOREIGN KEY (measurement_revision_id,style_id) REFERENCES measurement_revision(id,style_id),
    UNIQUE (pattern_id,revision_number),
    UNIQUE (id,style_id)
);
CREATE INDEX pattern_revision_history_idx ON pattern_revision(pattern_id,revision_number DESC);
CREATE FUNCTION guard_pattern_initial_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'ACTIVE' OR NEW.version <> 0 THEN
        RAISE EXCEPTION 'Invalid initial Pattern state';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_initial_state BEFORE INSERT ON pattern FOR EACH ROW EXECUTE FUNCTION guard_pattern_initial_state();
CREATE FUNCTION require_pattern_revision_one() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pattern_revision WHERE pattern_id=NEW.id AND revision_number=1)
        THEN RAISE EXCEPTION 'Pattern revision one required'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER pattern_complete AFTER INSERT ON pattern
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_pattern_revision_one();
CREATE FUNCTION guard_pattern_revision_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest bigint; current_status varchar;
BEGIN
    -- Only the owning Pattern: no upward/Measurement lock acquisition here.
    SELECT status INTO current_status FROM pattern WHERE id=NEW.pattern_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pattern missing'; END IF;
    IF current_status <> 'ACTIVE' THEN RAISE EXCEPTION 'Pattern is archived'; END IF;
    SELECT COALESCE(max(revision_number),0) INTO latest FROM pattern_revision WHERE pattern_id=NEW.pattern_id;
    IF NEW.revision_number<>latest+1 THEN RAISE EXCEPTION 'Invalid pattern revision sequence'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_revision_sequence BEFORE INSERT ON pattern_revision
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_revision_sequence();
CREATE FUNCTION guard_pattern_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.style_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.style_id,OLD.created_at)
       OR NEW.status=OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'Invalid pattern lifecycle transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_lifecycle BEFORE UPDATE ON pattern FOR EACH ROW EXECUTE FUNCTION guard_pattern_lifecycle();
CREATE TRIGGER pattern_no_delete BEFORE DELETE ON pattern FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_no_truncate BEFORE TRUNCATE ON pattern FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_revision_no_update BEFORE UPDATE ON pattern_revision FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_revision_no_delete BEFORE DELETE ON pattern_revision FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_revision_no_truncate BEFORE TRUNCATE ON pattern_revision FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
