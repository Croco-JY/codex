CREATE TABLE style_development_reference (
    id uuid PRIMARY KEY,
    style_id uuid NOT NULL REFERENCES style(id),
    storage_object_id uuid NOT NULL UNIQUE,
    display_name varchar(255) NOT NULL CHECK (
        btrim(display_name) <> '' AND display_name NOT IN ('.', '..')
        AND display_name !~ '[[:cntrl:]/\\]'),
    media_type varchar(64) NOT NULL CHECK (media_type = 'application/octet-stream'),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    state varchar(16) NOT NULL CHECK (state IN ('PENDING','READY','FAILED','DETACHED')),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX style_development_reference_page_idx
    ON style_development_reference(style_id, created_at DESC, id DESC);
CREATE INDEX style_development_reference_state_page_idx
    ON style_development_reference(style_id, state, created_at DESC, id DESC);

CREATE FUNCTION guard_development_reference_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.style_id,NEW.storage_object_id,NEW.display_name,NEW.media_type,NEW.size_bytes,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.style_id,OLD.storage_object_id,OLD.display_name,OLD.media_type,OLD.size_bytes,OLD.created_at)
        OR NOT ((OLD.state='PENDING' AND NEW.state IN ('READY','FAILED','DETACHED'))
            OR (OLD.state IN ('READY','FAILED') AND NEW.state='DETACHED'))
        OR NEW.version <> OLD.version+1 OR NEW.updated_at <= OLD.updated_at THEN
        RAISE EXCEPTION 'Invalid development reference transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER style_development_reference_transition BEFORE UPDATE ON style_development_reference
    FOR EACH ROW EXECUTE FUNCTION guard_development_reference_transition();
CREATE TRIGGER style_development_reference_no_delete BEFORE DELETE ON style_development_reference
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER style_development_reference_no_truncate BEFORE TRUNCATE ON style_development_reference
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
