-- Exact immutable grants. Event histories, not mutable lifecycle pointers, are truth.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM organization WHERE version < 0)
       OR EXISTS (SELECT 1 FROM project WHERE version < 0)
       OR EXISTS (SELECT 1 FROM style WHERE version < 0) THEN
        RAISE EXCEPTION 'Incompatible legacy parent version';
    END IF;
END $$;
ALTER TABLE organization ADD CONSTRAINT organization_nonnegative_version CHECK (version >= 0);
CREATE FUNCTION guard_release_parent_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.version IS NULL OR OLD.version < 0 OR OLD.version = 9223372036854775807 THEN
        RAISE EXCEPTION 'Parent version exhausted' USING ERRCODE='23514';
    END IF;
    IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
        RAISE EXCEPTION 'Exact parent version advancement required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER organization_release_version BEFORE UPDATE ON organization
    FOR EACH ROW EXECUTE FUNCTION guard_release_parent_version();
CREATE TRIGGER project_release_version BEFORE UPDATE ON project
    FOR EACH ROW EXECUTE FUNCTION guard_release_parent_version();
CREATE TRIGGER style_release_version BEFORE UPDATE ON style
    FOR EACH ROW EXECUTE FUNCTION guard_release_parent_version();

CREATE FUNCTION release_purpose_is_canonical(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT length(value) BETWEEN 1 AND 1000 AND value = btrim(value,
        U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

CREATE TABLE pattern_release_consent (
    id uuid PRIMARY KEY,
    recipient_organization_id uuid NOT NULL REFERENCES organization(id),
    intended_source_organization_id uuid NOT NULL,
    issuer varchar(500) NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
    subject varchar(255) NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (recipient_organization_id <> intended_source_organization_id),
    CHECK (expires_at = issued_at + interval '15 minutes'),
    UNIQUE (id,recipient_organization_id)
);
CREATE INDEX release_consent_recipient_page_idx ON pattern_release_consent
    (recipient_organization_id,issued_at DESC,id DESC);

CREATE TABLE pattern_release (
    id uuid PRIMARY KEY,
    consent_id uuid NOT NULL UNIQUE,
    source_organization_id uuid NOT NULL REFERENCES organization(id),
    recipient_organization_id uuid NOT NULL REFERENCES organization(id),
    project_id uuid NOT NULL REFERENCES project(id),
    style_id uuid NOT NULL REFERENCES style(id),
    pattern_id uuid NOT NULL,
    pattern_revision_id uuid NOT NULL,
    pattern_revision_number bigint NOT NULL CHECK (pattern_revision_number BETWEEN 1 AND 9007199254740991),
    artifact_id uuid NOT NULL REFERENCES pattern_artifact(id),
    storage_object_id uuid NOT NULL,
    declared_format varchar(16) NOT NULL CHECK (declared_format IN ('DXF_AAMA','DXF_ASTM','PDF')),
    display_name varchar(255) NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    purpose varchar(1000) NOT NULL CHECK (release_purpose_is_canonical(purpose)),
    access_duration_seconds integer NOT NULL CHECK (access_duration_seconds BETWEEN 1 AND 86400),
    source_version bigint NOT NULL CHECK (source_version >= 0),
    recipient_version bigint NOT NULL CHECK (recipient_version >= 0),
    project_version bigint NOT NULL CHECK (project_version >= 0),
    style_version bigint NOT NULL CHECK (style_version >= 0),
    pattern_version bigint NOT NULL CHECK (pattern_version BETWEEN 0 AND 9007199254740991),
    issuer varchar(500) NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
    subject varchar(255) NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    released_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (source_organization_id <> recipient_organization_id),
    CHECK (expires_at = released_at + access_duration_seconds * interval '1 second'),
    FOREIGN KEY (consent_id,recipient_organization_id)
        REFERENCES pattern_release_consent(id,recipient_organization_id),
    FOREIGN KEY (pattern_id,style_id) REFERENCES pattern(id,style_id),
    FOREIGN KEY (pattern_revision_id,style_id) REFERENCES pattern_revision(id,style_id),
    UNIQUE (id,source_organization_id),
    UNIQUE (id,consent_id,recipient_organization_id)
);
CREATE INDEX release_source_revision_page_idx ON pattern_release
    (source_organization_id,pattern_revision_id,released_at DESC,id DESC);
CREATE INDEX release_recipient_page_idx ON pattern_release
    (recipient_organization_id,released_at DESC,id DESC);

CREATE TABLE pattern_release_consent_event (
    id uuid PRIMARY KEY,
    consent_id uuid NOT NULL,
    recipient_organization_id uuid NOT NULL,
    event_number bigint NOT NULL CHECK (event_number BETWEEN 1 AND 9007199254740991),
    kind varchar(16) NOT NULL CHECK (kind IN ('ISSUED','CONSUMED','WITHDRAWN')),
    release_id uuid,
    actor_organization_id uuid NOT NULL REFERENCES organization(id),
    issuer varchar(500) NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
    subject varchar(255) NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (consent_id,recipient_organization_id)
        REFERENCES pattern_release_consent(id,recipient_organization_id),
    FOREIGN KEY (release_id,consent_id,recipient_organization_id)
        REFERENCES pattern_release(id,consent_id,recipient_organization_id),
    CHECK ((kind='CONSUMED') = (release_id IS NOT NULL)),
    UNIQUE (consent_id,event_number)
);
CREATE UNIQUE INDEX release_consent_consumed_once ON pattern_release_consent_event(consent_id)
    WHERE kind='CONSUMED';
CREATE TABLE pattern_release_event (
    id uuid PRIMARY KEY,
    release_id uuid NOT NULL,
    source_organization_id uuid NOT NULL,
    event_number bigint NOT NULL CHECK (event_number BETWEEN 1 AND 9007199254740991),
    kind varchar(16) NOT NULL CHECK (kind IN ('ACTIVATED','REVOKED')),
    actor_organization_id uuid NOT NULL REFERENCES organization(id),
    issuer varchar(500) NOT NULL CHECK (length(issuer) BETWEEN 1 AND 500),
    subject varchar(255) NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
    occurred_at timestamptz NOT NULL,
    FOREIGN KEY (release_id,source_organization_id) REFERENCES pattern_release(id,source_organization_id),
    CHECK (actor_organization_id = source_organization_id),
    UNIQUE (release_id,event_number),
    UNIQUE (release_id,kind)
);

-- New flows always acquire real PostgreSQL UUID-ordered roots before descendants.
-- Recipient withdrawal uses only its recipient root and consent, never source lookup.
CREATE FUNCTION lock_release_parents(src uuid, recipient uuid, proj uuid, sty uuid, pat uuid,
                                     require_recipient_active boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM organization WHERE id IN (src,recipient) ORDER BY id FOR NO KEY UPDATE;
    IF src=recipient OR NOT EXISTS (SELECT 1 FROM organization WHERE id=src AND status='ACTIVE')
       OR NOT EXISTS (SELECT 1 FROM organization WHERE id=recipient
                       AND (NOT require_recipient_active OR status='ACTIVE')) THEN
        RAISE EXCEPTION 'Release Organization unavailable' USING ERRCODE='23514';
    END IF;
    PERFORM id FROM project WHERE id=proj AND organization_id=src AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Release Project unavailable' USING ERRCODE='23514'; END IF;
    PERFORM id FROM style WHERE id=sty AND project_id=proj AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Release Style unavailable' USING ERRCODE='23514'; END IF;
    PERFORM id FROM pattern WHERE id=pat AND style_id=sty AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Release Pattern unavailable' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION guard_release_consent_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM id FROM organization WHERE id=NEW.recipient_organization_id AND status='ACTIVE'
        FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='23514'; END IF;
    -- No intended-source lookup/FK: its UUID is opaque at recipient issuance.
    NEW.issued_at := clock_timestamp();
    NEW.expires_at := NEW.issued_at + interval '15 minutes';
    RETURN NEW;
END $$;
CREATE TRIGGER release_consent_insert BEFORE INSERT ON pattern_release_consent
    FOR EACH ROW EXECUTE FUNCTION guard_release_consent_insert();

CREATE FUNCTION guard_pattern_release_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c pattern_release_consent%ROWTYPE; head_kind varchar;
BEGIN
    PERFORM lock_release_parents(NEW.source_organization_id,NEW.recipient_organization_id,
        NEW.project_id,NEW.style_id,NEW.pattern_id,true);
    SELECT * INTO c FROM pattern_release_consent WHERE id=NEW.consent_id FOR UPDATE;
    IF NOT FOUND OR c.recipient_organization_id<>NEW.recipient_organization_id
       OR c.intended_source_organization_id<>NEW.source_organization_id THEN
        RAISE EXCEPTION 'Consent unavailable' USING ERRCODE='23514';
    END IF;
    SELECT kind INTO head_kind FROM pattern_release_consent_event WHERE consent_id=c.id
        ORDER BY event_number DESC LIMIT 1;
    IF head_kind IS DISTINCT FROM 'ISSUED' OR clock_timestamp()>=c.expires_at THEN
        RAISE EXCEPTION 'Consent cannot be redeemed' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pattern_revision r JOIN pattern_artifact a
            ON a.pattern_revision_id=r.id AND a.style_id=r.style_id
        WHERE r.id=NEW.pattern_revision_id AND r.pattern_id=NEW.pattern_id
          AND r.style_id=NEW.style_id AND r.revision_number=NEW.pattern_revision_number
          AND a.id=NEW.artifact_id AND a.state='READY'
          AND (a.storage_object_id,a.declared_format,a.display_name,a.size_bytes,a.sha256)
              = (NEW.storage_object_id,NEW.declared_format,NEW.display_name,NEW.size_bytes,NEW.sha256)
    ) THEN RAISE EXCEPTION 'Exact READY artifact binding required' USING ERRCODE='23514'; END IF;
    IF NEW.source_version<>(SELECT version FROM organization WHERE id=NEW.source_organization_id)
       OR NEW.recipient_version<>(SELECT version FROM organization WHERE id=NEW.recipient_organization_id)
       OR NEW.project_version<>(SELECT version FROM project WHERE id=NEW.project_id)
       OR NEW.style_version<>(SELECT version FROM style WHERE id=NEW.style_id)
       OR NEW.pattern_version<>(SELECT version FROM pattern WHERE id=NEW.pattern_id) THEN
        RAISE EXCEPTION 'Release parent version mismatch' USING ERRCODE='23514';
    END IF;
    NEW.released_at := clock_timestamp();
    NEW.expires_at := NEW.released_at + NEW.access_duration_seconds * interval '1 second';
    RETURN NEW;
END $$;
CREATE TRIGGER pattern_release_insert BEFORE INSERT ON pattern_release
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_release_insert();

CREATE FUNCTION guard_release_consent_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c pattern_release_consent%ROWTYPE; r pattern_release%ROWTYPE; head bigint; previous varchar;
BEGIN
    SELECT * INTO c FROM pattern_release_consent WHERE id=NEW.consent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consent missing' USING ERRCODE='23514'; END IF;
    IF NEW.kind='CONSUMED' THEN
        SELECT * INTO r FROM pattern_release WHERE id=NEW.release_id AND consent_id=c.id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Consumed release missing' USING ERRCODE='23514'; END IF;
        PERFORM lock_release_parents(r.source_organization_id,r.recipient_organization_id,
            r.project_id,r.style_id,r.pattern_id,true);
        IF (NEW.actor_organization_id,NEW.issuer,NEW.subject) IS DISTINCT FROM
           (r.source_organization_id,r.issuer,r.subject) THEN
            RAISE EXCEPTION 'Consumption Actor mismatch' USING ERRCODE='23514';
        END IF;
    ELSE
        PERFORM id FROM organization WHERE id=c.recipient_organization_id AND status='ACTIVE'
            FOR NO KEY UPDATE;
        IF NOT FOUND OR NEW.actor_organization_id<>c.recipient_organization_id THEN
            RAISE EXCEPTION 'Recipient Actor required' USING ERRCODE='23514';
        END IF;
    END IF;
    PERFORM id FROM pattern_release_consent WHERE id=c.id FOR UPDATE;
    SELECT event_number,kind INTO head,previous FROM pattern_release_consent_event
        WHERE consent_id=c.id ORDER BY event_number DESC LIMIT 1;
    head := COALESCE(head,0);
    IF head>=9007199254740991 OR NEW.event_number<>head+1
       OR NOT ((head=0 AND NEW.kind='ISSUED')
            OR (head=1 AND previous='ISSUED' AND NEW.kind IN ('CONSUMED','WITHDRAWN'))
            OR (head=2 AND previous='CONSUMED' AND NEW.kind='WITHDRAWN')) THEN
        RAISE EXCEPTION 'Invalid consent event transition' USING ERRCODE='23514';
    END IF;
    IF NEW.recipient_organization_id<>c.recipient_organization_id
       OR (NEW.kind='ISSUED' AND (NEW.issuer,NEW.subject) IS DISTINCT FROM (c.issuer,c.subject))
       OR (NEW.kind='CONSUMED' AND clock_timestamp()>=c.expires_at) THEN
        RAISE EXCEPTION 'Invalid consent event context' USING ERRCODE='23514';
    END IF;
    NEW.occurred_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER release_consent_event_insert BEFORE INSERT ON pattern_release_consent_event
    FOR EACH ROW EXECUTE FUNCTION guard_release_consent_event();

CREATE FUNCTION guard_pattern_release_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r pattern_release%ROWTYPE; head bigint;
BEGIN
    SELECT * INTO r FROM pattern_release WHERE id=NEW.release_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Release missing' USING ERRCODE='23514'; END IF;
    PERFORM lock_release_parents(r.source_organization_id,r.recipient_organization_id,
        r.project_id,r.style_id,r.pattern_id,false);
    PERFORM id FROM pattern_release_consent WHERE id=r.consent_id FOR UPDATE;
    PERFORM id FROM pattern_release WHERE id=r.id FOR UPDATE;
    SELECT COALESCE(max(event_number),0) INTO head FROM pattern_release_event WHERE release_id=r.id;
    IF NEW.source_organization_id<>r.source_organization_id OR NEW.event_number<>head+1
       OR NOT ((head=0 AND NEW.kind='ACTIVATED') OR (head=1 AND NEW.kind='REVOKED'))
       OR (NEW.kind='ACTIVATED' AND (NEW.issuer,NEW.subject) IS DISTINCT FROM (r.issuer,r.subject)) THEN
        RAISE EXCEPTION 'Invalid release event transition' USING ERRCODE='23514';
    END IF;
    NEW.occurred_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER pattern_release_event_insert BEFORE INSERT ON pattern_release_event
    FOR EACH ROW EXECUTE FUNCTION guard_pattern_release_event();

CREATE FUNCTION require_release_consent_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pattern_release_consent_event
                   WHERE consent_id=NEW.id AND event_number=1 AND kind='ISSUED') THEN
        RAISE EXCEPTION 'Initial consent event required' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER release_consent_complete AFTER INSERT ON pattern_release_consent
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_release_consent_complete();
CREATE FUNCTION require_pattern_release_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pattern_release_event
                   WHERE release_id=NEW.id AND event_number=1 AND kind='ACTIVATED')
       OR NOT EXISTS (SELECT 1 FROM pattern_release_consent_event
                       WHERE consent_id=NEW.consent_id AND release_id=NEW.id AND kind='CONSUMED') THEN
        RAISE EXCEPTION 'Paired activation and consumption required' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pattern_release_complete AFTER INSERT ON pattern_release
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_pattern_release_complete();

DO $$ DECLARE t text; operation text; BEGIN
    FOREACH t IN ARRAY ARRAY['pattern_release_consent','pattern_release_consent_event',
                             'pattern_release','pattern_release_event'] LOOP
        FOREACH operation IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE'] LOOP
            EXECUTE format('CREATE TRIGGER %I BEFORE %s ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_workspace_destruction()',
                t||'_no_'||lower(operation),operation,t);
        END LOOP;
    END LOOP;
END $$;
