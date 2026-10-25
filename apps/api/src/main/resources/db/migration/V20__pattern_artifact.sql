-- The released V19 statement-level no-update trigger remains installed and enabled.
ALTER TABLE pattern_revision ADD COLUMN artifact_expected boolean NOT NULL DEFAULT false;
CREATE TABLE pattern_artifact (
    id uuid PRIMARY KEY,
    pattern_revision_id uuid NOT NULL UNIQUE,
    style_id uuid NOT NULL,
    storage_object_id uuid NOT NULL UNIQUE,
    declared_format varchar(16) NOT NULL CHECK (declared_format IN ('DXF_AAMA','DXF_ASTM','PDF')),
    display_name varchar(255) NOT NULL CHECK (
        length(display_name) BETWEEN 1 AND 255
        AND display_name !~ '^[[:space:]]' AND display_name !~ '[[:space:]]$'
        AND display_name NOT IN ('.','..') AND display_name !~ '[[:cntrl:]/\\]'),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    probe_version smallint NOT NULL DEFAULT 1 CHECK (probe_version=1),
    state varchar(16) NOT NULL CHECK (state IN ('PENDING','READY','FAILED')),
    failure_code varchar(32),
    version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (pattern_revision_id,style_id) REFERENCES pattern_revision(id,style_id),
    CHECK ((state IN ('PENDING','READY') AND failure_code IS NULL) OR
           (state='FAILED' AND failure_code IS NOT NULL AND failure_code IN
             ('STORAGE_WRITE_FAILED','STORAGE_READBACK_FAILED','STORAGE_INTEGRITY_MISMATCH')))
);
CREATE FUNCTION guard_pattern_artifact_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.state<>'PENDING' OR NEW.version<>0 OR NEW.failure_code IS NOT NULL OR NEW.probe_version<>1 THEN
        RAISE EXCEPTION 'Invalid initial artifact state';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pattern_revision WHERE id=NEW.pattern_revision_id
                   AND style_id=NEW.style_id AND artifact_expected) THEN
        RAISE EXCEPTION 'Revision was not constructed for an artifact';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_artifact_insert BEFORE INSERT ON pattern_artifact
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_artifact_insert();
CREATE FUNCTION require_pattern_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.artifact_expected AND
       (SELECT count(*) FROM pattern_artifact WHERE pattern_revision_id=NEW.id)<>1 THEN
        RAISE EXCEPTION 'Expected artifact required';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER pattern_revision_artifact_complete AFTER INSERT ON pattern_revision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_pattern_artifact();
CREATE FUNCTION guard_pattern_artifact_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.id,NEW.pattern_revision_id,NEW.style_id,NEW.storage_object_id,NEW.declared_format,
           NEW.display_name,NEW.size_bytes,NEW.sha256,NEW.probe_version,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.pattern_revision_id,OLD.style_id,OLD.storage_object_id,OLD.declared_format,
           OLD.display_name,OLD.size_bytes,OLD.sha256,OLD.probe_version,OLD.created_at)
       OR OLD.state<>'PENDING' OR NEW.state NOT IN ('READY','FAILED')
       OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
        RAISE EXCEPTION 'Invalid artifact transition';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pattern_artifact_transition BEFORE UPDATE ON pattern_artifact
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_artifact_transition();
CREATE TRIGGER pattern_artifact_no_delete BEFORE DELETE ON pattern_artifact
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
CREATE TRIGGER pattern_artifact_no_truncate BEFORE TRUNCATE ON pattern_artifact
    FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction();
